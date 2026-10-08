import type { ProcessProgress, VideoAnalyzer } from "@/types/services";
import type { TimeRange, VideoMetadata } from "@/types/video";
import { stat } from "node:fs/promises";
import { PermanentJobError } from "@/services/jobs/errors";
import { FfmpegError, readFfmpegHeader, runFfmpeg, runFfprobe } from "./ffmpeg";
import { complement, normalizeRanges, round3 } from "./ranges";

export interface ProbeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}
export interface ProbeResult {
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
    if (!video?.width || !video.height) {
      throw new PermanentJobError("Arquivo sem stream de vídeo válido", "Esse arquivo não tem um vídeo válido. Envie um MP4, MOV ou WEBM.");
    }
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    let duration = Number(probe.format.duration ?? NaN);
    // WebM de MediaRecorder/gravadores web não traz duração no cabeçalho: mede.
    if (!Number.isFinite(duration) || duration <= 0) duration = await measureDuration(localPath);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new PermanentJobError("Duração do vídeo inválida", "Não conseguimos ler esse vídeo. Verifique o formato ou tente novamente.");
    }

    const rotation = Math.abs(
      Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0),
    );
    const swap = rotation === 90 || rotation === 270;
    // VFR (ex.: gravação de tela): a média engana; usa a maior entre média e taxa real (até 60).
    const avgFps = parseFps(video.avg_frame_rate);
    const realFps = parseFps(video.r_frame_rate);
    const fps = Math.max(avgFps ?? 0, Math.min(60, realFps ?? 0)) || 30;

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
  try {
    const out = await runFfprobe(["-print_format", "json", "-show_format", "-show_streams", localPath]);
    return JSON.parse(out) as ProbeResult;
  } catch (error) {
    // Ambientes sem ffprobe (ex.: Vercel com ffmpeg-static): lê o cabeçalho pelo ffmpeg.
    if (error instanceof FfmpegError && error.notFound) return probeWithFfmpeg(localPath);
    throw error;
  }
}

/** Interpreta a saída de `ffmpeg -i` no mesmo formato do ffprobe (campos usados aqui). */
export async function probeWithFfmpeg(localPath: string): Promise<ProbeResult> {
  return parseFfmpegHeader(await readFfmpegHeader(localPath), (await stat(localPath)).size);
}

export function parseFfmpegHeader(header: string, sizeBytes: number | null): ProbeResult {
  const streams: ProbeStream[] = [];
  // Só a linha de nível superior (2 espaços): metadados do arquivo não podem forjar a duração.
  const dur = header.match(/^ {2}Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/m);
  const bitrate = header.match(/^ {2}Duration:.*?bitrate:\s*(\d+)\s*kb\/s/m);
  const lines = header.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const video = line.match(/Stream #\d+:\d+.*?: Video: (\w+)/);
    if (video && !/attached pic/.test(line)) {
      const size = line.match(/,\s*(\d{2,5})x(\d{2,5})[\s,\[]/);
      const avgM = line.match(/,\s*([\d.]+)\s*fps/);
      const tbrM = line.match(/,\s*([\d.]+)\s*tbr/);
      // Rotação aparece nas linhas seguintes (side data: displaymatrix).
      let rotation: number | undefined;
      for (let j = i + 1; j < lines.length && !/Stream #|Input #/.test(lines[j]!); j++) {
        const rot = lines[j]!.match(/rotation of (-?[\d.]+) degrees/);
        if (rot) rotation = Number(rot[1]);
      }
      streams.push({
        codec_type: "video",
        codec_name: video[1],
        width: size ? Number(size[1]) : undefined,
        height: size ? Number(size[2]) : undefined,
        avg_frame_rate: (avgM ?? tbrM) ? `${Math.round(Number((avgM ?? tbrM)![1]) * 1000)}/1000` : undefined,
        r_frame_rate: tbrM ? `${Math.round(Number(tbrM[1]) * 1000)}/1000` : undefined,
        side_data_list: rotation !== undefined ? [{ rotation }] : undefined,
      });
      continue;
    }
    const audio = line.match(/Stream #\d+:\d+.*?: Audio: (\w+)/);
    if (audio) streams.push({ codec_type: "audio", codec_name: audio[1] });
  }
  return {
    streams,
    format: {
      duration: dur ? String(Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])) : undefined,
      size: sizeBytes != null ? String(sizeBytes) : undefined,
      bit_rate: bitrate ? String(Number(bitrate[1]) * 1000) : undefined,
    },
  };
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
export async function extractSpeechAudio(localPath: string, outPath: string, maxSeconds?: number): Promise<void> {
  const limit = maxSeconds ? ["-t", String(Math.ceil(maxSeconds))] : [];
  await runFfmpeg(["-i", localPath, ...limit, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", outPath], {
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

/** Duração real lida remuxando sem decodificar (para arquivos sem Duration no cabeçalho). */
export async function measureDuration(localPath: string): Promise<number> {
  const { stderr } = await runFfmpeg(["-i", localPath, "-map", "0", "-c", "copy", "-f", "null", "-"], { timeoutMs: 5 * 60_000 });
  const all = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = all.at(-1);
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : NaN;
}
