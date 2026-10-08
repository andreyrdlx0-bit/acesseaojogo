import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { OperationOf } from "@/lib/editing-plan";
import { findOperation } from "@/lib/editing-plan/validate";
import type { TranscriptWord } from "@/types/video";
import { normalizeText } from "@/utils/text";
import { SUBTITLE_FONT_FAMILY } from "../fonts";
import { assColor, assFilter, assHeader, dialogue, escapeAssText } from "./ass";
import type { OperationProcessor } from "./types";

type SubtitleOp = OperationOf<"subtitles">;

/** Altura da fonte como fração da altura do vídeo. */
const SIZE_FACTOR = { small: 0.035, medium: 0.045, large: 0.06, xl: 0.078 } as const;
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
      ctx.warnings.push(
        ctx.metadata.hasAudio
          ? "As legendas precisam da transcrição do vídeo. Configure um provedor de Speech-to-Text para habilitá-las."
          : "O vídeo não tem áudio, então não há fala para legendar.",
      );
      return;
    }
    const ass = buildAss(ctx.words, op, ctx.frame.width, ctx.frame.height);
    const file = path.join(ctx.workDir, "subtitles.ass");
    await writeFile(file, ass, "utf8");
    ctx.files.set("subtitles", file);
    ctx.graph.video.push(assFilter(file));
  },
};

export function buildAss(words: TranscriptWord[], op: SubtitleOp, width: number, height: number): string {
  const fontSize = Math.round(height * SIZE_FACTOR[op.size] * (width < height ? 1 : 0.9));
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

function chunkWords(words: TranscriptWord[], max: number): TranscriptWord[][] {
  const chunks: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];
  for (const w of words) {
    const prev = current[current.length - 1];
    const gap = prev ? w.start - prev.end : 0;
    const endsSentence = prev ? /[.!?]$/.test(prev.word) : false;
    if (current.length >= max || gap > 0.6 || endsSentence) {
      if (current.length) chunks.push(current);
      current = [];
    }
    current.push(w);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function styleWord(word: string, op: SubtitleOp, highlight: boolean): string {
  const clean = escapeAssText(op.uppercase ? word.toUpperCase() : word);
  return highlight ? `{\\c${assColor(op.highlightColor)}}${clean}{\\c${assColor(op.color)}}` : clean;
}

function isKeyword(word: string): boolean {
  const n = normalizeText(word);
  return (n.length >= 6 && !STOPWORDS.has(n)) || /\d/.test(n);
}
