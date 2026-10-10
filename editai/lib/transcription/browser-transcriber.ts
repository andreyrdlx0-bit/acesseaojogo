"use client";
/**
 * Transcrição grátis NO NAVEGADOR (Whisper via transformers.js, sem chave de API).
 * Thread principal: baixa o vídeo, extrai o áudio (Web Audio) e entrega ao worker.
 * Devolve palavras com tempo em segundos do vídeo ORIGINAL.
 *
 * Nunca importe este módulo em código de servidor: a biblioteca puxa o
 * onnxruntime-node (288 MB), que não cabe numa função da Vercel.
 */
import { decodeToMono16k } from "./audio";
import type { FromWorker, WhisperDevice, WorkerConfig } from "./protocol";

export type TranscriptionProgress =
  | { stage: "downloading-video"; loaded: number; total: number | null }
  | { stage: "decoding" }
  | { stage: "planning" }
  | { stage: "loading-model"; loaded?: number; total?: number; percent?: number }
  | { stage: "transcribing"; piece: number; pieces: number; percent: number };

export interface BrowserTranscriptionResult {
  language: "pt";
  provider: string;
  words: Array<{ word: string; start: number; end: number }>;
  device: WhisperDevice;
  elapsedMs: number;
  audioSec: number;
}

/** Vídeo maior que isso não cabe com folga na memória da aba (o áudio é decodificado inteiro). */
export const MAX_BROWSER_VIDEO_BYTES = 600 * 1024 * 1024;
export const MAX_BROWSER_SECONDS = 15 * 60;
/** Download aproximado na primeira vez (modelo + runtime), depois fica em cache. */
export const MODEL_DOWNLOAD_MB = 110;

/**
 * Celular e aparelhos com pouca memória costumam derrubar a aba (pico de ~2 GB).
 * Devolve o motivo quando não dá para transcrever aqui.
 */
export function browserTranscriptionBlocker(): string | null {
  if (typeof window === "undefined") return "Indisponível.";
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") return "Este navegador não suporta a transcrição local.";
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  if (mobile) return "A transcrição no navegador precisa de um computador (no celular a página costuma travar por falta de memória).";
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return "Este aparelho tem pouca memória para transcrever no navegador. Use um computador com 4 GB ou mais.";
  return null;
}

let worker: Worker | null = null;
function getWorker(): Worker {
  // new URL(..., import.meta.url) é o padrão que o webpack do Next entende para empacotar o worker.
  worker ??= new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/** Encerra o worker (cancela na hora e libera a memória do modelo). */
export function disposeBrowserTranscriber() {
  worker?.terminate();
  worker = null;
}

/** Baixa o vídeo (URL assinada) informando o progresso. */
async function downloadVideo(url: string, signal: AbortSignal | undefined, onProgress?: (p: TranscriptionProgress) => void): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error("Não foi possível baixar o vídeo para transcrever. Atualize a página e tente de novo.");
  const totalHeader = Number(res.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  if (total && total > MAX_BROWSER_VIDEO_BYTES) throw new Error("Vídeo grande demais para transcrever no navegador.");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress?.({ stage: "downloading-video", loaded, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (loaded > MAX_BROWSER_VIDEO_BYTES) {
      await reader.cancel();
      throw new Error("Vídeo grande demais para transcrever no navegador.");
    }
    onProgress?.({ stage: "downloading-video", loaded, total });
  }
  return new Blob(chunks as BlobPart[], { type: res.headers.get("content-type") ?? "video/mp4" });
}

export async function transcribeVideoInBrowser(
  videoUrl: string,
  opts: { signal?: AbortSignal; onProgress?: (p: TranscriptionProgress) => void; config?: Partial<WorkerConfig> } = {},
): Promise<BrowserTranscriptionResult> {
  const { signal, onProgress } = opts;
  signal?.throwIfAborted();
  const video = await downloadVideo(videoUrl, signal, onProgress);
  signal?.throwIfAborted();
  onProgress?.({ stage: "decoding" });
  const audio = await decodeToMono16k(video, { signal, maxSeconds: MAX_BROWSER_SECONDS });
  const audioSec = audio.length / 16_000;
  signal?.throwIfAborted();

  // WASM (CPU) é o caminho testado de ponta a ponta; WebGPU fica desligado por padrão.
  const config: WorkerConfig = { language: "portuguese", preferWebGPU: false, ...opts.config };
  const w = getWorker();
  let device: WhisperDevice = "wasm";

  return await new Promise<BrowserTranscriptionResult>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      disposeBrowserTranscriber(); // único jeito de parar uma inferência em andamento
      reject(new DOMException("Transcrição cancelada.", "AbortError"));
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      disposeBrowserTranscriber();
      reject(new Error(e.message || "Falha ao iniciar a transcrição."));
    };
    const onMessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      switch (m.type) {
        case "stage":
          if (m.device) device = m.device;
          if (m.stage === "planning") onProgress?.({ stage: "planning" });
          if (m.stage === "loading-model") onProgress?.({ stage: "loading-model" });
          if (m.stage === "transcribing") onProgress?.({ stage: "transcribing", piece: 0, pieces: m.pieces ?? 0, percent: 0 });
          break;
        case "download":
          onProgress?.({ stage: "loading-model", loaded: m.loaded, total: m.total, percent: m.progress });
          break;
        case "fallback":
          device = m.to;
          break;
        case "piece":
          onProgress?.({ stage: "transcribing", piece: m.index, pieces: m.total, percent: (100 * m.audioDoneSec) / m.audioTotalSec });
          break;
        case "done":
          cleanup();
          resolve({
            language: "pt",
            provider: `transformers.js@4.3.0/${m.modelId}/${m.device}`.slice(0, 80),
            words: m.words,
            device: m.device ?? device,
            elapsedMs: m.elapsedMs,
            audioSec,
          });
          break;
        case "error":
          cleanup();
          // Erro no meio do caminho pode deixar a sessão do modelo inconsistente.
          disposeBrowserTranscriber();
          reject(new Error(m.message));
          break;
      }
    };
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    w.postMessage({ type: "transcribe", audio, config }, [audio.buffer]); // transfere sem copiar
  });
}
