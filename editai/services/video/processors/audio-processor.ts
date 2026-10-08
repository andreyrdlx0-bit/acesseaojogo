import { findOperation } from "@/lib/editing-plan/validate";
import type { OperationProcessor } from "./types";

const NOISE = { low: 8, medium: 14, high: 22 } as const;

/** Redução de ruído, melhoria de voz e volume. */
export const AudioProcessor: OperationProcessor = {
  name: "AudioProcessor",
  handles: ["noise_reduction", "audio_enhancement", "volume"],
  apply(ctx) {
    const noise = findOperation(ctx.plan, "noise_reduction");
    const enhance = findOperation(ctx.plan, "audio_enhancement");
    const volume = findOperation(ctx.plan, "volume");
    if (!ctx.metadata.hasAudio) {
      if (noise || enhance || volume) ctx.warnings.push("O vídeo não tem áudio — ajustes de som foram ignorados.");
      return;
    }
    const a = ctx.graph.audio;
    if (noise) a.push("highpass=f=70", `afftdn=nr=${NOISE[noise.strength]}:nf=-40:tn=1`);
    if (enhance) {
      a.push("highpass=f=80", "lowpass=f=14000");
      if (enhance.preset === "podcast") a.push("equalizer=f=180:t=q:w=1:g=2", "equalizer=f=3500:t=q:w=1.2:g=3");
      else a.push("equalizer=f=3000:t=q:w=1.5:g=2");
      a.push("acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2");
      a.push(`loudnorm=I=${enhance.preset === "loud" ? -13 : -16}:TP=-1.5:LRA=11`, "aresample=48000");
    }
    if (volume && volume.gainDb !== 0) a.push(`volume=${volume.gainDb}dB`, "alimiter=limit=0.97");
  },
};
