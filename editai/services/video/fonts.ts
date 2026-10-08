import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Fontes usadas pelo libass (legendas e textos sobrepostos).
 * A fonte Inter (OFL) vai junto com o app em assets/fonts, então funciona
 * também em ambientes sem fontes do sistema (Vercel/Lambda).
 */
export function resolveFontsDir(): string | null {
  const candidates = [process.env.FONTS_DIR, path.join(process.cwd(), "assets", "fonts")].filter(Boolean) as string[];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

/** Nome da família para o libass. */
export const SUBTITLE_FONT_FAMILY = process.env.SUBTITLE_FONT_FAMILY || "Inter";

/** Diretório temporário gravável (na Vercel só /tmp é gravável). */
export function defaultTmpRoot(): string {
  if (process.env.WORKER_TMP_DIR) return path.resolve(process.env.WORKER_TMP_DIR);
  return path.join(process.env.TMPDIR || "/tmp", "editai");
}
