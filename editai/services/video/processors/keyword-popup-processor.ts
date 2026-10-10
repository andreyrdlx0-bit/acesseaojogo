import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { OperationOf } from "@/lib/editing-plan";
import { findOperation } from "@/lib/editing-plan/validate";
import { matchRequestedKeywords, selectKeywords, type KeywordHit, type KeywordIcon } from "../keywords";
import { SUBTITLE_FONT_FAMILY } from "../fonts";
import { assFilter, assHeader, dialogue, escapeAssText, luminance, tagColor } from "./ass";
import { ASCENT, CAP_HEIGHT, DESCENT, EM_PER_FS, measureText } from "./font-metrics";
import { missingTranscriptWarning, subtitleBand, subtitleEconomy } from "./subtitle-processor";
import type { VerticalBand } from "./subtitle-layout";
import type { OperationProcessor } from "./types";

type PopupOp = OperationOf<"keyword_popups">;

/**
 * "Elementos sobre o que a pessoa fala": cartões animados com a palavra-chave
 * e um ícone, que aparecem quando a palavra é dita. Desenhados em ASS (\p1),
 * sem imagens externas, e posicionados para não cobrir a legenda.
 */
export const KeywordPopupProcessor: OperationProcessor = {
  name: "KeywordPopupProcessor",
  handles: ["keyword_popups"],
  async apply(ctx) {
    const op = findOperation(ctx.plan, "keyword_popups");
    if (!op) return;
    if (!ctx.words.length) {
      ctx.warnings.push(missingTranscriptWarning(ctx, "Os destaques animados precisam"));
      return;
    }
    let hits = op.keywords.length ? matchRequestedKeywords(ctx.words, op.keywords, { maxPerMinute: op.perMinute }) : [];
    if (op.keywords.length && !hits.length) {
      ctx.warnings.push(`Não encontramos “${op.keywords.join(", ")}” na fala, então escolhemos os destaques automaticamente.`);
    }
    if (!hits.length) hits = selectKeywords(ctx.words, { maxPerMinute: op.perMinute });
    if (!hits.length) {
      ctx.warnings.push("Não encontramos palavras de destaque na fala deste vídeo.");
      return;
    }
    const { width, height } = ctx.frame;
    const subtitles = findOperation(ctx.plan, "subtitles");
    const ass = buildPopupAss(hits, op, width, height, {
      subtitlePosition: subtitles?.position ?? null,
      avoid: subtitles ? subtitleBand(subtitles, width, height, subtitleEconomy(ctx)) : undefined,
    });
    const file = path.join(ctx.workDir, "popups.ass");
    await writeFile(file, ass, "utf8");
    ctx.files.set("popups", file);
    ctx.graph.video.push(assFilter(file));
  },
};

export interface PopupPlacement {
  /** Posição da legenda (null = sem legenda). */
  subtitlePosition: "top" | "center" | "bottom" | null;
  /** Faixa ocupada pela legenda; o cartão desvia dela. */
  avoid?: VerticalBand;
}

export interface PopupLayout {
  fontSize: number;
  maxCardW: number;
  slots: Array<{ x: number; y: number; rot: number }>;
}

export function popupLayout(W: number, H: number, position: PopupOp["position"], subtitlePosition: PopupPlacement["subtitlePosition"]): PopupLayout {
  if (W < H) {
    // Vertical: centralizado. "auto" fica entre o rosto e a legenda.
    const fontSize = Math.round(H * 0.04);
    const y = position === "top" ? 0.2 : position === "center" ? 0.5 : subtitlePosition === "bottom" ? 0.64 : 0.7;
    return {
      fontSize,
      maxCardW: Math.round(W * 0.86),
      slots: [
        { x: Math.round(W * 0.5), y: Math.round(H * y), rot: 3 },
        { x: Math.round(W * 0.5), y: Math.round(H * y), rot: -3 },
      ],
    };
  }
  const fontSize = Math.round(H * 0.052);
  if (position === "center") {
    return {
      fontSize,
      maxCardW: Math.round(W * 0.6),
      slots: [
        { x: Math.round(W * 0.5), y: Math.round(H * 0.5), rot: -3 },
        { x: Math.round(W * 0.5), y: Math.round(H * 0.5), rot: 3 },
      ],
    };
  }
  // Horizontal/quadrado: alterna os cantos de cima (ou de baixo, se a legenda estiver em cima).
  const y = position === "auto" && subtitlePosition === "top" ? 0.62 : 0.2;
  return {
    fontSize,
    maxCardW: Math.round(W * 0.4),
    slots: [
      { x: Math.round(W * 0.24), y: Math.round(H * y), rot: -3 },
      { x: Math.round(W * 0.76), y: Math.round(H * y), rot: 3 },
    ],
  };
}

