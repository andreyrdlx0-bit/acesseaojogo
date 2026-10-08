import { logger } from "@/lib/logger";
import { getQueue } from "@/services/queue";
import { VideoAnalysisService } from "@/services/video/analysis-service";
import { VideoProcessingService } from "@/services/video/processing-service";
import type { JobType } from "@/types/domain";
import type { QueuedJob } from "@/types/services";
import { isPermanentJobError, PermanentJobError } from "./errors";

export interface RunResult {
  job: Pick<QueuedJob, "id" | "type"> | null;
  status: "completed" | "retry" | "failed" | "idle";
}

const HEARTBEAT_MS = 60_000;

/**
 * Executa UM job da fila: usado pelo worker dedicado (todos os usuários) e
 * pela rota /api/jobs/run (somente os jobs do usuário autenticado, na Vercel).
 * Toda a política de retry/falha/reembolso fica aqui — sem duplicação.
 *
 * - heartbeat: um job vivo renova o lock e nunca parece "abandonado";
 * - um job que voltou à fila além do limite de tentativas (ex.: função morta
 *   pelo tempo máximo) é finalizado como falha, com reembolso, sem rodar de novo;
 * - falhas permanentes (PermanentJobError) não são repetidas.
 */
export async function runNextJob(input: {
  workerId: string;
  types?: JobType[];
  userId?: string;
  staleMinutes?: number;
  /** Tempo máximo disponível para este job (ex.: limite da função serverless). */
  timeBudgetMs?: number;
}): Promise<RunResult> {
  const queue = getQueue();
  const workerId = input.workerId;
  const job = await queue.claim(workerId, input.types ?? ["analyze", "render"], {
    userId: input.userId,
    staleMinutes: input.staleMinutes,
  });
  if (!job) return { job: null, status: "idle" };

  const started = Date.now();
  const deadline = input.timeBudgetMs ? started + input.timeBudgetMs : undefined;
  const heartbeat = setInterval(() => void queue.heartbeat(job.id, workerId).catch(() => undefined), HEARTBEAT_MS);
  logger.info("worker", "Job iniciado", { jobId: job.id, type: job.type, attempt: job.attempts, worker: workerId });
  try {
    if (job.attempts > job.maxAttempts) {
      throw new PermanentJobError(
        "Tentativas esgotadas (execuções anteriores foram interrompidas)",
        "Não conseguimos processar esse vídeo a tempo. Tente um trecho menor.",
      );
    }
    if (job.type === "analyze") await new VideoAnalysisService().run(String(job.payload.projectId));
    else await new VideoProcessingService().runRender(String(job.payload.renderId), { deadline });
    await queue.complete(job.id, workerId);
    logger.info("worker", "Job concluído", { jobId: job.id, type: job.type, ms: Date.now() - started });
    return { job: { id: job.id, type: job.type }, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "erro";
    const retry = !isPermanentJobError(error) && job.attempts < job.maxAttempts;
    logger.error("worker", retry ? "Job falhou; nova tentativa agendada" : "Job falhou definitivamente", {
      jobId: job.id,
      type: job.type,
      error,
    });
    if (!retry) {
      try {
        // Marca falha + reembolso ANTES de encerrar o job. Se isso falhar, o job
        // volta para a fila; na próxima execução o render já "failed" refaz só o
        // reembolso, e uma análise já concluída não é marcada como falha.
        if (job.type === "analyze") await new VideoAnalysisService().fail(String(job.payload.projectId), error);
        else await new VideoProcessingService().failRender(String(job.payload.renderId), error);
      } catch (finalizeError) {
        logger.error("worker", "Falha ao finalizar job com erro; ficará na fila", { jobId: job.id, error: finalizeError });
        await queue.fail(job.id, workerId, message, true);
        return { job: { id: job.id, type: job.type }, status: "retry" };
      }
    }
    await queue.fail(job.id, workerId, message, retry);
    return { job: { id: job.id, type: job.type }, status: retry ? "retry" : "failed" };
  } finally {
    clearInterval(heartbeat);
  }
}
