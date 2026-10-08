import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Render } from "@/types/domain";

const STEPS = [0, 25, 50, 75, 100];

/** Progresso de um job (QUEUED → PROCESSING → COMPLETED/FAILED). */
export function RenderProgress({ render, className }: { render: Pick<Render, "status" | "progress" | "message" | "error" | "warnings">; className?: string }) {
  const done = render.status === "completed";
  const failed = render.status === "failed";
  const message = done
    ? "Seu vídeo está pronto."
    : failed
      ? (render.error ?? "Não conseguimos processar esse vídeo.")
      : render.status === "queued"
        ? "Na fila..."
        : (render.message ?? "Processando...");
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-live="polite">
      <div className="flex items-center gap-3 text-sm">
        {done ? <CheckCircle2 className="size-4 text-emerald-400" /> : failed ? <XCircle className="size-4 text-red-400" /> : <Loader2 className="size-4 animate-spin text-accent" />}
        <span className={cn(failed && "text-red-300")}>{message}</span>
        {!done && !failed && <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{render.progress}%</span>}
      </div>
      {!failed && <Progress value={render.progress} />}
      {!failed && (
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
          {STEPS.map((s) => (
            <span key={s} className={cn(render.progress >= s && "text-foreground")}>
              {s}%
            </span>
          ))}
        </div>
      )}
      {done && render.warnings?.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-amber-300">
          {render.warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Estado de processamento da IA/análise com mensagem amigável. */
export function AIProcessingStatus({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-start gap-4 rounded-3xl border border-border bg-card p-5">
      <span className="relative mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-accent/15">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
        <Loader2 className="relative size-4 animate-spin text-accent" />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
