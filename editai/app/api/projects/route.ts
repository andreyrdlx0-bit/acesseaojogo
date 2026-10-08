import { z } from "zod";
import { apiRoute, parseBody } from "@/lib/api/handler";
import { createProject, listProjects } from "@/services/projects/project-service";

export const GET = apiRoute(async ({ user }) => ({ projects: await listProjects(user.id) }));

export const POST = apiRoute(async ({ user, request }) => {
  const body = await parseBody(request, z.object({ name: z.string().max(120).default("Novo projeto") }));
  return { project: await createProject(user.id, body.name) };
});
