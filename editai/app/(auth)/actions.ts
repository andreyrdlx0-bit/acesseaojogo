"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppUrl } from "@/lib/app-url";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  success?: string;
}

const email = z.string().trim().email("Informe um e-mail válido.");
const password = z.string().min(8, "A senha precisa de pelo menos 8 caracteres.").max(72);

/** Só aceita redirecionamentos internos (evita open redirect). */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z.object({ email, password: z.string().min(1, "Informe sua senha.") }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    logger.warn("auth", "Login falhou", { reason: error.code });
    return { error: "E-mail ou senha incorretos." };
  }
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z
    .object({ name: z.string().trim().min(2, "Como podemos te chamar?").max(80), email, password })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.name },
      emailRedirectTo: `${await getAppUrl()}/auth/callback?next=/dashboard`,
    },
  });
  if (error) {
    logger.warn("auth", "Cadastro falhou", { reason: error.code });
    return { error: error.code === "user_already_exists" ? "Já existe uma conta com esse e-mail." : "Não foi possível criar sua conta." };
  }
  if (!data.session) return { success: "Conta criada! Confirme seu e-mail pelo link que enviamos para começar." };
  redirect("/dashboard");
}

export async function requestPasswordReset(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await getAppUrl()}/auth/callback?next=/reset-password`,
  });
  // Mesma resposta exista ou não a conta (não revela e-mails cadastrados).
  return { success: "Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha." };
}

export async function updatePassword(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((d) => d.password === d.confirm, { message: "As senhas não coincidem." })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "O link expirou. Solicite uma nova redefinição de senha." };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
