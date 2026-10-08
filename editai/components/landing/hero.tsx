import { ArrowRight, Mic } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { Waveform } from "./waveform";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="grain pointer-events-none absolute inset-0 opacity-50" />
      <div className="pointer-events-none absolute left-1/2 top-[-240px] size-[720px] -translate-x-1/2 rounded-full bg-accent/15 blur-[140px]" />
      <div className="relative mx-auto max-w-6xl px-5 pb-24 pt-20 sm:pt-28">
        <p className="animate-in inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
          {siteConfig.tagline}
        </p>
        <h1 className="animate-in mt-8 max-w-4xl font-display text-[clamp(3rem,8vw,6.5rem)] leading-[0.95] text-balance">
          Seu editor de vídeo <em className="text-accent">entende</em> você.
        </h1>
        <p className="animate-in mt-8 max-w-xl text-lg text-muted-foreground sm:text-xl">{siteConfig.description}</p>
        <div className="animate-in mt-10 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" variant="accent">
            <Link href="/signup">
              Começar a editar <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#como-funciona">Ver como funciona</a>
          </Button>
        </div>

        <div className="animate-in mt-20 grid gap-4 rounded-3xl border border-border bg-card/70 p-4 backdrop-blur sm:p-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-800 via-zinc-900 to-black">
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center">
                <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">preview</p>
                <p className="mt-3 font-display text-3xl italic sm:text-4xl">
                  “...e foi assim que eu <span className="rounded bg-signal px-1 not-italic text-black">dobrei</span> o faturamento”
                </p>
              </div>
            </div>
            <div className="absolute bottom-3 left-3 right-3 flex gap-1">
              {[18, 9, 22, 6, 14, 11, 20].map((w, i) => (
                <span key={i} className={`h-1.5 rounded-full ${i % 3 === 1 ? "bg-transparent" : "bg-white/40"}`} style={{ flex: w }} />
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-between gap-6 rounded-2xl border border-border bg-background/60 p-5">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Você disse</p>
              <p className="mt-3 text-lg leading-snug">
                “Remove os silêncios, coloca legendas grandes, faz zoom quando eu falar de dinheiro e deixa mais rápido.”
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
                <Mic className="size-5" />
              </span>
              <Waveform className="h-10 flex-1" />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {["Silêncios removidos", "Legendas grandes", "Zoom em “dinheiro”", "Velocidade 1.15x"].map((t) => (
                <span key={t} className="rounded-full border border-border px-3 py-1 text-muted-foreground">
                  ✓ {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
