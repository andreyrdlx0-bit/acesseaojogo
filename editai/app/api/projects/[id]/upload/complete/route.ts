import { z } from "zod";
import { apiRoute, assertUuid, parseBody } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { completeVideoUpload } from "@/services/projects/project-service";

export const POST = apiRoute<{ id: string }>(
  async ({ user, params, request }) => {
    const { path } = await parseBody(request, z.object({ path: z.string().min(1).max(500) }));
    return completeVideoUpload(user.id, assertUuid(params.id, "Projeto"), path);
  },
  { rateLimit: RATE_LIMITS.upload, rateLimitKey: "upload" },
);
