import { estimateRenderCredits } from "@/config/credits";
import { getPlan } from "@/config/plans";
import type { EditingPlan } from "@/lib/editing-plan";
import { AppError, Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { creditService } from "@/services/credits/credit-service";
import { getQueue } from "@/services/queue";
import { getStorage } from "@/services/storage";
import type { Project, ProjectVersion, Render, RenderKind, RenderOptions, VideoMetadataRow } from "@/types/domain";
import type { VideoMetadata } from "@/types/video";
import { getOwnedProject } from "./project-service";

const db = () => createSupabaseAdminClient();

interface EnqueueInput {
  userId: string;
  project: Project;
  plan: EditingPlan;
  kind: RenderKind;
  options: RenderOptions;
  commandId?: string;
  /** edit: cria nova versão com este rótulo. export: usa `versionId`. */
  newVersionLabel?: string;
  versionId?: string;
}

/**
 * CREATE JOB → QUEUE. Cobra os créditos de forma atômica ANTES de enfileirar;
 * se o render falhar, o worker reembolsa (idempotente).
 */
export async function enqueueRender(input: EnqueueInput): Promise<Render> {
  const client = db();
  const { data: meta } = await client.from("video_metadata").select("*").eq("project_id", input.project.id).maybeSingle();
  const metadata = (meta as VideoMetadataRow | null)?.metadata;
  if (!metadata) throw Errors.validation("A análise do vídeo ainda não terminou.");

  const { data: sub } = await client.from("subscriptions").select("plan_id,status").eq("user_id", input.userId).maybeSingle();
  const plan = getPlan(sub && ["active", "trialing"].includes(sub.status) ? sub.plan_id : "free");
  if (input.options.quality === "1080p" && plan.maxQuality !== "1080p") {
    throw new AppError("FORBIDDEN", "Exportação em 1080p está disponível a partir do plano Creator.");
  }
  if (metadata.duration > plan.maxVideoMinutes * 60) {
    throw new AppError("FORBIDDEN", `Seu plano processa vídeos de até ${plan.maxVideoMinutes} minutos.`);
  }

  const credits = estimateRenderCredits({
    sourceDurationSeconds: metadata.duration,
    plan: input.plan,
    quality: input.options.quality,
    kind: input.kind,
    hasTranscript: Boolean(metadata.transcript?.words.length),
  });
  const balance = await creditService.getBalance(input.userId);
  if (balance < credits) throw Errors.insufficientCredits(credits, balance);

  // Versão: nova (edit) ou existente (export).
  let versionId = input.versionId;
  let createdVersion = false;
  if (input.kind === "edit") {
    const { data, error } = await client.rpc("create_project_version", {
      p_project_id: input.project.id,
      p_user_id: input.userId,
      p_label: input.newVersionLabel ?? "Nova versão",
      p_plan: input.plan,
      p_command_id: input.commandId ?? null,
      p_status: "pending",
      p_video_url: null,
    });
    if (error) throw new Error(error.message);
    versionId = ((Array.isArray(data) ? data[0] : data) as ProjectVersion).id;
    createdVersion = true;
  }
  if (!versionId) throw Errors.notFound("Versão");

  const { data: render, error } = await client
    .from("renders")
    .insert({
      project_id: input.project.id,
      user_id: input.userId,
      version_id: versionId,
      command_id: input.commandId ?? null,
      kind: input.kind,
      status: "queued",
      progress: 0,
      stage: "queued",
      message: "Na fila...",
      options: input.options,
      credits_charged: credits,
    })
    .select("*")
    .single();
  if (error || !render) {
    if (createdVersion) await client.from("project_versions").delete().eq("id", versionId);
    throw new Error(error?.message);
  }

  try {
    await creditService.consume(input.userId, credits, input.kind === "export" ? "export" : "render", render.id, `${input.kind === "export" ? "Exportação" : "Edição"}: ${input.project.name}`);
  } catch (e) {
    await client.from("renders").delete().eq("id", render.id);
    if (createdVersion) await client.from("project_versions").delete().eq("id", versionId);
    throw e;
  }

  try {
    await getQueue().enqueue("render", input.userId, { renderId: render.id }, { priority: plan.priority });
  } catch (e) {
    // Compensação: devolve os créditos e remove render/versão que nunca rodarão.
    await creditService
      .refundRender(input.userId, credits, render.id)
      .catch((err) => logger.error("credits", "Falha ao reembolsar após erro de enfileiramento", { renderId: render.id, error: err }));
    await client.from("renders").delete().eq("id", render.id);
    if (createdVersion) await client.from("project_versions").delete().eq("id", versionId);
    throw e;
  }
  if (input.kind === "edit") await client.from("projects").update({ status: "processing" }).eq("id", input.project.id);
  logger.info(input.kind === "export" ? "export" : "render", "Render enfileirado", {
    userId: input.userId,
    projectId: input.project.id,
    renderId: render.id,
    credits,
  });
  return render as Render;
}

export async function createExport(
  userId: string,
  projectId: string,
  versionId: string,
  options: RenderOptions,
): Promise<Render> {
  const project = await getOwnedProject(userId, projectId);
  const { data } = await db().from("project_versions").select("*").eq("id", versionId).eq("project_id", projectId).maybeSingle();
  const version = data as ProjectVersion | null;
  if (!version) throw Errors.notFound("Versão");
  if (version.status !== "ready") throw Errors.validation("Essa versão ainda não está pronta para exportar.");
  return enqueueRender({ userId, project, plan: version.editing_plan, kind: "export", options, versionId });
}

export async function getRenderForUser(userId: string, renderId: string) {
  const { data } = await db().from("renders").select("*").eq("id", renderId).eq("user_id", userId).maybeSingle();
  const render = data as Render | null;
  if (!render) throw Errors.notFound("Renderização");
  const signed_url = render.output_url ? await getStorage().createSignedUrl(render.output_url, 3600) : null;
  const ratio = (render.options?.aspectRatio ?? "").replace(":", "x");
  const download_url = render.output_url
    ? await getStorage().createSignedUrl(render.output_url, 3600, { download: `editai${ratio ? `-${ratio}` : ""}-${render.id.slice(0, 8)}.mp4` })
    : null;
  return { ...render, signed_url, download_url };
}

export async function estimateCommandCost(userId: string, projectId: string, plan: EditingPlan, options: RenderOptions, kind: RenderKind) {
  await getOwnedProject(userId, projectId);
  const { data } = await db().from("video_metadata").select("duration, metadata").eq("project_id", projectId).maybeSingle();
  const metadata = (data?.metadata ?? null) as VideoMetadata | null;
  return estimateRenderCredits({
    sourceDurationSeconds: Number(data?.duration ?? 0),
    plan,
    quality: options.quality,
    kind,
    hasTranscript: Boolean(metadata?.transcript?.words.length),
  });
}
