import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { serverEnv } from "@/config/env";
import { requireUserOrRedirect } from "@/lib/auth";
import { formatDate } from "@/utils/format";

export const metadata = { title: "Configurações" };

/** Mostra o estado REAL das integrações — nada de fingir que algo está ativo. */
function integrations() {
  const env = serverEnv();
  return [
    {
      name: "Planejador de edição (IA)",
      status: env.AI_PROVIDER !== "rules" && env.AI_API_KEY ? `${env.AI_PROVIDER} · ${env.AI_MODEL ?? "padrão"}` : "Regras locais (sem LLM)",
      ok: env.AI_PROVIDER !== "rules" && Boolean(env.AI_API_KEY),
    },
    {
      name: "Speech-to-Text",
      status: env.STT_PROVIDER === "openai" && env.SPEECH_TO_TEXT_API_KEY ? "OpenAI Whisper" : "Somente transcrição do navegador",
      ok: env.STT_PROVIDER === "openai" && Boolean(env.SPEECH_TO_TEXT_API_KEY),
    },
    { name: "Pagamentos", status: env.PAYMENT_PROVIDER === "stripe" ? "Stripe (integração pendente)" : "Não configurado", ok: false },
  ];
}

export default async function SettingsPage() {
  const user = await requireUserOrRedirect("/settings");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-8 lg:px-8">
      <h1 className="font-display text-4xl">Configurações</h1>
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-semibold">Conta</h2>
        <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">E-mail</dt>
          <dd>{user.email}</dd>
          <dt className="text-muted-foreground">Membro desde</dt>
          <dd>{formatDate(user.created_at)}</dd>
        </dl>
        <div className="mt-6 flex gap-3">
          <Button asChild variant="outline" size="sm">
            <a href="/reset-password">Alterar senha</a>
          </Button>
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit">
              Sair
            </Button>
          </form>
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-semibold">Integrações</h2>
        <ul className="mt-4 divide-y divide-border text-sm">
          {integrations().map((i) => (
            <li key={i.name} className="flex items-center justify-between gap-4 py-3">
              <span>{i.name}</span>
              <span className={i.ok ? "text-emerald-400" : "text-muted-foreground"}>{i.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
