import { spawn } from "node:child_process";

/**
 * Execução segura de FFmpeg/FFprobe: SEMPRE via array de argumentos (sem shell),
 * então nenhum texto do usuário ou do LLM pode virar comando de sistema.
 */
export interface FfmpegBinaries {
  ffmpeg: string;
  ffprobe: string;
}

export function binaries(): FfmpegBinaries {
  return {
    ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
    ffprobe: process.env.FFPROBE_PATH || "ffprobe",
  };
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
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
  return runProcess(binaries().ffmpeg, fullArgs, options);
}

export async function runFfprobe(args: string[]): Promise<string> {
  const { stdout } = await runProcessWithStdout(binaries().ffprobe, ["-v", "error", ...args], { timeoutMs: 60_000 });
  return stdout;
}

function runProcess(bin: string, args: string[], options: RunOptions): Promise<{ stderr: string }> {
  return runProcessWithStdout(bin, args, options).then(({ stderr }) => ({ stderr }));
}

function runProcessWithStdout(
  bin: string,
  args: string[],
  options: RunOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let progressBuffer = "";
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new FfmpegError("Tempo limite de processamento excedido", null, stderr.slice(-2000)));
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
    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(new FfmpegError(`Não foi possível executar ${bin}: ${err.message}`, null, ""));
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new FfmpegError(`${bin} terminou com código ${code}`, code, stderr.slice(-4000)));
    });
  });
}

/** Escapa um valor para uso dentro de uma opção de filtro FFmpeg. */
export function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/,/g, "\\,");
}
