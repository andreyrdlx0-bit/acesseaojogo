import { existsSync } from "node:fs";

const CANDIDATES = [
  "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
  "/usr/share/fonts/truetype/inter/Inter-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
];

/** Fonte usada por drawtext. Configure FONT_PATH em produção (Docker). */
export function resolveFontFile(): string | null {
  const configured = process.env.FONT_PATH;
  if (configured && existsSync(configured)) return configured;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/** Nome da família para libass (via fontconfig). */
export const SUBTITLE_FONT_FAMILY = process.env.SUBTITLE_FONT_FAMILY || "Inter";
