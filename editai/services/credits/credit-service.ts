import { AppError, Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CreditReason } from "@/types/domain";

/**
 * Créditos: toda movimentação passa por funções SQL atômicas
 * (consume_credits / grant_credits). O saldo nunca fica negativo — o banco
 * tem CHECK (balance >= 0) e o débito só ocorre se houver saldo.
 */
export const creditService = {
  async getBalance(userId: string): Promise<number> {
    const { data, error } = await createSupabaseAdminClient().from("credits").select("balance").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.balance ?? 0;
  },

  async consume(userId: string, amount: number, reason: Extract<CreditReason, "render" | "export">, referenceId: string, description: string) {
    const { data, error } = await createSupabaseAdminClient().rpc("consume_credits", {
      p_user_id: userId,
      p_amount: amount,
      p_reason: reason,
      p_reference_id: referenceId,
      p_description: description,
    });
    if (error) {
      if (error.message.includes("INSUFFICIENT_CREDITS")) {
        throw Errors.insufficientCredits(amount, await this.getBalance(userId));
      }
      throw new AppError("INTERNAL", "Não foi possível debitar os créditos.", { cause: error.message });
    }
    logger.info("credits", "Créditos debitados", { userId, amount, reason, referenceId, balance: data });
    return data as number;
  },

  async grant(userId: string, amount: number, reason: Extract<CreditReason, "refund" | "purchase" | "subscription_grant" | "adjustment">, referenceId: string | null, description: string) {
    const { data, error } = await createSupabaseAdminClient().rpc("grant_credits", {
      p_user_id: userId,
      p_amount: amount,
      p_reason: reason,
      p_reference_id: referenceId,
      p_description: description,
    });
    if (error) throw new Error(`Falha ao conceder créditos: ${error.message}`);
    logger.info("credits", "Créditos concedidos", { userId, amount, reason, referenceId, balance: data });
    return data as number;
  },

  /** Reembolso idempotente de um render que falhou. */
  async refundRender(userId: string, amount: number, renderId: string) {
    if (amount <= 0) return;
    await this.grant(userId, amount, "refund", renderId, "Reembolso: renderização não concluída");
  },
};
