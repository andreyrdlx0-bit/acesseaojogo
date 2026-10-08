/**
 * Logger estruturado (JSON por linha). Em produção, aponte stdout para seu
 * agregador (Datadog, Logtail, Axiom...). Nunca registre secrets nem tokens.
 */
export type LogEvent =
  | "upload"
  | "analysis"
  | "transcription"
  | "interpretation"
  | "plan"
  | "processing"
  | "render"
  | "export"
  | "credits"
  | "billing"
  | "auth"
  | "worker"
  | "failure";

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, event: LogEvent, message: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, event, message, ...sanitize(data) };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level !== "debug" || process.env.LOG_LEVEL === "debug") console.log(line);
}

const SECRET_KEYS = /(key|token|secret|password|authorization)/i;

function sanitize(data?: Record<string, unknown>): Record<string, unknown> {
  if (!data) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SECRET_KEYS.test(k)) out[k] = "[redacted]";
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message, stack: v.stack };
    else out[k] = v;
  }
  return out;
}

export const logger = {
  debug: (event: LogEvent, message: string, data?: Record<string, unknown>) => write("debug", event, message, data),
  info: (event: LogEvent, message: string, data?: Record<string, unknown>) => write("info", event, message, data),
  warn: (event: LogEvent, message: string, data?: Record<string, unknown>) => write("warn", event, message, data),
  error: (event: LogEvent, message: string, data?: Record<string, unknown>) => write("error", event, message, data),
};
