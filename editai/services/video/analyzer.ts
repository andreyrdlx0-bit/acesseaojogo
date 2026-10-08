import type { ProcessProgress, VideoAnalyzer } from "@/types/services";
import type { TimeRange, VideoMetadata } from "@/types/video";
import { runFfmpeg, runFfprobe } from "./ffmpeg";
import { complement, normalizeRanges, round3 } from "./ranges";

interface ProbeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}
interface ProbeResult {
  streams: ProbeStream[];
  format: { duration?: string; size?: string; bit_rate?: string };
}

export const DEFAULT_SILENCE = { thresholdDb: -35, minSeconds: 0.5 };

/** Análise técnica do vídeo: ffprobe + detecção de silêncio + volume. */
export class FfmpegVideoAnalyzer implements VideoAnalyzer {
  async analyze(localPath: string, onProgress?: (p: ProcessProgress) => void): Promise<VideoMetadata> {
    onProgress?.({ percent: 10, stage: "probe", message: "Lendo informações do vídeo..." });
    const probe = await probeFile(localPath);
    const video = probe.streams.find((s) => s.codec_type === "video");
    if (!video?.width || !video.height) throw new Error("Arquivo sem stream de vídeo válido");
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    const duration = Number(probe.format.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Duração do vídeo inválida");

    const rotation = Math.abs(
      Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0),
    );
    const swap = rotation === 90 || rotation === 270;
    const fps = parseFps(video.avg_frame_rate) ?? parseFps(video.r_frame_rate) ?? 30;

    let silences: TimeRange[] = [];
    let meanVolumeDb: number | null = null;
    let maxVolumeDb: number | null = null;
    if (audio) {
      onProgress?.({ percent: 40, stage: "audio", message: "Analisando áudio e silêncios..." });
      const result = await detectSilences(localPath, DEFAULT_SILENCE.thresholdDb, DEFAULT_SILENCE.minSeconds, duration);
      silences = result.silences;
      meanVolumeDb = result.meanVolumeDb;
      maxVolumeDb = result.maxVolumeDb;
    }

    return {
      duration: round3(duration),
      width: swap ? video.height : video.width,
      height: swap ? video.width : video.height,
      fps: Math.min(60, Math.round(fps * 100) / 100),
      hasAudio: Boolean(audio),
      videoCodec: video.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      bitrate: probe.format.bit_rate ? Number(probe.format.bit_rate) : null,
      sizeBytes: probe.format.size ? Number(probe.format.size) : null,
      rotation,
      meanVolumeDb,
      maxVolumeDb,
      silences,
      speech: audio ? complement(silences, duration) : [],
      suggestedCuts: silences.filter((s) => s.end - s.start >= 1),
      transcript: null,
    };
  }
}

export async function probeFile(localPath: string): Promise<ProbeResult> {
  const out = await runFfprobe(["-print_format", "json", "-show_format", "-show_streams", localPath]);
  return JSON.parse(out) as ProbeResult;
}

export async function detectSilences(
  localPath: string,
  thresholdDb: number,
  minSeconds: number,
  duration: number,
): Promise<{ silences: TimeRange[]; meanVolumeDb: number | null; maxVolumeDb: number | null }> {
  const { stderr } = await runFfmpeg(
    ["-i", localPath, "-vn", "-af", `silencedetect=noise=${thresholdDb}dB:d=${minSeconds},volumedetect`, "-f", "null", "-"],
    { timeoutMs: 10 * 60_000 },
  );
  const silences: TimeRange[] = [];
  let open: number | null = null;
  for (const line of stderr.split("\n")) {
    const start = line.match(/silence_start: (-?[\d.]+)/);
    const end = line.match(/silence_end: ([\d.]+)/);
    if (start) open = Math.max(0, Number(start[1]));
    if (end && open !== null) {
      silences.push({ start: round3(open), end: round3(Number(end[1])) });
      open = null;
    }
  }
  if (open !== null) silences.push({ start: round3(open), end: round3(duration) });
  const mean = stderr.match(/mean_volume: (-?[\d.]+) dB/);
  const max = stderr.match(/max_volume: (-?[\d.]+) dB/);
  return {
    silences: normalizeRanges(silences),
    meanVolumeDb: mean ? Number(mean[1]) : null,
    maxVolumeDb: max ? Number(max[1]) : null,
  };
}

export async function extractThumbnail(localPath: string, outPath: string, duration: number): Promise<void> {
  const at = Math.min(1, duration / 3).toFixed(2);
  await runFfmpeg(["-ss", at, "-i", localPath, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", outPath], {
    timeoutMs: 60_000,
  });
}

/** Áudio mono 16 kHz em MP3 — formato compacto ideal para Speech-to-Text. */
export async function extractSpeechAudio(localPath: string, outPath: string): Promise<void> {
  await runFfmpeg(["-i", localPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", outPath], {
    timeoutMs: 10 * 60_000,
  });
}

function parseFps(value?: string): number | null {
  if (!value) return null;
  const [n, d] = value.split("/").map(Number);
  if (!n || !d) return null;
  const fps = n / d;
  return Number.isFinite(fps) && fps > 0 && fps <= 240 ? fps : null;
}
