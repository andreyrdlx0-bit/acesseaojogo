"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectVersion } from "@/types/domain";
import { formatDuration } from "@/utils/format";

export function VersionList({
  versions,
  selectedId,
  currentId,
  onSelect,
}: {
  versions: ProjectVersion[];
  selectedId: string | null;
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ol className="flex gap-2 overflow-x-auto pb-1">
      {[...versions].reverse().map((v) => (
        <li key={v.id}>
          <button
            type="button"
            disabled={v.status === "failed"}
            onClick={() => v.status === "ready" && onSelect(v.id)}
            className={cn(
              "flex min-w-40 flex-col items-start gap-1 rounded-2xl border px-4 py-3 text-left transition-colors",
              selectedId === v.id ? "border-accent/60 bg-accent/5" : "border-border hover:bg-muted/50",
              v.status === "failed" && "opacity-50",
            )}
          >
            <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
              Versão {v.version_number}
              {v.status === "pending" && <Loader2 className="size-3.5 animate-spin text-accent" />}
              {currentId === v.id && v.status === "ready" && <span className="text-[10px] uppercase tracking-wider text-accent">atual</span>}
            </span>
            <span className="line-clamp-1 text-xs text-muted-foreground">{v.status === "failed" ? "Falhou" : v.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{formatDuration(v.duration)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
