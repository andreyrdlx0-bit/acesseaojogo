import type { TranscriptWord } from "@/types/video";

/**
 * Escolhe as palavras-chave da fala para os destaques animados, só com os
 * tempos por palavra da transcrição (sem IA externa). Determinística: mesma
 * entrada, mesma saída.
 *
 * Pontua cada palavra por: número/valor ("R$ 10 mil", "30%"), léxico de
 * impacto (dinheiro, crescimento, erro, segredo...), pausa antes, fala mais
 * lenta (ênfase), intensificador antes ("muito", "maior"), fim de frase e
 * repetição. Depois escolhe as melhores respeitando intervalo mínimo e limite
 * por minuto.
 */

export type KeywordIcon = "money" | "up" | "down" | "alert" | "check" | "bolt" | "bulb" | "time" | "heart" | "target" | "star";

export interface KeywordHit {
  /** Texto exibido, em maiúsculas. */
  text: string;
  start: number;
  end: number;
  score: number;
  icon: KeywordIcon;
}

export interface KeywordOptions {
  /** Intervalo mínimo entre destaques (s). */
  minGapSec?: number;
  maxPerMinute?: number;
  minScore?: number;
  /** Não repete a mesma palavra dentro desta janela (s). */
  dedupeWindowSec?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Como normalizeText, mas mantém "%" e "$" (valores e percentuais). */
function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s%$]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const stem = (n: string) => n.replace(/(oes|aes|ais|eis|ns|s)$/, "");

const PT_STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de da do das dos e em no na nos nas num numa que para pra pro pros por pelo pela pelos pelas com sem se " +
    "eu tu voce voces ele ela eles elas nos vos me te lhe lhes mim ti si meu minha meus minhas teu tua seu sua seus suas nosso nossa " +
    "isso esse essa esses essas este esta estes estas aquilo aquele aquela aqui ali la ai ca " +
    "mas mais menos muito muita muitos muitas pouco tambem como entao porque pois quando onde quem qual quais ja ainda so sobre ate " +
    "ou nem nao sim tipo ne ta to tava assim agora depois antes sempre vez coisa coisas gente cara bem bom boa " +
    "ser sou e era foi fui sao estar estou esta estao estava ter tenho tem tinha temos fazer faz fez fazendo ir vou vai vamos vao " +
    "pode posso podem poder dar deu da dizer disse falar fala falei ver vi ficar fica ficou quer quero queria sabe saber acho " +
    "todo toda todos todas cada outro outra outros outras mesmo mesma alguem algum alguma nada tudo"
  ).split(/\s+/),
);

const INTENSIFIERS = new Set(
  "muito super mega hiper extremamente totalmente realmente maior melhor pior principal unico unica verdadeiro verdadeira grande enorme nunca sempre".split(
    " ",
  ),
);

/** Léxico (palavras normalizadas, sem acento) -> ícone. Também conta como "impacto". */
const LEXICON: Array<[KeywordIcon, RegExp]> = [
  ["money", /^(dinheiro|reais|real|lucr\w*|vend\w+|fatur\w*|preco\w*|grana|renda|salario\w*|ric[oa]s?|invest\w*|gratis|desconto\w*|pag\w+|caro|barato|r\$)$/],
  ["up", /^(cresc\w*|aument\w*|dobr\w*|tripl\w*|escal\w*|ganh\w*|subi\w*|recorde\w*|explod\w*|bomb\w*|%)$/],
  ["down", /^(metade|caiu|cai|reduz\w*|diminu\w*|menor|baix\w*|cort\w*)$/],
  ["alert", /^(erro\w*|errad\w*|cuidado|problema\w*|nunca|atencao|risco\w*|perig\w*|pare|evite|golpe\w*|falh\w*|prejuizo\w*|perd\w+)$/],
  ["check", /^(certo|cert[ao]s|funcion\w*|sucesso|pronto|consegu\w*|garant\w*|aprov\w*|facil|simples|verdade|resultado\w*)$/],
  ["bolt", /^(rapid\w*|imediat\w*|urgent\w*|energia|poder\w*|forca|segundos?|instant\w*|viral\w*)$/],
  ["bulb", /^(ideia\w*|estrateg\w*|segredo\w*|dica\w*|truque\w*|metodo\w*|plano\w*|soluc\w*|aprend\w*|descobr\w*|passos?|conteudo\w*|criativ\w*|historia\w*)$/],
  ["time", /^(tempo|horas?|dias?|semanas?|mes|meses|anos?|prazo\w*|rotina\w*|minutos?)$/],
  ["heart", /^(amor|amo|ador\w+|paixao|coracao|familia\w*|feliz\w*|gratid\w*|conect\w*)$/],
  ["target", /^(objetivo\w*|foco|focad\w*|alvo|clientes?|publico|nicho|audiencia|seguidor\w*|meta|metas)$/],
];
const NUMBER_WORDS = /^(mil|milhao|milhoes|bilhao|bilhoes|cem|cento|dobro|triplo|metade|dezenas?|centenas?)$/;

