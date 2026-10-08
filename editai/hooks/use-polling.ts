"use client";

import { useEffect, useRef } from "react";

/** Executa `fn` a cada `intervalMs` enquanto `active` for true (pausa com a aba oculta). */
export function usePolling(fn: () => void | Promise<void>, intervalMs: number, active: boolean) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (!document.hidden) await Promise.resolve(saved.current()).catch(() => undefined);
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [intervalMs, active]);
}
