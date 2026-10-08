import type { EditingPlan } from "@/lib/editing-plan";
import { findOperation } from "@/lib/editing-plan/validate";
import type { ExportQuality, RenderKind } from "@/types/domain";

export const SIGNUP_BONUS_CREDITS = 30;

/**
 * Custo de uma renderização em créditos. Determinístico e calculado SEMPRE
 * no servidor (nunca confiamos em valor vindo do frontend).
 *
 * - 1 crédito a cada 30s de vídeo de entrada (limite superior da saída);
 * - 1080p custa 1.5x;
 * - legendas e música adicionam 1 crédito cada (custo de transcrição/mixagem);
 * - exportação de uma versão já editada custa metade (mínimo 1).
 */
export function estimateRenderCredits(input: {
  sourceDurationSeconds: number;
  plan: EditingPlan;
  quality: ExportQuality;
  kind: RenderKind;
}): number {
  const shorten = findOperation(input.plan, "shorten");
  const trim = findOperation(input.plan, "trim");
  let effective = input.sourceDurationSeconds;
  if (trim) {
    // Mesma regra do buildTimeline: trim inválido é ignorado (vídeo inteiro).
    const end = Math.min(trim.end ?? effective, effective);
    if (trim.start < end) effective = end - trim.start;
  }
  if (shorten) effective = Math.min(effective, shorten.targetSeconds);

  let credits = Math.max(1, Math.ceil(effective / 30));
  if (input.quality === "1080p") credits = Math.ceil(credits * 1.5);
  if (findOperation(input.plan, "subtitles")) credits += 1;
  if (findOperation(input.plan, "background_music")) credits += 1;
  if (input.kind === "export") credits = Math.max(1, Math.ceil(credits / 2));
  return credits;
}
