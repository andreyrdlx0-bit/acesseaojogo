import { apiRoute, assertUuid, parseBody } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { browserTranscriptSchema, saveBrowserTranscript } from "@/services/projects/transcript-service";

/** Salva a transcrição feita no navegador (Whisper local), validada no servidor. */
export const POST = apiRoute<{ id: string }>(
  async ({ user, params, request }) => {
    const body = await parseBody(request, browserTranscriptSchema);
    return saveBrowserTranscript(user.id, assertUuid(params.id, "Projeto"), body);
  },
  { rateLimit: RATE_LIMITS.upload, rateLimitKey: "transcript" },
);
