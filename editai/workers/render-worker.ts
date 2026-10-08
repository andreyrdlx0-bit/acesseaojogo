/**
 * Worker de processamento dedicado: QUEUE → WORKER → FFMPEG → STORAGE → COMPLETED
 *
 *   npm run worker
 *
 * Opcional na Vercel (lá a rota /api/jobs/run processa os jobs de cada usuário),
 * recomendado em produção para vídeos longos e volume alto. Escale subindo mais
 * instâncias: a fila usa FOR UPDATE SKIP LOCKED.
 */
import { existsSync } from "node:fs";
import { hostname } from "node:os";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function main() {
  const { logger } = await import("@/lib/logger");
  const { runNextJob } = await import("@/services/jobs/job-runner");
  const { cleanupExpiredAssets } = await import("./cleanup");
  const { serverEnv } = await import("@/config/env");

  const env = serverEnv();
  const workerId = `${hostname()}-${process.pid}`;
  let running = true;
  process.on("SIGINT", () => (running = false));
  process.on("SIGTERM", () => (running = false));
  logger.info("worker", "Worker iniciado", { workerId, concurrency: env.WORKER_CONCURRENCY });

  let lastCleanup = 0;
  const loop = async (slot: number) => {
    while (running) {
      if (slot === 0 && Date.now() - lastCleanup > 60 * 60_000) {
        lastCleanup = Date.now();
        cleanupExpiredAssets().catch((error) => logger.error("worker", "Limpeza falhou", { error }));
      }
      const result = await runNextJob({ workerId: `${workerId}#${slot}` }).catch((error) => {
        logger.error("worker", "Falha ao buscar/processar job", { error });
        return null;
      });
      if (!result || result.status === "idle") await new Promise((r) => setTimeout(r, env.WORKER_POLL_INTERVAL_MS));
    }
  };

  await Promise.all(Array.from({ length: env.WORKER_CONCURRENCY }, (_, i) => loop(i)));
  logger.info("worker", "Worker finalizado", { workerId });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
