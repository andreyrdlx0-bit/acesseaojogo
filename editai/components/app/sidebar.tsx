"use client";

import { CreditCard, FolderOpen, Home, Library, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Início", icon: Home },
  { href: "/projects/new", label: "Novo projeto", icon: Plus },
  { href: "/projects", label: "Meus projetos", icon: FolderOpen },
  { href: "/library", label: "Biblioteca", icon: Library },
  { href: "/billing", label: "Planos", icon: CreditCard },
  { href: "/settings", label: "Configurações", icon: Settings },
] as const;

function isActive(path: string, href: string) {
  if (href === "/projects") return path === "/projects" || (path.startsWith("/projects/") && path !== "/projects/new");
  return path === href || path.startsWith(`${href}/`);
}

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-card/40 px-3 py-5 lg:flex">
      <Link href="/dashboard" className="px-3">
        <Logo />
      </Link>
      <nav className="mt-10 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              isActive(path, item.href) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <item.icon className={cn("size-4", item.href === "/projects/new" && "text-accent")} />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

/** Navegação inferior no mobile. */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {NAV_ITEMS.filter((i) => i.href !== "/settings").map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn("flex flex-col items-center gap-1 py-2.5 text-[10px]", isActive(path, item.href) ? "text-foreground" : "text-muted-foreground")}
        >
          <item.icon className={cn("size-5", item.href === "/projects/new" && "text-accent")} />
          {item.label.replace("Meus ", "")}
        </Link>
      ))}
    </nav>
  );
}
