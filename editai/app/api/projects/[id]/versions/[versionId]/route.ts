import { apiRoute, assertUuid } from "@/lib/api/handler";
import { setCurrentVersion } from "@/services/projects/project-service";

/** Define a versão atual (base para os próximos comandos). Não apaga nenhuma versão. */
export const POST = apiRoute<{ id: string; versionId: string }>(async ({ user, params }) => {
  await setCurrentVersion(user.id, assertUuid(params.id, "Projeto"), assertUuid(params.versionId, "Versão"));
  return { ok: true };
});
