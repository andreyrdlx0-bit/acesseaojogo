import { apiRoute, assertUuid } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { confirmEditingCommand } from "@/services/projects/command-service";

export const POST = apiRoute<{ id: string }>(
  async ({ user, params }) => ({ render: await confirmEditingCommand(user.id, assertUuid(params.id, "Comando")) }),
  { rateLimit: RATE_LIMITS.render, rateLimitKey: "render" },
);
