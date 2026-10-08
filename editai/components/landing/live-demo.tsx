"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMPTY_PLAN, describeOperation, type EditingPlan } from "@/lib/editing-plan";
import { RuleBasedPlanner } from "@/services/ai/planner/rule-based-planner";

const EXAMPLES = [
  "Remova os silêncios, coloque legendas grandes e faça zoom quando eu falar dinheiro",
  "Deixe mais dinâmico e transforme em Reels",
  "Melhore minha voz e remova o ruído",
  "Faça uma versão de 30 segundos",
];

const planner = new RuleBasedPlanner();

/**
 * Demonstração REAL: roda no navegador o mesmo planejador por regras usado
 * no servidor e mostra o EditingPlan (JSON validado) que seria renderizado.
 */
export function LiveDemo() {
  const [instruction, setInstruction] = useState(EXAMPLES[0]!);
  const [reply, setReply] = useState<string | null>(null);
  const [plan, setPlan] = useState<EditingPlan>(EMPTY_PLAN);
  const [pending, start] = useTransition();

  const run = (text: string) =>
    start(async () => {
      const result = await planner.createEditingPlan({
        instruction: text,
        currentPlan: EMPTY_PLAN,
        mode: "edit",
        history: [],
        video: { duration: 60, width: 1080, height: 1920, fps: 30, hasAudio: true, silenceCount: 8, silenceSeconds: 12, hasTranscript: true, transcriptText: null, musicAssets: [] },
      });
      setReply(result.reply);
      setPlan(result.plan);
    });

  return (
    <section id="demo" className="mx-auto max-w-6xl px-5 py-28">
      <p className="text-xs uppercase tracking-[0.25em] text-accent">Demonstração</p>
      <h2 className="mt-4 max-w-2xl font-display text-4xl leading-tight sm:text-5xl">Veja sua frase virar uma edição.</h2>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
        Digite um comando. A IA nunca executa nada direto: ela gera um plano em JSON, validado antes de chegar ao motor de vídeo.
      </p>
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-border bg-card p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(instruction);
            }}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} aria-label="Instrução de edição" />
            <Button type="submit" variant="accent" disabled={pending || !instruction.trim()}>
              <Sparkles /> Interpretar
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setInstruction(ex);
                  run(ex);
                }}
                className="rounded-full border border-border px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
          <div className="mt-8 min-h-28">
            {reply ? (
              <>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">EDITAI</p>
                <p className="mt-2 text-lg">{reply}</p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {plan.operations.map((op, i) => (
                    <li key={i} className="rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
                      {describeOperation(op)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">Clique em “Interpretar” para ver a resposta.</p>
            )}
          </div>
        </div>
        <pre className="max-h-[440px] overflow-auto rounded-3xl border border-border bg-black/60 p-6 font-mono text-xs leading-relaxed text-emerald-300/90">
          {JSON.stringify({ operations: plan.operations }, null, 2)}
        </pre>
      </div>
    </section>
  );
}
