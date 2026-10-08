import { logger } from "./logger";

/**
 * Rate limiting em duas camadas:
 * 1. memória da instância (barato, barra rajadas imediatamente);
 * 2. contador compartilhado no Postgres (RPC hit_rate_limit) para as rotas
 *    caras — necessário na Vercel, onde cada instância tem sua própria memória.
 */
const buckets = new Map<string, number[]>();

export interface RateLimitRule {
  limit: number;
  windowMs: number;
  /** Também conta no banco (vale entre todas as instâncias). */
  shared?: boolean;
}

export const RATE_LIMITS = {
  command: { limit: 12, windowMs: 60_000, shared: true },
  render: { limit: 10, windowMs: 60_000, shared: true },
  upload: { limit: 20, windowMs: 60_000, shared: true },
  jobs: { limit: 30, windowMs: 60_000, shared: true },
  default: { limit: 120, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

function checkMemory(key: string, rule: RateLimitRule): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (hits.length >= rule.limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) buckets.clear(); // proteção de memória
  return true;
}

export async function checkRateLimit(key: string, rule: RateLimitRule): Promise<boolean> {
  if (!checkMemory(key, rule)) return false;
  if (!rule.shared || !process.env.SUPABASE_SERVICE_ROLE_KEY) return true;
  try {
    const { createSupabaseAdminClient } = await import("./supabase/admin");
    const { data, error } = await createSupabaseAdminClient().rpc("hit_rate_limit", {
      p_key: key,
      p_limit: rule.limit,
      p_window_seconds: Math.max(1, Math.round(rule.windowMs / 1000)),
    });
    if (error) throw new Error(error.message);
    return data !== false;
  } catch (error) {
    // Falha do contador compartilhado não derruba a rota: vale o limite em memória.
    logger.warn("failure", "Rate limit compartilhado indisponível", { error });
    return true;
  }
}
