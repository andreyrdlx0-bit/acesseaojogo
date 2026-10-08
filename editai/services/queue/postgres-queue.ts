import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobType } from "@/types/domain";
import type { QueuedJob, RenderQueue } from "@/types/services";

/**
 * Fila sobre a tabela `jobs` do Postgres (FOR UPDATE SKIP LOCKED).
 * Suficiente para o MVP e vários workers. Para alto volume, troque por
 * BullMQ/SQS implementando a mesma interface RenderQueue.
 */
export class PostgresRenderQueue implements RenderQueue {
  constructor(private readonly db: SupabaseClient) {}

  async enqueue(type: JobType, userId: string, payload: Record<string, unknown>, options: { priority?: number } = {}) {
    const { data, error } = await this.db
      .from("jobs")
      .insert({ type, user_id: userId, payload, priority: options.priority ?? 0 })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Falha ao enfileirar job: ${error?.message}`);
    return data.id as string;
  }

  async claim(workerId: string, types: JobType[]): Promise<QueuedJob | null> {
    const { data, error } = await this.db.rpc("claim_next_job", { p_worker: workerId, p_types: types });
    if (error) throw new Error(`Falha ao buscar job: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      userId: row.user_id,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    };
  }

  async complete(jobId: string) {
    await this.db.from("jobs").update({ status: "completed", locked_at: null, last_error: null }).eq("id", jobId);
  }

  async fail(jobId: string, error: string, retry: boolean) {
    const update = retry
      ? { status: "queued", locked_at: null, locked_by: null, last_error: error, run_after: new Date(Date.now() + 30_000).toISOString() }
      : { status: "failed", locked_at: null, last_error: error };
    await this.db.from("jobs").update(update).eq("id", jobId);
  }
}
