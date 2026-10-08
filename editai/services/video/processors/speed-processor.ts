import type { OperationProcessor } from "./types";

export const SpeedProcessor: OperationProcessor = {
  name: "SpeedProcessor",
  handles: ["speed"],
  apply(ctx) {
    const factor = ctx.timeline.speed;
    if (Math.abs(factor - 1) < 0.001) return;
    // Reamostra para CFR logo após mudar a velocidade: o zoompan (d=1) carimba
    // pts = n/fps e desfaria a aceleração se recebesse quadros espaçados.
    ctx.graph.video.push(`setpts=PTS/${factor.toFixed(4)}`, `fps=${ctx.fps}`);
    // atempo preserva o tom da voz.
    if (ctx.metadata.hasAudio) ctx.graph.audio.push(`atempo=${factor.toFixed(4)}`);
  },
};
