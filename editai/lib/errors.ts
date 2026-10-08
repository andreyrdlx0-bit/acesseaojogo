/**
 * Erros de domínio com mensagem amigável. A mensagem `userMessage` é a única
 * coisa que chega ao usuário — stack traces ficam só nos logs.
 */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "INSUFFICIENT_CREDITS"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_FAILED"
  | "UNSUPPORTED_MEDIA"
  | "CONFLICT"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  INSUFFICIENT_CREDITS: 402,
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_FAILED: 502,
  UNSUPPORTED_MEDIA: 415,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly userMessage: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(userMessage);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const Errors = {
  unauthorized: () => new AppError("UNAUTHORIZED", "Faça login para continuar."),
  notFound: (what = "Recurso") => new AppError("NOT_FOUND", `${what} não encontrado.`),
  validation: (msg: string, details?: Record<string, unknown>) => new AppError("VALIDATION", msg, details),
  rateLimited: () => new AppError("RATE_LIMITED", "Muitas solicitações. Aguarde alguns segundos e tente novamente."),
  insufficientCredits: (required: number, balance: number) =>
    new AppError("INSUFFICIENT_CREDITS", "Você não possui créditos suficientes.", { required, balance }),
  internal: () => new AppError("INTERNAL", "Algo deu errado do nosso lado. Tente novamente em instantes."),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Mensagem amigável para falhas de processamento de vídeo. */
export const VIDEO_FAILURE_MESSAGE =
  "Não conseguimos processar esse vídeo. Verifique o formato ou tente novamente.";