export function keywordIcon(word: string): KeywordIcon | null {
  const n = norm(word);
  for (const [icon, re] of LEXICON) if (re.test(n)) return icon;
  return null;
}

const displayText = (text: string) =>
  text
    .replace(/[.,!?;:…"“”]+$/u, "")
    .replace(/^["“]+/u, "")
    .toUpperCase();

export function selectKeywords(words: TranscriptWord[], opts: KeywordOptions = {}): KeywordHit[] {
  const minGap = opts.minGapSec ?? 3;
  const maxPerMinute = opts.maxPerMinute ?? 10;
  const minScore = opts.minScore ?? 3;
  const dedupe = opts.dedupeWindowSec ?? 45;
  if (!words.length) return [];

  const N = words.map((w) => norm(w.word));
  // Duração por letra (+3 absorve o custo fixo de cada palavra); bem acima da
  // mediana = fala mais lenta = ênfase.
  const perChar = words.map((w, i) => (w.end - w.start) / (N[i]!.replace(/\s/g, "").length + 3));
  const sorted = [...perChar].sort((a, b) => a - b);
  const medianPerChar = sorted[Math.floor(sorted.length / 2)] || 0.05;
  const stemCount = new Map<string, number>();
  for (const n of N) {
    if (n.length >= 4 && !PT_STOPWORDS.has(n)) stemCount.set(stem(n), (stemCount.get(stem(n)) ?? 0) + 1);
  }

  const candidates: KeywordHit[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const n = N[i]!;
    if (!n) continue;
    const isNum = /\d/.test(n);
    if (!isNum && (PT_STOPWORDS.has(n) || n.length < 4)) continue;
    // O "mil" de "10 mil" já entra junto com o número.
    if (!isNum && NUMBER_WORDS.test(n) && i > 0 && /\d/.test(N[i - 1]!)) continue;

    let score = 0;
    let text = w.word;
    let end = w.end;
    let icon = keywordIcon(n);

    if (isNum) {
      score += 3.5;
      const prev = N[i - 1];
      if (n.startsWith("r$")) icon = "money";
      if (prev === "r$" || prev === "r") {
        text = `R$ ${text}`;
        icon = "money";
      }
      // "30 por cento", "10 mil", "3 semanas"
      let j = i + 1;
      if (N[j] === "por" && N[j + 1] === "cento") {
        text = `${text}%`;
        end = words[j + 1]!.end;
        j += 2;
      } else if (N[j] && NUMBER_WORDS.test(N[j]!) && words[j]!.start - w.end < 0.4) {
        text = `${text} ${words[j]!.word}`;
        end = words[j]!.end;
        j += 1;
      }
      if (N[j] && !PT_STOPWORDS.has(N[j]!) && /^\p{L}{3,}$/u.test(N[j]!) && words[j]!.start - end < 0.4) {
        text = `${text} ${words[j]!.word}`;
        end = words[j]!.end;
        icon = icon ?? keywordIcon(N[j]!);
      }
      // Número solto e pequeno ("1 coisa", "2 e 3") sem unidade não é destaque.
      if (text === w.word && /^\d{1,2}$/.test(n)) continue;
      if (text.includes("%")) icon = icon ?? "up";
      if (/%|R\$/.test(text)) score += 1;
    } else {
      score += clamp((n.length - 5) * 0.4, 0, 2);
    }
    if (icon) score += 2;
    // Pausa antes da "frase": pula até 2 palavras funcionais coladas ("o SEGREDO").
    let h = i;
    while (h > 0 && i - h < 2 && PT_STOPWORDS.has(N[h - 1]!) && words[h]!.start - words[h - 1]!.end < 0.15) h--;
    const gapBefore = h > 0 ? words[h]!.start - words[h - 1]!.end : 1;
    if (gapBefore >= 0.45) score += 2;
    else if (gapBefore >= 0.25) score += 1;
    if (perChar[i]! >= medianPerChar * 1.4) score += 1.5;
    if (i > 0 && INTENSIFIERS.has(N[i - 1]!)) score += 1;
    const gapAfter = i < words.length - 1 ? words[i + 1]!.start - w.end : 1;
    if (/[.!?:]$/.test(w.word) || gapAfter >= 0.35) score += 0.75;
    if (!isNum && (stemCount.get(stem(n)) ?? 0) >= 2) score += 1;

    const shown = displayText(text);
    if (!shown) continue;
    candidates.push({ text: shown, start: w.start, end, score: Math.round(score * 100) / 100, icon: icon ?? "star" });
  }

  const duration = words[words.length - 1]!.end - words[0]!.start;
  const cap = Math.max(1, Math.ceil((duration / 60) * maxPerMinute));
  const ordered = candidates.filter((c) => c.score >= minScore).sort((a, b) => b.score - a.score || a.start - b.start);
  return pickSpaced(ordered, cap, minGap, dedupe);
}

/**
 * Destaques das palavras que o usuário pediu ("quando eu falar dinheiro").
 * Aceita variações ("dinheiro" casa "dinheiros"; "venda" casa "vendas") e
 * expressões de várias palavras.
 */
export function matchRequestedKeywords(words: TranscriptWord[], requested: string[], opts: KeywordOptions = {}): KeywordHit[] {
  const minGap = opts.minGapSec ?? 1.5;
  const dedupe = opts.dedupeWindowSec ?? 20;
  const maxPerMinute = opts.maxPerMinute ?? 10;
  const N = words.map((w) => norm(w.word));
  const hits: KeywordHit[] = [];
  for (const phrase of requested) {
    const parts = norm(phrase).split(" ").filter(Boolean);
    if (!parts.length) continue;
    for (let i = 0; i + parts.length <= words.length; i++) {
      const ok = parts.every((p, k) => {
        const n = N[i + k]!;
        return n === p || (p.length >= 4 && (stem(n) === stem(p) || n.startsWith(p)));
      });
      if (!ok) continue;
      const span = words.slice(i, i + parts.length);
      const text = displayText(span.map((w) => w.word).join(" "));
      if (!text) continue;
      hits.push({
        text,
        start: span[0]!.start,
        end: span[span.length - 1]!.end,
        score: 10,
        icon: keywordIcon(N[i + parts.length - 1]!) ?? (/\d/.test(text) ? "up" : "star"),
      });
    }
  }
  if (!hits.length) return [];
  const duration = words[words.length - 1]!.end - words[0]!.start;
  const cap = Math.max(1, Math.ceil((duration / 60) * maxPerMinute));
  return pickSpaced(
    hits.sort((a, b) => a.start - b.start),
    cap,
    minGap,
    dedupe,
  );
}

function pickSpaced(ordered: KeywordHit[], cap: number, minGap: number, dedupe: number): KeywordHit[] {
  const chosen: KeywordHit[] = [];
  for (const c of ordered) {
    if (chosen.length >= cap) break;
    if (chosen.some((k) => Math.abs(k.start - c.start) < minGap)) continue;
    const key = stem(norm(c.text));
    if (chosen.some((k) => stem(norm(k.text)) === key && Math.abs(k.start - c.start) < dedupe)) continue;
    chosen.push(c);
  }
  return chosen.sort((a, b) => a.start - b.start);
}
