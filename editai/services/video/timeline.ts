import type { EditingPlan } from "@/lib/editing-plan";
import { findOperation, findOperations } from "@/lib/editing-plan/validate";
import type { TimeRange, TranscriptWord, VideoMetadata } from "@/types/video";
import { normalizeText } from "@/utils/text";
import { dropTiny, intersect, normalizeRanges, round3, subtract, totalDuration } from "./ranges";

/**
 * Timeline de edição: decide QUAIS trechos do vídeo original permanecem e
 * como o tempo original é mapeado para o tempo do vídeo final.
 *
 * Toda renderização parte do vídeo ORIGINAL + plano cumulativo. Isso evita perda
 * de qualidade a cada versão e permite desfazer ("remova o zoom").
 */
export interface EditTimeline {
  /** Trechos mantidos, em segundos do vídeo original. */
  segments: TimeRange[];
  speed: number;
  sourceDuration: number;
  outputDuration: number;
  /** Trechos removidos (para a timeline visual). */
  removed: TimeRange[];
  warnings: string[];
}

const FILLERS = new Set(["e", "eh", "ehh", "ee", "eee", "hum", "hmm", "humm", "ahn", "an", "tipo", "ne", "aham", "uhm", "um", "uh"]);
const FILLER_ONLY = new Set(["eh", "ehh", "ee", "eee", "hum", "hmm", "humm", "ahn", "uhm", "um", "uh"]);
const MIN_SEGMENT = 0.12;

export function buildTimeline(metadata: VideoMetadata, plan: EditingPlan, silences?: TimeRange[]): EditTimeline {
  const warnings: string[] = [];
  const duration = metadata.duration;
  let segments: TimeRange[] = [{ start: 0, end: duration }];

  const trim = findOperation(plan, "trim");
  if (trim) {
    const end = Math.min(trim.end ?? duration, duration);
    if (trim.start >= end) warnings.push("O corte pedido ficou fora da duração do vídeo e foi ignorado.");
    else segments = intersect(segments, { start: trim.start, end });
  }

  const cuts = findOperations(plan, "cut").flatMap((c) => c.ranges);
  if (cuts.length) segments = subtract(segments, cuts);

  const silence = findOperation(plan, "remove_silence");
  if (silence) {
    if (!metadata.hasAudio) warnings.push("O vídeo não tem áudio — não há silêncios para remover.");
    else {
      const pad = silence.paddingMs / 1000;
      const detected = silences ?? metadata.silences;
      const removable = detected
        .filter((s) => s.end - s.start >= silence.minSilenceMs / 1000)
        .map((s) => ({
          // Mantém respiro, exceto no começo/fim do vídeo (silêncio total).
          start: s.start <= 0.05 ? 0 : s.start + pad,
          end: s.end >= duration - 0.05 ? duration : s.end - pad,
        }))
        .filter((s) => s.end - s.start > 0.05);
      segments = subtract(segments, removable);
    }
  }

  const retakes = findOperation(plan, "remove_retakes");
  if (retakes) {
    if (!metadata.transcript?.segments.length) {
      warnings.push("Para remover erros e repetições precisamos da transcrição do vídeo, que não está disponível.");
    } else {
      segments = subtract(segments, detectRetakes(metadata, retakes.removeFillers));
    }
  }

  segments = dropTiny(normalizeRanges(segments), MIN_SEGMENT);

  const speedOp = findOperation(plan, "speed");
  const speed = speedOp?.factor ?? 1;

  const shorten = findOperation(plan, "shorten");
  if (shorten) {
    const budget = shorten.targetSeconds * speed; // em segundos do original
    if (totalDuration(segments) > budget) {
      segments =
        shorten.strategy === "highlights" && metadata.transcript?.segments.length
          ? pickHighlights(segments, metadata, budget)
          : takeFromStart(segments, budget);
    }
  }

  if (!segments.length) {
    warnings.push("A edição removeria o vídeo inteiro; mantivemos o vídeo completo.");
    segments = [{ start: 0, end: duration }];
  }

  segments = segments.map((s) => ({ start: round3(s.start), end: round3(s.end) }));
  const kept = totalDuration(segments);
  return {
    segments,
    speed,
    sourceDuration: duration,
    outputDuration: round3(kept / speed),
    removed: subtract([{ start: 0, end: duration }], segments),
    warnings,
  };
}

