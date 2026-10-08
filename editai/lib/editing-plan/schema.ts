import { z } from "zod";

/**
 * EditingPlan — o contrato entre a IA e o motor de vídeo.
 *
 * O LLM NUNCA executa nada: ele apenas propõe um JSON que precisa passar por
 * estes schemas. Qualquer operação inválida é rejeitada individualmente antes
 * de chegar ao FFmpeg. Para adicionar uma nova operação:
 *   1. crie o schema aqui e inclua em `operationSchemas`;
 *   2. descreva-a em `services/ai/planner/prompt.ts`;
 *   3. implemente um processor em `services/video/processors/`.
 */

const seconds = z.number().finite().min(0).max(4 * 60 * 60);
const timeRange = z
  .object({ start: seconds, end: seconds })
  .refine((r) => r.end > r.start, { message: "end deve ser maior que start" });

const base = { enabled: z.boolean().default(true) };

export const trimOp = z
  .object({
    type: z.literal("trim"),
    ...base,
    /** Mantém apenas o trecho [start, end] do vídeo original. */
    start: seconds.default(0),
    end: seconds.optional(),
  })
  .refine((t) => t.end === undefined || t.end > t.start, { message: "end deve ser maior que start" });

export const cutOp = z.object({
  type: z.literal("cut"),
  ...base,
  /** Trechos (em segundos do vídeo original) que devem ser removidos. */
  ranges: z.array(timeRange).min(1).max(200),
});

export const removeSilenceOp = z.object({
  type: z.literal("remove_silence"),
  ...base,
  /** Pausas maiores que isso são removidas. */
  minSilenceMs: z.number().int().min(200).max(5000).default(600),
  thresholdDb: z.number().min(-70).max(-15).default(-35),
  /** Respiro mantido antes/depois da fala. */
  paddingMs: z.number().int().min(0).max(1000).default(120),
});

export const removeRetakesOp = z.object({
  type: z.literal("remove_retakes"),
  ...base,
  /** Remove "éé", "hum", "tipo assim"... quando houver timestamps por palavra. */
  removeFillers: z.boolean().default(true),
});

export const shortenOp = z.object({
  type: z.literal("shorten"),
  ...base,
  targetSeconds: z.number().min(5).max(600),
  strategy: z.enum(["highlights", "beginning"]).default("highlights"),
});

export const subtitleSize = z.enum(["small", "medium", "large", "xl"]);
export const subtitlePosition = z.enum(["top", "center", "bottom"]);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const subtitlesOp = z.object({
  type: z.literal("subtitles"),
  ...base,
  style: z.enum(["bold", "clean", "karaoke", "minimal"]).default("bold"),
  position: subtitlePosition.default("bottom"),
  size: subtitleSize.default("large"),
  uppercase: z.boolean().default(false),
  highlightKeywords: z.boolean().default(true),
  color: hexColor.default("#FFFFFF"),
  highlightColor: hexColor.default("#FACC15"),
  maxWordsPerLine: z.number().int().min(1).max(10).default(4),
});

/** Ajuste parcial de estilo ("deixe as legendas maiores"). É fundido em `subtitles`. */
export const subtitleStyleOp = z.object({
  type: z.literal("subtitle_style"),
  ...base,
  style: subtitlesOp.shape.style.optional(),
  position: subtitlePosition.optional(),
  size: subtitleSize.optional(),
  uppercase: z.boolean().optional(),
  highlightKeywords: z.boolean().optional(),
  color: hexColor.optional(),
  highlightColor: hexColor.optional(),
  maxWordsPerLine: z.number().int().min(1).max(10).optional(),
});

export const audioEnhancementOp = z.object({
  type: z.literal("audio_enhancement"),
  ...base,
  preset: z.enum(["voice", "podcast", "loud"]).default("voice"),
});

export const noiseReductionOp = z.object({
  type: z.literal("noise_reduction"),
  ...base,
  strength: z.enum(["low", "medium", "high"]).default("medium"),
});

export const volumeOp = z.object({
  type: z.literal("volume"),
  ...base,
  gainDb: z.number().min(-20).max(20),
});

