import type { EditingOperation, EditingPlan } from "./schema";
import type { RejectedOperation } from "./validate";

/** Motivo gravado em `rejected_operations` quando falta a transcrição. */
export const TRANSCRIPT_REQUIRED_REASON = "Precisa da transcrição do vídeo (use “Transcrever no navegador”).";

/** Operações que só funcionam com o tempo de cada palavra da fala. */
export function needsTranscript(op: EditingOperation): boolean {
  return (
    op.type === "subtitles" ||
    op.type === "subtitle_style" ||
    op.type === "keyword_popups" ||
    op.type === "remove_retakes" ||
    (op.type === "zoom" && op.trigger.kind === "keyword")
  );
}

/**
 * Tira do plano o que depende da transcrição quando o vídeo ainda não tem uma.
 * Sem isso o usuário pagaria por legendas que não aparecem, e pedir de novo
 * depois de transcrever daria "essa instrução não muda o vídeo".
 */
export function withoutTranscriptOps(plan: EditingPlan): { plan: EditingPlan; rejected: RejectedOperation[] } {
  const rejected: RejectedOperation[] = [];
  const operations = plan.operations.filter((op, index) => {
    if (!needsTranscript(op)) return true;
    rejected.push({ index, type: op.type, reason: TRANSCRIPT_REQUIRED_REASON });
    return false;
  });
  return { plan: { ...plan, operations }, rejected };
}
