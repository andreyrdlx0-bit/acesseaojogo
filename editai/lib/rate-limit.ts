/**
 * Rate limiting por janela deslizante, em memória.
 * Suficiente para uma instância; em múltiplas instâncias, troque por
 * Redis/Upstash mantendo a mesma assinatura.
 */
const buckets = new Map<string, number[]>();

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  command: { limit: 12, windowMs: 60_000 },
  render: { limit: 10, windowMs: 60_000 },
  upload: { limit: 20, windowMs: 60_000 },
  default: { limit: 120, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export function checkRateLimit(key: string, rule: RateLimitRule): boolean {
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
