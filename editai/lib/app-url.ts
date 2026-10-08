import "server-only";
import { headers } from "next/headers";

/**
 * URL pública do app. Ordem: NEXT_PUBLIC_APP_URL (se definida) → host da
 * requisição atual → domínio de produção da Vercel → localhost.
 * Assim o deploy funciona sem saber o domínio de antemão.
 */
export async function getAppUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto === "http" ? "http" : "https"}://${host}`;
    }
  } catch {
    // Fora de uma requisição (ex.: worker): segue para os fallbacks.
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}
