import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";

/**
 * Execução segura de FFmpeg/FFprobe: SEMPRE via array de argumentos (sem shell),
 * então nenhum texto do usuário ou do LLM pode virar comando de sistema.
 */
export interface FfmpegBinaries {
  ffmpeg: string;
  ffprobe: string;
}

/**
 * Resolução dos binários:
 *  1. FFMPEG_PATH / FFPROBE_PATH (ex.: FFmpeg do sistema no Docker do worker);
 *  2. ffmpeg-static (binário empacotado — usado na Vercel, sem ffprobe);
 *  3. "ffmpeg" / "ffprobe" do PATH.
 */
export function binaries(): FfmpegBinaries {
  const bundled = typeof ffmpegStatic === "string" && existsSync(ffmpegStatic) ? ffmpegStatic : null;
  return {
    ffmpeg: process.env.FFMPEG_PATH || bundled || "ffmpeg",
    ffprobe: process.env.FFPROBE_PATH || "ffprobe",
  };
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
    /** O binário não existe neste ambiente (ENOENT). */
    readonly notFound = false,
    /** Interrompido pelo limite de tempo de runProcess (não por OOM/sinal externo). */
    readonly timedOut = false,
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

export interface RunOptions {
  /** Duração esperada da saída — habilita cálculo de progresso. */
  expectedDuration?: number;
  onProgress?: (fraction: number) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function runFfmpeg(args: string[], options: RunOptions = {}): Promise<{ stderr: string }> {
  const fullArgs = ["-hide_banner", "-nostdin", "-y", ...(options.onProgress ? ["-progress", "pipe:1", "-nostats"] : []), ...args];
  return runProcess(binaries().ffmpeg, fullArgs, options).then(({ stderr }) => ({ stderr }));
}

export async function runFfprobe(args: string[]): Promise<string> {
  const { stdout } = await runProcess(binaries().ffprobe, ["-v", "error", ...args], { timeoutMs: 60_000 });
  return stdout;
}

/** Roda o ffmpeg sem saída (só para ler o cabeçalho do arquivo no stderr). */
export async function readFfmpegHeader(file: string): Promise<string> {
  try {
    const { stderr } = await runProcess(binaries().ffmpeg, ["-hide_banner", "-nostdin", "-i", file], { timeoutMs: 60_000 });
    return stderr;
  } catch (error) {
    // Sem arquivo de saída o ffmpeg sai com código 1 — o cabeçalho está no stderr.
    if (error instanceof FfmpegError && !error.notFound) return error.stderrTail;
    throw error;
  }
}

function runProcess(bin: string, args: string[], options: RunOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let progressBuffer = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      fn();
    };
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          finish(() => reject(new FfmpegError("Tempo limite de processamento excedido", null, stderr.slice(-2000), false, true)));
        }, options.timeoutMs)
      : null;
    const abort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", abort);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (!options.onProgress) {
        stdout += text;
        return;
      }
      progressBuffer += text;
      const lines = progressBuffer.split("\n");
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const [key, value] = line.split("=");
        if ((key === "out_time_us" || key === "out_time_ms") && value && options.expectedDuration) {
          const seconds = Number(value) / 1_000_000;
          if (Number.isFinite(seconds)) options.onProgress(Math.min(1, Math.max(0, seconds / options.expectedDuration)));
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(() => reject(new FfmpegError(`Não foi possível executar ${bin}: ${err.message}`, null, "", err.code === "ENOENT" || err.code === "EACCES")));
    });
    child.on("close", (code, signal) => {
      finish(() =>
        code === 0
          ? resolve({ stdout, stderr })
          : reject(
              new FfmpegError(
                code === null && signal ? `${bin} foi interrompido pelo sinal ${signal}` : `${bin} terminou com código ${code}`,
                code,
                stderr.slice(-8000),
              ),
            ),
      );
    });
  });
}

/** Escapa um valor para uso dentro de uma opção de filtro FFmpeg. */
export function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/,/g, "\\,");
}
