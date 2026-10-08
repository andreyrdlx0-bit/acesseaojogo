import { Logo } from "@/components/brand/logo";

/** Exibido quando a configuração do servidor está incompleta (sem fingir que funciona). */
export function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <Logo />
      <h1 className="font-display text-4xl">Quase lá: falta configurar o servidor</h1>
      <p className="text-muted-foreground">Estas variáveis de ambiente ainda não foram definidas:</p>
      <ul className="flex flex-col gap-2">
        {missing.map((key) => (
          <li key={key}>
            <code className="rounded-lg bg-muted px-3 py-1.5 text-sm">{key}</code>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Na Vercel: Project → Settings → Environment Variables, depois faça um novo deploy. Localmente: preencha <code>.env.local</code> e
        reinicie. O passo a passo está no README.
      </p>
    </main>
  );
}
