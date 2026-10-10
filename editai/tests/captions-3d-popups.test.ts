import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_PLAN, editingOperationSchema, validateEditingPlan, type OperationOf } from "@/lib/editing-plan";
import { cleanPieceWords, planPieces, SAMPLE_RATE } from "@/lib/transcription/segmenter";
import { RuleBasedPlanner } from "@/services/ai/planner/rule-based-planner";
import { buildBrowserTranscript } from "@/services/projects/transcript-service";
import { matchRequestedKeywords, selectKeywords } from "@/services/video/keywords";
import { buildPopupAss, KeywordPopupProcessor } from "@/services/video/processors/keyword-popup-processor";
import { layoutChunk, subtitle3dBand } from "@/services/video/processors/subtitle-3d";
import { buildAss, subtitleBand } from "@/services/video/processors/subtitle-processor";
import type { ProcessorContext } from "@/services/video/processors/types";
import type { TranscriptWord, VideoMetadata } from "@/types/video";

/** Transcrição falsa com tempos por palavra: "|" = pausa de 0,5 s, "*x*" = ênfase. */
function fake(script: string, t0 = 0.4): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let t = t0;
  for (const raw of script.split(/\s+/)) {
    if (!raw) continue;
    if (raw === "|") {
      t += 0.5;
      continue;
    }
    const word = raw.replace(/\*/g, "");
    let dur = 0.1 + 0.052 * word.replace(/[^\p{L}\p{N}]/gu, "").length;
    if (raw.includes("*")) dur *= 1.6;
    words.push({ word, start: +t.toFixed(3), end: +(t + dur).toFixed(3) });
    t += dur + 0.06;
    if (/[,:]$/.test(word)) t += 0.15;
    if (/[.!?]$/.test(word)) t += 0.3;
  }
  return words;
}

const SCRIPT =
  "Hoje eu vou te mostrar a *estratégia* que fez a minha loja vender 30% mais em apenas 3 semanas. | " +
  "O *segredo* não é postar todo dia. | É entender o que o seu cliente quer ouvir. | " +
  "Muita gente comete esse *erro*: | fala de produto, fala de preço, mas esquece da história. | " +
  "Quando eu mudei a estratégia, | o faturamento *dobrou* e o custo por cliente caiu pela metade. | " +
  "Então anota essa dica: | conteúdo que conecta vende muito mais rápido.";

const subs = (over: Record<string, unknown> = {}) => editingOperationSchema.parse({ type: "subtitles", ...over }) as OperationOf<"subtitles">;
const popups = (over: Record<string, unknown> = {}) =>
  editingOperationSchema.parse({ type: "keyword_popups", ...over }) as OperationOf<"keyword_popups">;
const events = (ass: string) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));

describe("selectKeywords", () => {
  it("escolhe as palavras de impacto na ordem da fala, sem repetir e com intervalo", () => {
    const hits = selectKeywords(fake(SCRIPT), { maxPerMinute: 10 });
    expect(hits.map((h) => h.text)).toEqual(["ESTRATÉGIA", "30%", "SEGREDO", "ERRO", "HISTÓRIA", "FATURAMENTO", "CONTEÚDO"]);
    expect(hits.map((h) => h.icon)).toEqual(["bulb", "up", "bulb", "alert", "bulb", "money", "bulb"]);
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.start - hits[i - 1]!.start).toBeGreaterThanOrEqual(3);
  });

  it("respeita o limite por minuto", () => {
    const words = fake(SCRIPT);
    const duration = words.at(-1)!.end - words[0]!.start;
    expect(selectKeywords(words, { maxPerMinute: 6 })).toHaveLength(Math.ceil((duration / 60) * 6));
  });

  it("junta valores e percentuais e ignora números soltos", () => {
    expect(selectKeywords(fake("eu ganhei R$ 10 mil | em vendas."))[0]).toMatchObject({ text: "R$ 10 MIL", icon: "money" });
    expect(selectKeywords(fake("cresceu 30 por cento | esse ano."))[0]?.text).toBe("30%");
    expect(selectKeywords(fake("tem 1 coisa | e 2 coisas")).some((h) => /^\d$/.test(h.text))).toBe(false);
    expect(selectKeywords(fake("então tipo assim né | e aí a gente vai lá"))).toEqual([]);
  });

  it("palavras pedidas: aceita variações e expressões", () => {
    const words = fake("o dinheiro sumiu | | e as vendas | caíram. | Marketing digital é tudo");
    expect(matchRequestedKeywords(words, ["dinheiro", "venda"]).map((h) => h.text)).toEqual(["DINHEIRO", "VENDAS"]);
    expect(matchRequestedKeywords(words, ["marketing digital"]).map((h) => h.text)).toEqual(["MARKETING DIGITAL"]);
    expect(matchRequestedKeywords(words, ["xadrez"])).toEqual([]);
  });
});

