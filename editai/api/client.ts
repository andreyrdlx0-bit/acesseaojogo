"use client";

/**
 * Cliente tipado das rotas /api. Converte erros em ApiError com a mensagem
 * amigável vinda do servidor (nunca stack trace).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Sem conexão. Verifique sua internet e tente novamente.", "NETWORK", 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string; details?: Record<string, unknown> } }).error;
    throw new ApiError(err?.message ?? "Algo deu errado. Tente novamente.", err?.code ?? "INTERNAL", res.status, err?.details);
  }
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  delete: <T>(url: string) => request<T>("DELETE", url),
};

/** Envia um arquivo direto para o storage usando a URL assinada (com progresso). */
export function uploadToSignedUrl(signedUrl: string, file: Blob, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError("Falha no envio do arquivo.", "UPLOAD", xhr.status)));
    xhr.onerror = () => reject(new ApiError("Falha no envio do arquivo. Verifique sua conexão.", "UPLOAD", 0));
    xhr.send(file);
  });
}
