import { z } from "zod";
import { baseMime, MAX_MUSIC_MB, MUSIC_MIME_TYPES } from "@/config/upload";
import { apiRoute, parseBody } from "@/lib/api/handler";
import { AppError, Errors } from "@/lib/errors";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStorage } from "@/services/storage";
import { newId } from "@/services/projects/project-service";
import { storagePaths } from "@/utils/storage-paths";

export const GET = apiRoute(async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("media_assets")
    .select("*")
    .in("kind", ["music", "export", "version_video"])
    .order("created_at", { ascending: false })
    .limit(100);
  const assets = data ?? [];
  const signed = await getStorage().createSignedUrls(assets.map((a) => a.storage_path as string), 3600);
  return { assets: assets.map((a) => ({ ...a, signed_url: signed[a.storage_path as string] ?? null })) };
});

/** URL de upload para uma música da biblioteca do usuário. */
export const POST = apiRoute(
  async ({ user, request }) => {
    const body = await parseBody(request, z.object({ fileName: z.string().max(200), mimeType: z.string().max(100), sizeBytes: z.number().int().positive() }));
    const ext = MUSIC_MIME_TYPES[baseMime(body.mimeType) as keyof typeof MUSIC_MIME_TYPES];
    if (!ext) throw new AppError("UNSUPPORTED_MEDIA", "Envie uma música em MP3, WAV, OGG ou M4A.");
    if (body.sizeBytes > MAX_MUSIC_MB * 1024 * 1024) throw Errors.validation(`A música deve ter até ${MAX_MUSIC_MB} MB.`);
    return getStorage().createSignedUploadUrl(storagePaths.library(user.id, newId(), ext));
  },
  { rateLimit: RATE_LIMITS.upload, rateLimitKey: "upload" },
);
