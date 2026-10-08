export interface TimeRange {
  start: number;
  end: number;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  language: string | null;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  /** Quem gerou: provedor de STT no servidor, navegador ou texto digitado. */
  source: "stt" | "browser" | "text";
  provider: string;
}

/** Resultado da análise do vídeo (ffprobe + silencedetect + transcrição). */
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  sizeBytes: number | null;
  rotation: number;
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  silences: TimeRange[];
  speech: TimeRange[];
  suggestedCuts: TimeRange[];
  transcript: Transcript | null;
}

export type AnalysisStatus = "pending" | "processing" | "completed" | "failed";
