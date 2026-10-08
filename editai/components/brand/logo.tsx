import { cn } from "@/lib/utils";

/** Marca: onda sonora que vira corte de vídeo. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <span className="relative grid size-8 place-items-center rounded-[10px] bg-accent text-accent-foreground">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden>
          <rect x="3" y="9" width="2.6" height="6" rx="1.3" />
          <rect x="7.4" y="5" width="2.6" height="14" rx="1.3" />
          <rect x="11.8" y="7.5" width="2.6" height="9" rx="1.3" />
          <path d="M17 6.5v11l5-5.5z" />
        </svg>
      </span>
      {!compact && <span className="text-[15px]">EDITAI</span>}
    </span>
  );
}
