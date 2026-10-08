/**
 * Demonstração/smoke test do motor de vídeo SEM Supabase e SEM IA:
 *   npm run engine:demo
 * Gera um vídeo sintético (tom com pausas), aplica um EditingPlan completo e
 * grava o resultado em .worker-tmp/demo/output.mp4.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { validateEditingPlan } from "@/lib/editing-plan";
import { FfmpegVideoAnalyzer } from "@/services/video/analyzer";
import { FfmpegVideoProcessor } from "@/services/video/engine";
import { runFfmpeg } from "@/services/video/ffmpeg";
import type { Transcript } from "@/types/video";

async function main() {
  const dir = path.resolve(".worker-tmp/demo");
  await mkdir(dir, { recursive: true });
  const source = path.join(dir, "source.mp4");

  // 12s de vídeo 1280x720; áudio: tom de 1s, pausa de 1.5s, repetindo.
  await runFfmpeg([
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=12",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
    "-filter_complex", "[1:a]volume='if(lt(mod(t,2.5),1),1,0)':eval=frame[a]",
    "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
  ]);

  const metadata = await new FfmpegVideoAnalyzer().analyze(source);
  console.log("metadata", { ...metadata, silences: metadata.silences.length });

  // Transcrição sintética (em produção vem do provedor de STT).
  const words = ["Hoje", "vou", "falar", "sobre", "dinheiro", "e", "como", "investir", "melhor", "agora"];
  const transcript: Transcript = {
    text: words.join(" "),
    language: "pt",
    source: "stt",
    provider: "demo",
    words: words.map((w, i) => ({ word: w, start: Math.floor(i / 2) * 2.5 + (i % 2) * 0.5, end: Math.floor(i / 2) * 2.5 + (i % 2) * 0.5 + 0.45 })),
    segments: [0, 1, 2, 3, 4].map((i) => ({ start: i * 2.5, end: i * 2.5 + 1, text: `${words[i * 2]} ${words[i * 2 + 1]}` })),
  };

  const { plan, rejected } = validateEditingPlan({
    operations: [
      { type: "remove_silence", minSilenceMs: 500 },
      { type: "subtitles", style: "karaoke", size: "xl", position: "center", uppercase: true },
      { type: "zoom", trigger: { kind: "keyword", keywords: ["dinheiro"] }, scale: 1.2 },
      { type: "speed", factor: 1.1 },
      { type: "aspect_ratio", ratio: "9:16" },
      { type: "audio_enhancement", preset: "voice" },
      { type: "color_adjustment", preset: "vivid" },
      { type: "text_overlay", text: "EDITAI: fale, a IA edita", start: 0, end: 2 },
      { type: "transitions", style: "fade" },
      { type: "b_roll", prompts: ["cidade"] },
      { type: "explode_server" }, // deve ser rejeitada
    ],
  });
  console.log("rejected", rejected);

  const result = await new FfmpegVideoProcessor().process(
    {
      sourcePath: source,
      outputPath: path.join(dir, "output.mp4"),
      plan,
      metadata: { ...metadata, transcript },
      options: { quality: "720p" },
      assets: {},
      workDir: dir,
    },
    (p) => process.stdout.write(`\r${p.percent}% ${p.message}          `),
  );
  console.log("\nresult", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
