"use client";

import { Captions, Laptop, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  browserTranscriptionBlocker,
  MAX_BROWSER_SECONDS,
  MODEL_DOWNLOAD_MB,
  transcribeVideoInBrowser,
  type TranscriptionProgress,
} from "@/lib/transcription/browser-transcriber";
import type { ProjectDetail } from "@/services/projects/project-service";

type Phase =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "running"; progress: TranscriptionProgress | { stage: "saving" } }
  | { kind: "error"; message: string };

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

function humanDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(10, Math.ceil(seconds / 10) * 10)} segundos`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

/**
 * Transcrição grátis no navegador do usuário (Whisper local). Aparece quando o
 * servidor não tem provedor de Speech-to-Text e o vídeo ainda não foi transcrito.
 */
export function BrowserTranscribeCard({
  projectId,
  duration,
  onDone,
}: {
  projectId: string;
  /** Duração do vídeo original (s). */
  duration: number;
  onDone: (words: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // Calculado só no cliente (usa navigator).
  const [blocker, setBlocker] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const running = phase.kind === "running";

  useEffect(() => {
    setBlocker(duration > MAX_BROWSER_SECONDS ? "Vídeos com mais de 15 minutos não podem ser transcritos no navegador." : browserTranscriptionBlocker());
  }, [duration]);

  // Avisa antes de fechar a aba no meio da transcrição; cancela ao sair do editor.
  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [running]);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function start() {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "running", progress: { stage: "downloading-video", loaded: 0, total: null } });
    try {
      // URL assinada recém-gerada (a da página pode ter expirado).
      const detail = await api.get<ProjectDetail>(`/api/projects/${projectId}`);
      if (!detail.originalUrl) throw new Error("Não encontramos o vídeo original deste projeto.");
      const result = await transcribeVideoInBrowser(detail.originalUrl, {
        signal: controller.signal,
        onProgress: (progress) => setPhase({ kind: "running", progress }),
      });
      if (!result.words.length) throw new Error("Não encontramos fala neste vídeo.");
      setPhase({ kind: "running", progress: { stage: "saving" } });
      const saved = await api.post<{ words: number }>(`/api/projects/${projectId}/transcript`, {
        language: result.language,
        provider: result.provider,
        words: result.words,
      });
      setPhase({ kind: "idle" });
      onDone(saved.words);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "error", message: friendlyError(error) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  if (blocker) {
    return (
      <div className="flex gap-3 rounded-2xl border border-border px-4 py-3 text-xs text-muted-foreground">
        <Laptop className="mt-0.5 size-4 shrink-0" />
        <p>
          Este vídeo ainda não foi transcrito, então legendas, destaques animados e zoom por palavra ficam indisponíveis. {blocker}
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
      <div className="flex items-start gap-3">
        <Captions className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Transcreva para liberar legendas e destaques</p>
          <p className="text-xs text-muted-foreground">
            Cortes, velocidade, áudio, formato e cor já funcionam. Legendas (inclusive 3D), destaques animados e zoom por palavra precisam
            saber o que é dito.
          </p>
        </div>
      </div>

      {phase.kind === "idle" && (
        <Button variant="accent" size="sm" className="self-start" onClick={() => setPhase({ kind: "confirm" })}>
          <Captions /> Transcrever no navegador (grátis)
        </Button>
      )}

      {phase.kind === "confirm" && (
        <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          <p>
            A transcrição roda no seu computador, sem custo. Na primeira vez baixa cerca de {MODEL_DOWNLOAD_MB} MB (fica guardado no
            navegador) e leva por volta de {humanDuration(duration * 0.6)} para este vídeo. Mantenha esta aba aberta.
          </p>
          <div className="flex gap-2">
            <Button variant="accent" size="sm" onClick={() => void start()}>
              Começar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPhase({ kind: "idle" })}>
              Agora não
            </Button>
          </div>
        </div>
      )}

      {phase.kind === "running" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {progressLabel(phase.progress)}
            </span>
            {phase.progress.stage !== "saving" && (
              <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>
                <X /> Cancelar
              </Button>
            )}
          </div>
          <Progress value={progressPercent(phase.progress)} />
        </div>
      )}

      {phase.kind === "error" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-destructive">{phase.message}</p>
          <Button variant="outline" size="sm" className="self-start" onClick={() => setPhase({ kind: "confirm" })}>
            Tentar de novo
          </Button>
        </div>
      )}
    </section>
  );
}

function progressLabel(p: TranscriptionProgress | { stage: "saving" }): string {
  switch (p.stage) {
    case "downloading-video":
      return p.total ? `Baixando o vídeo… ${mb(p.loaded)} de ${mb(p.total)} MB` : `Baixando o vídeo… ${mb(p.loaded)} MB`;
    case "decoding":
      return "Extraindo o áudio…";
    case "planning":
      return "Preparando…";
    case "loading-model":
      return p.total ? `Baixando o modelo de IA (só na 1ª vez)… ${mb(p.loaded ?? 0)} de ${mb(p.total)} MB` : "Carregando o modelo de IA…";
    case "transcribing":
      return p.pieces ? `Transcrevendo… parte ${Math.min(p.piece + 1, p.pieces)} de ${p.pieces}` : "Transcrevendo…";
    case "saving":
      return "Salvando a transcrição…";
  }
}

/** Barra única: vídeo 0–10%, áudio 10–15%, modelo 15–40%, fala 40–97%, salvar 97–100%. */
function progressPercent(p: TranscriptionProgress | { stage: "saving" }): number {
  switch (p.stage) {
    case "downloading-video":
      return p.total ? (10 * p.loaded) / p.total : 3;
    case "decoding":
      return 12;
    case "planning":
      return 15;
    case "loading-model":
      return 15 + (25 * (p.percent ?? 0)) / 100;
    case "transcribing":
      return 40 + (57 * p.percent) / 100;
    case "saving":
      return 98;
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return "A conexão falhou ao baixar o vídeo ou o modelo de transcrição. Verifique a internet (ou bloqueadores de anúncio) e tente de novo.";
  }
  if (/memory|out of memory|allocation|RangeError/i.test(message)) {
    return "O navegador ficou sem memória. Feche outras abas e tente de novo, ou use um computador com mais memória.";
  }
  return message.length > 200 ? "A transcrição falhou. Tente de novo." : message;
}
