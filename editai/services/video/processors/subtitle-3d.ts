import type { TranscriptWord } from "@/types/video";
import { assColor, dialogue, escapeAssText, mixColor, tagColor } from "./ass";
import { measureText } from "./font-metrics";
import { chunkWords, SUBTITLE_SIZE_FACTOR, type VerticalBand } from "./subtitle-layout";

/**
 * Legenda "3D": letras grandes em maiúsculas com extrusão (lateral colorida),
 * sombra difusa, leve perspectiva e karaokê (a palavra falada cresce e muda de
 * cor). Tudo em ASS puro, sem fontes ou programas extras.
 *
 * Camadas por bloco de palavras (de baixo para cima):
 *   0      sombra difusa (preta, \blur)
 *   1..K   extrusão: K cópias deslocadas na cor da lateral (a mais distante é o aro escuro)
 *   K+1    face (cor principal + contorno escuro) com o karaokê
 * O destaque do karaokê é feito com \t dentro do mesmo evento, então o custo é
 * K + 2 eventos por bloco.
 */

export interface Subtitle3DOptions {
  position: "top" | "center" | "bottom";
  size: keyof typeof SUBTITLE_SIZE_FACTOR;
  /** Cor da face. */
  color: string;
  /** Cor da palavra falada. */
  highlightColor: string;
  maxWordsPerLine: number;
  /**
   * Modo econômico (vídeos longos ou 1080p): karaokê só troca a cor (sem
   * crescer) e a sombra fica dura (sem \blur). Custa ~20% menos no filtro.
   */
  economy?: boolean;
  /** Cor da lateral (extrusão). */
  extrudeColor?: string;
}

const DEFAULT_EXTRUDE = "#7C3AED";
const MAX_LAYERS = 4;
const KARAOKE_SCALE = 112;
const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface Subtitle3DParams {
  fontSize: number;
  outline: number;
  depth: number;
  layers: number;
  stepX: number;
  stepY: number;
  frx: number;
  fax: number;
  shadowBlur: number;
  x: number;
  y: number;
  alignment: number;
  marginLR: number;
  marginV: number;
}

export function subtitle3dParams(W: number, H: number, o: Subtitle3DOptions): Subtitle3DParams {
  const portrait = W < H;
  // A extrusão "come" área visual: +8% no vertical; no horizontal (altura menor) +15%.
  const fontSize = Math.round(H * SUBTITLE_SIZE_FACTOR[o.size] * (portrait ? 1.08 : 1.15));
  const outline = Math.max(2, Math.round(fontSize * 0.075));
  const depth = Math.max(3, Math.round(fontSize * 0.2));
  // Passo <= contorno => extrusão contínua. 3 camadas ficam iguais a 7 e custam ~37% menos.
  const layers = clamp(Math.ceil(depth / outline), 2, MAX_LAYERS);
  const step = depth / layers;
  const alignment = o.position === "top" ? 8 : o.position === "center" ? 5 : 2;
  const marginV = Math.round(H * (o.position === "center" ? 0 : portrait ? 0.14 : 0.1));
  const marginLR = Math.round(W * 0.07);
  const y = o.position === "top" ? marginV : o.position === "center" ? Math.round(H / 2) : H - marginV;
  return {
    fontSize,
    outline,
    depth,
    layers,
    stepX: r1(step * 0.45),
    stepY: r1(step),
    frx: 12,
    fax: -0.06,
    shadowBlur: Math.max(2, Math.round(fontSize * 0.1)),
    x: Math.round(W / 2),
    y,
    alignment,
    marginLR,
    marginV,
  };
}

/** Faixa vertical que a legenda 3D pode ocupar: 2 linhas, palavra ativa a 112% e extrusão. */
export function subtitle3dBand(W: number, H: number, o: Subtitle3DOptions): VerticalBand {
  const p = subtitle3dParams(W, H, o);
  const blockH = 2 * p.fontSize * (KARAOKE_SCALE / 100) + p.depth + p.outline * 2;
  if (p.alignment === 2) return { top: Math.round(p.y - blockH), bottom: Math.round(p.y + p.depth + p.outline) };
  if (p.alignment === 8) return { top: Math.round(p.y - p.outline), bottom: Math.round(p.y + blockH) };
  return { top: Math.round(p.y - blockH / 2), bottom: Math.round(p.y + blockH / 2) };
}

export function subtitle3dStyle(W: number, H: number, o: Subtitle3DOptions, family: string): string {
  const p = subtitle3dParams(W, H, o);
  return `Style: Sub3D,${family},${p.fontSize},${assColor(o.color)},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${p.outline},0,${p.alignment},${p.marginLR},${p.marginLR},${p.marginV},1`;
}

export interface ChunkLayout {
  /** Índice da palavra que começa a 2ª linha (null = 1 linha). */
  breakBefore: number | null;
  /** Fator aplicado a todas as \fscx/\fscy (encolhe blocos que não cabem). */
  scale: number;
}

const wordText = (w: TranscriptWord) => escapeAssText(w.word.toUpperCase());

/**
 * Quebra própria (balanceada, no máximo 2 linhas) com a métrica da Inter Bold,
 * reservando espaço para a palavra ativa crescer. Com \q2 o libass não
 * re-quebra, então o bloco não "pula" quando a palavra ativa cresce.
 */
