/**
 * Funções puras (testadas com vitest) usadas pelo worker do Whisper:
 *  - planPieces: VAD por energia + divisão do áudio em pedaços <= 28 s cortando NO MEIO DE SILÊNCIOS
 *    (não usar chunk_length_s do pipeline: começar um pedaço no meio de uma palavra faz o Whisper
 *    base/small com timestamps alucinar em laço — verificado com transformers.js 4.3.0).
 *  - cleanPieceWords: remove palavras além do fim do pedaço (o laço de "seek" do 4.3.0 continua
 *    decodificando o enchimento de zeros até 30 s) e corta laços de repetição.
 */
export const SAMPLE_RATE = 16_000;

export interface Piece {
  start: number; // segundos no áudio original
  end: number;
  speechSec: number;
}

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

export function planPieces(
  samples: Float32Array,
  { maxSec = 28, minSec = 8, frameSec = 0.02, minSpeechSec = 0.3 } = {},
): Piece[] {
  const hop = Math.round(frameSec * SAMPLE_RATE);
  const n = Math.floor(samples.length / hop);
  if (n === 0) return [];
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += samples[j]! * samples[j]!;
    db[i] = 10 * Math.log10(s / hop + 1e-10);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(n * 0.1)]!;
  const peak = sorted[Math.min(n - 1, Math.floor(n * 0.98))]!;
  const thr = Math.max(floor + 6, Math.min(peak - 25, -35)); // abaixo disto = silêncio
  const silent = Array.from(db, (v) => v < thr);

  const maxF = Math.round(maxSec / frameSec);
  const minF = Math.round(minSec / frameSec);
  const cuts: Array<[number, number]> = [];
  let start = 0;
  while (start < n) {
    if (n - start <= maxF) {
      cuts.push([start, n]);
      break;
    }
    let best = -1;
    let bestLen = 0;
    let runStart = -1;
    for (let f = start + minF; f < start + maxF; f++) {
      if (silent[f]) {
        if (runStart < 0) runStart = f;
        const len = f - runStart + 1;
        if (len > bestLen) {
          bestLen = len;
          best = runStart + Math.floor(len / 2);
        }
      } else runStart = -1;
    }
    if (best < 0) {
      let m = Infinity;
      for (let f = start + minF; f < start + maxF; f++) if (db[f]! < m) { m = db[f]!; best = f; }
    }
    cuts.push([start, best]);
    start = best;
  }
  const total = samples.length / SAMPLE_RATE;
  return cuts
    .map(([a, b]) => {
      let speech = 0;
      for (let f = a; f < b; f++) if (!silent[f]) speech++;
      return { start: a * frameSec, end: Math.min(b * frameSec, total), speechSec: speech * frameSec };
    })
    .filter((p) => p.speechSec >= minSpeechSec); // pedaço só de silêncio: pula (evita "Legendas pela comunidade Amara.org")
}

/** Alucinações clássicas do Whisper em PT quando há silêncio/música. */
const ALWAYS_HALLUCINATED = [/amara\.org/i, /legendas? (pela|por) comunidade/i];
export const HALLUCINATION_PATTERNS = [...ALWAYS_HALLUCINATED, /^(obrigad[oa]|valeu) por assistir/i, /inscreva-se no canal/i];

export function cleanPieceWords(words: TimedWord[], pieceDur: number, speechSec = 0): { words: TimedWord[]; loopTrimmed: boolean } {
  let ws = words
    .filter((w) => w.word.length > 0 && w.start < pieceDur - 0.02)
    .map((w) => ({ ...w, end: Math.min(Math.max(w.end, w.start + 0.05), pieceDur) }));
  // Laço com os tempos jogados para depois do fim do pedaço: o filtro acima esvazia a
  // lista antes da busca de n-gramas, então a maior parte "sumindo" também conta como laço.
  let loopTrimmed = words.length >= 20 && ws.length < words.length / 2;
  const key = (from: number, len: number) => ws.slice(from, from + len).map((w) => w.word.toLowerCase()).join(" ");
  // Laço = mesmo n-grama repetido em sequência: 1–2 palavras 4x ("não não não" é fala real), 3–8 palavras 3x.
  outer: for (let len = 1; len <= 8; len++) {
    const minRepeats = len <= 2 ? 4 : 3;
    for (let i = 0; i + len * minRepeats <= ws.length; i++) {
      const g = key(i, len);
      let k = 1;
      while (key(i + k * len, len) === g) k++;
      if (k >= minRepeats) {
        ws = ws.slice(0, i + len);
        loopTrimmed = true;
        break outer;
      }
    }
  }
  // Créditos de legenda (Amara) são sempre alucinação. Despedidas ("Obrigado por assistir",
  // "inscreva-se no canal") só são descartadas quando são quase tudo o que veio E quase não
  // há fala no áudio do pedaço: uma despedida real no fim do vídeo fica.
  const text = ws.map((w) => w.word).join(" ");
  if (ALWAYS_HALLUCINATED.some((r) => r.test(text))) return { words: [], loopTrimmed };
  if (ws.length <= 8 && speechSec < 1 && HALLUCINATION_PATTERNS.some((r) => r.test(text))) return { words: [], loopTrimmed };
  return { words: ws, loopTrimmed };
}

/** Converte a saída do pipeline (chunks por palavra) em palavras limpas. */
export function chunksToWords(chunks: Array<{ text: string; timestamp: [number | null, number | null] | number[] }> | undefined): TimedWord[] {
  return (chunks ?? [])
    .map((c) => {
      const start = Number(c.timestamp[0] ?? 0);
      const endRaw = c.timestamp[1];
      return { word: c.text.trim(), start, end: endRaw == null ? start + 0.3 : Number(endRaw) };
    })
    .filter((w) => w.word.length > 0 && Number.isFinite(w.start));
}
