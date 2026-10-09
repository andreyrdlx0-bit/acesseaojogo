"use client";

import { Coins, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKS, PAID_PLANS, getPlan } from "@/config/plans";
import { BALANCE_EVENT, useLiveBalance } from "@/hooks/use-live-balance";
import { cn } from "@/lib/utils";
import type { CreditTransaction } from "@/types/domain";
import { formatBRL, formatDate } from "@/utils/format";

const REASON: Record<string, string> = {
  signup_bonus: "Bônus de boas-vindas",
  render: "Edição",
  export: "Exportação",
  refund: "Reembolso",
  purchase: "Compra",
  subscription_grant: "Créditos do plano",
  adjustment: "Ajuste",
};

export function BillingView({
  balance,
  planId,
  transactions,
  paymentsEnabled,
}: {
  balance: number;
  planId: string;
  transactions: CreditTransaction[];
  paymentsEnabled: boolean;
}) {
  const liveBalance = useLiveBalance(balance);
  const [history, setHistory] = useState(transactions);
  const [livePlanId, setLivePlanId] = useState(planId);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = getPlan(livePlanId);

  // A página pode vir do cache (voltar no navegador): busca saldo, extrato e
  // plano atuais juntos, para não mostrar saldo novo com extrato velho.
  useEffect(() => {
    let active = true;
    api
      .get<{ balance: number; transactions: CreditTransaction[]; subscription: { plan_id: string } | null }>("/api/credits")
      .then((data) => {
        if (!active) return;
        setHistory(data.transactions.slice(0, 20));
        setLivePlanId(data.subscription?.plan_id ?? "free");
        window.dispatchEvent(new CustomEvent(BALANCE_EVENT, { detail: data.balance }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function checkout(body: { planId: string } | { packId: string }, key: string) {
    setPending(key);
    setMessage(null);
    try {
      const { url } = await api.post<{ url: string }>("/api/billing/checkout", body);
      window.location.href = url;
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Não foi possível iniciar o pagamento.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-8 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-4xl">Planos e créditos</h1>
          <p className="mt-2 text-muted-foreground">
            Plano atual: <span className="text-foreground">{current.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4">
          <Coins className="size-5 text-accent" />
          <div>
            <p className="font-display text-3xl tabular-nums">{liveBalance}</p>
            <p className="text-xs text-muted-foreground">créditos disponíveis</p>
          </div>
        </div>
      </div>

      {!paymentsEnabled && (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 text-sm text-amber-200">
          Pagamentos ainda não estão ativos nesta instalação. Os planos abaixo mostram a estrutura que será cobrada quando o gateway for conectado.
        </p>
      )}
      {message && <p role="alert" className="rounded-2xl bg-muted px-5 py-4 text-sm">{message}</p>}

      <section className="grid gap-5 lg:grid-cols-3">
        {PAID_PLANS.map((plan) => (
          <div key={plan.id} className={cn("flex flex-col rounded-3xl border bg-card p-7", plan.highlight ? "border-accent/50" : "border-border")}>
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <p className="mt-4">
              <span className="font-display text-4xl">{formatBRL(plan.priceBRL)}</span>
              <span className="text-muted-foreground">/mês</span>
            </p>
            <ul className="mt-6 flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
              {plan.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <Button
              className="mt-8"
              variant={plan.highlight ? "accent" : "outline"}
              disabled={plan.id === current.id || pending !== null}
              onClick={() => checkout({ planId: plan.id }, plan.id)}
            >
              {pending === plan.id && <Loader2 className="animate-spin" />}
              {plan.id === current.id ? "Plano atual" : `Assinar ${plan.name}`}
            </Button>
          </div>
        ))}
      </section>

      <section id="creditos">
        <h2 className="text-lg font-semibold">Comprar créditos</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <button
              key={pack.id}
              disabled={pending !== null}
              onClick={() => checkout({ packId: pack.id }, pack.id)}
              className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 text-left transition-colors hover:border-accent/40 disabled:opacity-60"
            >
              <span>
                <span className="block font-display text-2xl">{pack.credits} créditos</span>
                <span className="text-sm text-muted-foreground">{formatBRL(pack.priceBRL)}</span>
              </span>
              {pending === pack.id && <Loader2 className="size-4 animate-spin" />}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Extrato</h2>
        <div className="mt-4 divide-y divide-border rounded-2xl border border-border">
          {history.length === 0 && <p className="px-5 py-6 text-sm text-muted-foreground">Nenhuma movimentação ainda.</p>}
          {history.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <div>
                <p>{t.description || REASON[t.reason]}</p>
                <p className="text-xs text-muted-foreground">{formatDate(t.created_at)}</p>
              </div>
              <span className={cn("font-mono tabular-nums", t.amount > 0 ? "text-emerald-400" : "text-muted-foreground")}>
                {t.amount > 0 ? "+" : ""}
                {t.amount}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Cada renderização consome créditos conforme duração, resolução e recursos. Se uma edição falhar, os créditos voltam automaticamente.
        </p>
      </section>
    </div>
  );
}
