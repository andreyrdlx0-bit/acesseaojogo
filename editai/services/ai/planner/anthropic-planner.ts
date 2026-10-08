import Anthropic from "@anthropic-ai/sdk";
import { validateEditingPlan } from "@/lib/editing-plan";
import type { AIEditingPlanner, EditingPlanResult, EditingRequest } from "@/types/services";
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserMessage, extractJsonObject } from "./prompt";

/** Planner via Claude (Anthropic SDK). Saída: JSON validado pelo schema. */
export class AnthropicPlanner implements AIEditingPlanner {
  readonly name = "anthropic";
  private readonly client: Anthropic | null;

  constructor(
    apiKey: string | undefined,
    private readonly model: string,
  ) {
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 }) : null;
  }

  get isConfigured() {
    return this.client !== null;
  }

  async createEditingPlan(input: EditingRequest): Promise<EditingPlanResult> {
    if (!this.client) throw new Error("AI_API_KEY não configurada");
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      // Tarefa de extração estruturada: esforço baixo mantém a latência curta.
      output_config: { effort: "low" },
      system: PLANNER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPlannerUserMessage(input) }],
    });
    if (response.stop_reason === "refusal") throw new Error("O modelo recusou a instrução");
    if (response.stop_reason === "max_tokens") throw new Error("Resposta do modelo truncada");

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const json = extractJsonObject(text) as { reply?: unknown; operations?: unknown };
    const { plan, rejected } = validateEditingPlan(json);
    const reply = typeof json.reply === "string" && json.reply.trim() ? json.reply.trim().slice(0, 600) : "Entendi. Preparei a edição.";
    return { plan, reply, rejected, provider: `${this.name}:${this.model}` };
  }
}
