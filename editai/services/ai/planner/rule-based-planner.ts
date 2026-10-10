import {
  EMPTY_PLAN,
  editingOperationSchema,
  normalizeEditingPlan,
  type EditingOperation,
  type EditingPlan,
  type OperationOf,
} from "@/lib/editing-plan";
import type { AIEditingPlanner, EditingPlanResult, EditingRequest } from "@/types/services";
import { normalizeText } from "@/utils/text";

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, noventa: 90,
};
const SIZES = ["small", "medium", "large", "xl"] as const;
const MONEY_WORDS = ["dinheiro", "grana", "reais", "real", "lucro", "faturamento", "renda", "salario", "investimento"];

/**
 * Planejador determinístico (sem LLM) para português.
 * Não é um mock: entende de verdade os comandos mapeados abaixo e é usado
 * quando AI_PROVIDER=rules ou como fallback se o LLM falhar.
 * Comandos fora deste vocabulário exigem um LLM configurado.
 */
export class RuleBasedPlanner implements AIEditingPlanner {
  readonly name = "rules";
  readonly isConfigured = true;

  async createEditingPlan(input: EditingRequest): Promise<EditingPlanResult> {
    const fullText = normalizeText(input.instruction);
    const ops: EditingOperation[] = structuredClone(input.currentPlan.operations);
    const actions: string[] = [];
    let text = fullText;
    const has = (...words: string[]) => words.some((w) => text.includes(w));
    const set = <T extends EditingOperation["type"]>(type: T, value: Omit<OperationOf<T>, "type" | "enabled"> & { enabled?: boolean }) => {
      const parsed = editingOperationSchema.parse({ type, ...value });
      const idx = ops.findIndex((o) => o.type === type);
      if (idx >= 0) ops[idx] = parsed;
      else ops.push(parsed);
    };
    const get = <T extends EditingOperation["type"]>(type: T) =>
      ops.find((o): o is OperationOf<T> => o.type === type && o.enabled);
    const drop = (type: EditingOperation["type"]) => {
      for (let i = ops.length - 1; i >= 0; i--) if (ops[i]!.type === type) ops.splice(i, 1);
    };

    // Desfazer tudo
    if (has("volte ao original", "voltar ao original", "desfaz tudo", "desfazer tudo", "remova tudo", "versao original")) {
      return this.result(EMPTY_PLAN, "Entendi. Vou voltar ao vídeo original, sem nenhuma edição.");
    }

    const autopilot =
      input.mode === "autopilot" || has("mais interessante", "viral", "otimiz", "alta retencao", "prender a atencao");
    if (autopilot) {
      set("remove_silence", { minSilenceMs: 400, thresholdDb: -35, paddingMs: 100 });
      set("remove_retakes", { removeFillers: true });
      // Pedido (ou já escolhido) de legenda 3D vale também no piloto automático.
      const style = !negates3d(text) && (wants3d(text) || get("subtitles")?.style === "3d") ? "3d" : "karaoke";
      set("subtitles", { ...(get("subtitles") ?? {}), enabled: true, style, size: "large", position: "center", uppercase: true } as never);
      set("audio_enhancement", { preset: "voice" });
      if (!get("speed")) set("speed", { factor: 1.1 });
      drop("zoom");
      ops.push(editingOperationSchema.parse({ type: "zoom", trigger: { kind: "emphasis", everySeconds: 5 }, scale: 1.12 }));
      if (has("tiktok", "reels", "shorts", "stories", "vertical") || input.mode === "autopilot") set("aspect_ratio", { ratio: "9:16", fit: "crop" });
      actions.push(
        `cortar pausas e erros, acelerar levemente, colocar legendas ${style === "3d" ? "em 3D" : "dinâmicas"}, fazer zooms nos momentos-chave e melhorar o áudio para prender a atenção`,
      );
    }

    // Cada oração é interpretada isoladamente ("remova X e coloque Y").
    for (const clause of splitClauses(input.instruction)) {
    text = clause;
    const removing = has("remov", "tirar", "tire ", "tira ", "sem ", "desativ", "desliga", "nao quero");

    // Silêncios / dinamismo
    const noSound = has(
      "nao tem som", "sem som", "nao tem audio", "sem audio", "nao tem fala", "sem fala", "ninguem fala", "nao falo",
      "parte muda", "partes mudas", "fica mudo", "fico calad", "fica calad", "tempo morto", "momentos vazios", "partes vazias",
    );
    // "sem som de fundo" é pedido de limpar ruído, não de cortar o vídeo.
    if (
      noSound &&
      !autopilot &&
      !has("legenda") &&
      has("cort", "remov", "tir", "apag", "exclu", "elimin", "pul", "onde", "aonde", "quando", "parte", "trecho", "pedac", "momento", "tempo morto") &&
      !/sem (?:som|audio|barulho|ruido) (?:de fundo|ambiente)/.test(text)
    ) {
      set("remove_silence", { minSilenceMs: 500, thresholdDb: -35, paddingMs: 100 });
      actions.push("cortar as partes sem fala");
    }
    if (has("silencio", "pausa", "respiro") && !autopilot) {
      if (removing || has("cort", "corta")) {
        const long = has("longa", "grande");
        set("remove_silence", { minSilenceMs: long ? 900 : 600, thresholdDb: -35, paddingMs: 120 });
        actions.push(long ? "remover as pausas longas" : "remover os silêncios");
      }
    }
    if ((has("dinamic", "cortes mais rapidos", "mais ritmo", "agil", "cortes inteligentes") || (has("estrateg") && has("cort"))) && !autopilot) {
      set("remove_silence", { minSilenceMs: 400, thresholdDb: -35, paddingMs: 90 });
      const current = get("speed")?.factor ?? 1;
      set("speed", { factor: clamp(Math.max(current, 1) * 1.08, 0.5, 1.5) });
      if (!get("zoom")) ops.push(editingOperationSchema.parse({ type: "zoom", trigger: { kind: "emphasis", everySeconds: 6 }, scale: 1.1 }));
      actions.push("remover pausas, acelerar pequenos trechos e criar cortes mais frequentes");
    }
    if (has("errei", "erro", "errado", "repet", "gaguej", "vicio", "eee", "hum")) {
      set("remove_retakes", { removeFillers: true });
      actions.push("remover as partes em que você errou ou repetiu");
    }
    if (has("desnecessari", "enrolac", "partes chatas") && !autopilot) {
      set("remove_silence", { minSilenceMs: 500, thresholdDb: -35, paddingMs: 100 });
      set("remove_retakes", { removeFillers: true });
      actions.push("tirar pausas, erros e trechos desnecessários");
    }

    // Velocidade
    if (has("mais rapido", "acelera", "acelere") && !has("cortes mais rapidos")) {
      const current = get("speed")?.factor ?? 1;
      set("speed", { factor: round2(clamp(current * 1.15, 0.5, 2)) });
      actions.push("deixar o vídeo mais rápido");
    } else if (has("mais devagar", "mais lento", "desacelera")) {
      const current = get("speed")?.factor ?? 1;
      set("speed", { factor: round2(clamp(current * 0.87, 0.5, 2)) });
      actions.push("deixar o vídeo mais devagar");
    } else if (has("velocidade normal")) {
      drop("speed");
      actions.push("voltar à velocidade normal");
    }

    // "tire o 3D" (com ou sem a palavra legenda) mantém as legendas no estilo normal.
    const subs3d = get("subtitles");
    const drop3d = subs3d?.style === "3d" && negates3d(text);
    if (drop3d && !autopilot) {
      set("subtitles", { ...subs3d, style: "bold" });
      actions.push("tirar o efeito 3D das legendas");
    }

    // Legendas ("tire o destaque das legendas" fica para o ramo de destaque abaixo)
    const highlightWords = has("destaq", "palavras importantes", "palavras chave");
    if (has("legenda") && !autopilot && !drop3d && !(removing && highlightWords)) {
      const current = get("subtitles");
      // "legendas sem 3D" nega só o efeito, não as legendas.
      if (removing && !negates3d(text)) {
        drop("subtitles");
        drop("subtitle_style");
        actions.push("remover as legendas");
      } else {
        const base = (current ?? editingOperationSchema.parse({ type: "subtitles" })) as OperationOf<"subtitles">;
        const next = { ...base, enabled: true };
        const idx = SIZES.indexOf(base.size);
        if (has("maior", "aument")) next.size = SIZES[Math.min(idx + 1, 3)]!;
        else if (has("menor", "diminu")) next.size = SIZES[Math.max(idx - 1, 0)]!;
        else if (has("gigante", "enorme")) next.size = "xl";
        else if (has("grande")) next.size = "large";
        else if (has("pequen")) next.size = "small";
        else if (has("tamanho normal", "tamanho padrao", "tamanho comum")) next.size = "large";
        if (has("em cima", "no topo", "parte de cima")) next.position = "top";
        if (has("no meio", "centro", "centraliz")) next.position = "center";
        if (has("embaixo", "em baixo", "parte de baixo", "rodape")) next.position = "bottom";
        if (has("maiuscul", "caixa alta")) next.uppercase = true;
        // "legendas normais" volta ao estilo padrão; "tamanho normal" não mexe no estilo.
        if (/legendas? (?:mais )?(?:normais?|comuns?|padrao)\b|(?:ao|pro|para o) normal\b|estilo (?:normal|padrao)/.test(text) && !has("tamanho", "cor ", "fonte")) {
          next.style = "bold";
        }
        if (has("karaoke", "palavra por palavra")) next.style = "karaoke";
        if (has("simples", "discret", "minimal")) next.style = "minimal";
        if (has("caixa", "fundo")) next.style = "clean";
        if ((wants3d(text) || has("profundidade")) && !negates3d(text)) next.style = "3d";
        if (has("amarel")) next.highlightColor = "#FACC15";
        if (has("verde")) next.highlightColor = "#22C55E";
        if (has("vermelh")) next.highlightColor = "#EF4444";
        set("subtitles", next);
        const sizeLabel = next.size === "xl" ? "gigantes" : next.size === "large" ? "grandes" : "";
        actions.push(
          current
            ? next.style === "3d" && current.style !== "3d"
              ? "deixar as legendas em 3D"
              : "ajustar as legendas"
            : `colocar legendas ${next.style === "3d" ? `${sizeLabel} em 3D` : sizeLabel}`.replace(/\s+/g, " ").trim(),
        );
      }
    }

    // Destaques animados (cards na tela) têm prioridade sobre o destaque de palavras na legenda.
    // "sem pop ups", "sem emojis": o substantivo negado não conta como pedido de cards.
    const negatedPopups = NEGATED_POPUPS.test(text);
    const positive = text.replace(new RegExp(NEGATED_POPUPS.source, "g"), " ");
    const hasPositive = (...words: string[]) => words.some((w) => positive.includes(w));
    const popupNoun = hasPositive("elemento", "pop up", "popup", "emoji", "icone", "destaques animados", "destaque animado", "cards na tela");
    const popupWords =
      popupNoun ||
      (/(?:^| )(?:sobre o que|do que) (?:eu |ela |ele |a pessoa |voce )?(?:fala|falo|diz|digo|esta falando|estou falando)\b/.test(text) &&
        !has("legenda", "musica", "trilha", "zoom", "volume")) ||
      // "mostre um destaque quando eu falar dinheiro" = cartão na tela, não cor na legenda.
      (has("destaq") && !has("legenda") && /quando (?:\p{L}+ )?(?:falar|disser|mencionar|citar)\b/u.test(text));
    if (highlightWords && !popupWords && !negatedPopups) {
      const subs = get("subtitles");
      if (removing) {
        if (subs?.highlightKeywords) {
          set("subtitles", { ...subs, highlightKeywords: false });
          actions.push("tirar o destaque das palavras nas legendas");
        } else if (get("keyword_popups")) {
          drop("keyword_popups");
          actions.push("remover os destaques animados");
        }
      } else {
        const base = (subs ?? editingOperationSchema.parse({ type: "subtitles" })) as OperationOf<"subtitles">;
        set("subtitles", { ...base, enabled: true, highlightKeywords: true });
        actions.push("destacar as palavras importantes nas legendas");
      }
    }

    // Elementos sobre o que a pessoa fala (destaques animados das palavras-chave)
    const prevPopups = get("keyword_popups");
    const iconWords = has("icone", "emoji");
    const cardWords = has("destaq", "pop up", "popup", "elemento", "card");
    const removeVerb = has("remov", "tirar", "tire ", "tira ", "desativ", "desliga", "nao quero");
    if (prevPopups && iconWords && cardWords && (removeVerb || /sem (?:os |as )?(?:icones?|emojis?)/.test(text))) {
      // "tire os ícones dos destaques": só os ícones saem.
      set("keyword_popups", { ...prevPopups, icons: false });
      actions.push("tirar os ícones dos destaques animados");
    } else if (negatedPopups && !popupNoun) {
      // "deixe sem pop ups", "legendas simples, sem emoji".
      if (prevPopups) {
        drop("keyword_popups");
        actions.push("remover os destaques animados");
      }
    } else if (popupWords) {
      // "sem exagero" não é pedido de remoção.
      const removePopups = removeVerb && !has("coloq", "adicion", "poe ", "bot", "acrescent");
      if (removePopups) {
        drop("keyword_popups");
        actions.push("remover os destaques animados");
      } else {
        const keywords = extractSpokenKeywords(text);
        const position = has("em cima", "no topo", "parte de cima")
          ? "top"
          : has("no centro", "no meio", "centraliz")
            ? "center"
            : (prevPopups?.position ?? "auto");
        set("keyword_popups", {
          keywords: keywords.length ? keywords : (prevPopups?.keywords ?? []),
          perMinute: prevPopups?.perMinute ?? 6,
          position,
          theme: prevPopups?.theme ?? "light",
          icons: /sem (?:os |as )?(?:icones?|emojis?)/.test(text) ? false : has("com icone", "com emoji") ? true : (prevPopups?.icons ?? true),
          color: prevPopups?.color ?? "#FACC15",
        });
        actions.push(
          keywords.length
            ? `mostrar destaques animados quando você falar “${keywords.join(", ")}”`
            : "mostrar destaques animados com as palavras-chave do que é dito",
        );
      }
    }

    // Zoom
    if (has("zoom", "aproxim", "close") && !autopilot) {
      if (removing) {
        drop("zoom");
        actions.push("remover o zoom");
      } else {
        const keywords = extractKeywords(text);
        drop("zoom");
        if (keywords.length) {
          const expanded = keywords.some((k) => MONEY_WORDS.includes(k)) ? [...new Set([...keywords, ...MONEY_WORDS])] : keywords;
          ops.push(editingOperationSchema.parse({ type: "zoom", trigger: { kind: "keyword", keywords: expanded }, scale: 1.15 }));
          actions.push(`fazer zoom quando você falar “${keywords.join(", ")}”`);
        } else {
          ops.push(editingOperationSchema.parse({ type: "zoom", trigger: { kind: "emphasis", everySeconds: 6 }, scale: 1.12 }));
          actions.push("fazer zoom nos momentos importantes");
        }
      }
    }

    // Áudio
    if (has("melhor") && has("voz", "audio", "som")) {
      set("audio_enhancement", { preset: has("podcast") ? "podcast" : "voice" });
      actions.push("melhorar sua voz");
    }
    if (has("ruido", "barulho", "chiado", "eco")) {
      set("noise_reduction", { strength: has("muito", "bastante", "forte") ? "high" : "medium" });
      actions.push("reduzir o ruído de fundo");
    }
    if (has("aument", "mais alto") && has("voz", "volume", "audio", "som") && !has("legenda")) {
      set("volume", { gainDb: clamp((get("volume")?.gainDb ?? 0) + 6, -20, 20) });
      actions.push("aumentar o volume da sua voz");
    } else if (has("abaix", "diminu", "mais baixo") && has("volume", "voz", "audio", "som") && !has("legenda")) {
      set("volume", { gainDb: clamp((get("volume")?.gainDb ?? 0) - 6, -20, 20) });
      actions.push("diminuir o volume");
    }
    if (has("musica", "trilha")) {
      if (removing) {
        drop("background_music");
        actions.push("remover a música de fundo");
      } else {
        const mood = has("calm", "tranquil", "suave") ? "calm" : has("animad", "alegre", "energ") ? "upbeat" : has("cinemat", "epic") ? "cinematic" : has("corporat") ? "corporate" : "any";
        const asset = input.video.musicAssets[0];
        set("background_music", { mood, volumeDb: -20, ...(asset ? { assetId: asset.id } : {}) });
        actions.push("colocar uma música de fundo");
      }
    }

    // Corte por tempo
    const firstN = text.match(/primeiros? (\d+|\p{L}+) segundos?/u);
    if (firstN && has("cort", "tir", "remov", "pul")) {
      const n = toNumber(firstN[1]!);
      if (n) {
        const trim = get("trim");
        set("trim", { start: n, ...(trim?.end !== undefined ? { end: trim.end } : {}) });
        actions.push(`cortar os primeiros ${n} segundos`);
      }
    }
    const lastN = text.match(/ultimos? (\d+|\p{L}+) segundos?/u);
    if (lastN && has("cort", "tir", "remov")) {
      const n = toNumber(lastN[1]!);
      if (n && n < input.video.duration) {
        set("trim", { start: get("trim")?.start ?? 0, end: round2(input.video.duration - n) });
        actions.push(`cortar os últimos ${n} segundos`);
      }
    }

    // Duração alvo
    const target = text.match(/(?:versao|video) (?:de |com )?(\d+|\p{L}+) (segundos?|minutos?)/u);
    if (target) {
      const n = toNumber(target[1]!);
      if (n) {
        const secs = target[2]!.startsWith("min") ? n * 60 : n;
        set("shorten", { targetSeconds: clamp(secs, 5, 600), strategy: "highlights" });
        actions.push(`criar uma versão de ${secs} segundos com os melhores momentos`);
      }
    } else if (has("versao curta", "mais curto", "mais curta", "resum")) {
      set("shorten", { targetSeconds: 30, strategy: "highlights" });
      actions.push("criar uma versão curta (30s) com os melhores momentos");
    }

    // Formato
    if (has("reels", "tiktok", "shorts", "stories", "9 16", "vertical") && !autopilot) {
      set("aspect_ratio", { ratio: "9:16", fit: "crop" });
      actions.push("adaptar para 9:16 e otimizar o enquadramento");
    } else if (has("16 9", "horizontal", "youtube", "paisagem")) {
      set("aspect_ratio", { ratio: "16:9", fit: "crop" });
      actions.push("adaptar para 16:9");
    } else if (has("1 1", "quadrad")) {
      set("aspect_ratio", { ratio: "1:1", fit: "crop" });
      actions.push("deixar quadrado (1:1)");
    } else if (has("4 5")) {
      set("aspect_ratio", { ratio: "4:5", fit: "crop" });
      actions.push("adaptar para 4:5");
    }

    // Visual
    if (has("preto e branco")) set("color_adjustment", { preset: "bw", brightness: 0, contrast: 1, saturation: 1 });
    else if (has("cores vivas", "mais vivo", "vibrant", "saturad")) set("color_adjustment", { preset: "vivid", brightness: 0, contrast: 1, saturation: 1 });
    else if (has("cinema", "cinematic")) set("color_adjustment", { preset: "cinematic", brightness: 0, contrast: 1, saturation: 1 });
    else if (has("mais quente")) set("color_adjustment", { preset: "warm", brightness: 0, contrast: 1, saturation: 1 });
    else if (has("mais frio")) set("color_adjustment", { preset: "cool", brightness: 0, contrast: 1, saturation: 1 });
    else if (has("mais claro", "clarear")) set("color_adjustment", { preset: "none", brightness: 0.06, contrast: 1, saturation: 1 });
    if (get("color_adjustment") && has("preto e branco", "cores", "vivo", "vibrant", "satur", "cinema", "quente", "frio", "claro")) {
      actions.push("ajustar as cores");
    }
    if (has("transic", "fade", "suave no inicio")) {
      if (removing) drop("transitions");
      else set("transitions", { style: "fade", durationMs: 400 });
      actions.push(removing ? "remover as transições" : "adicionar transições suaves");
    }

    if (has("profissional")) {
      set("audio_enhancement", { preset: "voice" });
      set("noise_reduction", { strength: "low" });
      set("transitions", { style: "fade", durationMs: 400 });
      const subs = get("subtitles");
      if (subs) set("subtitles", { ...subs, style: "clean" });
      actions.push("deixar o áudio limpo, com transições suaves e visual mais sóbrio");
    }

    }
    text = fullText;

    // Texto entre aspas
    const quoted = input.instruction.match(/["“”']([^"“”']{1,120})["“”']/);
    if (quoted && has("texto", "titulo", "escrev", "frase")) {
      ops.push(editingOperationSchema.parse({ type: "text_overlay", text: quoted[1]!, start: 0, end: 4, position: "top" }));
      actions.push(`escrever “${quoted[1]}” na tela`);
    }

    if (!actions.length) {
      return this.result(
        input.currentPlan,
        "Não consegui entender essa instrução. Tente algo como “remova os silêncios e coloque legendas grandes”.",
      );
    }
    return this.result(normalizeEditingPlan({ version: 1, operations: ops }), `Entendi. Vou ${joinPt(actions)}.`);
  }

