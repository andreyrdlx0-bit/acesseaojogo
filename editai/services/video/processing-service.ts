import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { normalizeEditingPlan, validateEditingPlan } from "@/lib/editing-plan";
import { VIDEO_FAILURE_MESSAGE } from "@/lib/errors";
import { isPermanentJobError, PermanentJobError } from "@/services/jobs/errors";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { creditService } from "@/services/credits/credit-service";
import { getStorage } from "@/services/storage";
import type { MediaAsset, Project, ProjectVersion, Render, VideoMetadataRow } from "@/types/domain";
import type { VideoProcessor } from "@/types/services";
import { storagePaths } from "@/utils/storage-paths";
import { defaultTmpRoot } from "./fonts";
import { FfmpegVideoProcessor } from "./engine";

/**
 * VideoProcessingService (roda no WORKER):
 *  1. recebe o vídeo original  2. recebe o EditingPlan  3. revalida operações
 *  4-7. gera e executa FFmpeg com progresso  8. armazena  9. registra URL
 *  10. atualiza status — e reembolsa créditos em caso de falha.
 */
function maxUploadBytes(): number {
  return Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024;
}

export class VideoProcessingService {
  constructor(
    private readonly processor: VideoProcessor = new FfmpegVideoProcessor(),
    private readonly tmpRoot = defaultTmpRoot(),
  ) {}

