import "server-only";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { requireUser } from "../auth";
import { AppError, Errors, isAppError } from "../errors";
import { logger } from "../logger";
import { checkRateLimit, RATE_LIMITS, type RateLimitRule } from "../rate-limit";

type RouteParams = Record<string, string>;

interface HandlerContext<P extends RouteParams> {
  user: User;
  params: P;
  request: NextRequest;
}

interface Options {
  rateLimit?: RateLimitRule;
  rateLimitKey?: string;
}

/**
 * Envelope padrão das rotas de API:
 * - exige usuário autenticado;
 * - aplica rate limit;
 * - converte erros em JSON amigável (sem stack trace) e registra internamente.
 */
export function apiRoute<P extends RouteParams = RouteParams>(
  handler: (ctx: HandlerContext<P>) => Promise<unknown>,
  options: Options = {},
) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    const started = Date.now();
    try {
      const user = await requireUser();
      const rule = options.rateLimit ?? RATE_LIMITS.default;
      const key = `${options.rateLimitKey ?? request.nextUrl.pathname.split("/").slice(0, 3).join("/")}:${user.id}`;
      if (!checkRateLimit(key, rule)) throw Errors.rateLimited();
      const params = (await context.params) ?? ({} as P);
      const result = await handler({ user, params, request });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error, request, started);
    }
  };
}

export function errorResponse(error: unknown, request?: NextRequest, started?: number) {
  const appError = isAppError(error) ? error : Errors.internal();
  const meta = { path: request?.nextUrl.pathname, ms: started ? Date.now() - started : undefined };
  if (!isAppError(error) || appError.status >= 500) logger.error("failure", "Erro na API", { ...meta, error });
  else logger.warn("failure", appError.code, { ...meta, details: appError.details });
  return NextResponse.json(
    { error: { code: appError.code, message: appError.userMessage, details: safeDetails(appError) } },
    { status: appError.status },
  );
}

function safeDetails(error: AppError) {
  // Apenas detalhes pensados para o cliente (ex.: créditos necessários).
  return error.code === "INSUFFICIENT_CREDITS" || error.code === "VALIDATION" ? error.details : undefined;
}

/** Valida o corpo JSON — nunca confiamos no frontend. */
export async function parseBody<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw Errors.validation("Corpo da requisição inválido.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw Errors.validation(issue?.message ?? "Dados inválidos.", { field: issue?.path.join(".") });
  }
  return parsed.data;
}

export const uuidSchema = z.string().uuid();

export function assertUuid(value: string, what = "Recurso"): string {
  if (!uuidSchema.safeParse(value).success) throw Errors.notFound(what);
  return value;
}
