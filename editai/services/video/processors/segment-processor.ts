import type { OperationProcessor } from "./types";

/**
 * Aplica a timeline (trim, cut, remove_silence, remove_retakes, shorten):
 * mantém apenas os trechos escolhidos e reconstrói os timestamps.
 */
export const SegmentProcessor: OperationProcessor = {
  name: "SegmentProcessor",
  handles: ["trim", "cut", "remove_silence", "remove_retakes", "shorten"],
  apply(ctx) {
    const { segments, sourceDuration } = ctx.timeline;
    // fps fixo garante CFR, então N/FRAME_RATE reconstrói o tempo com precisão.
    ctx.graph.video.push(`fps=${ctx.fps}`);
    const isFull = segments.length === 1 && segments[0]!.start <= 0.001 && segments[0]!.end >= sourceDuration - 0.001;
    if (isFull) return;
    const expr = segments.map((s) => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`).join("+");
    ctx.graph.video.push(`select='${expr}'`, "setpts=N/FRAME_RATE/TB");
    if (ctx.metadata.hasAudio) ctx.graph.audio.push(`aselect='${expr}'`, "asetpts=N/SR/TB");
  },
};
