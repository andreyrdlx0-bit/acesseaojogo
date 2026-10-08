import { stat } from "node:fs/promises";
import { findOperation } from "@/lib/editing-plan/validate";
import type { ProcessProgress, VideoProcessInput, VideoProcessResult, VideoProcessor } from "@/types/services";
import { detectSilences, probeFile } from "./analyzer";
import { PermanentJobError } from "@/services/jobs/errors";
import { FfmpegError, runFfmpeg } from "./ffmpeg";
import { normalizeFps } from "./fps";
import { PROCESSOR_PIPELINE, type FilterGraph, type ProcessorContext } from "./processors";
import { buildTimeline, mapWordsToOutput } from "./timeline";

const STAGE_MESSAGES: Record<string, string> = {
  prepare: "Preparando vídeo...",
  analyze: "Analisando vídeo...",
  cuts: "Aplicando cortes...",
  subtitles: "Gerando legendas...",
  audio: "Processando áudio...",
  render: "Renderizando...",
  finalize: "Finalizando...",
};

/**
 * Motor de vídeo baseado em FFmpeg. Recebe o vídeo ORIGINAL + EditingPlan
 * validado, monta um único filter_complex com os processors e renderiza.
 */
export class FfmpegVideoProcessor implements VideoProcessor {
  async process(input: VideoProcessInput, onProgress?: (p: ProcessProgress) => void): Promise<VideoProcessResult> {
    const report = (percent: number, stage: keyof typeof STAGE_MESSAGES) =>
      onProgress?.({ percent: Math.round(percent), stage, message: STAGE_MESSAGES[stage]! });

    report(5, "prepare");
    const { plan, metadata } = input;

    // Silêncios com os parâmetros pedidos (podem diferir dos da análise inicial).
    let silences = metadata.silences;
    const silenceOp = findOperation(plan, "remove_silence");
    if (silenceOp && metadata.hasAudio) {
      report(10, "analyze");
      silences = (await detectSilences(input.sourcePath, silenceOp.thresholdDb, silenceOp.minSilenceMs / 1000, metadata.duration))
        .silences;
    }

    report(18, "cuts");
    const timeline = buildTimeline(metadata, plan, silences);
    const words = metadata.transcript ? mapWordsToOutput(timeline, metadata.transcript.words) : [];

    const ctx: ProcessorContext = {
      plan,
      metadata,
      timeline,
      options: input.options,
      frame: { width: metadata.width, height: metadata.height },
      fps: normalizeFps(metadata.fps),
      words,
      workDir: input.workDir,
      assets: input.assets,
      graph: { video: [], audio: [], audioPost: [], extraInputs: [] },
      warnings: [...timeline.warnings],
      files: new Map(),
    };

    for (const processor of PROCESSOR_PIPELINE) {
      if (processor.name === "SubtitleProcessor" && findOperation(plan, "subtitles")) report(22, "subtitles");
      if (processor.name === "AudioProcessor") report(24, "audio");
      await processor.apply(ctx);
    }

    const args = buildFfmpegArgs(input, ctx.graph, metadata.hasAudio, timeline.outputDuration, ctx.fps, input.limits?.maxOutputBytes);
    const hasOutputAudio = metadata.hasAudio || Boolean(ctx.graph.music);
    if (!rateBudget(timeline.outputDuration, input.limits?.maxOutputBytes, hasOutputAudio).fits) {
      throw new PermanentJobError(
        `Saída de ${Math.round(timeline.outputDuration)}s não cabe no limite de armazenamento`,
        "O vídeo final ficaria longo demais para o limite de armazenamento. Faça uma versão mais curta.",
      );
    }
    report(25, "render");
    const timeoutMs = input.limits?.timeoutMs ?? Math.max(5 * 60_000, timeline.outputDuration * 20_000);
    try {
      await runFfmpeg(args, {
        expectedDuration: timeline.outputDuration,
        onProgress: (fraction) => report(25 + fraction * 70, "render"),
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof FfmpegError && error.timedOut) {
        // Estourou o tempo: tentar de novo daria o mesmo resultado.
        throw new PermanentJobError(
          `Renderização excedeu ${Math.round(timeoutMs / 1000)}s`,
          "Esse vídeo é longo demais para processar aqui. Tente um trecho menor ou uma versão mais curta.",
        );
      }
      throw error;
    }

    report(97, "finalize");
    const probe = await probeFile(input.outputPath);
    const v = probe.streams.find((s) => s.codec_type === "video");
    const size = (await stat(input.outputPath)).size;
    if (input.limits?.maxOutputBytes && size > input.limits.maxOutputBytes) {
      throw new PermanentJobError(
        `Saída com ${size} bytes excede o limite de ${input.limits.maxOutputBytes}`,
        "O vídeo final ficou maior que o limite de armazenamento. Tente uma versão mais curta ou em 720p.",
      );
    }
    return {
      outputPath: input.outputPath,
      duration: Number(probe.format.duration ?? timeline.outputDuration),
      width: v?.width ?? ctx.frame.width,
      height: v?.height ?? ctx.frame.height,
      sizeBytes: size,
      warnings: [...new Set(ctx.warnings)],
    };
  }
}

export function buildFfmpegArgs(
  input: Pick<VideoProcessInput, "sourcePath" | "outputPath">,
  graph: FilterGraph,
  hasAudio: boolean,
  outputDuration: number,
  fps: number,
  maxOutputBytes?: number,
): string[] {
  const parts: string[] = [];
  parts.push(`[0:v]${chain(graph.video, "null")}[vout]`);

  let audioLabel: string | null = null;
  const stereo = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
  if (hasAudio) {
    parts.push(`[0:a]${chain([...graph.audio, stereo], "anull")}[a0]`);
    audioLabel = "a0";
  }
  if (graph.music) {
    const m = graph.music;
    parts.push(`[${m.inputIndex}:a]${stereo},volume=${m.volumeDb}dB[bgm]`);
    if (audioLabel) {
      parts.push(`[${audioLabel}]asplit=2[voice][sc]`);
      parts.push("[bgm][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]");
      parts.push("[voice][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a1]");
      audioLabel = "a1";
    } else {
      audioLabel = "bgm";
    }
  }
  if (audioLabel) parts.push(`[${audioLabel}]${chain(graph.audioPost, "anull")}[aout]`);

  const args = ["-i", input.sourcePath];
  for (const extra of graph.extraInputs) args.push(...extra);
  args.push("-filter_complex", parts.join(";"), "-map", "[vout]");
  const budget = rateBudget(outputDuration, maxOutputBytes, Boolean(audioLabel));
  if (audioLabel) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", `${budget.audioKbps}k`, "-ar", "48000");
  else args.push("-an");
  args.push(
    "-t",
    outputDuration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    // Teto de bitrate: mantém o arquivo final dentro do limite do storage.
    ...(budget.videoKbps ? ["-maxrate", `${budget.videoKbps}k`, "-bufsize", `${budget.videoKbps * 2}k`] : []),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    input.outputPath,
  );
  return args;
}

/**
 * Orçamento de bitrate para a saída caber em `maxOutputBytes` (storage).
 * Reduz também o áudio em saídas longas; `fits=false` quando nem o mínimo cabe.
 */
export function rateBudget(outputDuration: number, maxOutputBytes: number | undefined, hasAudio: boolean) {
  if (!maxOutputBytes || outputDuration <= 0) return { audioKbps: hasAudio ? 160 : 0, videoKbps: undefined as number | undefined, fits: true };
  const totalKbps = (maxOutputBytes * 0.9 * 8) / 1000 / outputDuration;
  const audioKbps = !hasAudio ? 0 : totalKbps >= 450 ? 160 : totalKbps >= 300 ? 96 : 64;
  const videoKbps = Math.floor(totalKbps - audioKbps);
  return { audioKbps, videoKbps: Math.min(videoKbps, 20_000), fits: videoKbps >= 100 };
}

function chain(filters: string[], fallback: string): string {
  return filters.length ? filters.join(",") : fallback;
}

