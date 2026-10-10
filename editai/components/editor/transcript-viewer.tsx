"use client";

import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { describeOperation, plansEqual, TRANSCRIPT_REQUIRED_REASON, type EditingPlan } from "@/lib/editing-plan";
import type { EditingCommand, Render } from "@/types/domain";

/** "Entendi sua instrução:" + plano + custo + [Confirmar edição]. */
export function TranscriptViewer({
  command,
  balance,
  basePlan,
  onConfirmed,
  onDiscarded,
}: {
  command: EditingCommand;
  balance: number;
  /** Plano da versão de partida: se o novo plano for igual, não há o que renderizar. */
  basePlan: EditingPlan | null;
  onConfirmed: (render: Render) => void;
  onDiscarded: () => void;
}) {
  const [pending, setPending] = useState<"confirm" | "discard" | null>(null);
  const [error, setError] = useState<{ message: string; credits?: boolean } | null>(null);
  const ops = command.editing_plan.operations;
  const unchanged = basePlan ? plansEqual(command.editing_plan, basePlan) : ops.length === 0;
  const insufficient = !unchanged && balance < command.estimated_credits;
  // Itens que ficaram de fora por falta de transcrição já são explicados na resposta.
  const invalid = command.rejected_operations.filter((r) => r.reason !== TRANSCRIPT_REQUIRED_REASON);

  async function confirm() {
    setPending("confirm");
    setError(null);
    try {
      const { render } = await api.post<{ render: Render }>(`/api/commands/${command.id}/confirm`);
      onConfirmed(render);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError({ message: err?.message ?? "Não foi possível iniciar a edição.", credits: err?.code === "INSUFFICIENT_CREDITS" });
    } finally {
      setPending(null);
    }
  }

  async function discard() {
    setPending("discard");
    await api.post(`/api/commands/${command.id}/discard`).catch(() => undefined);
    setPending(null);
    onDiscarded();
  }

  return (
    <section className="animate-in flex flex-col gap-4 rounded-3xl border border-accent/40 bg-card p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Entendi sua instrução:</p>
        <p className="mt-2 text-lg leading-snug">“{command.instruction_text}”</p>
        {command.transcription_source === "browser" && (
          <p className="mt-1 text-xs text-muted-foreground">Transcrito pelo seu navegador.</p>
        )}
      </div>
      <p className="rounded-2xl bg-muted/60 px-4 py-3 text-sm">{command.assistant_reply}</p>

      {ops.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {ops.map((op, i) => (
            <li key={i} className="rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
              {describeOperation(op)}
            </li>
          ))}
        </ul>
      )}
      {invalid.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {invalid.length} sugestão(ões) da IA foram descartadas por não serem válidas.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        {unchanged ? (
          <p className="text-sm text-muted-foreground">Essa instrução não muda o vídeo. Descarte e diga o que você quer alterar.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Custo: <span className="font-medium text-foreground">{command.estimated_credits} crédito(s)</span> · saldo {balance}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={discard} disabled={pending !== null}>
            {pending === "discard" ? <Loader2 className="animate-spin" /> : <X />} Descartar
          </Button>
          <Button variant="accent" onClick={confirm} disabled={pending !== null || unchanged || insufficient}>
            {pending === "confirm" ? <Loader2 className="animate-spin" /> : <Check />} Confirmar edição
          </Button>
        </div>
      </div>
      {(insufficient || error?.credits) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Você não possui créditos suficientes.
          <Button asChild size="sm" variant="outline">
            <Link href="/billing">Comprar créditos</Link>
          </Button>
        </div>
      )}
      {error && !error.credits && <p role="alert" className="text-sm text-red-400">{error.message}</p>}
    </section>
  );
}
