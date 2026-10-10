import type { EditingOperation, EditingPlan } from "./schema";
import { plansEqual, type RejectedOperation } from "./validate";

/** Motivo gravado em `rejected_operations` quando falta a transcrição. */
export const TRANSCRIPT_REQUIRED_REASON = "Precisa da transcrição do vídeo (use “Transcrever no navegador”).";

/** Operações que só funcionam com o tempo de cada palavra da fala (desligadas não contam). */
export function needsTranscript(op: EditingOperation): boolean {
  if (!op.enabled) return false;
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
 * Operações idênticas às da versão de partida (`base`) ficam: já estavam lá,
 * não custam nada sem transcrição e tirá-las faria um pedido sem efeito virar
 * uma "mudança" cobrada.
 */
export function withoutTranscriptOps(plan: EditingPlan, base: EditingPlan = { version: 1, operations: [] }): { plan: EditingPlan; rejected: RejectedOperation[] } {
  const rejected: RejectedOperation[] = [];
  const operations = plan.operations.filter((op, index) => {
    if (!needsTranscript(op)) return true;
    if (base.operations.some((b) => b.type === op.type && plansEqual({ version: 1, operations: [b] }, { version: 1, operations: [op] }))) return true;
    rejected.push({ index, type: op.type, reason: TRANSCRIPT_REQUIRED_REASON });
    return false;
  });
  return { plan: { ...plan, operations }, rejected };
}

/**
 * Aviso de render feito SEM transcrição (as versões antigas e as atuais dizem
 * "...da transcrição do vídeo..."). Não confunde com "Não encontramos fala na
 * transcrição deste vídeo", que sai quando a transcrição existe.
 */
export function isMissingTranscriptWarning(warning: string): boolean {
  return /da transcri[cç][aã]o do v[ií]deo/i.test(warning);
}
