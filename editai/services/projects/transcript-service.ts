import { z } from "zod";
import { AppError, Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { VideoMetadataRow } from "@/types/domain";
import type { Transcript } from "@/types/video";
import { sanitizeUserText } from "@/utils/text";
import { getOwnedProject } from "./project-service";

/**
 * Transcrição feita no NAVEGADOR do usuário (Whisper local, sem chave de API).
 * O servidor não confia no cliente: valida limites, tempos e tamanho antes de
 * salvar, e só substitui uma transcrição que também veio do navegador.
 */
const word = z.object({
  word: z.string().min(1).max(60),
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
});

export const browserTranscriptSchema = z.object({
  language: z.string().max(20).nullable().default("pt"),
  provider: z.string().max(80).default("whisper-browser"),
  words: z.array(word).max(20_000),
});

export type BrowserTranscriptInput = z.infer<typeof browserTranscriptSchema>;

/** Monta e valida o Transcript a partir das palavras (no tempo do vídeo ORIGINAL). */
export function buildBrowserTranscript(input: BrowserTranscriptInput, duration: number): Transcript {
  const limit = duration + 1;
  const words = input.words
    .map((w) => ({ word: sanitizeUserText(w.word, 60).replace(/\s+/g, " "), start: round3(w.start), end: round3(Math.max(w.end, w.start)) }))
    .filter((w) => w.word && w.start <= limit)
    .map((w) => ({ ...w, end: Math.min(w.end, limit) }))
    .sort((a, b) => a.start - b.start);
  // Fala humana raramente passa de ~6 palavras por segundo: acima disso é lixo.
  if (words.length > Math.max(50, duration * 8)) throw Errors.validation("Transcrição maior do que o vídeo permite.");
  if (!words.length) throw Errors.validation("Não encontramos fala nessa transcrição.");

  // Segmentos: quebra em pausas longas ou fim de frase.
  const segments: Transcript["segments"] = [];
  let current: typeof words = [];
  const flush = () => {
    if (!current.length) return;
    segments.push({ start: current[0]!.start, end: current[current.length - 1]!.end, text: current.map((w) => w.word).join(" ") });
    current = [];
  };
  for (const w of words) {
    const prev = current[current.length - 1];
    if (prev && (w.start - prev.end > 1 || /[.!?]$/.test(prev.word) || current.length >= 24)) flush();
    current.push(w);
  }
  flush();

  return {
    text: words.map((w) => w.word).join(" ").slice(0, 100_000),
    language: input.language ?? null,
    words,
    segments,
    source: "browser",
    provider: input.provider,
  };
}

export async function saveBrowserTranscript(userId: string, projectId: string, input: BrowserTranscriptInput) {
  await getOwnedProject(userId, projectId);
  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("video_metadata").select("*").eq("project_id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as VideoMetadataRow | null;
  if (!row?.metadata || row.analysis_status !== "completed") {
    throw Errors.validation("Aguarde a análise do vídeo terminar para transcrever.");
  }
  const existing = row.metadata.transcript;
  if (existing && existing.source !== "browser") {
    throw new AppError("CONFLICT", "Este vídeo já tem uma transcrição do servidor.");
  }
  const transcript = buildBrowserTranscript(input, row.metadata.duration);
  const { error: updateError } = await db
    .from("video_metadata")
    .update({ metadata: { ...row.metadata, transcript } })
    .eq("project_id", projectId);
  if (updateError) throw new Error(updateError.message);
  logger.info("transcription", "Transcrição do navegador salva", { projectId, words: transcript.words.length });
  return { words: transcript.words.length };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
