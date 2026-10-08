"use client";

import { Mic, Pause, Play, RotateCcw, Square, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/utils/format";

export interface RecordedAudio {
  blob: Blob;
  duration: number;
  browserTranscript: string;
}

/** Gravação com iniciar, pausar, continuar, cancelar, enviar e regravar. */
export function AudioRecorder({
  onRecorded,
  onSubmit,
  disabled,
  primaryLabel,
}: {
  onRecorded: (audio: RecordedAudio | null) => void;
  onSubmit: () => void;
  disabled?: boolean;
  primaryLabel: string;
}) {
  const rec = useAudioRecorder();

  useEffect(() => {
    if (rec.state === "recorded" && rec.blob) onRecorded({ blob: rec.blob, duration: rec.seconds, browserTranscript: rec.liveTranscript });
    if (rec.state === "idle") onRecorded(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.state, rec.blob, rec.liveTranscript]);

  if (rec.state === "recording" || rec.state === "paused" || rec.state === "requesting") {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-accent/40 bg-accent/5 p-4">
        <div className="flex items-center gap-4">
          <span className="relative grid size-12 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
            {rec.state === "recording" && (
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/50" style={{ animationDuration: "1.6s" }} />
            )}
            <Mic className="relative size-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">{rec.state === "paused" ? "Pausado" : rec.state === "requesting" ? "Permita o microfone..." : "Gravando..."}</p>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {formatDuration(rec.seconds)} / {formatDuration(rec.maxSeconds)}
            </p>
          </div>
          <div className="flex h-8 items-center gap-[3px]" aria-hidden>
            {Array.from({ length: 14 }).map((_, i) => (
              <span
                key={i}
                className="w-[3px] rounded-full bg-accent transition-[height] duration-100"
                style={{ height: `${rec.state === "recording" ? Math.max(10, Math.min(100, rec.level * 260 * (0.5 + ((i * 37) % 10) / 10))) : 10}%` }}
              />
            ))}
          </div>
        </div>
        {rec.liveTranscript && <p className="line-clamp-2 text-sm italic text-muted-foreground">“{rec.liveTranscript}”</p>}
        <div className="flex flex-wrap gap-2">
          {rec.state === "paused" ? (
            <Button size="sm" variant="outline" onClick={rec.resume}>
              <Play /> Continuar
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={rec.pause} disabled={rec.state !== "recording"}>
              <Pause /> Pausar
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={rec.cancel}>
            <X /> Cancelar
          </Button>
          <Button size="sm" variant="accent" className="ml-auto" onClick={rec.stop} disabled={rec.state === "requesting"}>
            <Square className="fill-current" /> Concluir
          </Button>
        </div>
      </div>
    );
  }

  if (rec.state === "recorded" && rec.url) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <audio src={rec.url} controls className="w-full" />
        {rec.liveTranscript && <p className="text-sm italic text-muted-foreground">“{rec.liveTranscript}”</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={rec.cancel} disabled={disabled}>
            <X /> Descartar
          </Button>
          <Button size="sm" variant="outline" onClick={() => void rec.start()} disabled={disabled}>
            <RotateCcw /> Gravar novamente
          </Button>
          <Button size="sm" variant="accent" className="ml-auto" onClick={onSubmit} disabled={disabled}>
            ✨ Enviar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void rec.start()}
        disabled={disabled}
        className={cn(
          "group flex w-full items-center justify-center gap-3 rounded-2xl bg-accent px-6 py-5 text-base font-semibold text-accent-foreground shadow-[0_10px_40px_-12px_var(--color-accent)] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50",
        )}
      >
        <Mic className="size-5 transition-transform group-hover:scale-110" />
        {primaryLabel}
      </button>
      {rec.error && (
        <p role="alert" className="text-sm text-red-400">
          {rec.error}
        </p>
      )}
    </div>
  );
}
