import { NextResponse } from "next/server";
import { isSupabaseConfigured, serverEnv } from "@/config/env";

/** Estado REAL das integrações (sem expor secrets). */
export async function GET() {
  let env: ReturnType<typeof serverEnv> | null = null;
  try {
    env = serverEnv();
  } catch {
    env = null;
  }
  return NextResponse.json({
    supabase: isSupabaseConfigured() && Boolean(env),
    planner: env ? (env.AI_PROVIDER !== "rules" && env.AI_API_KEY ? env.AI_PROVIDER : "rules") : "unconfigured",
    speechToText: env?.STT_PROVIDER === "openai" && env.SPEECH_TO_TEXT_API_KEY ? "openai" : "browser-only",
    payments: env?.PAYMENT_PROVIDER === "stripe" ? "stripe (TODO: CONNECT_REAL_PROVIDER)" : "none",
  });
}