describe("legenda 3D", () => {
  const words = fake(SCRIPT);

  it("gera sombra, extrusão e face por bloco, com kerning e sem quebra automática", () => {
    const ass = buildAss(words, subs({ style: "3d" }), 720, 1280);
    expect(ass).toContain("Kerning: yes");
    expect(ass).toMatch(/^Style: Sub3D,Inter,83,/m);
    const ev = events(ass);
    // 3 palavras por bloco no máximo; 5 eventos (sombra + 3 camadas + face) por bloco.
    expect(ev.length % 5).toBe(0);
    expect(ev.every((e) => e.includes("\\q2") && e.includes("\\frx12"))).toBe(true);
    expect(ev.some((e) => e.includes("\\blur"))).toBe(true);
    expect(ev.some((e) => e.includes("\\fscx112"))).toBe(true);
    // Maiúsculas, palavra ativa em amarelo na face.
    expect(ass).toContain("ESTRATÉGIA");
    expect(ass).toContain("\\1c&H15CCFA&");
  });

  it("modo econômico: sem \\blur e sem crescer a palavra ativa", () => {
    const ev = events(buildAss(words, subs({ style: "3d" }), 1080, 1920, true));
    expect(ev.some((e) => e.includes("\\blur"))).toBe(false);
    expect(ev.some((e) => e.includes("\\fscx112"))).toBe(false);
  });

  it("texto da fala nunca vira comando ASS", () => {
    const ev = events(buildAss([{ word: "{\\fs200}oi\\N", start: 0, end: 1 }], subs({ style: "3d" }), 720, 1280));
    expect(ev.every((e) => !e.includes("\\fs200") && e.includes("FS200OIN"))).toBe(true);
  });

  it("quebra em 2 linhas equilibradas e encolhe o que não cabe", () => {
    const long = [
      { word: "inacreditavelmente", start: 0, end: 1 },
      { word: "extraordinário", start: 1, end: 2 },
    ];
    const lay = layoutChunk(long, 83, 620, 112);
    expect(lay.breakBefore).toBe(1);
    expect(lay.scale).toBeLessThanOrEqual(1);
    expect(layoutChunk([{ word: "oi", start: 0, end: 1 }], 83, 620, 112)).toEqual({ breakBefore: null, scale: 1 });
  });

  it("faixa ocupada fica na parte de baixo para legenda embaixo", () => {
    const band = subtitle3dBand(720, 1280, { position: "bottom", size: "large", color: "#FFFFFF", highlightColor: "#FACC15", maxWordsPerLine: 3 });
    expect(band.bottom).toBeLessThanOrEqual(1280);
    expect(band.top).toBeGreaterThan(640);
    expect(subtitleBand(subs({ style: "3d" }), 720, 1280)).toEqual(band);
  });
});

/** y do centro de cada cartão (evento da camada 20). */
const cardCenters = (ass: string) =>
  events(ass)
    .filter((e) => e.startsWith("Dialogue: 20,"))
    .map((e) => {
      const m = /\\org\(([\d.]+),([\d.]+)\)/.exec(e)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    });

describe("destaques animados", () => {
  const hits = selectKeywords(fake(SCRIPT), { maxPerMinute: 10 });

  it("4 eventos por destaque (cartão, círculo, ícone, texto) e desvia da legenda", () => {
    const band = subtitleBand(subs({ style: "3d" }), 720, 1280);
    const ass = buildPopupAss(hits, popups(), 720, 1280, { subtitlePosition: "bottom", avoid: band });
    const ev = events(ass);
    expect(ev).toHaveLength(hits.length * 4);
    expect(new Set(ev.map((e) => e.split(",")[0]))).toEqual(new Set(["Dialogue: 20", "Dialogue: 21", "Dialogue: 22", "Dialogue: 23"]));
    for (const c of cardCenters(ass)) expect(c.y).toBeLessThan(band.top);
  });

  it("legenda grande no centro: o cartão sai de cima dela", () => {
    const op = subs({ style: "3d", position: "center", size: "xl" });
    const band = subtitleBand(op, 720, 1280);
    const ass = buildPopupAss(hits, popups({ position: "center" }), 720, 1280, { subtitlePosition: "center", avoid: band });
    for (const c of cardCenters(ass)) expect(c.y < band.top || c.y > band.bottom).toBe(true);
  });

  it("horizontal: alterna os cantos de cima", () => {
    const xs = cardCenters(buildPopupAss(hits, popups(), 1280, 720, { subtitlePosition: "bottom" })).map((c) => c.x);
    expect(xs.slice(0, 4)).toEqual([307, 973, 307, 973]);
  });

  it("sem ícones: só cartão e texto; tema accent escuro usa texto branco", () => {
    expect(events(buildPopupAss(hits, popups({ icons: false }), 720, 1280, { subtitlePosition: null }))).toHaveLength(hits.length * 2);
    const dark = buildPopupAss(hits, popups({ theme: "accent", color: "#1E3A8A" }), 720, 1280, { subtitlePosition: null });
    expect(dark).toContain("\\1c&HFFFFFF&} ESTRATÉGIA");
    const light = buildPopupAss(hits, popups({ theme: "accent", color: "#FACC15" }), 720, 1280, { subtitlePosition: null });
    expect(light).toContain("\\1c&H271811&} ESTRATÉGIA");
  });

  it("processor: avisa sem transcrição e grava o .ass com transcrição", async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "editai-popups-"));
    const { plan } = validateEditingPlan({ operations: [{ type: "keyword_popups" }, { type: "subtitles", style: "3d" }] });
    const metadata = { hasAudio: true, duration: 40, width: 720, height: 1280 } as VideoMetadata;
    const ctx = (words: TranscriptWord[]): ProcessorContext => ({
      plan,
      metadata,
      timeline: { segments: [], speed: 1, sourceDuration: 40, outputDuration: 40, removed: [], warnings: [] },
      options: { quality: "720p" },
      frame: { width: 720, height: 1280 },
      fps: 30,
      words,
      workDir,
      assets: {},
      graph: { video: [], audio: [], audioPost: [], extraInputs: [] },
      warnings: [],
      files: new Map(),
    });
    const empty = ctx([]);
    await KeywordPopupProcessor.apply(empty);
    expect(empty.graph.video).toEqual([]);
    expect(empty.warnings[0]).toMatch(/Transcrever no navegador/);

    const full = ctx(fake(SCRIPT));
    await KeywordPopupProcessor.apply(full);
    expect(full.graph.video[0]).toMatch(/^ass=filename='.*popups\.ass'/);
    expect(events(await readFile(full.files.get("popups")!, "utf8")).length).toBeGreaterThan(0);
  });
});

