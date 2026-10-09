"use client";

import { Coins } from "lucide-react";
import Link from "next/link";
import { useLiveBalance } from "@/hooks/use-live-balance";
import { cn } from "@/lib/utils";

/** Saldo no cabeçalho. Atualiza ao vivo pelo evento "editai:balance" (editor/exportação). */
export function CreditBalance({ balance: initial, renderedAt, className }: { balance: number; renderedAt?: number; className?: string }) {
  const balance = useLiveBalance(initial, { renderedAt });
  return (
    <Link
      href="/billing"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-accent/50",
        balance <= 3 && "border-amber-500/40 text-amber-300",
        className,
      )}
      title="Créditos disponíveis"
    >
      <Coins className="size-4 text-accent" />
      <span className="tabular-nums font-medium">{balance}</span>
      <span className="hidden text-muted-foreground sm:inline">créditos</span>
    </Link>
  );
}

/** Número do saldo que busca o valor atual ao montar (páginas que podem vir do cache). */
export function LiveCredits({ initial }: { initial: number }) {
  return <>{useLiveBalance(initial, { fetchOnMount: true })}</>;
}
