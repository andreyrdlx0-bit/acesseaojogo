import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStorage } from "@/services/storage";

/** Remove arquivos temporários expirados (ex.: áudios de comandos de voz). */
export async function cleanupExpiredAssets(): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("media_assets")
    .select("id, storage_path")
    .lt("expires_at", new Date().toISOString())
    .limit(500);
  if (!data?.length) return 0;
  await getStorage().remove(data.map((d) => d.storage_path as string));
  await db.from("media_assets").delete().in("id", data.map((d) => d.id as string));
  logger.info("worker", "Arquivos temporários removidos", { count: data.length });
  return data.length;
}
