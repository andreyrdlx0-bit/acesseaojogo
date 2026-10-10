import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { OperationOf } from "@/lib/editing-plan";
import { findOperation } from "@/lib/editing-plan/validate";
import type { TranscriptWord } from "@/types/video";
import { normalizeText } from "@/utils/text";
import { SUBTITLE_FONT_FAMILY } from "../fonts";
import { assColor, assFilter, assHeader, dialogue, escapeAssText } from "./ass";
import { measureText } from "./font-metrics";
import { build3dSubtitleEvents, subtitle3dBand, subtitle3dStyle, type Subtitle3DOptions } from "./subtitle-3d";
import { chunkWords, SUBTITLE_SIZE_FACTOR, type VerticalBand } from "./subtitle-layout";
import type { OperationProcessor, ProcessorContext } from "./types";

type SubtitleOp = OperationOf<"subtitles">;

/**
 * Aviso quando falta a transcrição (legendas, destaques e zoom por palavra
 * dependem dela). `subject` completa a frase: "As legendas precisam".
 */
export function missingTranscriptWarning(ctx: ProcessorContext, subject: string): string {
  if (!ctx.metadata.hasAudio) return "O vídeo não tem áudio, então não há fala para legendar ou destacar.";
  if (ctx.metadata.transcript) return "Não encontramos fala na transcrição deste vídeo.";
  return `${subject} da transcrição do vídeo. No editor, use “Transcrever no navegador (grátis)” e peça de novo.`;
}

/**
 * Modo econômico da legenda 3D: em vídeos longos ou em 1080p o filtro de
 * legendas (single-thread) pesa mais, então o karaokê só troca a cor.
 */
export function subtitleEconomy(ctx: ProcessorContext): boolean {
  return ctx.options.quality === "1080p" || ctx.timeline.outputDuration > 300;
}

const STOPWORDS = new Set(
  "a o as os um uma de da do das dos e em no na nos nas que para por com sem se eu voce ele ela isso esse essa este esta mas mais muito tambem como entao porque pra pro ja vai vou ser ter tem foi era sao nao sim aqui ali la meu minha seu sua".split(
    " ",
  ),
);

/**
 * Gera legendas queimadas (ASS/libass) a partir das palavras da transcrição,
 * já reposicionadas no tempo do vídeo final.
 */
export const SubtitleProcessor: OperationProcessor = {
  name: "SubtitleProcessor",
  handles: ["subtitles", "subtitle_style"],
  async apply(ctx) {
    const op = findOperation(ctx.plan, "subtitles");
    if (!op) return;
    if (!ctx.words.length) {
      ctx.warnings.push(missingTranscriptWarning(ctx, "As legendas precisam"));
      return;
    }
    const ass = buildAss(ctx.words, op, ctx.frame.width, ctx.frame.height, subtitleEconomy(ctx));
    const file = path.join(ctx.workDir, "subtitles.ass");
    await writeFile(file, ass, "utf8");
    ctx.files.set("subtitles", file);
    ctx.graph.video.push(assFilter(file));
  },
};

export function subtitle3dOptions(op: SubtitleOp, economy: boolean): Subtitle3DOptions {
  return {
    position: op.position,
    size: op.size,
    color: op.color,
    highlightColor: op.highlightColor,
    maxWordsPerLine: op.maxWordsPerLine,
    economy,
  };
}

