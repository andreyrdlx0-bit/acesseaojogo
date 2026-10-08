import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { RenderQueue } from "@/types/services";
import { PostgresRenderQueue } from "./postgres-queue";

let instance: RenderQueue | null = null;

export function getQueue(): RenderQueue {
  if (!instance) instance = new PostgresRenderQueue(createSupabaseAdminClient());
  return instance;
}
