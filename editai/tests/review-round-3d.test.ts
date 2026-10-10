import { describe, expect, it } from "vitest";
import { estimateRenderCredits } from "@/config/credits";
import { EMPTY_PLAN, editingOperationSchema, validateEditingPlan, withoutTranscriptOps, type EditingPlan, type OperationOf } from "@/lib/editing-plan";
import { cleanPieceWords } from "@/lib/transcription/segmenter";
import { RuleBasedPlanner } from "@/services/ai/planner/rule-based-planner";
import { buildBrowserTranscript } from "@/services/projects/transcript-service";
import type { KeywordHit } from "@/services/video/keywords";
import { buildPopupAss } from "@/services/video/processors/keyword-popup-processor";
import { build3dSubtitleEvents } from "@/services/video/processors/subtitle-3d";
import { subtitleBand } from "@/services/video/processors/subtitle-processor";
import { buildTimeline } from "@/services/video/timeline";
import type { VideoMetadata } from "@/types/video";

const events = (ass: string) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const toSec = (t: string) => {
  const [h, m, s] = t.split(":").map(Number) as [number, number, number];
  return h * 3600 + m * 60 + s;
};
const popups = (over: Record<string, unknown> = {}) =>
  editingOperationSchema.parse({ type: "keyword_popups", ...over }) as OperationOf<"keyword_popups">;
const subs = (over: Record<string, unknown> = {}) => editingOperationSchema.parse({ type: "subtitles", ...over }) as OperationOf<"subtitles">;

