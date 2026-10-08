import Link from "next/link";
import { Input, Label } from "@/components/ui/input";
import { SIGNUP_BONUS_CREDITS } from "@/config/credits";
import { signUp } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Criar conta" };

export default function SignupPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Comece a editar falando</h1>
      <p className="mb-8 mt-2 text-muted-foreground">{SIGNUP_BONUS_CREDITS} créditos grátis para o seu primeiro vídeo.</p>
      <AuthForm action={signUp} submitLabel="Criar conta">
        <div className="grid gap-2">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" name="name" autoComplete="name" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </div>
      </AuthForm>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </>
  );
}
