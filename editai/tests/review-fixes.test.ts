import { describe, expect, it } from "vitest";
import { estimateRenderCredits } from "@/config/credits";
import { plansEqual, validateEditingPlan } from "@/lib/editing-plan";
import { safeNextPath } from "@/lib/safe-redirect";
import { parseFfmpegHeader } from "@/services/video/analyzer";

const IPHONE_DV_HEADER = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_0001.MOV':
  Metadata:
    major_brand     : qt
    creation_time   : 2026-09-01T12:00:00.000000Z
    com.apple.quicktime.make: Apple
  Duration: 00:00:12.50, start: 0.000000, bitrate: 9000 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 8500 kb/s, 29.98 fps, 30 tbr, 600 tbn (default)
      Metadata:
        creation_time   : 2026-09-01T12:00:00.000000Z
        handler_name    : Core Media Video
        vendor_id       : [0][0][0][0]
        encoder         : HEVC
      Side data:
        DOVI configuration record: version: 1.0, profile: 8, level: 5, rpu flag: 1, el flag: 0, bl flag: 1, compatibility id: 4
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 96 kb/s (default)
      Metadata:
        title           : "  Duration: 99:00:00.00 fake"
`;

describe("parseFfmpegHeader (Vercel, sem ffprobe)", () => {
  it("lê rotação de iPhone mesmo após metadados e DOVI", () => {
    const r = parseFfmpegHeader(IPHONE_DV_HEADER, 1000);
    const video = r.streams.find((s) => s.codec_type === "video")!;
    expect(video.width).toBe(1920);
    expect(video.side_data_list?.[0]?.rotation).toBe(-90);
    expect(r.streams.some((s) => s.codec_type === "audio")).toBe(true);
  });
  it("usa só a linha Duration de nível superior (metadado não forja duração)", () => {
    expect(Number(parseFfmpegHeader(IPHONE_DV_HEADER, 1000).format.duration)).toBeCloseTo(12.5);
  });
  it("expõe média e taxa real (VFR)", () => {
    const video = parseFfmpegHeader(IPHONE_DV_HEADER, 1000).streams[0]!;
    expect(video.avg_frame_rate).toBe("29980/1000");
    expect(video.r_frame_rate).toBe("30000/1000");
  });
});

describe("safeNextPath", () => {
  it.each(["//evil.com", "/\\evil.com", "/\tevil", "https://evil.com", "/.//evil.com", "/a/..//evil.com", "evil"])("rejeita %s", (v) => {
    expect(safeNextPath(v)).toBe("/dashboard");
  });
  it("aceita caminhos internos", () => {
    expect(safeNextPath("/projects/new?x=1")).toBe("/projects/new?x=1");
  });
});

describe("plansEqual", () => {
  it("ignora a ordem das chaves (jsonb reordena)", () => {
    const a = validateEditingPlan({ operations: [{ type: "speed", factor: 1.2 }] }).plan;
    const b = JSON.parse(JSON.stringify(a), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(plansEqual(a, b)).toBe(true);
    expect(plansEqual(a, validateEditingPlan({ operations: [] }).plan)).toBe(false);
  });
});

describe("estimateRenderCredits", () => {
  it("trim inválido é cobrado como vídeo inteiro (igual ao render)", () => {
    const plan = { version: 1 as const, operations: [{ type: "trim" as const, enabled: true, start: 590 }] };
    expect(estimateRenderCredits({ sourceDurationSeconds: 300, plan, quality: "720p", kind: "edit", hasTranscript: true })).toBe(10);
  });
  it("trim válido reduz o custo", () => {
    const plan = validateEditingPlan({ operations: [{ type: "trim", start: 0, end: 30 }] }).plan;
    expect(estimateRenderCredits({ sourceDurationSeconds: 300, plan, quality: "720p", kind: "edit", hasTranscript: true })).toBe(1);
  });
});
