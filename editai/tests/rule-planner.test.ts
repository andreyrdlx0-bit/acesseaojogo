import { describe, expect, it } from "vitest";
import { EMPTY_PLAN, type EditingPlan } from "@/lib/editing-plan";
import { RuleBasedPlanner } from "@/services/ai/planner/rule-based-planner";
import type { VideoContext } from "@/types/services";

const video: VideoContext = {
  duration: 60, width: 1080, height: 1920, fps: 30, hasAudio: true, silenceCount: 4, silenceSeconds: 6,
  hasTranscript: true, transcriptText: null, musicAssets: [],
};
const planner = new RuleBasedPlanner();
const run = (instruction: string, currentPlan: EditingPlan = EMPTY_PLAN) =>
  planner.createEditingPlan({ instruction, currentPlan, video, mode: "edit", history: [] });
const types = (p: EditingPlan) => p.operations.map((o) => o.type).sort();

describe("RuleBasedPlanner", () => {
  it("entende o comando composto principal", async () => {
    const r = await run("Remova os silêncios, coloque legendas grandes, faça zoom quando eu falar dinheiro e deixe o vídeo mais rápido.");
    expect(types(r.plan)).toEqual(["remove_silence", "speed", "subtitles", "zoom"]);
    const zoom = r.plan.operations.find((o) => o.type === "zoom");
    expect(zoom?.type === "zoom" && zoom.trigger.kind === "keyword" && zoom.trigger.keywords).toContain("dinheiro");
    expect(r.reply).toMatch(/^Entendi\. Vou/);
  });

  it("ajusta incrementalmente: legendas maiores e remover zoom", async () => {
    const first = await run("coloque legendas e faça zoom nos momentos importantes");
    const bigger = await run("agora deixe as legendas maiores", first.plan);
    const subs = bigger.plan.operations.find((o) => o.type === "subtitles");
    expect(subs?.type === "subtitles" && subs.size).toBe("xl");
    const noZoom = await run("remova o zoom", bigger.plan);
    expect(types(noZoom.plan)).not.toContain("zoom");
  });

  it.each([
    ["corte os primeiros cinco segundos", "trim"],
    ["transforme em Reels", "aspect_ratio"],
    ["faça uma versão de 30 segundos", "shorten"],
    ["melhore minha voz", "audio_enhancement"],
    ["remova o ruído", "noise_reduction"],
    ["aumente minha voz", "volume"],
    ["remova as partes onde eu errei", "remove_retakes"],
    ["coloque uma música de fundo", "background_music"],
    ["crie uma versão curta", "shorten"],
  ])("“%s” => %s", async (instruction, type) => {
    const r = await run(instruction);
    expect(types(r.plan)).toContain(type);
  });

  it("não inventa edição para instrução desconhecida", async () => {
    const r = await run("qual a capital da França?");
    expect(r.plan.operations).toHaveLength(0);
    expect(r.reply).toMatch(/Não consegui/);
  });
});
