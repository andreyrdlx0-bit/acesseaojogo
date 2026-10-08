import { serverEnv } from "@/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { StorageProvider } from "@/types/services";
import { SupabaseStorageProvider } from "./supabase-storage";

let instance: StorageProvider | null = null;

/** Ponto único de troca do storage (ex.: S3/R2 no futuro). */
export function getStorage(): StorageProvider {
  if (!instance) instance = new SupabaseStorageProvider(createSupabaseAdminClient(), serverEnv().SUPABASE_STORAGE_BUCKET);
  return instance;
}
