import type { EditingOperationType, EditingPlan } from "@/lib/editing-plan";
import type { RenderOptions } from "@/types/domain";
import type { TranscriptWord, VideoMetadata } from "@/types/video";
import type { EditTimeline } from "../timeline";

/** Grafo de filtros sendo montado pelos processors (sem executar nada). */
export interface FilterGraph {
  /** Cadeia aplicada ao stream de vídeo principal, em ordem. */
  video: string[];
  /** Cadeia aplicada à voz antes da mixagem com música. */
  audio: string[];
  /** Cadeia aplicada ao áudio final (após mixagem). */
  audioPost: string[];
  /** Entradas extras do FFmpeg (ex.: música), como argumentos. */
  extraInputs: string[][];
  music?: { inputIndex: number; volumeDb: number };
}

export interface ProcessorContext {
  plan: EditingPlan;
  metadata: VideoMetadata;
  timeline: EditTimeline;
  options: RenderOptions;
  /** Dimensões atuais do quadro conforme os filtros vão sendo aplicados. */
  frame: { width: number; height: number };
  fps: number;
  /** Palavras no tempo do vídeo FINAL. */
  words: TranscriptWord[];
  workDir: string;
  assets: { musicPath?: string };
  graph: FilterGraph;
  warnings: string[];
  /** Arquivos auxiliares gerados (ASS, textos) para limpeza. */
  files: Map<string, string>;
}

/**
 * Um processor traduz um tipo de operação do EditingPlan em filtros FFmpeg.
 * Processors são puros em relação ao sistema: só escrevem no grafo e em
 * arquivos dentro de `workDir`.
 */
export interface OperationProcessor {
  readonly name: string;
  readonly handles: readonly EditingOperationType[];
  apply(ctx: ProcessorContext): void | Promise<void>;
}

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
