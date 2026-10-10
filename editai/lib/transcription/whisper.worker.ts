/// <reference lib="webworker" />
/**
 * Web Worker: Whisper (transformers.js 4.3.0) com timestamps POR PALAVRA, em PT.
 * Nada roda na thread da UI. O modelo fica em cache (Cache API) após o 1º download.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { FromWorker, ModelChoice, ToWorker, WhisperDevice, WorkerConfig } from "./protocol";
import { SAMPLE_RATE, chunksToWords, cleanPieceWords, planPieces, type TimedWord } from "./segmenter";

declare const self: DedicatedWorkerGlobalScope;

const DEFAULT_MODELS: Record<WhisperDevice, ModelChoice> = {
  // WebGPU: encoder fp32 (fp16 no encoder perde precisão no EP WebGPU do v4) + decoder q4 — mesma escolha do @remotion/whisper-webgpu.
  webgpu: { id: "onnx-community/whisper-base_timestamped", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } },
  // WASM (CPU): q8 = arquivos *_quantized.onnx (~77 MB no total para o base). Verificado em PT com timestamps por palavra.
  wasm: { id: "Xenova/whisper-base", dtype: "q8" },
};

const post = (msg: FromWorker) => self.postMessage(msg);

let loaded: { key: string; asr: AutomaticSpeechRecognitionPipeline } | null = null;

function applyEnv(cfg: WorkerConfig) {
  env.allowLocalModels = Boolean(cfg.host?.localModelPath);
  if (cfg.host?.localModelPath) env.localModelPath = cfg.host.localModelPath;
  if (cfg.host?.allowRemoteModels !== undefined) env.allowRemoteModels = cfg.host.allowRemoteModels;
  if (cfg.host?.remoteHost) env.remoteHost = cfg.host.remoteHost;
  env.useBrowserCache = true; // Cache API: 2ª vez não baixa de novo
  const wasm = env.backends.onnx.wasm;
  if (!wasm) return;
  // O transformers.js usa o runtime sem "asyncify" no Safari < 26, mas detecta o Safari
  // por navigator.vendor, que não existe dentro de um worker: a página manda o resultado.
  const suffix = cfg.safariBelow26 ? "" : ".asyncify";
  if (cfg.ortWasmBaseUrl) {
    wasm.wasmPaths = {
      mjs: `${cfg.ortWasmBaseUrl}ort-wasm-simd-threaded${suffix}.mjs`,
      wasm: `${cfg.ortWasmBaseUrl}ort-wasm-simd-threaded${suffix}.wasm`,
    };
  } else if (cfg.safariBelow26 && wasm.wasmPaths && typeof wasm.wasmPaths === "object") {
    const paths = wasm.wasmPaths as { mjs?: string | URL; wasm?: string | URL };
    wasm.wasmPaths = {
      mjs: paths.mjs ? String(paths.mjs).replace(".asyncify.", ".") : undefined,
      wasm: paths.wasm ? String(paths.wasm).replace(".asyncify.", ".") : undefined,
    };
  }
}

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (self.navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load(device: WhisperDevice, model: ModelChoice): Promise<AutomaticSpeechRecognitionPipeline> {
  const key = `${device}|${model.id}|${JSON.stringify(model.dtype)}`;
  if (loaded?.key === key) return loaded.asr;
  if (loaded) await loaded.asr.dispose().catch(() => undefined);
  loaded = null;
  post({ type: "stage", stage: "loading-model", device, modelId: model.id });
  const asr = (await pipeline("automatic-speech-recognition", model.id, {
    device,
    dtype: model.dtype as never,
    progress_callback: (p) => {
      if (p.status === "progress_total") post({ type: "download", loaded: p.loaded, total: p.total, progress: p.progress });
    },
  })) as AutomaticSpeechRecognitionPipeline;
  loaded = { key, asr };
  return asr;
}

async function transcribePiece(asr: AutomaticSpeechRecognitionPipeline, audio: Float32Array, language: string): Promise<TimedWord[]> {
  const dur = audio.length / SAMPLE_RATE;
  const base = { language, task: "transcribe", return_timestamps: "word" as const };
  // Pedaço <= 28 s: NÃO passar chunk_length_s (o pedaço já foi cortado num silêncio).
  const out = await asr(audio, base);
  const raw = chunksToWords(out.chunks);
  // Sanidade: sem chunks, ou todas as palavras no mesmo instante = timestamps quebrados (já relatado no WebGPU).
  if (out.text.trim().length > 0 && (raw.length === 0 || (raw.length >= 3 && raw.every((w) => w.start === raw[0]!.start)))) {
    throw new Error("Timestamps por palavra inválidos neste dispositivo.");
  }
  let best = cleanPieceWords(raw, dur);
  if (best.loopTrimmed) {
    // Laço de repetição detectado: tenta de novo proibindo n-gramas repetidos.
    const retry = await asr(audio, { ...base, no_repeat_ngram_size: 3 });
    const r2 = cleanPieceWords(chunksToWords(retry.chunks), dur);
    if (r2.words.length > best.words.length) best = r2;
  }
  return best.words;
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  if (ev.data.type !== "transcribe") return;
  const { audio, config } = ev.data;
  const t0 = performance.now();
  try {
    applyEnv(config);
    post({ type: "stage", stage: "planning" });
    const pieces = planPieces(audio);
    const totalSec = audio.length / SAMPLE_RATE;

    const models = { ...DEFAULT_MODELS, ...config.models };
    // Áudio sem fala (faixa muda): não baixa o modelo à toa.
    if (!pieces.length) {
      post({ type: "done", words: [], device: "wasm", modelId: models.wasm.id, elapsedMs: Math.round(performance.now() - t0), loadMs: 0 });
      return;
    }
    let device: WhisperDevice = config.preferWebGPU && (await hasWebGPU()) ? "webgpu" : "wasm";
    let asr: AutomaticSpeechRecognitionPipeline;
    const tLoad = performance.now();
    try {
      asr = await load(device, models[device]);
    } catch (err) {
      if (device !== "webgpu") throw err;
      post({ type: "fallback", from: "webgpu", to: "wasm", reason: String((err as Error)?.message ?? err) });
      device = "wasm";
      asr = await load(device, models.wasm);
    }
    const loadMs = performance.now() - tLoad;

    post({ type: "stage", stage: "transcribing", device, modelId: models[device].id, pieces: pieces.length });
    const words: TimedWord[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]!;
      const slice = audio.subarray(Math.round(p.start * SAMPLE_RATE), Math.round(p.end * SAMPLE_RATE));
      let pieceWords: TimedWord[];
      try {
        pieceWords = await transcribePiece(asr, slice, config.language);
      } catch (err) {
        if (device !== "webgpu") throw err;
        // Alguns GPUs/drivers falham na 1ª inferência: cai para WASM e refaz este pedaço.
        post({ type: "fallback", from: "webgpu", to: "wasm", reason: String((err as Error)?.message ?? err) });
        device = "wasm";
        asr = await load(device, models.wasm);
        pieceWords = await transcribePiece(asr, slice, config.language);
      }
      for (const w of pieceWords) {
        words.push({ word: w.word, start: round2(w.start + p.start), end: round2(w.end + p.start) });
      }
      post({ type: "piece", index: i + 1, total: pieces.length, words: words.length, audioDoneSec: p.end, audioTotalSec: totalSec });
    }
    post({ type: "done", words, device, modelId: models[device].id, elapsedMs: Math.round(performance.now() - t0), loadMs: Math.round(loadMs) });
  } catch (err) {
    post({ type: "error", message: String((err as Error)?.message ?? err) });
  }
};

function round2(x: number) {
  return Math.round(x * 100) / 100;
}
