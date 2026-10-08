import { serverEnv } from "@/config/env";
import type { SpeechToTextProvider } from "@/types/services";
import { OpenAIWhisperProvider } from "./openai-whisper";
import { UnconfiguredSpeechToText } from "./unconfigured";

let instance: SpeechToTextProvider | null = null;

export function getSpeechToText(): SpeechToTextProvider {
  if (instance) return instance;
  const env = serverEnv();
  instance =
    env.STT_PROVIDER === "openai" && env.SPEECH_TO_TEXT_API_KEY
      ? new OpenAIWhisperProvider(env.SPEECH_TO_TEXT_API_KEY, env.STT_MODEL, env.STT_LANGUAGE)
      : new UnconfiguredSpeechToText();
  return instance;
}
