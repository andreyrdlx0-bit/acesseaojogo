"use client";

import { Loader2 } from "lucide-react";
import { startTransition, useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { AuthState } from "./actions";

interface Props {
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  submitLabel: string;
  children: React.ReactNode;
}

/** Formulário com estados loading / success / error para as server actions. */
export function AuthForm({ action, submitLabel, children }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      // Envia via transição: o React 19 não limpa os campos quando há erro.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {children}
      {state.error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          {state.success}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="mt-2">
        {pending && <Loader2 className="animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  );
}
