export type PlanId = "free" | "starter" | "creator" | "pro";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceBRL: number;
  monthlyCredits: number;
  maxQuality: "720p" | "1080p";
  maxVideoMinutes: number;
  priority: number;
  highlight?: boolean;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Grátis",
    priceBRL: 0,
    monthlyCredits: 0,
    maxQuality: "720p",
    maxVideoMinutes: 3,
    priority: 0,
    features: ["30 créditos de boas-vindas", "Edição por IA", "Exportação em 720p"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceBRL: 29,
    monthlyCredits: 120,
    maxQuality: "720p",
    maxVideoMinutes: 5,
    priority: 1,
    features: ["120 créditos por mês", "Vídeos HD (720p)", "Edição por IA com voz", "Remoção de silêncios"],
  },
  creator: {
    id: "creator",
    name: "Creator",
    priceBRL: 59,
    monthlyCredits: 300,
    maxQuality: "1080p",
    maxVideoMinutes: 10,
    priority: 2,
    highlight: true,
    features: ["300 créditos por mês", "Exportação 1080p", "Legendas dinâmicas", "Zoom inteligente", "Edição avançada"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceBRL: 99,
    monthlyCredits: 700,
    maxQuality: "1080p",
    maxVideoMinutes: 15,
    priority: 5,
    features: [
      "700 créditos por mês",
      "Processamento prioritário",
      "Recursos avançados",
      "Múltiplas versões por projeto",
      "Modo Autopilot (beta)",
    ],
  },
};

export const PAID_PLANS = [PLANS.starter, PLANS.creator, PLANS.pro];

export interface CreditPack {
  id: string;
  credits: number;
  priceBRL: number;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack_50", credits: 50, priceBRL: 15 },
  { id: "pack_150", credits: 150, priceBRL: 39 },
  { id: "pack_400", credits: 400, priceBRL: 89 },
];

export function getPlan(id: string | null | undefined): PlanDefinition {
  return PLANS[(id as PlanId) ?? "free"] ?? PLANS.free;
}
