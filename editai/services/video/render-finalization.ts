import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { creditService } from "@/services/credits/credit-service";
import type { EditingCommand, Project, ProjectVersion, Render } from "@/types/domain";

/**
 * Passos finais de um render, todos idempotentes: podem ser refeitos por uma
 * nova tentativa do job ou pela autocorreção ao abrir o projeto. Sem FFmpeg
 * aqui, para que leituras (API/páginas) possam importar este módulo.
 *
 * Ordem importa: o render é marcado terminal ANTES de olhar outras edições
 * (hasOtherActiveEdit). Assim, entre duas edições que terminam juntas, a última
 * a terminar sempre vê a outra terminada e devolve o projeto para "ready".
 */

export function throwIfError(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

/** Há outra edição na fila ou renderizando neste projeto? */
export async function hasOtherActiveEdit(projectId: string, renderId: string): Promise<boolean> {
  const { count, error } = await createSupabaseAdminClient()
    .from("renders")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("kind", "edit")
    .in("status", ["queued", "processing"])
    .neq("id", renderId);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/**
 * Edição já gravada como "completed": versão pronta, projeto e comando
 * atualizados. O comando é o último passo e marca a finalização como feita:
 * depois disso, repetir (nova tentativa atrasada) não troca de novo a versão
 * atual, que o usuário pode já ter mudado.
 */
export async function finishCompletedEdit(render: Render): Promise<void> {
  const db = createSupabaseAdminClient();
  if (render.command_id) {
    const { data: command, error } = await db.from("editing_commands").select("status").eq("id", render.command_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (command?.status === "rendered") return;
  }
  throwIfError(
    await db
      .from("project_versions")
      .update({
        status: "ready",
        video_url: render.output_url,
        duration: render.output_duration,
        width: render.output_width,
        height: render.output_height,
        size_bytes: render.output_size_bytes,
      })
      .eq("id", render.version_id),
  );
  // Outra edição em andamento continua dona do status "processing".
  const busy = await hasOtherActiveEdit(render.project_id, render.id);
  throwIfError(
    await db
      .from("projects")
      .update(busy ? { current_version_id: render.version_id } : { current_version_id: render.version_id, status: "ready" })
      .eq("id", render.project_id),
  );
  if (render.command_id) {
    throwIfError(await db.from("editing_commands").update({ status: "rendered" }).eq("id", render.command_id).eq("status", "confirmed"));
  }
}

/**
 * Render já gravado como "failed": reembolso primeiro (o dinheiro não espera a
 * limpeza), depois a limpeza da edição.
 */
export async function finishFailedRender(render: Render): Promise<void> {
  // Idempotente: (reference_id, reason) é único em credit_transactions.
  await creditService.refundRender(render.user_id, render.credits_charged, render.id);
  if (render.kind !== "edit") return;
  const db = createSupabaseAdminClient();
  throwIfError(await db.from("project_versions").update({ status: "failed" }).eq("id", render.version_id).neq("status", "ready"));
  if (!(await hasOtherActiveEdit(render.project_id, render.id))) {
    throwIfError(await db.from("projects").update({ status: "ready" }).eq("id", render.project_id).eq("status", "processing"));
  }
  if (render.command_id) {
    throwIfError(await db.from("editing_commands").update({ status: "failed" }).eq("id", render.command_id).eq("status", "confirmed"));
  }
}

/**
 * Autocorreção ao abrir o projeto: conclui finalizações que pararam no meio
 * (banco instável, job abandonado, versões antigas do código) e destrava um
 * projeto "processing" sem nenhuma edição ativa. Devolve true se mudou algo.
 */
export async function reconcileProject(input: {
  project: Project;
  versions: ProjectVersion[];
  commands: EditingCommand[];
  renders: Render[];
}): Promise<boolean> {
  const { project, versions, commands, renders } = input;
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const commandById = new Map(commands.map((c) => [c.id, c]));
  let changed = false;

  for (const render of renders) {
    if (render.kind !== "edit") continue;
    const version = versionById.get(render.version_id);
    const command = render.command_id ? commandById.get(render.command_id) : undefined;
    const commandPending = command?.status === "confirmed";
    // Versão ainda pendente ou comando ainda "confirmed" = finalização pela
    // metade (o comando é o último passo): refaz tudo, inclusive a versão atual.
    if (render.status === "completed" && (version?.status === "pending" || commandPending)) {
      await finishCompletedEdit(render);
      changed = true;
    } else if (render.status === "failed" && (version?.status === "pending" || commandPending)) {
      await finishFailedRender(render);
      changed = true;
    }
  }

  // Reembolsos que ficaram para trás (o job desistiu de finalizar, o que
  // acontece em minutos): só falhas recentes, para não consultar a cada polling.
  const recent = Date.now() - 24 * 3600_000;
  const charged = renders.filter(
    (r) => r.status === "failed" && r.credits_charged > 0 && (!r.completed_at || Date.parse(r.completed_at) > recent),
  );
  if (charged.length) {
    const { data, error } = await createSupabaseAdminClient()
      .from("credit_transactions")
      .select("reference_id")
      .eq("reason", "refund")
      .in(
        "reference_id",
        charged.map((r) => r.id),
      );
    if (error) throw new Error(error.message);
    const refunded = new Set((data ?? []).map((t) => t.reference_id as string));
    for (const render of charged) {
      if (refunded.has(render.id)) continue;
      logger.warn("credits", "Reembolso pendente aplicado pela autocorreção", { renderId: render.id });
      await creditService.refundRender(render.user_id, render.credits_charged, render.id);
      changed = true;
    }
  }

  if (project.status === "processing" && !renders.some((r) => r.kind === "edit" && (r.status === "queued" || r.status === "processing"))) {
    // Confere no banco (a lista pode estar truncada) antes de destravar.
    if (!(await hasOtherActiveEdit(project.id, "00000000-0000-0000-0000-000000000000"))) {
      throwIfError(await createSupabaseAdminClient().from("projects").update({ status: "ready" }).eq("id", project.id).eq("status", "processing"));
      changed = true;
    }
  }
  return changed;
}