export function buildPopupAss(hits: KeywordHit[], op: PopupOp, W: number, H: number, placement: PopupPlacement): string {
  const layout = popupLayout(W, H, op.position, placement.subtitlePosition);
  const header = assHeader(W, H, [
    `Style: Pop,${SUBTITLE_FONT_FAMILY},${layout.fontSize},&H00111827,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
  ]);
  return [...header, ...buildPopupEvents(hits, op, W, H, layout, placement.avoid), ""].join("\n");
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const shadowPx = (fs: number) => Math.max(3, Math.round(fs * 0.12));
const MIN_DUR = 1.2;
const MAX_DUR = 2.0;
const BASE_LAYER = 20;

const ICON_COLORS: Record<KeywordIcon, string> = {
  money: "#16A34A",
  up: "#2563EB",
  down: "#DC2626",
  alert: "#EF4444",
  check: "#16A34A",
  bolt: "#F59E0B",
  bulb: "#EAB308",
  time: "#7C3AED",
  heart: "#E11D48",
  target: "#0EA5E9",
  star: "#F59E0B",
};

/**
 * 4 eventos por destaque (camadas 20–23): cartão com sombra dura, círculo do
 * ícone, ícone e texto. Todos usam \an5 com o MESMO \pos/\org e o mesmo
 * conteúdo de linha ([círculo] + espaço + TEXTO), deixando invisível o que não
 * é daquela camada; assim tudo escala e gira junto em torno do centro.
 */
export function buildPopupEvents(
  hits: KeywordHit[],
  op: PopupOp,
  W: number,
  H: number,
  layout: PopupLayout,
  avoid?: VerticalBand,
): string[] {
  const accent = op.color;
  const darkText = "#111827";
  const accentText = luminance(accent) > 0.35 ? darkText : "#FFFFFF";
  const events: string[] = [];
  let shown = 0;
  hits.forEach((hit, idx) => {
    const next = hits[idx + 1];
    const t0 = Math.max(0, hit.start - 0.08);
    let t1 = t0 + clamp(1.2 + 0.05 * hit.text.length, MIN_DUR, MAX_DUR);
    if (next) t1 = Math.min(t1, next.start - 0.08 - 0.15);
    if (t1 - t0 < 0.6) return; // pouco tempo até o próximo: descarta
    const dur = Math.round((t1 - t0) * 1000);

    const slot = layout.slots[shown++ % layout.slots.length]!;
    const text = escapeAssText(hit.text);
    const iconOn = op.icons;
    // Diminui o corpo até o cartão caber na largura máxima.
    let fs = layout.fontSize;
    const cardWidth = (size: number) =>
      measureText(text, size) + (iconOn ? Math.round(size * 1.12) + measureText(" ", size) - Math.round(size * 0.5) * 0.25 : 0) + 2 * Math.round(size * 0.5);
    for (let tries = 0; tries < 8 && cardWidth(fs) > layout.maxCardW; tries++) fs = Math.max(8, Math.floor(fs * 0.9));
    const em = fs * EM_PER_FS;
    const S = iconOn ? Math.round(fs * 1.12) : 0;
    const cardH = Math.round(fs * 1.6);
    const cardW = Math.round(cardWidth(fs));
    const radius = Math.round(cardH * 0.32);
    // \pbo centraliza o círculo na altura das maiúsculas.
    const pbo = iconOn ? r1(S / 2 - (CAP_HEIGHT * em) / 2) : 0;
    // Distância do centro das maiúsculas ao centro (\an5) da linha.
    const A = Math.max(ASCENT * em, S - pbo);
    const D = Math.max(DESCENT * em, pbo);
    const capsOffset = (A - D) / 2 - (CAP_HEIGHT * em) / 2;

    const cx = slot.x;
    const half = cardH / 2 + Math.abs(Math.sin((slot.rot * Math.PI) / 180)) * (cardW / 2) + shadowPx(fs);
    let cy = slot.y;
    if (avoid) {
      const gap = Math.round(H * 0.025);
      if (cy + half > avoid.top - gap && cy - half < avoid.bottom + gap) {
        // Legenda na metade de baixo: sobe o cartão; senão, desce.
        cy = (avoid.top + avoid.bottom) / 2 > H / 2 ? Math.round(avoid.top - gap - half) : Math.round(avoid.bottom + gap + half);
      }
    }
    cy = Math.round(clamp(cy, half + H * 0.02, H - half - H * 0.02));
    const lineY = r1(cy - capsOffset);

    // Entrada 30% -> 112% -> 96% -> 100% (quique); saída para 70% com fade.
    const anim =
      `\\fscx30\\fscy30\\t(0,140,0.8,\\fscx112\\fscy112)\\t(140,230,\\fscx96\\fscy96)\\t(230,300,\\fscx100\\fscy100)` +
      `\\t(${Math.max(300, dur - 160)},${dur},\\fscx70\\fscy70)\\fad(90,160)`;
    const common = (y: number) => `\\an5\\pos(${cx},${y})\\org(${cx},${cy})\\frz${slot.rot}\\bord0\\shad0`;

    const light = op.theme === "light";
    const cardColor = light ? "#FFFFFF" : accent;
    const textColor = light ? darkText : accentText;
    const badgeColor = light ? ICON_COLORS[hit.icon] : accentText;
    const glyphColor = light ? "#FFFFFF" : accent;

    events.push(
      dialogue(
        t0,
        t1,
        `{${common(cy)}\\1c${tagColor(cardColor)}\\shad${shadowPx(fs)}\\4c&H000000&\\4a&H90&${anim}\\p1}${roundedRectPath(cardW, cardH, radius)}{\\p0}`,
        "Pop",
        BASE_LAYER,
      ),
    );
    const invisible = "\\alpha&HFF&";
    if (iconOn) {
      const badge = circlePath(S / 2, S / 2, S / 2);
      events.push(
        dialogue(t0, t1, `{${common(lineY)}${anim}}{\\1c${tagColor(badgeColor)}\\pbo${pbo}\\p1}${badge}{\\p0${invisible}} ${text}`, "Pop", BASE_LAYER + 1),
      );
      events.push(
        dialogue(
          t0,
          t1,
          `{${common(lineY)}${anim}}{\\1c${tagColor(glyphColor)}\\pbo${pbo}\\p1}${iconGlyphPath(hit.icon, S, S * 0.13)}{\\p0${invisible}} ${text}`,
          "Pop",
          BASE_LAYER + 2,
        ),
      );
      events.push(
        dialogue(
          t0,
          t1,
          `{${common(lineY)}${anim}}{${invisible}\\pbo${pbo}\\p1}${badge}{\\p0\\alpha&H00&\\1c${tagColor(textColor)}} ${text}`,
          "Pop",
          BASE_LAYER + 3,
        ),
      );
    } else {
      events.push(dialogue(t0, t1, `{${common(lineY)}${anim}\\1c${tagColor(textColor)}}${text}`, "Pop", BASE_LAYER + 3));
    }
  });
  return events;
}

/* Desenhos (\p1), em coordenadas absolutas a partir de (0,0). */

const K = 0.5523; // aproximação de círculo por Bézier

function circlePath(cx: number, cy: number, r: number, reverse = false): string {
  const k = r * K;
  const f = r1;
  if (reverse) {
    // Sentido anti-horário: vira "furo" dentro de outro contorno (anel).
    return (
      `m ${f(cx)} ${f(cy - r)} ` +
      `b ${f(cx - k)} ${f(cy - r)} ${f(cx - r)} ${f(cy - k)} ${f(cx - r)} ${f(cy)} ` +
      `b ${f(cx - r)} ${f(cy + k)} ${f(cx - k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} ` +
      `b ${f(cx + k)} ${f(cy + r)} ${f(cx + r)} ${f(cy + k)} ${f(cx + r)} ${f(cy)} ` +
      `b ${f(cx + r)} ${f(cy - k)} ${f(cx + k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)}`
    );
  }
  return (
    `m ${f(cx)} ${f(cy - r)} ` +
    `b ${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} ` +
    `b ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} ` +
    `b ${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} ` +
    `b ${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)}`
  );
}

export function roundedRectPath(w: number, h: number, r: number): string {
  const k = r * (1 - K);
  const f = r1;
  return (
    `m ${f(r)} 0 l ${f(w - r)} 0 b ${f(w - k)} 0 ${f(w)} ${f(k)} ${f(w)} ${f(r)} ` +
    `l ${f(w)} ${f(h - r)} b ${f(w)} ${f(h - k)} ${f(w - k)} ${f(h)} ${f(w - r)} ${f(h)} ` +
    `l ${f(r)} ${f(h)} b ${f(k)} ${f(h)} 0 ${f(h - k)} 0 ${f(h - r)} ` +
    `l 0 ${f(r)} b 0 ${f(k)} ${f(k)} 0 ${f(r)} 0`
  );
}

// Glifo "$" da Inter Bold convertido em curvas, num quadrado 100x100.
const DOLLAR_PATH =
  "m 47.3 100 l 53.7 100 l 53.7 90.4 b 70.9 89.5 80.9 80.5 80.9 67 b 80.9 53.8 70.7 47 57.4 43.9 l 53.7 43 l 53.7 23.3 b 59.9 24.2 63.8 27.6 64.3 33.1 l 79.9 33.1 b 79.6 20 69.5 10.7 53.7 9.7 l 53.7 0 l 47.3 0 l 47.3 9.7 b 32 10.9 21.2 20 21.2 33.3 b 21.2 44.8 29.1 51.5 42.5 54.7 l 47.3 55.9 l 47.3 76.7 b 40.2 75.9 35.2 72 34.8 65 l 19.1 65 b 19.5 80.7 30.3 89.5 47.3 90.4 m 53.7 76.7 l 53.7 57.6 b 60.7 59.5 64.7 62 64.7 66.9 b 64.7 72 60.4 75.8 53.7 76.7 m 47.3 41.4 b 41.9 39.7 37.7 37.2 37.7 32.2 b 37.7 27.7 41.1 24.3 47.3 23.4";

/** Contornos do ícone num quadrado 100x100 ("CIRCLE"/"HOLE cx cy r" viram círculos). */
function iconShapes(icon: KeywordIcon): string[] {
  switch (icon) {
    case "check":
      return ["m 20 52 l 31 41 l 43 53 l 70 26 l 81 37 l 43 75"];
    case "up":
      return ["m 50 16 l 82 50 l 62 50 l 62 84 l 38 84 l 38 50 l 18 50"];
    case "down":
      return ["m 50 84 l 82 50 l 62 50 l 62 16 l 38 16 l 38 50 l 18 50"];
    case "bolt":
      return ["m 58 10 l 22 56 l 46 56 l 38 90 l 78 40 l 54 40 l 64 10"];
    case "alert":
      return ["m 42 16 l 58 16 l 55 62 l 45 62", "CIRCLE 50 77 8"];
    case "time":
      return ["m 28 16 l 72 16 l 72 24 l 55 50 l 72 76 l 72 84 l 28 84 l 28 76 l 45 50 l 28 24"];
    case "heart":
      return ["m 50 84 b 14 60 12 40 18 30 b 26 16 44 16 50 32 b 56 16 74 16 82 30 b 88 40 86 60 50 84"];
    case "bulb":
      return ["CIRCLE 50 40 24", "m 39 66 l 61 66 l 61 74 l 39 74", "m 42 78 l 58 78 l 56 86 l 44 86"];
    case "target":
      return ["CIRCLE 50 50 40", "HOLE 50 50 29", "CIRCLE 50 50 19", "HOLE 50 50 9"];
    case "money":
      return [DOLLAR_PATH];
    case "star": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 42 : 18;
        pts.push(`${r1(50 + r * Math.cos(a))} ${r1(52 + r * Math.sin(a))}`);
      }
      return [`m ${pts[0]} l ${pts.slice(1).join(" l ")}`];
    }
  }
}

/** Ícone escalado para o tamanho S; "m 0 0 m S S" fixa a caixa do desenho. */
function iconGlyphPath(icon: KeywordIcon, S: number, inset: number): string {
  const scale = (S - 2 * inset) / 100;
  const tx = (v: number) => r1(inset + v * scale);
  const parts = iconShapes(icon).map((shape) => {
    if (shape.startsWith("CIRCLE") || shape.startsWith("HOLE")) {
      const [, cx, cy, r] = shape.split(" ").map(Number) as [number, number, number, number];
      return circlePath(tx(cx), tx(cy), r * scale, shape.startsWith("HOLE"));
    }
    return shape.replace(/-?\d+(\.\d+)?/g, (m) => String(tx(Number(m))));
  });
  return `m 0 0 m ${r1(S)} ${r1(S)} ${parts.join(" ")}`;
}
