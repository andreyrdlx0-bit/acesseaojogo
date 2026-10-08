import Link from "next/link";
import { Input, Label } from "@/components/ui/input";
import { signIn } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="font-display text-4xl">Bem-vindo de volta</h1>
      <p className="mb-8 mt-2 text-muted-foreground">Entre para continuar editando com a voz.</p>
      <AuthForm action={signIn} submitLabel="Entrar">
        <input type="hidden" name="next" value={next ?? "/dashboard"} />
        <div className="grid gap-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Senha</Label>
            <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
              Esqueceu a senha?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      </AuthForm>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Ainda não tem conta?{" "}
        <Link href="/signup" className="text-foreground underline-offset-4 hover:underline">
          Criar conta grátis
        </Link>
      </p>
    </>
  );
}