  private result(plan: EditingPlan, reply: string): EditingPlanResult {
    return { plan, reply, rejected: [], provider: this.name };
  }
}

const CLAUSE_VERBS =
  "(?:coloq|coloc|faca|faz|deix|remov|tir|cort|melhor|aument|diminu|abaix|aceler|cri|transform|adicion|poe|ponh|bot|use|mud|troq|destaq|escrev|tamb)";

function splitClauses(instruction: string): string[] {
  const normalized = instruction
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized
    .split(new RegExp(`[,.;!?\\n]|\\s(?:e|depois|agora|tambem|alem disso)\\s(?=${CLAUSE_VERBS})`))
    .map((c) => normalizeText(c))
    .filter(Boolean);
}

// Palavras de escopo/posição que nunca são o "assunto" pedido ("em todo o vídeo", "em cima").
const NOT_KEYWORDS = new Set(
  "momentos momento importantes importante principais principal partes parte video videos todo toda todos cada frase frases cima baixo meio centro topo rodape tela palavra palavras chave chaves falo fala diz digo emojis emoji icones elementos legendas legenda".split(
    " ",
  ),
);
// Depois da palavra pedida, frases de posição/escopo encerram a lista ("dinheiro em cima da tela").
const SCOPE_TAIL = /\s(?:em cima|no topo|no centro|no meio|embaixo|em baixo|no video|em todo|na tela|no rodape)\b.*$/u;

