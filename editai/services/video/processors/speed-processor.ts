import type { OperationProcessor } from "./types";

export const SpeedProcessor: OperationProcessor = {
  name: "SpeedProcessor",
  handles: ["speed"],
  apply(ctx) {
    const factor = ctx.timeline.speed;
    if (Math.abs(factor - 1) < 0.001) return;
    ctx.graph.video.push(`setpts=PTS/${factor.toFixed(4)}`);
    // atempo preserva o tom da voz.
    if (ctx.metadata.hasAudio) ctx.graph.audio.push(`atempo=${factor.toFixed(4)}`);
  },
};
