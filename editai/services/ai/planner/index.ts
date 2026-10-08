import { serverEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import type { AIEditingPlanner, EditingPlanResult, EditingRequest } from "@/types/services";
import { AnthropicPlanner } from "./anthropic-planner";
import { OpenAIPlanner } from "./openai-planner";
import { RuleBasedPlanner } from "./rule-based-planner";

/**
 * Planner com fallback: tenta o LLM configurado; se não houver chave ou a
 * chamada falhar, usa o planejador determinístico e informa isso no
 * `provider` (nunca finge que o LLM respondeu).
 */
class PlannerWithFallback implements AIEditingPlanner {
  readonly name: string;
  readonly isConfigured = true;
  constructor(
    private readonly primary: AIEditingPlanner | null,
    private readonly fallback: AIEditingPlanner,
  ) {
    this.name = primary?.name ?? fallback.name;
  }

  async createEditingPlan(input: EditingRequest): Promise<EditingPlanResult> {
    if (this.primary?.isConfigured) {
      try {
        return await this.primary.createEditingPlan(input);
      } catch (error) {
        logger.error("interpretation", "LLM planner falhou; usando planejador por regras", { error });
        const result = await this.fallback.createEditingPlan(input);
        return { ...result, provider: `${result.provider} (fallback)` };
      }
    }
    return this.fallback.createEditingPlan(input);
  }
}

let instance: AIEditingPlanner | null = null;

export function getEditingPlanner(): AIEditingPlanner {
  if (instance) return instance;
  const env = serverEnv();
  const primary =
    env.AI_PROVIDER === "anthropic"
      ? new AnthropicPlanner(env.AI_API_KEY, env.AI_MODEL ?? "claude-opus-5-5")
      : env.AI_PROVIDER === "openai"
        ? new OpenAIPlanner(env.AI_API_KEY, env.AI_MODEL ?? "gpt-4o-mini")
        : null;
  instance = new PlannerWithFallback(primary, new RuleBasedPlanner());
  return instance;
}

export { RuleBasedPlanner };
