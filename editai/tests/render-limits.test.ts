import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isPermanentJobError } from "@/services/jobs/errors";
import { rateBudget } from "@/services/video/engine";
import { binaries, FfmpegError, runFfmpeg } from "@/services/video/ffmpeg";

const MAX = 50 * 1024 * 1024;

describe("rateBudget (saída precisa caber no limite do storage)", () => {
  it("cabe em 90% do limite de 30 s a 1800 s", () => {
    for (let d = 30; d <= 1800; d += 30) {
      const { audioKbps, videoKbps, fits } = rateBudget(d, MAX, true);
      expect(fits).toBe(true);
      expect(((audioKbps + videoKbps!) * 1000 * d) / 8).toBeLessThanOrEqual(MAX * 0.9);
    }
  });

  it("reduz o áudio em saídas longas e recusa quando nem o mínimo cabe", () => {
    expect(rateBudget(838, MAX, true).audioKbps).toBe(160);
    expect(rateBudget(839, MAX, true).audioKbps).toBe(96);
    expect(rateBudget(1259, MAX, true).audioKbps).toBe(64);
    expect(rateBudget(2302, MAX, true).fits).toBe(false);
  });

  it("vídeos curtos têm teto alto e sem limite não há teto", () => {
    expect(rateBudget(10, MAX, true).videoKbps).toBe(20_000);
    expect(rateBudget(10, undefined, true).videoKbps).toBeUndefined();
  });
});

describe("ffmpeg interrompido", () => {
  const longRender = ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "600", "-f", "null", "-"];

  it("timeout interno marca timedOut", async () => {
    const error = await runFfmpeg(longRender, { timeoutMs: 500 }).catch((e) => e);
    expect(error).toBeInstanceOf(FfmpegError);
    expect(error.timedOut).toBe(true);
  });

  it("morte por sinal externo (ex.: OOM) não é timeout nem falha definitiva", async () => {
    const pending = runFfmpeg(longRender).catch((e) => e);
    // Mata o ffmpeg filho deste processo, como o kernel faria num OOM.
    await new Promise((r) => setTimeout(r, 400));
    await new Promise<void>((resolve) => {
      const pkill = spawn("pkill", ["-KILL", "-P", String(process.pid), "-f", binaries().ffmpeg]);
      pkill.on("close", () => resolve());
    });
    const error = await pending;
    expect(error).toBeInstanceOf(FfmpegError);
    expect(error.timedOut).toBe(false);
    expect(error.exitCode).toBeNull();
    expect(error.message).toContain("SIGKILL");
    expect(isPermanentJobError(error)).toBe(false);
  });
});
