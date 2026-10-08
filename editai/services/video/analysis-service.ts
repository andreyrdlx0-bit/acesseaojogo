import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSpeechToText } from "@/services/ai/stt";
import { getStorage } from "@/services/storage";
import type { Project } from "@/types/domain";
import type { VideoAnalyzer } from "@/types/services";
import { storagePaths } from "@/utils/storage-paths";
import { defaultTmpRoot } from "./fonts";
import { extractSpeechAudio, extractThumbnail, FfmpegVideoAnalyzer } from "./analyzer";

const STT_MAX_BYTES = 24 * 1024 * 1024;

/**
 * Pipeline de análise pós-upload: duração, resolução, FPS, áudio, volume,
 * silêncios, fala, cortes sugeridos, thumbnail e transcrição (se houver STT).
 */
export class VideoAnalysisService {
  constructor(
    private readonly analyzer: VideoAnalyzer = new FfmpegVideoAnalyzer(),
    private readonly tmpRoot = defaultTmpRoot(),
  ) {}

  async run(projectId: string): Promise<void> {
    const db = createSupabaseAdminClient();
    const storage = getStorage();
    const { data } = await db.from("projects").select("*").eq("id", projectId).maybeSingle();
    const project = data as Project | null;
    if (!project?.original_video_url) throw new Error("Projeto sem vídeo");

    const workDir = path.resolve(this.tmpRoot, `analyze-${projectId}`);
    await mkdir(workDir, { recursive: true });
    await db.from("video_metadata").update({ analysis_status: "processing", analysis_error: null }).eq("project_id", projectId);
    try {
      const source = path.join(workDir, `source${path.extname(project.original_video_url)}`);
      await storage.downloadToFile(project.original_video_url, source);
      const metadata = await this.analyzer.analyze(source);

      const maxSeconds = Number(process.env.MAX_VIDEO_SECONDS || 900);
      if (metadata.duration > maxSeconds) throw new Error(`Vídeo excede ${maxSeconds}s`);

      const thumbLocal = path.join(workDir, "thumbnail.jpg");
      await extractThumbnail(source, thumbLocal, metadata.duration);
      const thumbKey = storagePaths.thumbnail(project.user_id, projectId);
      await storage.uploadFile(thumbKey, thumbLocal, "image/jpeg");

      const stt = getSpeechToText();
      if (metadata.hasAudio && stt.isConfigured) {
        try {
          const audioLocal = path.join(workDir, "speech.mp3");
          await extractSpeechAudio(source, audioLocal);
          const { size } = await stat(audioLocal);
          if (size > STT_MAX_BYTES) {
            logger.warn("transcription", "Áudio grande demais para STT; transcrição ignorada", { projectId, size });
          } else {
            const { readFile } = await import("node:fs/promises");
            const buf = await readFile(audioLocal);
            metadata.transcript = await stt.transcribe(
              { kind: "buffer", data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, fileName: "speech.mp3", mimeType: "audio/mpeg" },
              { language: process.env.STT_LANGUAGE || "pt", wordTimestamps: true },
            );
            logger.info("transcription", "Vídeo transcrito", { projectId, words: metadata.transcript.words.length });
          }
        } catch (error) {
          logger.error("transcription", "Falha ao transcrever o vídeo (seguindo sem transcrição)", { projectId, error });
        }
      } else if (metadata.hasAudio) {
        logger.warn("transcription", "Sem provedor de STT: vídeo sem transcrição (legendas indisponíveis)", { projectId });
      }

      await db
        .from("video_metadata")
        .update({
          analysis_status: "completed",
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          has_audio: metadata.hasAudio,
          metadata,
          analyzed_at: new Date().toISOString(),
        })
        .eq("project_id", projectId);
      await db
        .from("project_versions")
        .update({ duration: metadata.duration, width: metadata.width, height: metadata.height, size_bytes: metadata.sizeBytes })
        .eq("project_id", projectId)
        .eq("version_number", 1);
      await db.from("projects").update({ status: "ready", thumbnail_url: thumbKey }).eq("id", projectId);
      logger.info("analysis", "Análise concluída", { projectId, duration: metadata.duration, silences: metadata.silences.length });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async fail(projectId: string, error: unknown) {
    const db = createSupabaseAdminClient();
    logger.error("failure", "Análise falhou", { projectId, error });
    await db
      .from("video_metadata")
      .update({ analysis_status: "failed", analysis_error: "Não conseguimos processar esse vídeo. Verifique o formato ou tente novamente." })
      .eq("project_id", projectId);
    await db.from("projects").update({ status: "failed" }).eq("id", projectId);
  }
}