function keywordList(raw: string): string[] {
  return raw
    .replace(SCOPE_TAIL, "")
    .split(/\s+e\s+|,|\s+ou\s+/)
    .map((w) => w.trim().split(" ").filter((p) => p.length > 2 && !NOT_KEYWORDS.has(p)).pop() ?? "")
    .filter((w) => w.length > 2)
    .slice(0, 5);
}

const SPOKEN = "quando (?:\\p{L}+ )?(?:falar|disser|digo|mencionar|citar)";

function extractKeywords(text: string): string[] {
  const m = text.match(
    new RegExp(`(?:${SPOKEN}|na palavra|nas palavras|(?:^|\\s)em)\\s+(?:sobre |de |em |a palavra |o |a )?([\\p{L}\\s]+?)(?:\\s+e\\s+(?:deixe|coloque|faca|remova|tire)|$)`, "u"),
  );
  return m ? keywordList(m[1]!) : [];
}

/** Só formas explícitas ("quando eu falar X", "a palavra X"): o resto é escolha automática. */
function extractSpokenKeywords(text: string): string[] {
  const m = text.match(
    new RegExp(`(?:${SPOKEN}|(?:na|nas|a|as) palavras?)\\s+(?:sobre |de |a palavra |o |a )?([\\p{L}\\s]+?)(?:\\s+e\\s+(?:deixe|coloque|faca|remova|tire)|$)`, "u"),
  );
  return m ? keywordList(m[1]!) : [];
}