/** Converte um instante do vídeo original para o vídeo final (null se foi cortado). */
export function sourceToOutput(timeline: EditTimeline, t: number): number | null {
  let acc = 0;
  for (const s of timeline.segments) {
    if (t >= s.start && t <= s.end) return (acc + (t - s.start)) / timeline.speed;
    acc += s.end - s.start;
  }
  return null;
}

/** Palavras da transcrição reposicionadas no tempo do vídeo final. */
export function mapWordsToOutput(timeline: EditTimeline, words: TranscriptWord[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    const start = sourceToOutput(timeline, Math.max(w.start, 0));
    const end = sourceToOutput(timeline, w.end);
    const midOut = sourceToOutput(timeline, mid);
    if (midOut === null) continue;
    const s = start ?? midOut;
    const e = end ?? midOut + 0.2;
    out.push({ word: w.word, start: round3(s), end: round3(Math.max(e, s + 0.08)) });
  }
  return out;
}

function detectRetakes(metadata: VideoMetadata, removeFillers: boolean): TimeRange[] {
  const transcript = metadata.transcript!;
  const remove: TimeRange[] = [];
  const segs = transcript.segments;
  // Frase recomeçada: o próximo segmento começa com as mesmas 3 palavras.
  for (let i = 0; i < segs.length - 1; i++) {
    const a = normalizeText(segs[i]!.text).split(" ").slice(0, 3).join(" ");
    const b = normalizeText(segs[i + 1]!.text).split(" ").slice(0, 3).join(" ");
    if (a.length >= 6 && a === b) remove.push({ start: segs[i]!.start, end: segs[i + 1]!.start });
  }
  if (removeFillers) {
    for (const w of transcript.words) {
      const n = normalizeText(w.word);
      if (FILLER_ONLY.has(n) || (FILLERS.has(n) && w.end - w.start > 0.45)) {
        remove.push({ start: w.start, end: w.end });
      }
    }
  }
  return remove;
}

function takeFromStart(segments: TimeRange[], budget: number): TimeRange[] {
  const out: TimeRange[] = [];
  let left = budget;
  for (const s of segments) {
    if (left <= MIN_SEGMENT) break;
    const len = s.end - s.start;
    out.push(len <= left ? s : { start: s.start, end: s.start + left });
    left -= Math.min(len, left);
  }
  return out;
}

/**
 * Seleciona as frases mais "densas" (mais palavras por segundo e palavras
 * relevantes), sempre mantendo a primeira frase (o gancho) e a ordem original.
 */
function pickHighlights(segments: TimeRange[], metadata: VideoMetadata, budget: number): TimeRange[] {
  const sentences = metadata.transcript!.segments.flatMap((seg) =>
    intersect(segments, seg).map((r) => ({ range: r, text: seg.text })),
  );
  if (!sentences.length) return takeFromStart(segments, budget);
  const scored = sentences.map((s, index) => {
    const words = normalizeText(s.text).split(" ").filter(Boolean);
    const len = Math.max(0.5, s.range.end - s.range.start);
    const relevant = words.filter((w) => w.length > 5).length;
    const score = (words.length / len) * 0.6 + relevant * 0.4 + (index === 0 ? 100 : 0);
    return { ...s, index, score };
  });
  const chosen: typeof scored = [];
  let used = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    const len = s.range.end - s.range.start;
    if (used + len > budget) continue;
    chosen.push(s);
    used += len;
  }
  if (!chosen.length) return takeFromStart(segments, budget);
  return normalizeRanges(chosen.sort((a, b) => a.index - b.index).map((c) => c.range));
}
