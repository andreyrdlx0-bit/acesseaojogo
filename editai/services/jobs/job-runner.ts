import { logger } from "@/lib/logger";
import { getQueue } from "@/services/queue";
import { VideoAnalysisService } from "@/services/video/analysis-service";
import { VideoProcessingService } from "@/services/video/processing-service";
import type { JobType } from "@/types/domain";
import type { QueuedJob } from "@/types/services";

export interface RunResult {
  job: Pick<QueuedJob, "id" | "type"> | null;
  status: "completed" | "retry" | "failed" | "idle";
}

/**
 * Executa UM job da fila: usado pelo worker dedicado (todos os usuários) e
 * pela rota /api/jobs/run (somente os jobs do usuário autenticado, na Vercel).
 * Toda a política de retry/falha/reembolso fica aqui — sem duplicação.
 */
export async function runNextJob(input: {
  workerId: string;
  types?: JobType[];
  userId?: string;
  staleMinutes?: number;
}): Promise<RunResult> {
  const queue = getQueue();
  const job = await queue.claim(input.workerId, input.types ?? ["analyze", "render"], {
    userId: input.userId,
    staleMinutes: input.staleMinutes,
  });
  if (!job) return { job: null, status: "idle" };

  const started = Date.now();
  logger.info("worker", "Job iniciado", { jobId: job.id, type: job.type, attempt: job.attempts, worker: input.workerId });
  try {
    if (job.type === "analyze") await new VideoAnalysisService().run(String(job.payload.projectId));
    else await new VideoProcessingService().runRender(String(job.payload.renderId));
    await queue.complete(job.id);
    logger.info("worker", "Job concluído", { jobId: job.id, type: job.type, ms: Date.now() - started });
    return { job: { id: job.id, type: job.type }, status: "completed" };
  } catch (error) {
    const retry = job.attempts < job.maxAttempts;
    await queue.fail(job.id, error instanceof Error ? error.message.slice(0, 1000) : "erro", retry);
    logger.error("worker", retry ? "Job falhou; nova tentativa agendada" : "Job falhou definitivamente", {
      jobId: job.id,
      type: job.type,
      error,
    });
    if (!retry) {
      if (job.type === "analyze") await new VideoAnalysisService().fail(String(job.payload.projectId), error);
      else await new VideoProcessingService().failRender(String(job.payload.renderId), error);
    }
    return { job: { id: job.id, type: job.type }, status: retry ? "retry" : "failed" };
  }
}
