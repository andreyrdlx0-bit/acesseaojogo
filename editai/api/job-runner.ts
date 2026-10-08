"use client";

import { api } from "./client";

interface RunResponse {
  processed: { id: string; type: string; status: string } | null;
  pending: number;
  inline: boolean;
}

let inFlight: Promise<void> | null = null;

/**
 * Dispara o processamento dos jobs pendentes do usuário (modo inline/Vercel).
 * Idempotente: chamadas simultâneas reaproveitam a mesma execução; a fila no
 * banco (SKIP LOCKED) garante que cada job roda uma única vez. Com um worker
 * dedicado ativo, a rota responde `inline: false` e nada acontece aqui.
 */
export function kickJobs(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      for (let i = 0; i < 10; i++) {
        const res = await api.post<RunResponse>("/api/jobs/run");
        if (!res.inline || !res.processed || res.pending === 0) break;
      }
    } catch {
      // O polling da tela mostra o estado real; uma nova tentativa ocorre no próximo ciclo.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
