"use client";

import { Download, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { type MouseEvent, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { kickJobs } from "@/api/job-runner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { estimateRenderCredits } from "@/config/credits";
import { usePolling } from "@/hooks/use-polling";
import type { AspectRatio } from "@/lib/editing-plan";
import { cn } from "@/lib/utils";
import type { ExportQuality, ProjectVersion, Render } from "@/types/domain";
import { formatBytes, formatDuration } from "@/utils/format";
import { RenderProgress } from "./render-progress";

const RATIOS: { value: AspectRatio; label: string; hint: string }[] = [
  { value: "9:16", label: "9:16", hint: "Reels · TikTok · Shorts" },
  { value: "16:9", label: "16:9", hint: "YouTube · horizontal" },
  { value: "1:1", label: "1:1", hint: "Feed quadrado" },
];

type RenderWithUrl = Render & { signed_url?: string | null; download_url?: string | null };

export function ExportModal({
  projectId,
  version,
  sourceDuration,
  hasTranscript,
  maxQuality,
  balance,
  onCreditsChanged,
}: {
  projectId: string;
  version: ProjectVersion | null;
  sourceDuration: number;
  /** Sem transcrição, legendas e destaques não são desenhados nem cobrados. */
  hasTranscript: boolean;
  maxQuality: ExportQuality;
  balance: number;
  /** Chamado quando créditos são cobrados ou devolvidos (atualiza o saldo na tela). */
  onCreditsChanged?: () => void;
}) {
  const lastKick = useRef(0);
  // Quando as URLs do render (assinadas por 1h) foram buscadas.
  const fetchedAt = useRef(0);
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState<AspectRatio>("9:16");
  const [quality, setQuality] = useState<ExportQuality>(maxQuality);
  const [render, setRender] = useState<RenderWithUrl | null>(null);
  const [error, setError] = useState<{ message: string; credits?: boolean } | null>(null);
  const [starting, setStarting] = useState(false);

  const cost = version ? estimateRenderCredits({ sourceDurationSeconds: sourceDuration, plan: version.editing_plan, quality, kind: "export", hasTranscript }) : 0;
  const running = render && (render.status === "queued" || render.status === "processing");

  usePolling(
    async () => {
      if (!render) return;
      const { render: r } = await api.get<{ render: RenderWithUrl }>(`/api/renders/${render.id}`);
      fetchedAt.current = Date.now();
      setRender(r);
      // Pendente (inclusive "processing" de uma tentativa interrompida): continua disparando.
      if ((r.status === "queued" || r.status === "processing") && Date.now() - lastKick.current > (r.status === "queued" ? 5_000 : 15_000)) {
        lastKick.current = Date.now();
        void kickJobs();
      }
      if (r.status === "completed" || r.status === "failed") onCreditsChanged?.();
    },
    1500,
    Boolean(running),
  );

  /** Com o modal aberto há muito tempo, a URL de download já expirou: busca outra antes. */
  async function download(e: MouseEvent<HTMLAnchorElement>) {
    setError(null);
    if (!render || Date.now() - fetchedAt.current < 45 * 60_000) return;
    e.preventDefault();
    try {
      const { render: r } = await api.get<{ render: RenderWithUrl }>(`/api/renders/${render.id}`);
      fetchedAt.current = Date.now();
      setRender(r);
      const url = r.download_url ?? r.signed_url;
      if (url) window.location.assign(url);
    } catch {
      setError({ message: "Não foi possível gerar o link de download. Tente de novo." });
    }
  }

  async function start() {
    if (!version) return;
    setStarting(true);
    setError(null);
    try {
      const { render: r } = await api.post<{ render: Render }>(`/api/projects/${projectId}/exports`, { versionId: version.id, aspectRatio: ratio, quality });
      setRender(r);
      lastKick.current = Date.now();
      void kickJobs();
      onCreditsChanged?.();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError({ message: err?.message ?? "Não foi possível exportar.", credits: err?.code === "INSUFFICIENT_CREDITS" });
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
        if (!o && !running) setRender(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!version || version.status !== "ready"}>
          <Upload /> Exportar vídeo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Exportar vídeo</DialogTitle>
        <DialogDescription>Versão {version?.version_number} · MP4</DialogDescription>

        {!render ? (
          <div className="mt-6 flex flex-col gap-6">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Formato</legend>
              <div className="grid grid-cols-3 gap-2">
                {RATIOS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRatio(r.value)}
                    className={cn("rounded-xl border p-3 text-left", ratio === r.value ? "border-accent bg-accent/5" : "border-border hover:bg-muted/50")}
                  >
                    <span className="block font-medium">{r.label}</span>
                    <span className="text-[11px] text-muted-foreground">{r.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Qualidade</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["720p", "1080p"] as const).map((q) => {
                  const locked = q === "1080p" && maxQuality !== "1080p";
                  return (
                    <button
                      key={q}
                      type="button"
                      disabled={locked}
                      onClick={() => setQuality(q)}
                      className={cn("rounded-xl border p-3 text-left disabled:opacity-50", quality === q ? "border-accent bg-accent/5" : "border-border hover:bg-muted/50")}
                    >
                      <span className="block font-medium">{q}</span>
                      <span className="text-[11px] text-muted-foreground">{locked ? "Plano Creator ou superior" : q === "1080p" ? "Full HD" : "HD"}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
              <span className="text-muted-foreground">
                Custo: <span className="text-foreground">{cost} crédito(s)</span> · saldo {balance}
              </span>
              <Button variant="accent" onClick={start} disabled={starting || cost > balance}>
                {starting && <Loader2 className="animate-spin" />} Exportar vídeo
              </Button>
            </div>
            {(cost > balance || error?.credits) && (
              <div className="flex items-center justify-between rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Você não possui créditos suficientes.
                <Button asChild size="sm" variant="outline">
                  <Link href="/billing">Comprar créditos</Link>
                </Button>
              </div>
            )}
            {error && !error.credits && <p className="text-sm text-red-400">{error.message}</p>}
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-5">
            <RenderProgress render={render} />
            {render.status === "completed" && render.signed_url && (
              <>
                <video src={render.signed_url} controls playsInline className="max-h-80 w-full rounded-xl bg-black" />
                <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                  <Stat label="Duração" value={formatDuration(render.output_duration)} />
                  <Stat label="Resolução" value={`${render.output_width}×${render.output_height}`} />
                  <Stat label="Tamanho" value={formatBytes(render.output_size_bytes)} />
                </dl>
                <Button asChild variant="accent" size="lg">
                  <a href={render.download_url ?? render.signed_url} rel="noopener" onClick={download}>
                    <Download /> Baixar vídeo
                  </a>
                </Button>
                {error && <p className="text-sm text-red-400">{error.message}</p>}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-2 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}
