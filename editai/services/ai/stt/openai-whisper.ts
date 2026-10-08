import type { AudioSource, SpeechToTextProvider, TranscribeOptions } from "@/types/services";
import type { Transcript } from "@/types/video";

interface WhisperVerbose {
  text: string;
  language?: string;
  words?: { word: string; start: number; end: number }[];
  segments?: { start: number; end: number; text: string }[];
}

/** Speech-to-Text real via API de transcrição da OpenAI (Whisper). */
export class OpenAIWhisperProvider implements SpeechToTextProvider {
  readonly name = "openai-whisper";
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly defaultLanguage: string,
  ) {}

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  async transcribe(audio: AudioSource, options: TranscribeOptions = {}): Promise<Transcript> {
    if (!this.apiKey) throw new Error("SPEECH_TO_TEXT_API_KEY não configurada");
    const { data, fileName, mimeType } = await toBuffer(audio);

    const form = new FormData();
    form.append("file", new Blob([data], { type: mimeType }), fileName);
    form.append("model", this.model);
    form.append("response_format", "verbose_json");
    form.append("language", options.language ?? this.defaultLanguage);
    if (options.prompt) form.append("prompt", options.prompt.slice(0, 800));
    if (options.wordTimestamps) {
      form.append("timestamp_granularities[]", "word");
      form.append("timestamp_granularities[]", "segment");
    }

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!res.ok) throw new Error(`STT falhou: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as WhisperVerbose;
    return {
      text: json.text.trim(),
      language: json.language ?? null,
      words: (json.words ?? []).map((w) => ({ word: w.word.trim(), start: w.start, end: w.end })),
      segments: (json.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })),
      source: "stt",
      provider: this.name,
    };
  }
}

async function toBuffer(audio: AudioSource): Promise<{ data: ArrayBuffer; fileName: string; mimeType: string }> {
  if (audio.kind === "buffer") return audio;
  const res = await fetch(audio.url);
  if (!res.ok) throw new Error(`Não foi possível baixar o áudio (HTTP ${res.status})`);
  return {
    data: await res.arrayBuffer(),
    fileName: audio.fileName ?? "audio.webm",
    mimeType: audio.mimeType ?? res.headers.get("content-type") ?? "audio/webm",
  };
}
