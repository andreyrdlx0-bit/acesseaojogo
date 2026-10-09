"use client";

import { Coins } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Saldo no cabeçalho. Atualiza ao vivo pelo evento "editai:balance" (editor/exportação).
 * `renderedAt` muda a cada renderização no servidor: o valor do servidor volta a
 * valer mesmo quando é igual ao anterior (ex.: reembolso devolveu o saldo inicial).
 */
export function CreditBalance({ balance: initial, renderedAt, className }: { balance: number; renderedAt?: number; className?: string }) {
  const [balance, setBalance] = useState(initial);
  useEffect(() => setBalance(initial), [initial, renderedAt]);
  useEffect(() => {
    const onBalance = (e: Event) => setBalance((e as CustomEvent<number>).detail);
    window.addEventListener("editai:balance", onBalance);
    return () => window.removeEventListener("editai:balance", onBalance);
  }, []);
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
