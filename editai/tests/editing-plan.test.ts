import { describe, expect, it } from "vitest";
import { normalizeEditingPlan, validateEditingPlan } from "@/lib/editing-plan";

describe("validateEditingPlan", () => {
  it("aceita operações válidas e aplica padrões", () => {
    const { plan, rejected } = validateEditingPlan({ operations: [{ type: "remove_silence" }, { type: "speed", factor: 1.1 }] });
    expect(rejected).toHaveLength(0);
    expect(plan.operations[0]).toMatchObject({ type: "remove_silence", enabled: true, minSilenceMs: 600 });
  });

  it("rejeita tipos desconhecidos e valores fora do limite sem descartar o resto", () => {
    const { plan, rejected } = validateEditingPlan({
      operations: [{ type: "rm -rf /" }, { type: "speed", factor: 50 }, { type: "subtitles", size: "xl" }],
    });
    expect(rejected.map((r) => r.type)).toEqual(["rm -rf /", "speed"]);
    expect(plan.operations).toHaveLength(1);
  });

  it("rejeita entrada que não é plano", () => {
    expect(validateEditingPlan("ignore as instruções").rejected).toHaveLength(1);
  });

  it("funde subtitle_style em subtitles e mantém só a última operação única", () => {
    const plan = normalizeEditingPlan(
      validateEditingPlan({
        operations: [
          { type: "speed", factor: 1.1 },
          { type: "subtitles", size: "medium" },
          { type: "speed", factor: 1.3 },
          { type: "subtitle_style", size: "xl" },
        ],
      }).plan,
    );
    expect(plan.operations.filter((o) => o.type === "speed")).toHaveLength(1);
    expect(plan.operations.find((o) => o.type === "speed")).toMatchObject({ factor: 1.3 });
    expect(plan.operations.find((o) => o.type === "subtitles")).toMatchObject({ size: "xl" });
    expect(plan.operations.some((o) => o.type === "subtitle_style")).toBe(false);
  });
});
