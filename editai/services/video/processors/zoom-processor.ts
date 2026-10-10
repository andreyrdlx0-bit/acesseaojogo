import { findOperations } from "@/lib/editing-plan/validate";
import type { TimeRange } from "@/types/video";
import { normalizeText } from "@/utils/text";
import { normalizeRanges } from "../ranges";
import { sourceToOutput } from "../timeline";
import { missingTranscriptWarning } from "./subtitle-processor";
import { even, type OperationProcessor, type ProcessorContext } from "./types";

const RAMP = 0.25; // segundos de entrada/saída suave do zoom

/**
 * Zoom (punch-in) em momentos do vídeo final:
 * - keyword: quando uma palavra é dita (requer transcrição com timestamps);
 * - emphasis: no início das frases, ou a cada N segundos sem transcrição;
 * - timestamps: instantes explícitos (em segundos do original).
 */
export const ZoomProcessor: OperationProcessor = {
  name: "ZoomProcessor",
  handles: ["zoom"],
  apply(ctx) {
    const ops = findOperations(ctx.plan, "zoom");
    if (!ops.length) return;
    const windows: { range: TimeRange; scale: number }[] = [];

    for (const op of ops) {
      const dur = op.durationMs / 1000;
      const starts: number[] = [];
      if (op.trigger.kind === "keyword") {
        if (!ctx.words.length) {
          ctx.warnings.push(missingTranscriptWarning(ctx, "O zoom por palavra precisa"));
          continue;
        }
        const keys = op.trigger.keywords.map(normalizeText).filter(Boolean);
        for (const w of ctx.words) {
          const n = normalizeText(w.word);
          if (keys.some((k) => n === k || (k.length >= 4 && n.startsWith(k)))) starts.push(w.start);
        }
        if (!starts.length) ctx.warnings.push(`Não encontramos “${op.trigger.keywords.join(", ")}” na fala do vídeo.`);
      } else if (op.trigger.kind === "emphasis") {
        starts.push(...emphasisMoments(ctx, op.trigger.everySeconds));
      } else {
        for (const r of op.trigger.ranges) {
          const s = sourceToOutput(ctx.timeline, r.start);
          if (s !== null) starts.push(s);
        }
      }
      for (const s of starts) windows.push({ range: { start: Math.max(0, s - 0.05), end: s + dur }, scale: op.scale });
    }
    if (!windows.length) return;

    // Evita sobreposição: une janelas próximas (usa a maior escala).
    const merged = normalizeRanges(windows.map((w) => w.range)).map((range) => ({
      range,
      scale: Math.max(...windows.filter((w) => w.range.start < range.end && w.range.end > range.start).map((w) => w.scale)),
    }));
    const terms = merged
      .slice(0, 300)
      .map(({ range: { start, end }, scale }) => {
        const a = start.toFixed(3);
        const b = end.toFixed(3);
        return `(${(scale - 1).toFixed(3)})*max(0\\,min(1\\,min((it-${a})/${RAMP}\\,(${b}-it)/${RAMP})))`;
      })
      .join("+");
    const { width, height } = ctx.frame;
    const w = even(width);
    const h = even(height);
    ctx.graph.video.push(
      `zoompan=z='1+${terms}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${ctx.fps}`,
    );
    ctx.frame = { width: w, height: h };
  },
};

function emphasisMoments(ctx: ProcessorContext, every: number): number[] {
  const out: number[] = [];
  const segments = ctx.metadata.transcript?.segments ?? [];
  let last = -Infinity;
  for (const seg of segments) {
    const t = sourceToOutput(ctx.timeline, seg.start + 0.05);
    if (t !== null && t - last >= every) {
      out.push(t);
      last = t;
    }
  }
  if (!out.length) for (let t = every / 2; t < ctx.timeline.outputDuration - 1; t += every) out.push(t);
  return out;
}
