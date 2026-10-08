"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Algo deu errado.</h1>
        <p className="mt-2 text-muted-foreground">Tente novamente em instantes. Se persistir, fale com o suporte.</p>
        <Button className="mt-8" onClick={reset}>
          Tentar novamente
        </Button>
      </div>
    </main>
  );
}
