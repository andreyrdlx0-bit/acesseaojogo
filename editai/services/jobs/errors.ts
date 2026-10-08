/**
 * Falha que não adianta tentar de novo (vídeo longo demais para o limite da
 * plataforma, saída maior que o storage aceita, arquivo inválido). O executor
 * de jobs marca como falha definitiva na hora, sem repetir o processamento.
 */
export class PermanentJobError extends Error {
  constructor(
    message: string,
    /** Mensagem amigável exibida ao usuário. */
    readonly userMessage: string,
  ) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export function isPermanentJobError(error: unknown): error is PermanentJobError {
  return error instanceof PermanentJobError;
}
