import { estimateRenderCredits } from "@/config/credits";
import { getPlan } from "@/config/plans";
import { AUDIO_MIME_TYPES, baseMime, MAX_AUDIO_COMMAND_MB, MAX_INSTRUCTION_CHARS } from "@/config/upload";
import { EMPTY_PLAN, describePlan, type EditingPlan } from "@/lib/editing-plan";
import { AppError, Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEditingPlanner } from "@/services/ai/planner";
import { getSpeechToText } from "@/services/ai/stt";
import { getStorage } from "@/services/storage";
import type { EditingCommand, ExportQuality, PlannerModeInput, ProjectVersion, TranscriptionSource, VideoMetadataRow } from "./types";
import { getOwnedProject, newId } from "./project-service";
import { enqueueRender } from "./render-service";
import { sanitizeUserText } from "@/utils/text";
import { storagePaths } from "@/utils/storage-paths";
import type { VideoContext } from "@/types/services";

const db = () => createSupabaseAdminClient();

export async function createAudioUploadUrl(userId: string, projectId: string, mimeType: string, sizeBytes: number) {
  await getOwnedProject(userId, projectId);
  const ext = AUDIO_MIME_TYPES[baseMime(mimeType) as keyof typeof AUDIO_MIME_TYPES];
  if (!ext) throw new AppError("UNSUPPORTED_MEDIA", "Formato de áudio não suportado.");
  if (sizeBytes <= 0 || sizeBytes > MAX_AUDIO_COMMAND_MB * 1024 * 1024) throw Errors.validation("Áudio muito grande.");
  const path = storagePaths.audio(userId, projectId, newId(), ext);
  return getStorage().createSignedUploadUrl(path);
}

export interface CreateCommandInput {
  userId: string;
  projectId: string;
  text?: string;
  audioPath?: string;
  audioMimeType?: string;
  audioDuration?: number;
  browserTranscript?: string;
  mode: PlannerModeInput;
  baseVersionId?: string;
}

/**
 * ÁUDIO → SPEECH-TO-TEXT → TRANSCRIÇÃO → AI EDITING PLANNER → JSON validado.
 * Não renderiza nada: o usuário confirma depois ("Confirmar edição").
 */
