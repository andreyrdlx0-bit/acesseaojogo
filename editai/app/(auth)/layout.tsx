import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-dvh lg:grid-cols-2">
      <section className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" aria-label="EDITAI">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</div>
      </section>
      <aside className="relative hidden overflow-hidden border-l border-border bg-card lg:block">
        <div className="grain absolute inset-0 opacity-60" />
        <div className="absolute -right-32 top-1/4 size-[520px] rounded-full bg-accent/20 blur-[120px]" />
        <div className="relative flex h-full flex-col justify-end p-14">
          <p className="font-display text-5xl leading-[1.05] italic">“Remove os silêncios e coloca legendas grandes.”</p>
          <p className="mt-6 max-w-sm text-muted-foreground">Você fala. A IA entende, monta a edição e entrega uma nova versão do seu vídeo.</p>
        </div>
      </aside>
    </main>
  );
}
