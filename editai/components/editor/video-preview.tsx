"use client";

import { Film } from "lucide-react";
import { cn } from "@/lib/utils";

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
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-black", className)}>
      {src ? (
        <video key={videoKey ?? src} src={src} poster={poster ?? undefined} controls playsInline preload="metadata" className="mx-auto max-h-[62vh] w-full bg-black object-contain" />
      ) : (
        <div className="grid aspect-video place-items-center text-muted-foreground">
          <Film className="size-8" />
        </div>
      )}
      {label && <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs backdrop-blur">{label}</span>}
    </div>
  );
}
