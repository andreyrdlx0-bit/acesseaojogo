import type { OperationProcessor } from "./types";

/**
 * Aplica a timeline (trim, cut, remove_silence, remove_retakes, shorten):
 * mantém apenas os trechos escolhidos e reconstrói os timestamps.
 *
 * Sincronia A/V: os dois streams começam em 0 (preservando o deslocamento
 * original), os cortes caem na grade de quadros do vídeo (intervalo semiaberto)
 * e o áudio é fatiado em blocos de exatamente 1 quadro de vídeo — assim
 * `select` e `aselect` mantêm os mesmos instantes e o erro não se acumula.
 */
export const SegmentProcessor: OperationProcessor = {
  name: "SegmentProcessor",
  handles: ["trim", "cut", "remove_silence", "remove_retakes", "shorten"],
  apply(ctx) {
    const { segments, sourceDuration } = ctx.timeline;
    const fps = ctx.fps;
    // CFR a partir de t=0 (preenche/apara o início se o vídeo começar depois do áudio).
    ctx.graph.video.push(`fps=${fps}:start_time=0`);
    if (ctx.metadata.hasAudio) ctx.graph.audio.push("aresample=48000:async=1:first_pts=0");

    const isFull = segments.length === 1 && segments[0]!.start <= 0.001 && segments[0]!.end >= sourceDuration - 0.001;
    if (isFull) return;

    const expr = segments
      .map((s) => [Math.round(s.start * fps), Math.round(s.end * fps)] as const)
      .filter(([a, b]) => b > a)
      .map(([a, b]) => `gte(t,${((a - 0.5) / fps).toFixed(6)})*lt(t,${((b - 0.5) / fps).toFixed(6)})`)
      .join("+");
    ctx.graph.video.push(`select='${expr}'`, "setpts=N/FRAME_RATE/TB");
    if (ctx.metadata.hasAudio) {
      const samplesPerFrame = 48000 % fps === 0 ? 48000 / fps : 64;
      ctx.graph.audio.push(`asetnsamples=n=${samplesPerFrame}:p=0`, `aselect='${expr}'`, "asetpts=N/SR/TB");
    }
  },
};
