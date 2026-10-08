import { z } from "zod";
import { CREDIT_PACKS, PAID_PLANS } from "@/config/plans";
import { publicEnv } from "@/config/env";
import { apiRoute, parseBody } from "@/lib/api/handler";
import { logger } from "@/lib/logger";
import { getPaymentProvider } from "@/services/billing";

const schema = z.union([
  z.object({ planId: z.enum(PAID_PLANS.map((p) => p.id) as ["starter", "creator", "pro"]) }),
  z.object({ packId: z.enum(CREDIT_PACKS.map((p) => p.id) as [string, ...string[]]) }),
]);

export const POST = apiRoute(async ({ user, request }) => {
  const body = await parseBody(request, schema);
  const provider = getPaymentProvider();
  const urls = { successUrl: `${publicEnv.appUrl}/billing?success=1`, cancelUrl: `${publicEnv.appUrl}/billing` };
  logger.info("billing", "Checkout solicitado", { userId: user.id, ...body, provider: provider.name });
  const session =
    "planId" in body
      ? await provider.createCheckoutSession({ userId: user.id, email: user.email ?? "", planId: body.planId, ...urls })
      : await provider.createCreditPackCheckout({ userId: user.id, email: user.email ?? "", packId: body.packId, ...urls });
  return { url: session.url };
});
