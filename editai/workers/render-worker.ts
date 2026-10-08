/**
 * Worker de processamento: QUEUE → WORKER → FFMPEG → STORAGE → COMPLETED
 *
 *   npm run worker
 *
 * Roda fora do Next.js (processo de longa duração, com FFmpeg instalado).
 * Escale horizontalmente subindo mais instâncias: a fila usa SKIP LOCKED.
 */
import { existsSync } from "node:fs";
import { hostname } from "node:os";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function main() {
  const { logger } = await import("@/lib/logger");
  const { getQueue } = await import("@/services/queue");
  const { VideoProcessingService } = await import("@/services/video/processing-service");
  const { VideoAnalysisService } = await import("@/services/video/analysis-service");
  const { cleanupExpiredAssets } = await import("./cleanup");
  const { serverEnv } = await import("@/config/env");

  const env = serverEnv();
  const queue = getQueue();
  const renderer = new VideoProcessingService();
  const analyzer = new VideoAnalysisService();
  const workerId = `${hostname()}-${process.pid}`;
  let running = true;
  let active = 0;

  process.on("SIGINT", () => (running = false));
  process.on("SIGTERM", () => (running = false));
  logger.info("worker", "Worker iniciado", { workerId, concurrency: env.WORKER_CONCURRENCY });

  let lastCleanup = 0;
  const loop = async () => {
    while (running) {
      if (Date.now() - lastCleanup > 60 * 60_000) {
        lastCleanup = Date.now();
        cleanupExpiredAssets().catch((error) => logger.error("worker", "Limpeza falhou", { error }));
      }
      const job = await queue.claim(workerId, ["analyze", "render"]).catch((error) => {
        logger.error("worker", "Falha ao buscar job", { error });
        return null;
      });
      if (!job) {
        await new Promise((r) => setTimeout(r, env.WORKER_POLL_INTERVAL_MS));
        continue;
      }
      active++;
      const started = Date.now();
      logger.info("worker", "Job iniciado", { jobId: job.id, type: job.type, attempt: job.attempts });
      try {
        if (job.type === "analyze") await analyzer.run(String(job.payload.projectId));
        else await renderer.runRender(String(job.payload.renderId));
        await queue.complete(job.id);
        logger.info("worker", "Job concluído", { jobId: job.id, type: job.type, ms: Date.now() - started });
      } catch (error) {
        const retry = job.attempts < job.maxAttempts;
        await queue.fail(job.id, error instanceof Error ? error.message.slice(0, 1000) : "erro", retry);
        logger.error("worker", retry ? "Job falhou; nova tentativa agendada" : "Job falhou definitivamente", {
          jobId: job.id,
          type: job.type,
          error,
        });
        if (!retry) {
          if (job.type === "analyze") await analyzer.fail(String(job.payload.projectId), error);
          else await renderer.failRender(String(job.payload.renderId), error);
        }
      } finally {
        active--;
      }
    }
  };

  await Promise.all(Array.from({ length: env.WORKER_CONCURRENCY }, loop));
  while (active > 0) await new Promise((r) => setTimeout(r, 500));
  logger.info("worker", "Worker finalizado", { workerId });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