export function layoutChunk(chunk: TranscriptWord[], fontSize: number, maxWidth: number, karaokeScale: number): ChunkLayout {
  const widths = chunk.map((w) => measureText(wordText(w), fontSize));
  const space = measureText(" ", fontSize);
  const extra = (Math.max(...widths) * (karaokeScale - 100)) / 100;
  const lineW = (a: number, b: number) => widths.slice(a, b).reduce((s, w) => s + w, 0) + space * (b - a - 1) + extra;
  const total = lineW(0, chunk.length);
  if (total <= maxWidth || chunk.length === 1) {
    return { breakBefore: null, scale: total > 0 ? Math.min(1, maxWidth / total) : 1 };
  }
  let best = 1;
  let bestW = Infinity;
  for (let k = 1; k < chunk.length; k++) {
    const w = Math.max(lineW(0, k), lineW(k, chunk.length));
    // Empate: prefere a linha de cima menor (pirâmide).
    if (w < bestW - 0.5 || (Math.abs(w - bestW) <= 0.5 && lineW(0, k) <= lineW(0, best))) {
      best = k;
      bestW = w;
    }
  }
  return { breakBefore: best, scale: Math.min(1, maxWidth / bestW) };
}

type Role = "face" | "side" | "shadow";

/**
 * Texto de um bloco com as tags por palavra. Todas as camadas recebem as
 * mesmas tags de tamanho (\fscx/\fscy e os \t de escala) para a extrusão
 * acompanhar a face; só a face recebe as cores do karaokê.
 */
function chunkMarkup(chunk: TranscriptWord[], t0: number, layout: ChunkLayout, o: Subtitle3DOptions, role: Role): string {
  const ms = (t: number) => Math.max(0, Math.round((t - t0) * 1000));
  const sc = (v: number) => Math.round(v * layout.scale);
  const fg = tagColor(o.color);
  const hl = tagColor(o.highlightColor);
  const karaokeScale = o.economy ? 100 : KARAOKE_SCALE;
  return chunk
    .map((w, i) => {
      // Entrada do bloco: 82% -> 100% em 120 ms.
      let tags = `\\fscx${sc(82)}\\fscy${sc(82)}\\t(0,120,\\fscx${sc(100)}\\fscy${sc(100)})`;
      if (role === "face") tags = `\\1c${fg}` + tags;
      const a = ms(w.start);
      const b = i < chunk.length - 1 ? ms(chunk[i + 1]!.start) : null;
      const big = karaokeScale === 100 ? "" : `\\fscx${sc(karaokeScale)}\\fscy${sc(karaokeScale)}`;
      const normal = karaokeScale === 100 ? "" : `\\fscx${sc(100)}\\fscy${sc(100)}`;
      const on = role === "face" ? `\\1c${hl}${big}` : big;
      const off = role === "face" ? `\\1c${fg}${normal}` : normal;
      if (on) tags += `\\t(${a},${a + 80},${on})`;
      if (b !== null && off) tags += `\\t(${b},${b + 80},${off})`;
      const sep = i === 0 ? "" : layout.breakBefore === i ? "\\N" : " ";
      return `${sep}{${tags}}${wordText(w)}`;
    })
    .join("");
}

export function build3dSubtitleEvents(words: TranscriptWord[], o: Subtitle3DOptions, W: number, H: number): string[] {
  const p = subtitle3dParams(W, H, o);
  const side = o.extrudeColor ?? DEFAULT_EXTRUDE;
  const sideNear = mixColor(side, "#000000", 0.15);
  const sideFar = mixColor(side, "#000000", 0.7);
  const edge = mixColor(side, "#000000", 0.85);
  const an = `\\an${p.alignment}`;
  const persp = `\\frx${p.frx}\\fax${p.fax}`;
  const chunks = chunkWords(words, Math.min(o.maxWordsPerLine, 3));
  const events: string[] = [];
  chunks.forEach((chunk, ci) => {
    const start = chunk[0]!.start;
    const lastEnd = chunk[chunk.length - 1]!.end;
    const next = chunks[ci + 1]?.[0]?.start ?? Infinity;
    // Nunca passa do início do próximo bloco: as camadas têm \pos fixo e o libass não
    // empurra uma legenda para longe da outra (os dois blocos se misturariam na tela).
    const end = Math.min(next, lastEnd + 0.3);
    if (end - start < 0.04) return;
    const layout = layoutChunk(chunk, p.fontSize, W - 2 * p.marginLR, o.economy ? 100 : KARAOKE_SCALE);
    // \q2: sem quebra automática (a quebra já veio do layoutChunk). Sem \fad de
    // propósito: camadas translúcidas sobrepostas "lavam" a face.
    const base = `${an}${persp}\\q2`;

    const sx = p.x + p.stepX * p.layers * 0.8;
    const sy = p.y + p.stepY * p.layers * 1.4;
    const shadow = o.economy ? "\\1a&HA0&\\3a&HA0&" : `\\1a&H70&\\3a&H70&\\blur${p.shadowBlur}`;
    events.push(
      dialogue(
        start,
        end,
        `{\\pos(${r1(sx)},${r1(sy)})${base}\\1c&H000000&\\3c&H000000&${shadow}}` + chunkMarkup(chunk, start, layout, o, "shadow"),
        "Sub3D",
        0,
      ),
    );
    // Extrusão, da camada mais distante para a mais próxima.
    for (let i = p.layers; i >= 1; i--) {
      const c = tagColor(i === p.layers ? sideFar : sideNear);
      events.push(
        dialogue(
          start,
          end,
          `{\\pos(${r1(p.x + p.stepX * i)},${r1(p.y + p.stepY * i)})${base}\\1c${c}\\3c${c}}` +
            chunkMarkup(chunk, start, layout, o, "side"),
          "Sub3D",
          p.layers - i + 1,
        ),
      );
    }
    events.push(
      dialogue(
        start,
        end,
        `{\\pos(${p.x},${p.y})${base}\\3c${tagColor(edge)}}` + chunkMarkup(chunk, start, layout, o, "face"),
        "Sub3D",
        p.layers + 1,
      ),
    );
  });
  return events;
}
