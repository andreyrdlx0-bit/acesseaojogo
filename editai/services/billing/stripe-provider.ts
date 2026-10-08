import { AppError } from "@/lib/errors";
import type { CheckoutSession, PaymentProvider } from "@/types/services";

/**
 * Integração Stripe — arquitetura preparada, cobrança ainda NÃO conectada.
 * TODO: CONNECT_REAL_PROVIDER
 *  1. npm i stripe
 *  2. criar Prices no Stripe para starter/creator/pro e pacotes de créditos;
 *  3. createCheckoutSession => stripe.checkout.sessions.create({ mode: "subscription", metadata: { userId, planId } });
 *  4. webhook (app/api/billing/webhook) => em `checkout.session.completed` e
 *     `invoice.paid`, atualizar `subscriptions` e chamar creditService.grant(..., "subscription_grant").
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  constructor(private readonly apiKey: string | undefined) {}

  get isConfigured() {
    return false; // Só vira true quando a integração acima for implementada.
  }

  async createCheckoutSession(): Promise<CheckoutSession> {
    throw notConfigured();
  }

  async createCreditPackCheckout(): Promise<CheckoutSession> {
    throw notConfigured();
  }
}

export class NoPaymentProvider implements PaymentProvider {
  readonly name = "none";
  readonly isConfigured = false;
  async createCheckoutSession(): Promise<CheckoutSession> {
    throw notConfigured();
  }
  async createCreditPackCheckout(): Promise<CheckoutSession> {
    throw notConfigured();
  }
}

function notConfigured() {
  return new AppError(
    "PROVIDER_NOT_CONFIGURED",
    "Os pagamentos ainda não estão disponíveis. Em breve você poderá assinar um plano por aqui.",
  );
}
