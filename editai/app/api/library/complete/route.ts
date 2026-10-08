import { z } from "zod";
import { apiRoute, parseBody } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStorage } from "@/services/storage";
import { sanitizeUserText } from "@/utils/text";
import { storagePaths } from "@/utils/storage-paths";

export const POST = apiRoute(async ({ user, request }) => {
  const body = await parseBody(request, z.object({ path: z.string().max(500), fileName: z.string().max(200), mimeType: z.string().max(100) }));
  if (!storagePaths.belongsTo(body.path, user.id) || !body.path.includes("/library/")) throw Errors.validation("Arquivo inválido.");
  const { exists, sizeBytes } = await getStorage().exists(body.path);
  if (!exists) throw Errors.validation("Não encontramos o arquivo enviado.");
  const { data, error } = await createSupabaseAdminClient()
    .from("media_assets")
    .insert({ user_id: user.id, kind: "music", storage_path: body.path, file_name: sanitizeUserText(body.fileName, 200), mime_type: body.mimeType, size_bytes: sizeBytes })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return { asset: data };
});
