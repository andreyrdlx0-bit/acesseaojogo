import { apiRoute } from "@/lib/api/handler";
import { runNextJob } from "@/services/jobs/job-runner";
import { getQueue } from "@/services/queue";

// FFmpeg roda nesta função: Node.js e tempo máximo estendido (Vercel Fluid: até 300s no Hobby).
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Processamento inline (sem worker dedicado): o navegador do usuário dispara
 * esta rota quando há análise/renderização pendente. Só processa jobs do
 * PRÓPRIO usuário autenticado, um por chamada. Desative com INLINE_JOBS=false
 * quando houver um worker dedicado.
 */
export const POST = apiRoute(
  async ({ user }) => {
    if (process.env.INLINE_JOBS === "false") return { processed: null, pending: 0, inline: false };
    const result = await runNextJob({
      workerId: `inline-${user.id.slice(0, 8)}-${process.env.VERCEL_REGION ?? "local"}`,
      userId: user.id,
      // Funções duram no máximo 300s: um job "preso" há 6+ min pode ser retomado.
      staleMinutes: 6,
    });
    const pending = await getQueue().countQueued(user.id);
    return { processed: result.job ? { ...result.job, status: result.status } : null, pending, inline: true };
  },
  { rateLimit: { limit: 30, windowMs: 60_000 }, rateLimitKey: "jobs-run" },
);
