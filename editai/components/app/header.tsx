import { LogOut } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { CreditBalance } from "./credit-balance";

export function Header({ email, name, balance }: { email: string; name: string | null; balance: number }) {
  const initials = (name || email).slice(0, 1).toUpperCase();
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-5 backdrop-blur lg:px-8">
      <Link href="/dashboard" className="lg:hidden">
        <Logo compact />
      </Link>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-3">
        <CreditBalance balance={balance} />
        <span className="grid size-9 place-items-center rounded-full bg-muted text-sm font-medium" title={email}>
          {initials}
        </span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="icon" aria-label="Sair">
            <LogOut />
          </Button>
        </form>
      </div>
    </header>
  );
}
