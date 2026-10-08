/** Taxa de quadros de trabalho (CFR) usada em toda a renderização. */
export function normalizeFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 30;
  if (fps > 50) return 60;
  return Math.round(fps) || 30;
}
