import { apiRoute, assertUuid } from "@/lib/api/handler";
import { discardEditingCommand } from "@/services/projects/command-service";

export const POST = apiRoute<{ id: string }>(async ({ user, params }) => {
  await discardEditingCommand(user.id, assertUuid(params.id, "Comando"));
  return { ok: true };
});
