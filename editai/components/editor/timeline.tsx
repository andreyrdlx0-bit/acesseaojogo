"use client";

import { useMemo } from "react";
import { findOperation, findOperations, type EditingPlan } from "@/lib/editing-plan";
import { cn } from "@/lib/utils";
import { buildTimeline } from "@/services/video/timeline";
import type { VideoMetadata } from "@/types/video";
import { normalizeText } from "@/utils/text";

/**
 * Timeline de visualização (não é editor manual): mostra, sobre o vídeo
 * ORIGINAL, o que a IA manteve, cortou, legendou e onde fez zoom.
 * Usa a mesma função de timeline do motor de vídeo. Os silêncios exibidos
 * são os da análise inicial (o render recalcula com os parâmetros do plano).
 */
export function Timeline({ metadata, plan }: { metadata: VideoMetadata; plan: EditingPlan }) {
  const data = useMemo(() => {
    const timeline = buildTimeline(metadata, plan);
    const words = metadata.transcript?.words ?? [];
    const zoomTimes: number[] = [];
    for (const z of findOperations(plan, "zoom")) {
      if (z.trigger.kind === "keyword") {
        const keys = z.trigger.keywords.map(normalizeText);
        for (const w of words) if (keys.some((k) => normalizeText(w.word).startsWith(k))) zoomTimes.push(w.start);
      } else if (z.trigger.kind === "timestamps") zoomTimes.push(...z.trigger.ranges.map((r) => r.start));
      else for (let t = z.trigger.everySeconds / 2; t < metadata.duration; t += z.trigger.everySeconds) zoomTimes.push(t);
    }
    return { timeline, zoomTimes, subtitles: Boolean(findOperation(plan, "subtitles")) };
  }, [metadata, plan]);

  const D = metadata.duration || 1;
  const pct = (t: number) => `${(Math.max(0, Math.min(D, t)) / D) * 100}%`;
  const ticks = Array.from({ length: 6 }, (_, i) => (D / 5) * i);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">Timeline</span>
        <span className="text-muted-foreground">
          {fmt(D)} → <span className="text-foreground">{fmt(data.timeline.outputDuration)}</span>
        </span>
      </div>
      <Track label="Vídeo">
        {data.timeline.segments.map((s, i) => (
          <span key={i} className="absolute inset-y-0 rounded-sm bg-foreground/80" style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }} />
        ))}
      </Track>
      <Track label="Áudio">
        {metadata.hasAudio &&
          metadata.speech.map((s, i) => (
            <span key={i} className="absolute inset-y-1 rounded-sm bg-sky-400/60" style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }} />
          ))}
      </Track>
      <Track label="Legendas">
        {data.subtitles &&
          (metadata.transcript?.segments ?? []).map((s, i) => (
            <span key={i} className="absolute inset-y-1 rounded-sm bg-signal/70" style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }} />
          ))}
        {data.subtitles && !metadata.transcript && <span className="absolute inset-0 flex items-center pl-2 text-[10px] text-muted-foreground">sem transcrição</span>}
      </Track>
      <Track label="Cortes">
        {data.timeline.removed.map((s, i) => (
          <span key={i} className="absolute inset-y-0 rounded-sm bg-red-500/50" style={{ left: pct(s.start), width: `max(2px, calc(${pct(s.end)} - ${pct(s.start)}))` }} />
        ))}
      </Track>
      <Track label="Zoom">
        {data.zoomTimes.map((t, i) => (
          <span key={i} className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full bg-accent" style={{ left: pct(t) }} />
        ))}
      </Track>
      <div className="ml-16 flex justify-between font-mono text-[10px] text-muted-foreground">
        {ticks.map((t) => (
          <span key={t}>{fmt(t)}</span>
        ))}
      </div>
      {data.timeline.speed !== 1 && <p className="ml-16 text-muted-foreground">Velocidade {data.timeline.speed}x aplicada sobre os trechos mantidos.</p>}
    </div>
  );
}

function Track({ label, children, className }: { label: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-13 shrink-0 text-muted-foreground">{label}</span>
      <div className={cn("relative h-5 flex-1 overflow-hidden rounded-md bg-muted", className)}>{children}</div>
    </div>
  );
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
