import { writeFile } from "node:fs/promises";
import path from "node:path";
import { findOperations } from "@/lib/editing-plan/validate";
import { SUBTITLE_FONT_FAMILY } from "../fonts";
import { assFilter, assHeader, dialogue, escapeAssText } from "./ass";
import type { OperationProcessor } from "./types";

const SIZE_FACTOR = { small: 0.04, medium: 0.055, large: 0.07, xl: 0.09 } as const;
const ALIGN = { top: 8, center: 5, bottom: 2 } as const;

/**
 * Textos sobrepostos renderizados pelo libass (quebra de linha automática e
 * a mesma fonte das legendas). O texto do usuário/LLM é escapado e gravado em
 * arquivo — nunca entra na linha de comando do FFmpeg.
 */
export const TextOverlayProcessor: OperationProcessor = {
  name: "TextOverlayProcessor",
  handles: ["text_overlay"],
  async apply(ctx) {
    const ops = findOperations(ctx.plan, "text_overlay");
    if (!ops.length) return;
    const { width, height } = ctx.frame;
    const margin = Math.round(width * 0.08);
    const styles = (["top", "center", "bottom"] as const).flatMap((pos) =>
      (["small", "medium", "large", "xl"] as const).map((size) => {
        const fontSize = Math.round(height * SIZE_FACTOR[size]);
        const outline = Math.max(2, Math.round(fontSize * 0.07));
        const marginV = pos === "center" ? 0 : Math.round(height * 0.08);
        return `Style: ${pos}-${size},${SUBTITLE_FONT_FAMILY},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${outline},1,${ALIGN[pos]},${margin},${margin},${marginV},1`;
      }),
    );
    const total = ctx.timeline.outputDuration;
    const events = ops
      .map((op) => {
        const start = Math.min(op.start, total);
        const end = Math.min(op.end ?? total, total);
        return end > start ? dialogue(start, end, escapeAssText(op.text), `${op.position}-${op.size}`, 1) : null;
      })
      .filter((e): e is string => e !== null);
    if (!events.length) {
      ctx.warnings.push("O texto pedido ficaria fora da duração do vídeo e foi ignorado.");
      return;
    }
    const file = path.join(ctx.workDir, "overlays.ass");
    await writeFile(file, [...assHeader(width, height, styles), ...events, ""].join("\n"), "utf8");
    ctx.files.set("overlays", file);
    ctx.graph.video.push(assFilter(file));
  },
};
