import { z } from "zod";
import { apiRoute, assertUuid, parseBody } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createVideoUploadUrl } from "@/services/projects/project-service";

const schema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

/** Gera URL assinada: o vídeo vai direto do browser para o storage privado. */
export const POST = apiRoute<{ id: string }>(
  async ({ user, params, request }) => {
    const body = await parseBody(request, schema);
    return createVideoUploadUrl(user.id, assertUuid(params.id, "Projeto"), body);
  },
  { rateLimit: RATE_LIMITS.upload, rateLimitKey: "upload" },
);
