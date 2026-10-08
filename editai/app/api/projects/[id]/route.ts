import { z } from "zod";
import { apiRoute, assertUuid, parseBody } from "@/lib/api/handler";
import { deleteProject, getProjectDetail, renameProject } from "@/services/projects/project-service";

export const GET = apiRoute<{ id: string }>(async ({ user, params }) =>
  getProjectDetail(user.id, assertUuid(params.id, "Projeto")),
);

export const PATCH = apiRoute<{ id: string }>(async ({ user, params, request }) => {
  const { name } = await parseBody(request, z.object({ name: z.string().min(1).max(120) }));
  await renameProject(user.id, assertUuid(params.id, "Projeto"), name);
  return { ok: true };
});

export const DELETE = apiRoute<{ id: string }>(async ({ user, params }) => {
  await deleteProject(user.id, assertUuid(params.id, "Projeto"));
  return { ok: true };
});
