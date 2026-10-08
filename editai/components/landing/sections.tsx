import {
  AudioLines,
  Captions,
  Clock,
  Gauge,
  History,
  Mic,
  Scissors,
  Sparkles,
  Upload,
  Wand2,
  ZoomIn,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PAID_PLANS, PLANS } from "@/config/plans";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/utils/format";

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs uppercase tracking-[0.25em] text-accent">{eyebrow}</p>
      <h2 className="mt-4 font-display text-4xl leading-tight sm:text-5xl text-balance">{title}</h2>
      {children && <p className="mt-4 text-lg text-muted-foreground">{children}</p>}
    </div>
  );
}

const STEPS = [
  { icon: Upload, title: "Upload", text: "Envie seu vídeo em MP4, MOV ou WEBM. Analisamos áudio, pausas e fala." },
  { icon: Mic, title: "Fale", text: "Aperte o microfone e diga o que quer. Ou escreva, se preferir." },
  { icon: Wand2, title: "IA edita", text: "A IA transforma sua fala em um plano de edição e renderiza uma nova versão." },
  { icon: Sparkles, title: "Publique", text: "Ajuste com novos comandos e exporte em 9:16, 16:9 ou 1:1." },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="mx-auto max-w-6xl px-5 py-28">
      <SectionHeading eyebrow="Como funciona" title={<>Do vídeo bruto ao post em <em>quatro</em> passos.</>} />
      <ol className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative bg-background p-8">
            <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
            <s.icon className="mt-6 size-6 text-accent" />
            <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            {i < STEPS.length - 1 && <span className="absolute right-6 top-8 hidden text-muted-foreground lg:block">→</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

const FEATURES = [
  { icon: Scissors, title: "Corta silêncios e erros", text: "Remove pausas, gaguejos e frases recomeçadas automaticamente." },
  { icon: Captions, title: "Legendas dinâmicas", text: "Estilo karaokê, palavras-chave destacadas, tamanho e posição por voz." },
  { icon: ZoomIn, title: "Zoom inteligente", text: "“Faça zoom quando eu falar dinheiro” — e o zoom acontece na palavra." },
  { icon: AudioLines, title: "Voz de estúdio", text: "Redução de ruído, compressão e normalização de volume." },
  { icon: Gauge, title: "Ritmo e duração", text: "Acelere, encurte para 30 segundos ou escolha os melhores momentos." },
  { icon: History, title: "Versões ilimitadas", text: "Cada comando cria uma versão. O original nunca é sobrescrito." },
];

export function Features() {
  return (
    <section id="recursos" className="border-y border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-5 py-28">
        <SectionHeading eyebrow="Recursos" title="Tudo o que um editor faria. Sem a linha do tempo.">
          Você descreve o resultado; o EDITAI cuida dos cortes, legendas, zoom, áudio e formato.
        </SectionHeading>
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-2xl border border-border bg-background p-7 transition-colors hover:border-accent/40">
              <f.icon className="size-5 text-muted-foreground transition-colors group-hover:text-accent" />
              <h3 className="mt-5 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const AUDIENCE = [
  ["Criadores de conteúdo", "Reels, TikTok e Shorts todos os dias sem passar horas editando."],
  ["Especialistas e infoprodutores", "Aulas e cortes de lives prontos para publicar."],
  ["Pequenos negócios", "Vídeos de produto e depoimentos com cara profissional."],
  ["Social media e agências", "Várias versões do mesmo vídeo para cada rede."],
];

export function Audience() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-28">
      <SectionHeading eyebrow="Para quem é" title={<>Para quem tem algo a dizer — e <em>pouco tempo</em> para editar.</>} />
      <div className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2">
        {AUDIENCE.map(([title, text]) => (
          <div key={title} className="border-t border-border pt-6">
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="mt-2 text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Pricing() {
  return (
    <section id="planos" className="border-y border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-5 py-28">
        <SectionHeading eyebrow="Planos" title="Simples, em reais, sem fidelidade.">
          Comece grátis com {PLANS.free.features[0]?.toLowerCase()}.
        </SectionHeading>
        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {PAID_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-3xl border bg-background p-8",
                plan.highlight ? "border-accent/60 shadow-[0_0_80px_-30px_var(--color-accent)]" : "border-border",
              )}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-8 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">Mais escolhido</span>
              )}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-6 flex items-baseline gap-1">
                <span className="font-display text-5xl">{formatBRL(plan.priceBRL)}</span>
                <span className="text-muted-foreground">/mês</span>
              </p>
              <ul className="mt-8 flex flex-1 flex-col gap-3 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2 text-muted-foreground">
                    <span className="text-accent">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-10" variant={plan.highlight ? "accent" : "outline"}>
                <Link href="/signup">Começar com {plan.name}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  ["Preciso saber editar vídeo?", "Não. Você descreve o resultado com suas palavras e a IA monta a edição. Se algo não ficar como queria, é só pedir outra mudança."],
  ["Posso escrever em vez de falar?", "Sim. Todo comando pode ser gravado por voz ou digitado."],
  ["Meu vídeo original é alterado?", "Nunca. Cada comando gera uma nova versão a partir do original, e você pode voltar a qualquer versão anterior."],
  ["Quais formatos posso exportar?", "MP4 em 9:16, 16:9 ou 1:1, em 720p ou 1080p (1080p a partir do plano Creator)."],
  ["Como funcionam os créditos?", "Cada renderização consome créditos de acordo com a duração, a resolução e os recursos usados. Você vê o custo antes de confirmar."],
  ["Meus vídeos ficam privados?", "Sim. Seus arquivos ficam em armazenamento privado, isolados por usuário, e só são acessados por links temporários."],
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-28">
      <SectionHeading eyebrow="FAQ" title="Perguntas frequentes" />
      <div className="mt-12 divide-y divide-border border-y border-border">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group py-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium">
              {q}
              <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-border">
      <div className="pointer-events-none absolute bottom-[-300px] left-1/2 size-[700px] -translate-x-1/2 rounded-full bg-accent/20 blur-[140px]" />
      <div className="relative mx-auto max-w-4xl px-5 py-32 text-center">
        <h2 className="font-display text-5xl leading-[1.02] sm:text-7xl text-balance">
          Pare de editar. <em className="text-accent">Comece a falar.</em>
        </h2>
        <p className="mx-auto mt-6 max-w-lg text-lg text-muted-foreground">Seu primeiro vídeo editado por IA em poucos minutos.</p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" variant="accent">
            <Link href="/signup">
              <Mic /> Editar com IA
            </Link>
          </Button>
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5" /> Sem cartão de crédito para começar
        </p>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 text-sm text-muted-foreground sm:flex-row">
        <p>© {new Date().getFullYear()} EDITAI. Fale. A IA edita.</p>
        <div className="flex gap-6">
          <a href="#planos" className="hover:text-foreground">Planos</a>
          <a href="#faq" className="hover:text-foreground">FAQ</a>
          <Link href="/login" className="hover:text-foreground">Entrar</Link>
        </div>
      </div>
    </footer>
  );
}
