import { escapeFilterValue } from "../ffmpeg";
import { resolveFontsDir } from "../fonts";

/** Utilitários do formato ASS (libass) compartilhados por legendas e textos. */

/** #RRGGBB -> &H00BBGGRR */
export function assColor(hex: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}`.toUpperCase();
}

export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/**
 * Remove tudo que o libass interpretaria como comando ({\tags}, \N, \h).
 * Texto vindo do usuário/LLM vira sempre texto puro.
 */
export function escapeAssText(text: string): string {
  return text.replace(/[\\{}]/g, "").replace(/[\r\n]+/g, " ");
}

export function assHeader(width: number, height: number, styles: string[]): string[] {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
}

export function dialogue(start: number, end: number, text: string, style = "Default", layer = 0): string {
  return `Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`;
}

/** Filtro `ass` com o diretório de fontes empacotado. */
export function assFilter(file: string): string {
  const fontsDir = resolveFontsDir();
  return `ass=filename='${escapeFilterValue(file)}'${fontsDir ? `:fontsdir='${escapeFilterValue(fontsDir)}'` : ""}`;
}
