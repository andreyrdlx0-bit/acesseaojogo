import { Logo } from "@/components/brand/logo";

/** Exibido quando o Supabase ainda não foi configurado (sem fingir que funciona). */
export function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <Logo />
      <h1 className="font-display text-4xl">Quase lá: configure o Supabase</h1>
      <p className="text-muted-foreground">
        O painel precisa de um projeto Supabase para autenticação, banco e storage. Copie <code>.env.example</code> para{" "}
        <code>.env.local</code>, preencha <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> e{" "}
        <code>SUPABASE_SERVICE_ROLE_KEY</code>, aplique <code>database/migrations/0001_init.sql</code> e reinicie o servidor.
      </p>
      <p className="text-sm text-muted-foreground">O passo a passo completo está no README.</p>
    </main>
  );
}
