import { AudioProcessor } from "./audio-processor";
import { BRollProcessor } from "./broll-processor";
import { ColorProcessor } from "./color-processor";
import { CropProcessor, ScaleProcessor } from "./crop-processor";
import { MusicProcessor } from "./music-processor";
import { SegmentProcessor } from "./segment-processor";
import { SpeedProcessor } from "./speed-processor";
import { SubtitleProcessor } from "./subtitle-processor";
import { TextOverlayProcessor } from "./text-overlay-processor";
import { TransitionProcessor } from "./transition-processor";
import type { OperationProcessor } from "./types";
import { ZoomProcessor } from "./zoom-processor";

/**
 * Ordem do pipeline. Cortes e velocidade primeiro (definem o tempo final),
 * depois enquadramento, zoom, escala, cor, legendas, textos e transições.
 */
export const PROCESSOR_PIPELINE: readonly OperationProcessor[] = [
  SegmentProcessor,
  SpeedProcessor,
  CropProcessor,
  ZoomProcessor,
  ScaleProcessor,
  ColorProcessor,
  SubtitleProcessor,
  TextOverlayProcessor,
  AudioProcessor,
  MusicProcessor,
  TransitionProcessor,
  BRollProcessor,
];

export type { OperationProcessor, ProcessorContext, FilterGraph } from "./types";
