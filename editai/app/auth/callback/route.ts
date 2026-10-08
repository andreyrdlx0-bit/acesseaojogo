import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Troca o código do e-mail (confirmação / recuperação) por uma sessão. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  // Falha na recuperação de senha: volta direto para pedir um novo link.
  const failure = next === "/reset-password" ? "/forgot-password" : "/login";
  return NextResponse.redirect(`${origin}${failure}?error=link_invalido`);
}
