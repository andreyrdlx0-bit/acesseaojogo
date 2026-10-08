import type { SpeechToTextProvider } from "@/types/services";
import type { Transcript } from "@/types/video";

/**
 * Provedor usado quando nenhum STT de servidor está configurado.
 * NÃO inventa transcrição: lança erro explícito. A rota de comandos usa então
 * a transcrição feita pelo navegador (Web Speech API), marcada como "browser".
 * TODO: CONNECT_REAL_PROVIDER — defina STT_PROVIDER=openai + SPEECH_TO_TEXT_API_KEY.
 */
export class UnconfiguredSpeechToText implements SpeechToTextProvider {
  readonly name = "none";
  readonly isConfigured = false;
  async transcribe(): Promise<Transcript> {
    throw new Error("Nenhum provedor de Speech-to-Text configurado no servidor");
  }
}
