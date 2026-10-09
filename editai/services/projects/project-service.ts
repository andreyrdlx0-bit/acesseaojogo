import { randomUUID } from "node:crypto";
import { serverEnv } from "@/config/env";
import { baseMime, SIGNED_URL_TTL_SECONDS, VIDEO_MIME_TYPES } from "@/config/upload";
import { EMPTY_PLAN } from "@/lib/editing-plan";
import { AppError, Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getQueue } from "@/services/queue";
import { getStorage } from "@/services/storage";
import { reconcileProject } from "@/services/video/render-finalization";
import type {
  EditingCommand,
  Project,
  ProjectVersion,
  Render,
  VideoMetadataRow,
} from "@/types/domain";
import { sanitizeUserText } from "@/utils/text";
import { storagePaths } from "@/utils/storage-paths";

const db = () => createSupabaseAdminClient();

export interface ProjectSummary extends Project {
  thumbnail_signed_url: string | null;
  duration: number | null;
  latest_version_number: number | null;
}

export interface ProjectDetail {
  /** Quando as URLs assinadas (TTL de 1h) foram geradas (relógio do servidor, ms). */
  signedAt: number;
  project: Project;
  metadata: VideoMetadataRow | null;
  versions: (ProjectVersion & { signed_url: string | null })[];
  commands: EditingCommand[];
  renders: (Render & { signed_url: string | null })[];
  originalUrl: string | null;
  thumbnailUrl: string | null;
}