  async runRender(renderId: string, opts: { deadline?: number } = {}): Promise<void> {
    const db = createSupabaseAdminClient();
    const storage = getStorage();
    const { data: renderRow } = await db.from("renders").select("*").eq("id", renderId).maybeSingle();
    const render = renderRow as Render | null;
    if (!render) throw new PermanentJobError(`Render ${renderId} não encontrado`, VIDEO_FAILURE_MESSAGE);
    if (render.status === "completed") return;
    if (render.status === "failed") {
      // Uma finalização anterior marcou a falha mas pode ter falhado no reembolso:
      // refaz só o reembolso (idempotente) e nunca renderiza de novo.
      await creditService.refundRender(render.user_id, render.credits_charged, render.id);
      return;
    }

    const [{ data: projectRow }, { data: versionRow }, { data: metaRow }] = await Promise.all([
      db.from("projects").select("*").eq("id", render.project_id).single(),
      db.from("project_versions").select("*").eq("id", render.version_id).single(),
      db.from("video_metadata").select("*").eq("project_id", render.project_id).single(),
    ]);
    const project = projectRow as Project;
    const version = versionRow as ProjectVersion;
    const metadata = (metaRow as VideoMetadataRow).metadata;
    if (!project.original_video_url || !metadata) throw new Error("Projeto sem vídeo original analisado");

    const update = (fields: Partial<Render>) => db.from("renders").update(fields).eq("id", renderId);
    const workDir = path.resolve(this.tmpRoot, `render-${renderId}`);
    await mkdir(workDir, { recursive: true });
    await update({ status: "processing", started_at: new Date().toISOString(), progress: 1, stage: "prepare", message: "Preparando vídeo...", error: null });

    try {
      // 3. Nunca confiamos no plano salvo: revalida antes do FFmpeg.
      const { plan, rejected } = validateEditingPlan(version.editing_plan);
      const warnings = rejected.map((r) => `Operação ignorada (${r.type ?? "?"}): ${r.reason}`);

      const sourcePath = path.join(workDir, `source${path.extname(project.original_video_url)}`);
      await storage.downloadToFile(project.original_video_url, sourcePath);

      const assets: { musicPath?: string } = {};
      const music = plan.operations.find((o) => o.type === "background_music" && o.enabled);
      if (music && music.type === "background_music") {
        const asset = await this.findMusic(render.user_id, music.assetId);
        if (asset) {
          assets.musicPath = path.join(workDir, `music${path.extname(asset.storage_path)}`);
          await storage.downloadToFile(asset.storage_path, assets.musicPath);
        }
      }

      let lastWrite = 0;
      const outputPath = path.join(workDir, "output.mp4");
      const result = await this.processor.process(
        {
          sourcePath,
          outputPath,
          plan: normalizeEditingPlan(plan),
          metadata,
          options: render.options,
          assets,
          workDir,
          limits: {
            maxOutputBytes: maxUploadBytes(),
            // Reserva ~45s para o upload e a gravação no banco antes do fim da função.
            timeoutMs: opts.deadline ? Math.max(20_000, opts.deadline - Date.now() - 45_000) : undefined,
          },
        },
        (p) => {
          const now = Date.now();
          if (now - lastWrite < 1500 && p.percent < 97) return; // não martela o banco
          lastWrite = now;
          void update({ progress: Math.min(99, p.percent), stage: p.stage, message: p.message });
        },
      );

      const outKey =
        render.kind === "export"
          ? storagePaths.export(render.user_id, render.project_id, render.id)
          : storagePaths.version(render.user_id, render.project_id, version.version_number);
      await storage.uploadFile(outKey, result.outputPath, "video/mp4");
      await db.from("media_assets").upsert(
        {
          user_id: render.user_id,
          project_id: render.project_id,
          kind: render.kind === "export" ? "export" : "version_video",
          storage_path: outKey,
          mime_type: "video/mp4",
          size_bytes: result.sizeBytes,
          duration_seconds: result.duration,
          metadata: { width: result.width, height: result.height, renderId },
        },
        { onConflict: "storage_path" },
      );

      if (render.kind === "edit") {
        await db
          .from("project_versions")
          .update({ status: "ready", video_url: outKey, duration: result.duration, width: result.width, height: result.height, size_bytes: result.sizeBytes })
          .eq("id", version.id);
        await db.from("projects").update({ current_version_id: version.id, status: "ready" }).eq("id", project.id);
        if (render.command_id) await db.from("editing_commands").update({ status: "rendered" }).eq("id", render.command_id);
      }
      await update({
        status: "completed",
        progress: 100,
        stage: "done",
        message: "Seu vídeo está pronto.",
        output_url: outKey,
        output_size_bytes: result.sizeBytes,
        output_duration: result.duration,
        output_width: result.width,
        output_height: result.height,
        warnings: [...warnings, ...result.warnings],
        completed_at: new Date().toISOString(),
      });
      logger.info(render.kind === "export" ? "export" : "render", "Render concluído", {
        renderId,
        projectId: project.id,
        duration: result.duration,
        sizeBytes: result.sizeBytes,
        warnings: result.warnings.length,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /** Marca falha definitiva: status, mensagem amigável e reembolso (idempotente). */
  async failRender(renderId: string, internalError: unknown): Promise<void> {
    const db = createSupabaseAdminClient();
    const { data, error: readError } = await db.from("renders").select("*").eq("id", renderId).maybeSingle();
    if (readError) throw new Error(readError.message);
    const render = data as Render | null;
    if (!render || render.status === "completed") return;
    logger.error("failure", "Render falhou", { renderId, error: internalError });
    const userMessage = isPermanentJobError(internalError) ? internalError.userMessage : VIDEO_FAILURE_MESSAGE;
    if (render.status !== "failed") {
      const { error } = await db
        .from("renders")
        .update({ status: "failed", error: userMessage, stage: "failed", message: userMessage, completed_at: new Date().toISOString() })
        .eq("id", renderId);
      if (error) throw new Error(error.message);
    }
    if (render.kind === "edit") {
      // Erros do Supabase vêm em `error` (não lançam): checa cada passo para que
      // o executor recoloque a finalização na fila se algo falhar.
      const steps = [
        await db.from("project_versions").update({ status: "failed" }).eq("id", render.version_id).neq("status", "ready"),
        await db.from("projects").update({ status: "ready" }).eq("id", render.project_id).eq("status", "processing"),
        render.command_id ? await db.from("editing_commands").update({ status: "failed" }).eq("id", render.command_id) : { error: null },
      ];
      const failed = steps.find((step) => step.error);
      if (failed?.error) throw new Error(failed.error.message);
    }
    // Idempotente: (reference_id, reason) é único em credit_transactions.
    await creditService.refundRender(render.user_id, render.credits_charged, render.id);
  }

  private async findMusic(userId: string, assetId?: string): Promise<MediaAsset | null> {
    const db = createSupabaseAdminClient();
    let query = db.from("media_assets").select("*").eq("user_id", userId).eq("kind", "music");
    if (assetId) query = query.eq("id", assetId);
    const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    return (data as MediaAsset | null) ?? null;
  }
}
