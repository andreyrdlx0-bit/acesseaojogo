import { Coins } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function CreditBalance({ balance, className }: { balance: number; className?: string }) {
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
