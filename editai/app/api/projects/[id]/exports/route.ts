import { z } from "zod";
import { aspectRatioValues } from "@/lib/editing-plan";
import { apiRoute, assertUuid, parseBody } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createExport } from "@/services/projects/render-service";

const schema = z.object({
  versionId: z.string().uuid(),
  aspectRatio: z.enum(aspectRatioValues).optional(),
  quality: z.enum(["720p", "1080p"]).default("1080p"),
});

export const POST = apiRoute<{ id: string }>(
  async ({ user, params, request }) => {
    const { versionId, ...options } = await parseBody(request, schema);
    return { render: await createExport(user.id, assertUuid(params.id, "Projeto"), versionId, options) };
  },
  { rateLimit: RATE_LIMITS.render, rateLimitKey: "render" },
);
