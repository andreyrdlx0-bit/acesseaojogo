"use client";

import { Film } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type PlaybackState = { time: number; playing: boolean };

export function VideoPreview({
  src,
  poster,
  className,
  label,
  videoKey,
}: {
  src: string | null;
  poster?: string | null;
  className?: string;
  label?: string;
  /** Identidade estável do vídeo (ex.: id da versão): o player só reinicia quando ela muda. */
  videoKey?: string;
}) {
  // Renovar a URL assinada (mesmo vídeo, `src` novo) recarrega o <video> e o
  // volta para 0:00 pausado. Guardamos a posição e retomamos de onde estava.
  const last = useRef<PlaybackState>({ time: 0, playing: false });
  const resume = useRef<PlaybackState | null>(null);
  const identity = videoKey ?? src;
  // Outro vídeo (outra versão): começa do zero.
  useEffect(() => {
    last.current = { time: 0, playing: false };
    resume.current = null;
  }, [identity]);

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-black", className)}>
      {src ? (
        <video
          key={identity}
          src={src}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="mx-auto max-h-[62vh] w-full bg-black object-contain"
          onTimeUpdate={(e) => {
            if (!resume.current) last.current.time = e.currentTarget.currentTime;
          }}
          onPlay={() => {
            if (!resume.current) last.current.playing = true;
          }}
          onPause={() => {
            if (!resume.current) last.current.playing = false;
          }}
          // "emptied" = o navegador descartou a mídia atual para carregar o novo src.
          onEmptied={() => {
            if (last.current.time > 0 || last.current.playing) resume.current = { ...last.current };
          }}
          onLoadedMetadata={(e) => {
            const state = resume.current;
            resume.current = null;
            if (!state) return;
            const video = e.currentTarget;
            if (state.time > 0 && state.time < video.duration) video.currentTime = state.time;
            if (state.playing) void video.play().catch(() => undefined);
          }}
        />
      ) : (
        <div className="grid aspect-video place-items-center text-muted-foreground">
          <Film className="size-8" />
        </div>
      )}
      {label && <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs backdrop-blur">{label}</span>}
    </div>
  );
}
