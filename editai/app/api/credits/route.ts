import { apiRoute } from "@/lib/api/handler";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Leitura via cliente do usuário: RLS garante que só vê os próprios dados. */
export const GET = apiRoute(async () => {
  const supabase = await createSupabaseServerClient();
  const [{ data: credits }, { data: transactions }, { data: subscription }] = await Promise.all([
    supabase.from("credits").select("balance").maybeSingle(),
    supabase.from("credit_transactions").select("*").order("created_at", { ascending: false }).limit(30),
    supabase.from("subscriptions").select("*").maybeSingle(),
  ]);
  return { balance: credits?.balance ?? 0, transactions: transactions ?? [], subscription };
});
