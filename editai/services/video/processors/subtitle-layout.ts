import type { TranscriptWord } from "@/types/video";

/** Altura da fonte da legenda como fração da altura do vídeo. */
export const SUBTITLE_SIZE_FACTOR = { small: 0.035, medium: 0.045, large: 0.06, xl: 0.078 } as const;

/** Faixa vertical (px) ocupada pela legenda, para outros elementos desviarem dela. */
export interface VerticalBand {
  top: number;
  bottom: number;
}

/**
 * Agrupa as palavras em blocos de legenda: no máximo `max` palavras, quebrando
 * em pausas (> 0,6 s) e em fim de frase.
 */
export function chunkWords(words: TranscriptWord[], max: number): TranscriptWord[][] {
  const chunks: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];
  for (const w of words) {
    const prev = current[current.length - 1];
    const gap = prev ? w.start - prev.end : 0;
    const endsSentence = prev ? /[.!?]$/.test(prev.word) : false;
    if (current.length >= max || gap > 0.6 || endsSentence) {
      if (current.length) chunks.push(current);
      current = [];
    }
    current.push(w);
  }
  if (current.length) chunks.push(current);
  return chunks;
}
