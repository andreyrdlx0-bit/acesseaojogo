import { findOperation } from "@/lib/editing-plan/validate";
import type { OperationProcessor } from "./types";

/**
 * B-roll automático — arquitetura preparada, geração ainda não implementada.
 * TODO: CONNECT_REAL_PROVIDER (banco de vídeos/geração de imagem) e inserir
 * overlays via filtro `overlay` com enable='between(t,a,b)'.
 */
export const BRollProcessor: OperationProcessor = {
  name: "BRollProcessor",
  handles: ["b_roll"],
  apply(ctx) {
    if (findOperation(ctx.plan, "b_roll")) {
      ctx.warnings.push("B-roll automático ainda não está disponível. O restante da edição foi aplicado.");
    }
  },
};
