import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getPaymentProvider } from "@/services/billing";

/**
 * Webhook do gateway de pagamento.
 * TODO: CONNECT_REAL_PROVIDER — validar assinatura (PAYMENT_WEBHOOK_SECRET),
 * atualizar `subscriptions` e conceder créditos com creditService.grant(...).
 */
export async function POST() {
  const provider = getPaymentProvider();
  if (!provider.isConfigured) {
    logger.warn("billing", "Webhook recebido sem provedor de pagamento configurado");
    return NextResponse.json({ error: "payments_not_configured" }, { status: 501 });
  }
  return NextResponse.json({ error: "not_implemented" }, { status: 501 });
}