export function buildAss(words: TranscriptWord[], op: SubtitleOp, width: number, height: number, economy = false): string {
  if (op.style === "3d") {
    const o = subtitle3dOptions(op, economy);
    const header = assHeader(width, height, [subtitle3dStyle(width, height, o, SUBTITLE_FONT_FAMILY)]);
    return [...header, ...build3dSubtitleEvents(words, o, width, height), ""].join("\n");
  }
  const fontSize = classicFontSize(op, width, height);
  const alignment = op.position === "top" ? 8 : op.position === "center" ? 5 : 2;
  const marginV = Math.round(height * (op.position === "center" ? 0 : 0.12));
  const outline = op.style === "minimal" ? 0 : Math.max(2, Math.round(fontSize * 0.08));
  const shadow = op.style === "minimal" ? 0 : 1;
  const borderStyle = op.style === "clean" ? 3 : 1; // 3 = caixa de fundo
  const bold = op.style === "minimal" ? 0 : -1;
  const primary = assColor(op.color);
  const back = op.style === "clean" ? "&H80000000" : "&H64000000";

  const header = assHeader(width, height, [
    `Style: Default,${SUBTITLE_FONT_FAMILY},${fontSize},${primary},&H000000FF,&H00000000,${back},${bold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},${Math.round(width * 0.08)},${Math.round(width * 0.08)},${marginV},1`,
  ]);

  const events: string[] = [];
  const chunks = chunkWords(words, op.maxWordsPerLine);
  for (const chunk of chunks) {
    const chunkEnd = chunk[chunk.length - 1]!.end;
    if (op.style === "karaoke") {
      // Um evento por palavra, destacando a palavra falada.
      chunk.forEach((w, i) => {
        const end = i < chunk.length - 1 ? chunk[i + 1]!.start : chunkEnd;
        const text = chunk.map((cw, j) => styleWord(cw.word, op, j === i)).join(" ");
        events.push(dialogue(w.start, Math.max(end, w.start + 0.05), text));
      });
    } else {
      const text = chunk.map((w) => styleWord(w.word, op, op.highlightKeywords && isKeyword(w.word))).join(" ");
      events.push(dialogue(chunk[0]!.start, chunkEnd, text));
    }
  }
  return [...header, ...events, ""].join("\n");
}

function classicFontSize(op: SubtitleOp, width: number, height: number): number {
  return Math.round(height * SUBTITLE_SIZE_FACTOR[op.size] * (width < height ? 1 : 0.9));
}

/**
 * Faixa vertical que a legenda pode ocupar, para os destaques animados não
 * caírem em cima dela. Nos estilos clássicos o libass quebra as linhas sozinho,
 * então a altura vem do maior bloco real (medido com a métrica da Inter Bold).
 */
export function subtitleBand(op: SubtitleOp, width: number, height: number, economy = false, words: TranscriptWord[] = []): VerticalBand {
  if (op.style === "3d") return subtitle3dBand(width, height, subtitle3dOptions(op, economy));
  const fontSize = classicFontSize(op, width, height);
  const outline = op.style === "minimal" ? 0 : Math.max(2, Math.round(fontSize * 0.08));
  const maxWidth = width - 2 * Math.round(width * 0.08);
  const lines = Math.max(2, ...chunkWords(words, op.maxWordsPerLine).map((chunk) => countLines(chunk, op, fontSize, maxWidth)));
  const blockH = Math.min(6, lines) * fontSize * 1.05 + 2 * outline + 4;
  if (op.position === "top") {
    const top = Math.round(height * 0.12);
    return { top: top - outline, bottom: Math.round(top + blockH) };
  }
  if (op.position === "center") return { top: Math.round(height / 2 - blockH / 2), bottom: Math.round(height / 2 + blockH / 2) };
  const bottom = Math.round(height * 0.88);
  return { top: Math.round(bottom - blockH), bottom: bottom + outline };
}

/** Linhas que o libass usa para um bloco (quebra gulosa por palavra). */
function countLines(chunk: TranscriptWord[], op: SubtitleOp, fontSize: number, maxWidth: number): number {
  const space = measureText(" ", fontSize);
  let lines = 1;
  let lineW = 0;
  for (const w of chunk) {
    const wordW = measureText(escapeAssText(op.uppercase ? w.word.toUpperCase() : w.word), fontSize);
    if (lineW > 0 && lineW + space + wordW > maxWidth) {
      lines++;
      lineW = wordW;
    } else {
      lineW += (lineW > 0 ? space : 0) + wordW;
    }
  }
  return lines;
}

function styleWord(word: string, op: SubtitleOp, highlight: boolean): string {
  const clean = escapeAssText(op.uppercase ? word.toUpperCase() : word);
  return highlight ? `{\\c${assColor(op.highlightColor)}}${clean}{\\c${assColor(op.color)}}` : clean;
}

function isKeyword(word: string): boolean {
  const n = normalizeText(word);
  return (n.length >= 6 && !STOPWORDS.has(n)) || /\d/.test(n);
}
