import { validateEditingPlan } from "@/lib/editing-plan";
import type { AIEditingPlanner, EditingPlanResult, EditingRequest } from "@/types/services";
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserMessage, extractJsonObject } from "./prompt";

/** Planner via API compatível com OpenAI Chat Completions (modo JSON). */
export class OpenAIPlanner implements AIEditingPlanner {
  readonly name = "openai";
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string,
  ) {}

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  async createEditingPlan(input: EditingRequest): Promise<EditingPlanResult> {
    if (!this.apiKey) throw new Error("AI_API_KEY não configurada");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          { role: "user", content: buildPlannerUserMessage(input) },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`LLM falhou: HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const json = extractJsonObject(body.choices?.[0]?.message?.content ?? "") as { reply?: unknown };
    const { plan, rejected } = validateEditingPlan(json);
    const reply = typeof json.reply === "string" && json.reply.trim() ? json.reply.trim().slice(0, 600) : "Entendi. Preparei a edição.";
    return { plan, reply, rejected, provider: `${this.name}:${this.model}` };
  }
}