describe("planejador por regras", () => {
  const planner = new RuleBasedPlanner();
  const video = {
    duration: 60, width: 1080, height: 1920, fps: 30, hasAudio: true, silenceCount: 4, silenceSeconds: 6,
    hasTranscript: true, transcriptText: null, musicAssets: [],
  };
  it("elementos sobre o que fala + legendas 3D + cortes sem som", async () => {
    const r = await planner.createEditingPlan({
      instruction: "adicione elementos sobre o que ela fala, legendas 3D, cortes aonde nao tem som",
      currentPlan: EMPTY_PLAN,
      video,
      mode: "edit",
      history: [],
    });
    const byType = Object.fromEntries(r.plan.operations.map((o) => [o.type, o]));
    expect(byType.keyword_popups).toMatchObject({ position: "auto", theme: "light", icons: true, keywords: [] });
    expect(byType.subtitles).toMatchObject({ style: "3d" });
    expect(byType.remove_silence).toBeDefined();
  });
});

describe("transcrição do navegador", () => {
  it("monta o Transcript: ordena, limpa, limita ao vídeo e cria segmentos", () => {
    const t = buildBrowserTranscript(
      {
        language: "pt",
        provider: "test",
        words: [
          { word: "mundo.", start: 0.6, end: 0.9 },
          { word: "Olá", start: 0.1, end: 0.5 },
          { word: "  depois  ", start: 3, end: 3.4 },
          { word: "fora", start: 50, end: 51 },
        ],
      },
      10,
    );
    expect(t.words.map((w) => w.word)).toEqual(["Olá", "mundo.", "depois"]);
    expect(t.segments.map((s) => s.text)).toEqual(["Olá mundo.", "depois"]);
    expect(t.source).toBe("browser");
  });

  it("recusa transcrição vazia ou maior do que o vídeo permite", () => {
    expect(() => buildBrowserTranscript({ language: "pt", provider: "t", words: [] }, 10)).toThrow();
    const many = Array.from({ length: 200 }, (_, i) => ({ word: "a", start: i * 0.01, end: i * 0.01 + 0.01 }));
    expect(() => buildBrowserTranscript({ language: "pt", provider: "t", words: many }, 5)).toThrow();
  });

  it("divide o áudio em pedaços de até 28 s cortando nos silêncios", () => {
    // 70 s: "fala" (tom com volume variando) e 1 s de quase silêncio a cada 10 s.
    const samples = new Float32Array(70 * SAMPLE_RATE);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = (i / SAMPLE_RATE) % 10 < 9 ? 0.3 * Math.sin(i / 5) * (0.5 + 0.5 * Math.sin(i / 3000)) : 0.001 * Math.sin(i);
    }
    const pieces = planPieces(samples);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (const p of pieces) expect(p.end - p.start).toBeLessThanOrEqual(28.01);
    for (const p of pieces.slice(0, -1)) expect(p.end % 10).toBeGreaterThanOrEqual(9);
  });

  it("corta laços de repetição e frases alucinadas", () => {
    const loop = Array.from({ length: 12 }, (_, i) => ({ word: i % 3 === 0 ? "eu" : i % 3 === 1 ? "vou" : "lá", start: i, end: i + 0.5 }));
    const r = cleanPieceWords(loop, 30);
    expect(r.loopTrimmed).toBe(true);
    expect(r.words).toHaveLength(3);
    expect(cleanPieceWords([{ word: "Legendas pela comunidade Amara.org", start: 0, end: 1 }], 30).words).toEqual([]);
  });
});