/** Garante que o projeto existe E pertence ao usuário (base da autorização). */
export async function getOwnedProject(userId: string, projectId: string): Promise<Project> {
  const { data, error } = await db().from("projects").select("*").eq("id", projectId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Errors.notFound("Projeto");
  return data as Project;
}

export async function createProject(userId: string, rawName: string): Promise<Project> {
  const name = sanitizeUserText(rawName, 120) || "Novo projeto";
  const { data, error } = await db().from("projects").insert({ user_id: userId, name }).select("*").single();
  if (error || !data) throw new Error(error?.message);
  logger.info("upload", "Projeto criado", { userId, projectId: data.id });
  return data as Project;
}

export async function listProjects(userId: string, limit = 50): Promise<ProjectSummary[]> {
  const { data, error } = await db()
    .from("projects")
    .select("*, video_metadata(duration), project_versions!project_versions_project_id_fkey(version_number)")
    .eq("user_id", userId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as (Project & {
    video_metadata: { duration: number | null } | { duration: number | null }[] | null;
    project_versions: { version_number: number }[];
  })[];
  const thumbs = await getStorage().createSignedUrls(
    rows.map((r) => r.thumbnail_url).filter((p): p is string => Boolean(p)),
    SIGNED_URL_TTL_SECONDS,
  );
  return rows.map(({ video_metadata, project_versions, ...p }) => {
    const meta = Array.isArray(video_metadata) ? video_metadata[0] : video_metadata;
    return {
      ...p,
      thumbnail_signed_url: p.thumbnail_url ? (thumbs[p.thumbnail_url] ?? null) : null,
      duration: meta?.duration != null ? Number(meta.duration) : null,
      latest_version_number: project_versions.length ? Math.max(...project_versions.map((v) => v.version_number)) : null,
    };
  });
}

export async function getProjectDetail(userId: string, projectId: string, opts: { reconcile?: boolean } = {}): Promise<ProjectDetail> {
  const project = await getOwnedProject(userId, projectId);
  const client = db();
  const [meta, versions, commands, renders] = await Promise.all([
    client.from("video_metadata").select("*").eq("project_id", projectId).maybeSingle(),
    client.from("project_versions").select("*").eq("project_id", projectId).order("version_number", { ascending: true }),
    client.from("editing_commands").select("*").eq("project_id", projectId).order("created_at", { ascending: true }).limit(200),
    client.from("renders").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(50),
  ]);
  for (const r of [meta, versions, commands, renders]) if (r.error) throw new Error(r.error.message);

  const versionRows = (versions.data ?? []) as ProjectVersion[];
  const renderRows = (renders.data ?? []) as Render[];
  const commandRows = (commands.data ?? []) as EditingCommand[];

  // Autocorreção: conclui finalizações que pararam no meio e destrava o
  // projeto. Nunca derruba a leitura; se algo mudou, lê de novo.
  if (opts.reconcile !== false) {
    const changed = await reconcileProject({ project, versions: versionRows, commands: commandRows, renders: renderRows }).catch((error) => {
      logger.error("render", "Falha na autocorreção do projeto", { projectId, error });
      return false;
    });
    if (changed) return getProjectDetail(userId, projectId, { reconcile: false });
  }
  const paths = [
    project.original_video_url,
    project.thumbnail_url,
    ...versionRows.map((v) => v.video_url),
    ...renderRows.map((r) => r.output_url),
  ].filter((p): p is string => Boolean(p));
  const signedAt = Date.now();
  const signed = await getStorage().createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  const sign = (p: string | null) => (p ? (signed[p] ?? null) : null);

  return {
    signedAt,
    project,
    metadata: (meta.data as VideoMetadataRow | null) ?? null,
    versions: versionRows.map((v) => ({ ...v, signed_url: sign(v.video_url) })),
    commands: commandRows,
    renders: renderRows.map((r) => ({ ...r, signed_url: sign(r.output_url) })),
    originalUrl: sign(project.original_video_url),
    thumbnailUrl: sign(project.thumbnail_url),
  };
}

export async function renameProject(userId: string, projectId: string, rawName: string) {
  await getOwnedProject(userId, projectId);
  const name = sanitizeUserText(rawName, 120);
  if (!name) throw Errors.validation("Informe um nome para o projeto.");
  await db().from("projects").update({ name }).eq("id", projectId);
}

export async function deleteProject(userId: string, projectId: string) {
  await getOwnedProject(userId, projectId);
  await getStorage().removePrefix(storagePaths.projectRoot(userId, projectId));
  await db().from("projects").delete().eq("id", projectId).eq("user_id", userId);
  logger.info("upload", "Projeto excluído", { userId, projectId });
}

// ------------------------------------------------------------------ upload

export async function createVideoUploadUrl(
  userId: string,
  projectId: string,
  file: { fileName: string; mimeType: string; sizeBytes: number },
) {
  const project = await getOwnedProject(userId, projectId);
  if (project.original_video_url && project.status !== "failed" && project.status !== "draft" && project.status !== "uploading") {
    throw new AppError("CONFLICT", "Este projeto já tem um vídeo. Crie um novo projeto para outro vídeo.");
  }
  const mime = baseMime(file.mimeType) as keyof typeof VIDEO_MIME_TYPES;
  const ext = VIDEO_MIME_TYPES[mime];
  if (!ext) throw new AppError("UNSUPPORTED_MEDIA", "Formato não suportado. Envie um vídeo MP4, MOV ou WEBM.");
  const maxBytes = serverEnv().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.sizeBytes <= 0 || file.sizeBytes > maxBytes) {
    throw Errors.validation(`O vídeo deve ter no máximo ${serverEnv().MAX_UPLOAD_MB} MB.`);
  }
  const path = storagePaths.original(userId, projectId, ext);
  const upload = await getStorage().createSignedUploadUrl(path);
  await db()
    .from("projects")
    .update({ status: "uploading", original_file_name: sanitizeUserText(file.fileName, 200) })
    .eq("id", projectId);
  logger.info("upload", "URL de upload gerada", { userId, projectId, sizeBytes: file.sizeBytes, mime });
  return { ...upload, path };
}

/**
 * Confirma o upload: verifica no storage (não confia no cliente), cria a
 * versão 1 (vídeo original) e enfileira a análise.
 */
export async function completeVideoUpload(userId: string, projectId: string, path: string) {
  const project = await getOwnedProject(userId, projectId);
  if (!storagePaths.belongsTo(path, userId, projectId) || !path.includes("/original/")) {
    throw Errors.validation("Caminho de upload inválido.");
  }
  const { exists, sizeBytes } = await getStorage().exists(path);
  if (!exists) throw Errors.validation("Não encontramos o vídeo enviado. Tente novamente.");

  const client = db();
  await client.from("media_assets").upsert(
    {
      user_id: userId,
      project_id: projectId,
      kind: "original_video",
      storage_path: path,
      file_name: project.original_file_name,
      size_bytes: sizeBytes,
    },
    { onConflict: "storage_path" },
  );

  const { data: version, error } = await client.rpc("create_project_version", {
    p_project_id: projectId,
    p_user_id: userId,
    p_label: "Vídeo original",
    p_plan: EMPTY_PLAN,
    p_command_id: null,
    p_status: "ready",
    p_video_url: path,
  });
  if (error) throw new Error(error.message);
  const v = (Array.isArray(version) ? version[0] : version) as ProjectVersion;

  await client
    .from("projects")
    .update({ original_video_url: path, current_version_id: v.id, status: "analyzing" })
    .eq("id", projectId);
  await client
    .from("video_metadata")
    .upsert({ project_id: projectId, user_id: userId, analysis_status: "pending" }, { onConflict: "project_id" });
  const jobId = await getQueue().enqueue("analyze", userId, { projectId }, { priority: 10 });
  logger.info("upload", "Upload concluído; análise enfileirada", { userId, projectId, sizeBytes, jobId });
  return { versionId: v.id, jobId };
}

export async function setCurrentVersion(userId: string, projectId: string, versionId: string) {
  await getOwnedProject(userId, projectId);
  const { data } = await db()
    .from("project_versions")
    .select("id,status")
    .eq("id", versionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) throw Errors.notFound("Versão");
  if (data.status !== "ready") throw Errors.validation("Essa versão ainda não está pronta.");
  await db().from("projects").update({ current_version_id: versionId }).eq("id", projectId);
}

export const newId = () => randomUUID();
