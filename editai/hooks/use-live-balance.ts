"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";

/** Evento global com o saldo atual (disparado pelo editor e pela exportação). */
export const BALANCE_EVENT = "editai:balance";

/**
 * Saldo de créditos ao vivo. Segue o evento global e, com `fetchOnMount`, busca
 * o valor atual ao montar — voltar/avançar no navegador mostra a página do
 * cache, com o saldo de quando ela foi gerada. `renderedAt` muda a cada
 * renderização no servidor: o valor do servidor volta a valer mesmo quando é
 * igual ao anterior.
 */
export function useLiveBalance(initial: number, opts: { renderedAt?: number; fetchOnMount?: boolean } = {}) {
  const { renderedAt, fetchOnMount = false } = opts;
  const [balance, setBalance] = useState(initial);
  useEffect(() => setBalance(initial), [initial, renderedAt]);
  useEffect(() => {
    const onBalance = (e: Event) => setBalance((e as CustomEvent<number>).detail);
    window.addEventListener(BALANCE_EVENT, onBalance);
    return () => window.removeEventListener(BALANCE_EVENT, onBalance);
  }, []);
  useEffect(() => {
    if (!fetchOnMount) return;
    let active = true;
    api
      .get<{ balance: number }>("/api/credits")
      .then(({ balance: current }) => {
        // O evento atualiza este componente e também o saldo do cabeçalho.
        if (active) window.dispatchEvent(new CustomEvent(BALANCE_EVENT, { detail: current }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [fetchOnMount]);
  return balance;
}
