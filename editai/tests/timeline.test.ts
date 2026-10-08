import { describe, expect, it } from "vitest";
import { validateEditingPlan } from "@/lib/editing-plan";
import { buildTimeline, sourceToOutput } from "@/services/video/timeline";
import type { VideoMetadata } from "@/types/video";

const meta = (over: Partial<VideoMetadata> = {}): VideoMetadata => ({
  duration: 20, width: 1920, height: 1080, fps: 30, hasAudio: true, videoCodec: "h264", audioCodec: "aac",
  bitrate: null, sizeBytes: null, rotation: 0, meanVolumeDb: null, maxVolumeDb: null,
  silences: [{ start: 4, end: 6 }, { start: 10, end: 10.3 }], speech: [], suggestedCuts: [], transcript: null, ...over,
});
const plan = (operations: unknown[]) => validateEditingPlan({ operations }).plan;

describe("buildTimeline", () => {
  it("remove silêncios longos mantendo respiro", () => {
    const t = buildTimeline(meta(), plan([{ type: "remove_silence", minSilenceMs: 600, paddingMs: 100 }]));
    expect(t.segments).toEqual([{ start: 0, end: 4.1 }, { start: 5.9, end: 20 }]);
  });

  it("aplica trim, cortes e velocidade", () => {
    const t = buildTimeline(meta(), plan([{ type: "trim", start: 5 }, { type: "cut", ranges: [{ start: 8, end: 9 }] }, { type: "speed", factor: 2 }]));
    expect(t.segments).toEqual([{ start: 5, end: 8 }, { start: 9, end: 20 }]);
    expect(t.outputDuration).toBe(7);
    expect(sourceToOutput(t, 9)).toBe(1.5);
    expect(sourceToOutput(t, 8.5)).toBeNull();
  });

  it("encurta para a duração alvo", () => {
    const t = buildTimeline(meta(), plan([{ type: "shorten", targetSeconds: 6, strategy: "beginning" }]));
    expect(t.outputDuration).toBe(6);
  });

  it("avisa quando remove_retakes não tem transcrição", () => {
    const t = buildTimeline(meta(), plan([{ type: "remove_retakes" }]));
    expect(t.warnings.length).toBe(1);
  });

  it("nunca remove o vídeo inteiro", () => {
    const t = buildTimeline(meta(), plan([{ type: "cut", ranges: [{ start: 0, end: 20 }] }]));
    expect(t.outputDuration).toBe(20);
  });
});