/** "sem pop ups", "sem os emojis", "sem nenhum elemento". */
const NEGATED_POPUPS = /(?:^| )sem (?:os |as |nenhum |nenhuma )?(?:pop ?ups?|emojis?|icones?|elementos?|destaques? animados?|cards?)\b/;

/** Pedido de 3D: "3d", "3 d", "tridimensional", "relevo" (palavra inteira: "3 dicas" não conta). */
function wants3d(text: string): boolean {
  return /(?:^| )3 ?d(?: |$)/.test(text) || /tridimension|relevo/.test(text);
}

/** "sem 3d", "tire o 3d", "remova o efeito 3d", "sem relevo". */
function negates3d(text: string): boolean {
  return /(?:sem|tir\w*|remov\w*|desativ\w*|desliga\w*|nao quero)(?: \p{L}+){0,3} (?:3 ?d|relevo|tridimensional)(?: |$)/u.test(text);
}

function toNumber(token: string): number | null {
  const n = Number(token);
  if (Number.isFinite(n) && n > 0) return n;
  return NUMBER_WORDS[token] ?? null;
}

function joinPt(items: string[]): string {
  const unique = [...new Set(items)];
  if (unique.length === 1) return unique[0]!;
  return `${unique.slice(0, -1).join(", ")} e ${unique[unique.length - 1]}`;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
