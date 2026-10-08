import { findOperation } from "@/lib/editing-plan/validate";
import type { OperationProcessor } from "./types";

/** Fade de entrada e saída (vídeo e áudio). */
export const TransitionProcessor: OperationProcessor = {
  name: "TransitionProcessor",
  handles: ["transitions"],
  apply(ctx) {
    const op = findOperation(ctx.plan, "transitions");
    if (!op || op.style === "none") return;
    const total = ctx.timeline.outputDuration;
    const d = Math.min(op.durationMs / 1000, total / 4);
    const outStart = Math.max(0, total - d).toFixed(3);
    ctx.graph.video.push(`fade=t=in:st=0:d=${d.toFixed(3)}`, `fade=t=out:st=${outStart}:d=${d.toFixed(3)}`);
    ctx.graph.audioPost.push(`afade=t=in:st=0:d=${d.toFixed(3)}`, `afade=t=out:st=${outStart}:d=${d.toFixed(3)}`);
  },
};
