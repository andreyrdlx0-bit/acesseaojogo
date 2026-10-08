import "server-only";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { Errors } from "./errors";
import { createSupabaseServerClient } from "./supabase/server";

/** Usuário autenticado (validado no servidor do Supabase, não só pelo cookie). */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw Errors.unauthorized();
  return user;
}

/** Para páginas: redireciona para o login em vez de lançar erro. */
export async function requireUserOrRedirect(next?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}
