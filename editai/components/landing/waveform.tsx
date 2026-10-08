import { cn } from "@/lib/utils";

const BARS = [0.4, 0.7, 1, 0.55, 0.85, 0.35, 0.9, 0.6, 0.75, 0.45, 1, 0.5, 0.8, 0.3, 0.65, 0.95, 0.4, 0.7, 0.55, 0.85];

export function Waveform({ className, active = true }: { className?: string; active?: boolean }) {
  return (
    <div className={cn("flex items-center gap-[3px]", className)} aria-hidden>
      {BARS.map((h, i) => (
        <span
          key={i}
          className={cn("w-[3px] flex-1 rounded-full bg-accent/80", active && "animate-wave")}
          style={{ height: `${h * 100}%`, animationDelay: `${(i % 7) * 0.12}s` }}
        />
      ))}
    </div>
  );
}
