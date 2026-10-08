import { z } from "zod";

/**
 * Variáveis de ambiente do SERVIDOR/WORKER. Lidas sob demanda para que o build
 * não quebre quando um provedor opcional não estiver configurado.
 * Nunca importe este arquivo em Client Components.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default("editai-media"),

  AI_PROVIDER: z.enum(["anthropic", "openai", "rules"]).default("rules"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),

  STT_PROVIDER: z.enum(["openai", "browser"]).default("browser"),
  SPEECH_TO_TEXT_API_KEY: z.string().optional(),
  STT_MODEL: z.string().default("whisper-1"),
  STT_LANGUAGE: z.string().default("pt"),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  FONT_PATH: z.string().optional(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
  WORKER_TMP_DIR: z.string().default(".worker-tmp"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),

  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(5000).default(500),
  MAX_VIDEO_SECONDS: z.coerce.number().int().min(10).default(900),

  PAYMENT_PROVIDER: z.enum(["stripe", "none"]).default("none"),
  PAYMENT_API_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const empty = (v: string | undefined) => (v === "" ? undefined : v);
  const raw = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, empty(v)]));
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuração inválida do servidor. Verifique: ${missing}. Veja .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Variáveis públicas (seguras para o browser). */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

export const isSupabaseConfigured = () => Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
