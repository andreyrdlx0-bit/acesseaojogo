/**
 * Normaliza um destino de redirecionamento vindo do usuário (?next=...).
 * Só aceita caminhos do próprio site: rejeita "//host", "/\host", caracteres de
 * controle e qualquer coisa que, após normalizar, aponte para outra origem.
 */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  const next = typeof value === "string" ? value : "";
  // eslint-disable-next-line no-control-regex
  if (!next.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://editai.invalid");
    const path = url.pathname + url.search;
    return url.origin === "http://editai.invalid" && !path.startsWith("//") ? path : fallback;
  } catch {
    return fallback;
  }
}
