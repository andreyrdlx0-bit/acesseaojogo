import { apiRoute, assertUuid } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStorage } from "@/services/storage";

export const DELETE = apiRoute<{ id: string }>(async ({ user, params }) => {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("media_assets")
    .select("id, storage_path, kind")
    .eq("id", assertUuid(params.id))
    .eq("user_id", user.id)
    .eq("kind", "music")
    .maybeSingle();
  if (!data) throw Errors.notFound("Arquivo");
  await getStorage().remove([data.storage_path as string]);
  await db.from("media_assets").delete().eq("id", data.id);
  return { ok: true };
});
