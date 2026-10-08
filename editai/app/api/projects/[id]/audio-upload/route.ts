import { z } from "zod";
import { apiRoute, assertUuid, parseBody } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createAudioUploadUrl } from "@/services/projects/command-service";

export const POST = apiRoute<{ id: string }>(
  async ({ user, params, request }) => {
    const body = await parseBody(request, z.object({ mimeType: z.string().max(100), sizeBytes: z.number().int().positive() }));
    return createAudioUploadUrl(user.id, assertUuid(params.id, "Projeto"), body.mimeType, body.sizeBytes);
  },
  { rateLimit: RATE_LIMITS.upload, rateLimitKey: "upload" },
);
