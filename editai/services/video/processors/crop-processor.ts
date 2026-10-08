import { findOperation } from "@/lib/editing-plan/validate";
import type { AspectRatio } from "@/lib/editing-plan";
import { even, type OperationProcessor } from "./types";

const RATIOS: Record<AspectRatio, number> = { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1, "4:5": 4 / 5 };

/**
 * Recorte manual + adaptação de formato (9:16, 16:9, 1:1, 4:5).
 * O formato da exportação (options.aspectRatio) tem prioridade sobre o plano.
 */
export const CropProcessor: OperationProcessor = {
  name: "CropProcessor",
  handles: ["crop", "aspect_ratio"],
  apply(ctx) {
    const crop = findOperation(ctx.plan, "crop");
    if (crop) {
      const w = even(Math.min(crop.width, 1 - crop.x) * ctx.frame.width);
      const h = even(Math.min(crop.height, 1 - crop.y) * ctx.frame.height);
      const x = Math.round(crop.x * ctx.frame.width);
      const y = Math.round(crop.y * ctx.frame.height);
      ctx.graph.video.push(`crop=${w}:${h}:${x}:${y}`);
      ctx.frame = { width: w, height: h };
    }

    const aspectOp = findOperation(ctx.plan, "aspect_ratio");
    const ratioKey = ctx.options.aspectRatio ?? aspectOp?.ratio;
    if (!ratioKey) return;
    const target = RATIOS[ratioKey];
    const current = ctx.frame.width / ctx.frame.height;
    if (Math.abs(current - target) < 0.01) return;

    const fit = aspectOp?.fit ?? "crop";
    if (fit === "pad") {
      const w = current > target ? ctx.frame.width : even(ctx.frame.height * target);
      const h = current > target ? even(ctx.frame.width / target) : ctx.frame.height;
      ctx.graph.video.push(`pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`);
      ctx.frame = { width: w, height: h };
    } else {
      // Recorte centralizado — enquadramento de rosto/assunto é um TODO de IA visual.
      const w = current > target ? even(ctx.frame.height * target) : ctx.frame.width;
      const h = current > target ? ctx.frame.height : even(ctx.frame.width / target);
      ctx.graph.video.push(`crop=${w}:${h}:(iw-${w})/2:(ih-${h})/2`);
      ctx.frame = { width: w, height: h };
    }
  },
};

/** Escala final para a qualidade escolhida (lado menor = 720 ou 1080). */
export const ScaleProcessor: OperationProcessor = {
  name: "ScaleProcessor",
  handles: [],
  apply(ctx) {
    const shortSide = ctx.options.quality === "1080p" ? 1080 : 720;
    const { width, height } = ctx.frame;
    const ratioKey = ctx.options.aspectRatio ?? findOperation(ctx.plan, "aspect_ratio")?.ratio;
    // Com formato definido, usa a resolução exata (ex.: 1080x1920) e não a arredondada.
    const ratio = ratioKey ? RATIOS[ratioKey] : width / height;
    const w = ratio >= 1 ? even(shortSide * ratio) : shortSide;
    const h = ratio >= 1 ? shortSide : even(shortSide / ratio);
    ctx.graph.video.push(`scale=${w}:${h}:flags=lanczos`, "setsar=1");
    ctx.frame = { width: w, height: h };
  },
};
