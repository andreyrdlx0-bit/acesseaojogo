import {
  editingOperationSchema,
  OPERATION_TYPES,
  type EditingOperation,
  type EditingPlan,
  type OperationOf,
} from "./schema";

export interface RejectedOperation {
  index: number;
  type: string | null;
  reason: string;
}

export interface PlanValidationResult {
  plan: EditingPlan;
  rejected: RejectedOperation[];
}

/** Operações que podem aparecer várias vezes no plano. Todas as outras são únicas. */
const MULTI_INSTANCE: ReadonlySet<string> = new Set(["cut", "text_overlay", "zoom"]);
const MAX_OPERATIONS = 100;

/**
 * Valida um plano vindo de fonte NÃO confiável (LLM ou frontend).
 * Cada operação é validada isoladamente: as inválidas são descartadas e
 * reportadas, as válidas seguem. Nada aqui executa código.
 */
export function validateEditingPlan(raw: unknown): PlanValidationResult {
  const rejected: RejectedOperation[] = [];
  const rawOps = extractOperations(raw);
  if (rawOps === null) {
    return {
      plan: { version: 1, operations: [] },
      rejected: [{ index: -1, type: null, reason: "O plano não contém uma lista de operações." }],
    };
  }

  const valid: EditingOperation[] = [];
  rawOps.slice(0, MAX_OPERATIONS).forEach((op, index) => {
    const type = typeof op === "object" && op && "type" in op ? String((op as { type: unknown }).type) : null;
    if (!type || !OPERATION_TYPES.includes(type as never)) {
      rejected.push({ index, type, reason: `Operação desconhecida: ${type ?? "sem tipo"}` });
      return;
    }
    const parsed = editingOperationSchema.safeParse(op);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      rejected.push({
        index,
        type,
        reason: `${issue?.path.join(".") || "operação"}: ${issue?.message ?? "inválida"}`,
      });
      return;
    }
    valid.push(parsed.data);
  });
  if (rawOps.length > MAX_OPERATIONS) {
    rejected.push({ index: MAX_OPERATIONS, type: null, reason: "Limite de operações excedido." });
  }

  return { plan: normalizeEditingPlan({ version: 1, operations: valid }), rejected };
}

function extractOperations(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { operations?: unknown }).operations)) {
    return (raw as { operations: unknown[] }).operations;
  }
  return null;
}

/**
 * Normaliza o plano:
 * - mantém só a última instância de operações únicas (a mais recente vence);
 * - funde `subtitle_style` em `subtitles` (criando legendas se necessário);
 * - remove operações desativadas que não têm efeito.
 */
export function normalizeEditingPlan(plan: EditingPlan): EditingPlan {
  const singles = new Map<string, EditingOperation>();
  const multi: EditingOperation[] = [];
  const styleUpdates: OperationOf<"subtitle_style">[] = [];

  for (const op of plan.operations) {
    if (op.type === "subtitle_style") {
      styleUpdates.push(op);
      continue;
    }
    if (MULTI_INSTANCE.has(op.type)) multi.push(op);
    else {
      singles.delete(op.type); // preserva ordem de inserção da última ocorrência
      singles.set(op.type, op);
    }
  }

  if (styleUpdates.length) {
    const current = singles.get("subtitles") as OperationOf<"subtitles"> | undefined;
    let merged: OperationOf<"subtitles"> = current ?? editingSubtitlesDefaults();
    for (const update of styleUpdates) {
      if (!update.enabled) continue;
      const defined = Object.fromEntries(
        Object.entries(update).filter(([k, v]) => v !== undefined && k !== "type" && k !== "enabled"),
      );
      merged = { ...merged, ...defined, enabled: true };
    }
    singles.set("subtitles", merged);
  }

  const operations = [...singles.values(), ...multi].filter(
    (op) => op.enabled || op.type === "subtitles", // "subtitles: false" explicita remoção
  );
  return { version: 1, operations };
}

function editingSubtitlesDefaults(): OperationOf<"subtitles"> {
  return editingOperationSchema.parse({ type: "subtitles" }) as OperationOf<"subtitles">;
}

export function findOperation<T extends EditingOperation["type"]>(
  plan: EditingPlan,
  type: T,
): OperationOf<T> | undefined {
  return plan.operations.find((op): op is OperationOf<T> => op.type === type && op.enabled);
}

export function findOperations<T extends EditingOperation["type"]>(plan: EditingPlan, type: T): OperationOf<T>[] {
  return plan.operations.filter((op): op is OperationOf<T> => op.type === type && op.enabled);
}
