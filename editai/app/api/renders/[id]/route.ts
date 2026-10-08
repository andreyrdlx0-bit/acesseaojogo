import { apiRoute, assertUuid } from "@/lib/api/handler";
import { getRenderForUser } from "@/services/projects/render-service";

export const GET = apiRoute<{ id: string }>(
  async ({ user, params }) => ({ render: await getRenderForUser(user.id, assertUuid(params.id, "Renderização")) }),
  { rateLimit: { limit: 240, windowMs: 60_000 }, rateLimitKey: "render-status" },
);
