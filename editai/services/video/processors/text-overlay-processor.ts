import { writeFile } from "node:fs/promises";
import path from "node:path";
import { findOperations } from "@/lib/editing-plan/validate";
import { escapeFilterValue } from "../ffmpeg";
import { resolveFontFile } from "../fonts";
import type { OperationProcessor } from "./types";

const SIZE_FACTOR = { small: 0.04, medium: 0.055, large: 0.07, xl: 0.09 } as const;

/**
 * Textos sobrepostos (drawtext). O texto vai para um arquivo (textfile=) para
 * que nenhum caractere vindo do usuário/LLM seja interpretado pelo FFmpeg.
 */
export const TextOverlayProcessor: OperationProcessor = {
  name: "TextOverlayProcessor",
  handles: ["text_overlay"],
  async apply(ctx) {
    const ops = findOperations(ctx.plan, "text_overlay");
    if (!ops.length) return;
    const font = resolveFontFile();
    if (!font) {
      ctx.warnings.push("Nenhuma fonte disponível no servidor para textos sobrepostos (configure FONT_PATH).");
      return;
    }
    let i = 0;
    for (const op of ops) {
      const file = path.join(ctx.workDir, `overlay-${i++}.txt`);
      await writeFile(file, op.text, "utf8");
      ctx.files.set(`overlay-${i}`, file);
      // drawtext não quebra linha: limita a fonte para caber em 90% da largura.
      const maxBySize = ctx.frame.height * SIZE_FACTOR[op.size];
      const maxByWidth = (ctx.frame.width * 0.9) / (op.text.length * 0.56);
      const size = Math.max(12, Math.round(Math.min(maxBySize, maxByWidth)));
      const y = op.position === "top" ? "h*0.08" : op.position === "center" ? "(h-text_h)/2" : "h*0.8-text_h";
      const end = op.end ?? ctx.timeline.outputDuration;
      ctx.graph.video.push(
        [
          `drawtext=fontfile='${escapeFilterValue(font)}'`,
          `textfile='${escapeFilterValue(file)}'`,
          `fontsize=${size}`,
          "fontcolor=white",
          "borderw=3",
          "bordercolor=black@0.8",
          "x=(w-text_w)/2",
          `y=${y}`,
          `enable='between(t\\,${op.start.toFixed(2)}\\,${end.toFixed(2)})'`,
        ].join(":"),
      );
    }
  },
};
