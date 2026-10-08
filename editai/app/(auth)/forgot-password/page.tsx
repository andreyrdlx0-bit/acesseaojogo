import Link from "next/link";
import { Input, Label } from "@/components/ui/input";
import { requestPasswordReset } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Recuperar senha" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <h1 className="font-display text-4xl">Recuperar senha</h1>
      <p className="mb-8 mt-2 text-muted-foreground">Enviaremos um link para você criar uma nova senha.</p>
      {error === "link_invalido" && (
        <p role="alert" className="mb-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Link inválido ou expirado. Abra o link no mesmo navegador em que fez o pedido ou solicite um novo.
        </p>
      )}
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
