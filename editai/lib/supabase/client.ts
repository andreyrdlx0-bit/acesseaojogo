"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/config/env";

/** Cliente do browser (anon key + sessão do usuário; sujeito a RLS). */
export function createSupabaseBrowserClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
