import { RefreshOnHistoryNavigation } from "@/components/app/refresh-on-history-navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPaymentProvider } from "@/services/billing";
import type { CreditTransaction } from "@/types/domain";
import { BillingView } from "./billing-view";

export const metadata = { title: "Planos" };

export default async function BillingPage() {
  await requireUserOrRedirect("/billing");
  const supabase = await createSupabaseServerClient();
  const [{ data: credits }, { data: sub }, { data: tx }] = await Promise.all([
    supabase.from("credits").select("balance").maybeSingle(),
    supabase.from("subscriptions").select("plan_id,status").maybeSingle(),
    supabase.from("credit_transactions").select("*").order("created_at", { ascending: false }).limit(20),
  ]);
  return (
    <>
      <RefreshOnHistoryNavigation />
      <BillingView
        balance={credits?.balance ?? 0}
        planId={sub?.plan_id ?? "free"}
        transactions={(tx ?? []) as CreditTransaction[]}
        paymentsEnabled={getPaymentProvider().isConfigured}
      />
    </>
  );
}
