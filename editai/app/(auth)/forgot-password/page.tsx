import Link from "next/link";
import { Input, Label } from "@/components/ui/input";
import { requestPasswordReset } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Recuperar senha" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Recuperar senha</h1>
      <p className="mb-8 mt-2 text-muted-foreground">Enviaremos um link para você criar uma nova senha.</p>
      <AuthForm action={requestPasswordReset} submitLabel="Enviar link">
        <div className="grid gap-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
      </AuthForm>
      <Link href="/login" className="mt-8 text-center text-sm text-muted-foreground hover:text-foreground">
        Voltar para o login
      </Link>
    </>
  );
}
