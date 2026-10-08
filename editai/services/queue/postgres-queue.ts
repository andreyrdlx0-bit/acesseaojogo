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

  async claim(workerId: string, types: JobType[], options: { userId?: string; staleMinutes?: number } = {}): Promise<QueuedJob | null> {
    const { data, error } = options.userId
      ? await this.db.rpc("claim_next_job_for_user", {
          p_worker: workerId,
          p_types: types,
          p_user_id: options.userId,
          p_stale_minutes: options.staleMinutes ?? 10,
        })
      : await this.db.rpc("claim_next_job", { p_worker: workerId, p_types: types });
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

  async countQueued(userId: string): Promise<number> {
    const { count, error } = await this.db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "queued");
    if (error) throw new Error(`Falha ao contar jobs: ${error.message}`);
    return count ?? 0;
  }

  async complete(jobId: string, workerId: string): Promise<boolean> {
    const { data } = await this.db
      .from("jobs")
      .update({ status: "completed", last_error: null })
      .eq("id", jobId)
      .eq("locked_by", workerId)
      .eq("status", "processing")
      .select("id");
    return Boolean(data?.length);
  }

  async fail(jobId: string, workerId: string, error: string, retry: boolean): Promise<boolean> {
    const update = retry
      ? { status: "queued", locked_at: null, locked_by: null, last_error: error, run_after: new Date(Date.now() + 30_000).toISOString() }
      : { status: "failed", last_error: error };
    const { data } = await this.db
      .from("jobs")
      .update(update)
      .eq("id", jobId)
      .eq("locked_by", workerId)
      .eq("status", "processing")
      .select("id");
    return Boolean(data?.length);
  }

  async heartbeat(jobId: string, workerId: string): Promise<void> {
    await this.db
      .from("jobs")
      .update({ locked_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("locked_by", workerId)
      .eq("status", "processing");
  }
}