export async function createEditingCommand(input: CreateCommandInput): Promise<EditingCommand & { needs_transcript_fallback?: boolean }> {
  const project = await getOwnedProject(input.userId, input.projectId);
  if (!project.current_version_id || project.status === "analyzing" || project.status === "uploading") {
    throw Errors.validation("Aguarde a análise do vídeo terminar para enviar instruções.");
  }

  // 1. Instrução: texto digitado OU transcrição do áudio.
  let instruction = sanitizeUserText(input.text ?? "", MAX_INSTRUCTION_CHARS);
  let transcription: string | null = null;
  let source: TranscriptionSource = "text";
  if (input.audioPath) {
    if (!storagePaths.belongsTo(input.audioPath, input.userId, input.projectId) || !input.audioPath.includes("/audio/")) {
      throw Errors.validation("Áudio inválido.");
    }
    const stt = getSpeechToText();
    if (stt.isConfigured) {
      try {
        const buffer = await getStorage().downloadBuffer(input.audioPath);
        const ext = input.audioPath.split(".").pop() ?? "webm";
        const result = await stt.transcribe(
          { kind: "buffer", data: buffer, fileName: `command.${ext}`, mimeType: input.audioMimeType ?? "audio/webm" },
          { language: "pt" },
        );
        transcription = result.text;
        source = "stt";
        logger.info("transcription", "Comando de voz transcrito", { projectId: project.id, provider: stt.name, chars: result.text.length });
      } catch (error) {
        logger.error("transcription", "Falha no STT do comando", { projectId: project.id, error });
      }
    }
    if (!transcription && input.browserTranscript) {
      transcription = sanitizeUserText(input.browserTranscript, MAX_INSTRUCTION_CHARS);
      source = "browser";
    }
    if (!transcription) {
      throw new AppError(
        "PROVIDER_NOT_CONFIGURED",
        "Não conseguimos transcrever o áudio. Escreva sua instrução ou tente gravar novamente.",
      );
    }
    instruction = transcription;
    await db().from("media_assets").upsert(
      {
        user_id: input.userId,
        project_id: project.id,
        kind: "audio_command",
        storage_path: input.audioPath,
        mime_type: input.audioMimeType ?? null,
        duration_seconds: input.audioDuration ?? null,
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), // temporário
      },
      { onConflict: "storage_path" },
    );
  }
  if (!instruction) throw Errors.validation("Diga ou escreva como você quer seu vídeo.");

  // 2. Contexto: versão base, metadata, histórico, biblioteca de músicas.
  const baseVersionId = input.baseVersionId ?? project.current_version_id;
  const client = db();
  const [{ data: base }, { data: meta }, { data: history }, { data: music }] = await Promise.all([
    client.from("project_versions").select("*").eq("id", baseVersionId).eq("project_id", project.id).maybeSingle(),
    client.from("video_metadata").select("*").eq("project_id", project.id).maybeSingle(),
    client
      .from("editing_commands")
      .select("instruction_text, assistant_reply")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(6),
    client.from("media_assets").select("id, file_name").eq("user_id", input.userId).eq("kind", "music").limit(20),
  ]);
  if (!base) throw Errors.notFound("Versão");
  const metadataRow = meta as VideoMetadataRow | null;
  const metadata = metadataRow?.metadata;
  if (!metadata) throw Errors.validation("A análise do vídeo ainda não terminou.");

  const video: VideoContext = {
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    hasAudio: metadata.hasAudio,
    silenceCount: metadata.silences.length,
    silenceSeconds: Math.round(metadata.silences.reduce((a, s) => a + s.end - s.start, 0)),
    hasTranscript: Boolean(metadata.transcript?.words.length),
    transcriptText: metadata.transcript?.text ?? null,
    musicAssets: (music ?? []).map((m) => ({ id: m.id as string, name: (m.file_name as string) ?? "Música" })),
  };

  // 3. IA interpreta → JSON → validação (dentro do planner).
  const planner = getEditingPlanner();
  const started = Date.now();
  const result = await planner.createEditingPlan({
    instruction,
    currentPlan: ((base as ProjectVersion).editing_plan as EditingPlan) ?? EMPTY_PLAN,
    video,
    mode: input.mode,
    history: (history ?? [])
      .reverse()
      .map((h) => ({ instruction: h.instruction_text as string, reply: h.assistant_reply as string })),
  });
  logger.info("plan", "Plano de edição gerado", {
    projectId: project.id,
    provider: result.provider,
    operations: result.plan.operations.map((o) => o.type),
    rejected: result.rejected.length,
    ms: Date.now() - started,
  });

  const credits = estimateRenderCredits({ sourceDurationSeconds: metadata.duration, plan: result.plan, quality: "720p", kind: "edit" });
  const { data: command, error } = await client
    .from("editing_commands")
    .insert({
      project_id: project.id,
      user_id: input.userId,
      audio_url: input.audioPath ?? null,
      audio_duration: input.audioDuration ?? null,
      transcription,
      transcription_source: source,
      instruction_text: instruction,
      editing_plan: result.plan,
      assistant_reply: result.reply,
      rejected_operations: result.rejected,
      planner_provider: result.provider,
      status: "planned",
      base_version_id: baseVersionId,
      estimated_credits: credits,
    })
    .select("*")
    .single();
  if (error || !command) throw new Error(error?.message);
  return command as EditingCommand;
}

/** "Confirmar edição": cria a nova versão e enfileira a renderização. */
export async function confirmEditingCommand(userId: string, commandId: string) {
  const client = db();
  const { data } = await client.from("editing_commands").select("*").eq("id", commandId).eq("user_id", userId).maybeSingle();
  const command = data as EditingCommand | null;
  if (!command) throw Errors.notFound("Comando");
  if (command.status !== "planned") throw new AppError("CONFLICT", "Essa edição já foi confirmada.");
  const plan = command.editing_plan as EditingPlan;

  const project = await getOwnedProject(userId, command.project_id);
  const labelParts = describePlan(plan);
  const label = labelParts.length ? labelParts.slice(0, 3).join(" + ") : "Sem edições";

  const render = await enqueueRender({
    userId,
    project,
    plan,
    kind: "edit",
    options: { quality: "720p" },
    commandId: command.id,
    newVersionLabel: label,
  });
  await client
    .from("editing_commands")
    .update({ status: "confirmed", result_version_id: render.version_id })
    .eq("id", command.id);
  return render;
}

export async function discardEditingCommand(userId: string, commandId: string) {
  await db().from("editing_commands").update({ status: "discarded" }).eq("id", commandId).eq("user_id", userId).eq("status", "planned");
}

export async function getUserPlanQuality(userId: string): Promise<ExportQuality> {
  const { data } = await db().from("subscriptions").select("plan_id,status").eq("user_id", userId).maybeSingle();
  const plan = getPlan(data?.status === "active" || data?.status === "trialing" ? data.plan_id : "free");
  return plan.maxQuality;
}
