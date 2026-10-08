import { Input, Label } from "@/components/ui/input";
import { updatePassword } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Nova senha" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Crie uma nova senha</h1>
      <p className="mb-8 mt-2 text-muted-foreground">Use pelo menos 8 caracteres.</p>
      <AuthForm action={updatePassword} submitLabel="Salvar nova senha">
        <div className="grid gap-2">
          <Label htmlFor="password">Nova senha</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Confirme a senha</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
      </AuthForm>
    </>
  );
}
