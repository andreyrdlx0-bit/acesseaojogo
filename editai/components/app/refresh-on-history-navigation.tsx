"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// Voltar/avançar do navegador reaproveita o cache do router do Next sem ir ao
// servidor: saldo, extrato e status de projetos apareceriam desatualizados.
let lastHistoryNavigation = 0;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    lastHistoryNavigation = Date.now();
  });
}

/** Em páginas com dados que mudam, busca de novo quando a página volta do histórico. */
export function RefreshOnHistoryNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (Date.now() - lastHistoryNavigation > 2000) return;
    lastHistoryNavigation = 0;
    router.refresh();
  }, [pathname, router]);
  return null;
}
