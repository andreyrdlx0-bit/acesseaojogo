import { findOperation } from "@/lib/editing-plan/validate";
import type { OperationProcessor } from "./types";

const PRESETS = {
  none: null,
  vivid: "eq=contrast=1.08:saturation=1.35",
  warm: "colorbalance=rs=0.08:gs=0.02:bs=-0.08,eq=saturation=1.1",
  cool: "colorbalance=rs=-0.06:bs=0.08",
  bw: "hue=s=0,eq=contrast=1.1",
  cinematic: "eq=contrast=1.12:saturation=0.9:gamma=0.97,colorbalance=rs=0.03:bs=0.05:rh=0.06:bh=-0.04",
} as const;

export const ColorProcessor: OperationProcessor = {
  name: "ColorProcessor",
  handles: ["color_adjustment"],
  apply(ctx) {
    const op = findOperation(ctx.plan, "color_adjustment");
    if (!op) return;
    const preset = PRESETS[op.preset];
    if (preset) ctx.graph.video.push(preset);
    if (op.brightness !== 0 || op.contrast !== 1 || op.saturation !== 1) {
      ctx.graph.video.push(
        `eq=brightness=${op.brightness.toFixed(3)}:contrast=${op.contrast.toFixed(3)}:saturation=${op.saturation.toFixed(3)}`,
      );
    }
  },
};
