import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/config/env";

let admin: SupabaseClient | null = null;

/**
 * Cliente com SERVICE ROLE (ignora RLS). Somente servidor e worker.
 * Toda rota que usa este cliente DEVE validar a posse do recurso antes.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("admin client não pode ser usado no browser");
  if (admin) return admin;
  const env = serverEnv();
  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
