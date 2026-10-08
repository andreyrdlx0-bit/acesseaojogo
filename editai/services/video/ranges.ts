import type { TimeRange } from "@/types/video";

/** Utilitários puros de intervalos de tempo (segundos). */

export function normalizeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges.filter((r) => r.end > r.start).map((r) => ({ ...r })).sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1e-6) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

export function intersect(ranges: TimeRange[], window: TimeRange): TimeRange[] {
  return ranges
    .map((r) => ({ start: Math.max(r.start, window.start), end: Math.min(r.end, window.end) }))
    .filter((r) => r.end > r.start);
}

export function subtract(ranges: TimeRange[], remove: TimeRange[]): TimeRange[] {
  let result = normalizeRanges(ranges);
  for (const cut of normalizeRanges(remove)) {
    const next: TimeRange[] = [];
    for (const r of result) {
      if (cut.end <= r.start || cut.start >= r.end) next.push(r);
      else {
        if (cut.start > r.start) next.push({ start: r.start, end: cut.start });
        if (cut.end < r.end) next.push({ start: cut.end, end: r.end });
      }
    }
    result = next;
  }
  return result;
}

export function totalDuration(ranges: TimeRange[]): number {
  return ranges.reduce((acc, r) => acc + (r.end - r.start), 0);
}

/** Remove fragmentos muito curtos (geram cortes "piscando"). */
export function dropTiny(ranges: TimeRange[], minSeconds: number): TimeRange[] {
  return ranges.filter((r) => r.end - r.start >= minSeconds);
}

/** Inverso dentro de [0, duration]. */
export function complement(ranges: TimeRange[], duration: number): TimeRange[] {
  return subtract([{ start: 0, end: duration }], ranges);
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
