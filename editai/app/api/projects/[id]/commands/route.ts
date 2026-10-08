import { z } from "zod";
import { MAX_AUDIO_COMMAND_SECONDS, MAX_INSTRUCTION_CHARS } from "@/config/upload";
import { apiRoute, assertUuid, parseBody } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createEditingCommand } from "@/services/projects/command-service";

const schema = z
  .object({
    text: z.string().max(MAX_INSTRUCTION_CHARS).optional(),
    audioPath: z.string().max(500).optional(),
    audioMimeType: z.string().max(100).optional(),
    audioDuration: z.number().min(0).max(MAX_AUDIO_COMMAND_SECONDS).optional(),
    browserTranscript: z
      .string()
      .max(20_000)
      .transform((t) => t.slice(0, MAX_INSTRUCTION_CHARS))
      .optional(),
    mode: z.enum(["edit", "autopilot"]).default("edit"),
    baseVersionId: z.string().uuid().optional(),
  })
  .refine((b) => Boolean(b.text?.trim() || b.audioPath), { message: "Envie um áudio ou escreva sua instrução." });

/** ÁUDIO/TEXTO → STT → IA → EditingPlan validado (sem renderizar). */
export const POST = apiRoute<{ id: string }>(
  async ({ user, params, request }) => {
    const body = await parseBody(request, schema);
    const command = await createEditingCommand({ userId: user.id, projectId: assertUuid(params.id, "Projeto"), ...body });
    return { command };
  },
  { rateLimit: RATE_LIMITS.command, rateLimitKey: "command" },
);