describe("destaques: palavra longa em vídeo quadrado", () => {
  const hit = (text: string, start: number): KeywordHit => ({ text, start, end: start + 0.6, score: 9, icon: "money" });

  it("o texto encolhe junto com o cartão (\\fs em todos os eventos) e o cartão fica dentro do quadro", () => {
    const ass = buildPopupAss([hit("EMPREENDEDORISMO", 1), hit("FATURAMENTO", 5)], popups(), 720, 720, { subtitlePosition: "bottom" });
    const ev = events(ass);
    expect(ev).toHaveLength(8);
    for (const e of ev) expect(e).toMatch(/\\fs(\d+)\\pos/);
    const sizes = ev.map((e) => Number(/\\fs(\d+)/.exec(e)![1]));
    expect(Math.max(...sizes)).toBeLessThan(37);
    for (const e of ev.filter((x) => x.startsWith("Dialogue: 20,"))) {
      const x = Number(/\\pos\(([\d.]+),/.exec(e)![1]);
      const w = Math.max(...[...e.matchAll(/ l ([\d.]+) /g)].map((m) => Number(m[1])));
      expect(x - w / 2).toBeGreaterThanOrEqual(0);
      expect(x + w / 2).toBeLessThanOrEqual(720);
    }
  });
});

describe("legenda 3D: blocos nunca se sobrepõem", () => {
  it("palavras com o mesmo início (Whisper) não fazem dois blocos aparecerem juntos", () => {
    const words = [
      { word: "vídeo", start: 1.0, end: 1.3 },
      { word: "para", start: 1.3, end: 1.5 },
      { word: "a", start: 1.64, end: 1.72 },
      { word: "edição", start: 1.64, end: 2.16 },
      { word: "de", start: 2.2, end: 2.3 },
    ];
    const ev = events(["", ...build3dSubtitleEvents(words, { position: "bottom", size: "large", color: "#FFFFFF", highlightColor: "#FACC15", maxWordsPerLine: 3 }, 720, 1280)].join("\n"));
    const faces = ev.filter((e) => e.startsWith("Dialogue: 4,")).map((e) => e.split(",").slice(1, 3).map(toSec) as [number, number]);
    for (let i = 1; i < faces.length; i++) expect(faces[i]![0]).toBeGreaterThanOrEqual(faces[i - 1]![1]);
  });
});

describe("faixa da legenda clássica", () => {
  it("conta as linhas reais (xl, maiúsculas, 6 palavras quebram em mais de 2 linhas)", () => {
    const words = "conteúdo que conecta vende muito mais".split(" ").map((w, i) => ({ word: w, start: i, end: i + 0.5 }));
    const op = subs({ style: "bold", size: "xl", uppercase: true, maxWordsPerLine: 6 });
    const two = subtitleBand(op, 720, 1280);
    const real = subtitleBand(op, 720, 1280, false, words);
    expect(real.bottom).toBe(two.bottom);
    expect(real.top).toBeLessThan(two.top);
  });
});

describe("limpeza da transcrição do navegador", () => {
  it("mantém uma despedida real no meio de um trecho longo", () => {
    const text = "Obrigado por assistir este vídeo deixa seu like comenta o que você achou e compartilha com um amigo";
    const words = text.split(" ").map((w, i) => ({ word: w, start: i * 0.3, end: i * 0.3 + 0.25 }));
    expect(cleanPieceWords(words, 30).words).toHaveLength(words.length);
  });

  it("laço com tempos depois do fim do pedaço pede nova tentativa", () => {
    const words = Array.from({ length: 40 }, (_, i) => ({ word: "isso", start: 15 + i * 0.1, end: 15 + i * 0.1 + 0.05 }));
    const r = cleanPieceWords(words, 9.8);
    expect(r.words).toEqual([]);
    expect(r.loopTrimmed).toBe(true);
  });
});

describe("cortar erros não apaga o artigo “um”", () => {
  it("remove_retakes mantém “um truque”", () => {
    const transcript = buildBrowserTranscript(
      {
        language: "pt",
        provider: "t",
        words: "Hoje eu vou te mostrar um truque simples hum para ganhar um tempo".split(" ").map((w, i) => ({ word: w, start: i * 0.4, end: i * 0.4 + 0.3 })),
      },
      10,
    );
    const metadata = { duration: 10, hasAudio: true, silences: [], speech: [], suggestedCuts: [], transcript } as unknown as VideoMetadata;
    const t = buildTimeline(metadata, validateEditingPlan({ operations: [{ type: "remove_retakes", removeFillers: true }] }).plan);
    // Só o "hum" (9ª palavra, 3,2–3,5 s) sai; os dois "um" ficam.
    expect(t.removed).toEqual([{ start: 3.2, end: 3.5 }]);
  });
});

describe("sem transcrição", () => {
  const plan: EditingPlan = validateEditingPlan({
    operations: [
      { type: "subtitles", style: "3d" },
      { type: "keyword_popups" },
      { type: "zoom", trigger: { kind: "keyword", keywords: ["dinheiro"] } },
      { type: "zoom", trigger: { kind: "emphasis", everySeconds: 6 } },
      { type: "remove_retakes" },
      { type: "remove_silence" },
    ],
  }).plan;

  it("tira do plano o que depende da fala e mantém o resto", () => {
    const r = withoutTranscriptOps(plan);
    expect(r.plan.operations.map((o) => o.type).sort()).toEqual(["remove_silence", "zoom"]);
    expect(r.rejected.map((x) => x.type).sort()).toEqual(["keyword_popups", "remove_retakes", "subtitles", "zoom"]);
  });

  it("não cobra legendas e destaques que não seriam desenhados", () => {
    const base = { sourceDurationSeconds: 30, plan, quality: "720p" as const, kind: "edit" as const };
    expect(estimateRenderCredits({ ...base, hasTranscript: true })).toBe(3);
    expect(estimateRenderCredits({ ...base, hasTranscript: false })).toBe(1);
  });
});

describe("planejador: frases do dia a dia", () => {
  const planner = new RuleBasedPlanner();
  const video = {
    duration: 60, width: 1080, height: 1920, fps: 30, hasAudio: true, silenceCount: 4, silenceSeconds: 6,
    hasTranscript: true, transcriptText: null, musicAssets: [],
  };
  const run = async (instruction: string, currentPlan: EditingPlan = EMPTY_PLAN) =>
    (await planner.createEditingPlan({ instruction, currentPlan, video, mode: "edit", history: [] })).plan.operations;
  const withOp = (op: Record<string, unknown>): EditingPlan => ({ version: 1, operations: [editingOperationSchema.parse(op)] });

  it.each([
    ["remova os destaques animados", withOp({ type: "keyword_popups" }), []],
    ["coloque destaques animados", EMPTY_PLAN, ["keyword_popups"]],
    ["coloque legenda do que eu falo", EMPTY_PLAN, ["subtitles"]],
    ["coloque uma música mais baixa do que a minha fala", EMPTY_PLAN, ["background_music"]],
    ["melhore a voz, sem som de fundo", EMPTY_PLAN, ["audio_enhancement"]],
    ["reduza o ruido e deixe sem som de fundo", EMPTY_PLAN, ["noise_reduction"]],
    ["corte as partes sem som", EMPTY_PLAN, ["remove_silence"]],
    ["coloque zoom nos momentos estratégicos", EMPTY_PLAN, ["zoom"]],
    ["faça cortes estratégicos", EMPTY_PLAN, ["remove_silence", "speed", "zoom"]],
  ] as const)("%s", async (instruction, current, expected) => {
    expect((await run(instruction, current)).map((o) => o.type).sort()).toEqual([...expected].sort());
  });

  it("palavras de posição não viram palavra-chave; “em cima” vira posição", async () => {
    const [all] = await run("coloque pop ups em todo o vídeo");
    expect(all).toMatchObject({ type: "keyword_popups", keywords: [] });
    const [top] = await run("coloque emojis em cima");
    expect(top).toMatchObject({ type: "keyword_popups", keywords: [], position: "top" });
    const [kw] = await run("coloque elementos quando eu falar dinheiro e investimento");
    expect(kw).toMatchObject({ type: "keyword_popups", keywords: ["dinheiro", "investimento"] });
  });

  it("“sem exagero” e “sem ícones” não removem os destaques", async () => {
    expect(await run("coloque emojis sem exagero")).toMatchObject([{ type: "keyword_popups", icons: true }]);
    expect(await run("coloque destaques animados sem ícones")).toMatchObject([{ type: "keyword_popups", icons: false }]);
  });

  it("tirar o 3D mantém as legendas; piloto automático respeita o 3D pedido", async () => {
    const sub3d = withOp({ type: "subtitles", style: "3d" });
    expect(await run("tire o 3d das legendas", sub3d)).toMatchObject([{ type: "subtitles", style: "bold" }]);
    expect(await run("deixe as legendas normais", sub3d)).toMatchObject([{ type: "subtitles", style: "bold" }]);
    const auto = await run("deixe o vídeo mais interessante com legendas 3D");
    expect(auto.find((o) => o.type === "subtitles")).toMatchObject({ style: "3d" });
  });
});
