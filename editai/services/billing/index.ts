import { serverEnv } from "@/config/env";
import type { PaymentProvider } from "@/types/services";
import { NoPaymentProvider, StripePaymentProvider } from "./stripe-provider";

export function getPaymentProvider(): PaymentProvider {
  const env = serverEnv();
  return env.PAYMENT_PROVIDER === "stripe" ? new StripePaymentProvider(env.PAYMENT_API_KEY) : new NoPaymentProvider();
}
