/** Mensagens entre a página e o worker do Whisper. */
export type WhisperDevice = "webgpu" | "wasm";

export interface ModelChoice {
  id: string;
  dtype: string | Record<string, string>;
}

export interface WorkerConfig {
  language: string; // "portuguese"
  preferWebGPU: boolean;
  models?: Partial<Record<WhisperDevice, ModelChoice>>;
  /** Hospedagem própria dos modelos (opcional). Ex.: { allowRemoteModels: false, localModelPath: "/models/" } */
  host?: { allowRemoteModels?: boolean; localModelPath?: string; remoteHost?: string };
  /** Hospedagem própria do runtime WASM do ONNX (opcional; padrão = cdn.jsdelivr.net). Ex.: "/ort/" */
  ortWasmBaseUrl?: string;
}

export type ToWorker = { type: "transcribe"; audio: Float32Array; config: WorkerConfig };

export type FromWorker =
  | { type: "stage"; stage: "planning" | "loading-model" | "transcribing"; device?: WhisperDevice; modelId?: string; pieces?: number }
  | { type: "download"; loaded: number; total: number; progress: number }
  | { type: "piece"; index: number; total: number; words: number; audioDoneSec: number; audioTotalSec: number }
  | { type: "fallback"; from: WhisperDevice; to: WhisperDevice; reason: string }
  | {
      type: "done";
      words: Array<{ word: string; start: number; end: number }>;
      device: WhisperDevice;
      modelId: string;
      elapsedMs: number;
      loadMs: number;
    }
  | { type: "error"; message: string };