export const backgroundMusicOp = z.object({
  type: z.literal("background_music"),
  ...base,
  mood: z.enum(["calm", "upbeat", "cinematic", "corporate", "any"]).default("any"),
  volumeDb: z.number().min(-40).max(-6).default(-20),
  /** media_assets.id (kind = music) da biblioteca do usuário. */
  assetId: z.string().uuid().optional(),
});

export const speedOp = z.object({
  type: z.literal("speed"),
  ...base,
  factor: z.number().min(0.5).max(2),
});

export const zoomTrigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keyword"), keywords: z.array(z.string().min(1).max(40)).min(1).max(30) }),
  z.object({ kind: z.literal("emphasis"), everySeconds: z.number().min(2).max(30).default(6) }),
  z.object({ kind: z.literal("timestamps"), ranges: z.array(timeRange).min(1).max(100) }),
]);

export const zoomOp = z.object({
  type: z.literal("zoom"),
  ...base,
  trigger: zoomTrigger,
  scale: z.number().min(1.03).max(1.6).default(1.15),
  durationMs: z.number().int().min(300).max(5000).default(1500),
});

export const cropOp = z.object({
  type: z.literal("crop"),
  ...base,
  /** Retângulo normalizado (0–1) relativo ao quadro original. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.1).max(1),
  height: z.number().min(0.1).max(1),
});

export const aspectRatioValues = ["9:16", "16:9", "1:1", "4:5"] as const;
export const aspectRatioOp = z.object({
  type: z.literal("aspect_ratio"),
  ...base,
  ratio: z.enum(aspectRatioValues),
  fit: z.enum(["crop", "pad"]).default("crop"),
});

export const transitionsOp = z.object({
  type: z.literal("transitions"),
  ...base,
  style: z.enum(["fade", "none"]).default("fade"),
  durationMs: z.number().int().min(100).max(2000).default(400),
});

export const textOverlayOp = z.object({
  type: z.literal("text_overlay"),
  ...base,
  text: z.string().min(1).max(120),
  /** Em segundos do vídeo FINAL. */
  start: seconds.default(0),
  end: seconds.optional(),
  position: z.enum(["top", "center", "bottom"]).default("top"),
  size: subtitleSize.default("large"),
});

export const colorAdjustmentOp = z.object({
  type: z.literal("color_adjustment"),
  ...base,
  preset: z.enum(["none", "vivid", "warm", "cool", "bw", "cinematic"]).default("none"),
  brightness: z.number().min(-0.5).max(0.5).default(0),
  contrast: z.number().min(0.5).max(2).default(1),
  saturation: z.number().min(0).max(3).default(1),
});

export const bRollOp = z.object({
  type: z.literal("b_roll"),
  ...base,
  prompts: z.array(z.string().min(1).max(200)).max(20).default([]),
});

export const operationSchemas = [
  trimOp,
  cutOp,
  removeSilenceOp,
  removeRetakesOp,
  shortenOp,
  subtitlesOp,
  subtitleStyleOp,
  audioEnhancementOp,
  noiseReductionOp,
  volumeOp,
  backgroundMusicOp,
  speedOp,
  zoomOp,
  cropOp,
  aspectRatioOp,
  transitionsOp,
  textOverlayOp,
  colorAdjustmentOp,
  bRollOp,
] as const;

export const editingOperationSchema = z.discriminatedUnion("type", operationSchemas);

export const OPERATION_TYPES = operationSchemas.map((s) => s.shape.type.value);

export const editingPlanSchema = z.object({
  version: z.literal(1).default(1),
  operations: z.array(editingOperationSchema).max(100),
});

export type EditingOperation = z.infer<typeof editingOperationSchema>;
export type EditingOperationType = EditingOperation["type"];
export type EditingPlan = z.infer<typeof editingPlanSchema>;
export type OperationOf<T extends EditingOperationType> = Extract<EditingOperation, { type: T }>;
export type AspectRatio = (typeof aspectRatioValues)[number];

export const EMPTY_PLAN: EditingPlan = { version: 1, operations: [] };
