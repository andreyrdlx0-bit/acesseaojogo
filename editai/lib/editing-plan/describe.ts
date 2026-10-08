import type { EditingOperation, EditingPlan } from "./schema";

const SIZE_LABEL = { small: "pequenas", medium: "médias", large: "grandes", xl: "gigantes" } as const;

/** Descrição curta em português de cada operação — usada na UI e na timeline. */
export function describeOperation(op: EditingOperation): string {
  switch (op.type) {
    case "trim":
      return `Manter de ${fmt(op.start)} ${op.end !== undefined ? `até ${fmt(op.end)}` : "até o fim"}`;
    case "cut":
      return `Cortar ${op.ranges.length} trecho${op.ranges.length > 1 ? "s" : ""}`;
    case "remove_silence":
      return `Remover silêncios acima de ${(op.minSilenceMs / 1000).toFixed(1)}s`;
    case "remove_retakes":
      return op.removeFillers ? "Remover erros e vícios de linguagem" : "Remover trechos repetidos";
    case "shorten":
      return `Versão de ${Math.round(op.targetSeconds)}s`;
    case "subtitles":
      return op.enabled ? `Legendas ${SIZE_LABEL[op.size]} (${op.style})` : "Sem legendas";
    case "subtitle_style":
      return "Ajustar estilo das legendas";
    case "audio_enhancement":
      return "Melhorar a voz";
    case "noise_reduction":
      return "Reduzir ruído";
    case "volume":
      return `${op.gainDb > 0 ? "Aumentar" : "Diminuir"} volume (${op.gainDb > 0 ? "+" : ""}${op.gainDb} dB)`;
    case "background_music":
      return "Música de fundo";
    case "speed":
      return `Velocidade ${op.factor.toFixed(2)}x`;
    case "zoom":
      return op.trigger.kind === "keyword"
        ? `Zoom em “${op.trigger.keywords.slice(0, 3).join(", ")}”`
        : op.trigger.kind === "emphasis"
          ? "Zoom nos momentos importantes"
          : `Zoom em ${op.trigger.ranges.length} momento(s)`;
    case "crop":
      return "Recorte do quadro";
    case "aspect_ratio":
      return `Formato ${op.ratio}`;
    case "transitions":
      return "Transições suaves";
    case "text_overlay":
      return `Texto: “${op.text}”`;
    case "color_adjustment":
      return op.preset !== "none" ? `Cor: ${op.preset}` : "Ajuste de cor";
    case "b_roll":
      return "B-roll (em breve)";
  }
}

export function describePlan(plan: EditingPlan): string[] {
  return plan.operations.filter((op) => op.enabled || op.type === "subtitles").map(describeOperation);
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
