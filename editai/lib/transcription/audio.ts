/**
 * Extrai o áudio de um vídeo/áudio (File/Blob) NO NAVEGADOR e devolve
 * Float32Array mono 16 kHz (o formato que o Whisper espera).
 *
 * Roda na THREAD PRINCIPAL: Web Audio (OfflineAudioContext) não existe em Web Worker.
 * Depois transfira o buffer para o worker (zero-cópia).
 */
export const WHISPER_SAMPLE_RATE = 16_000;

export class AudioDecodeError extends Error {
  constructor(
    message: string,
    readonly reason: "unsupported" | "no-audio" | "decode-failed" | "too-long",
  ) {
    super(message);
    this.name = "AudioDecodeError";
  }
}

type OfflineCtor = typeof OfflineAudioContext;

function getOfflineCtor(): OfflineCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

/** decodeAudioData DESANEXA o ArrayBuffer (mesmo quando falha): leia o Blob de novo a cada tentativa. */
async function decodeAt(Ctor: OfflineCtor, file: Blob, sampleRate: number): Promise<AudioBuffer> {
  const ctx = new Ctor(1, 1, sampleRate); // pode lançar NotSupportedError (Safari antigo com 16 kHz)
  const bytes = await file.arrayBuffer();
  return await ctx.decodeAudioData(bytes);
}

function downmix(buffer: AudioBuffer): Float32Array {
  const n = buffer.numberOfChannels;
  if (n === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < n; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / n;
  }
  return out;
}

async function resampleTo16k(Ctor: OfflineCtor, decoded: AudioBuffer): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE));
  const ctx = new Ctor(1, length, WHISPER_SAMPLE_RATE); // mono: Web Audio faz o downmix (L+R)/2
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

export async function decodeToMono16k(
  file: Blob,
  { maxSeconds = 15 * 60, signal }: { maxSeconds?: number; signal?: AbortSignal } = {},
): Promise<Float32Array> {
  const Ctor = getOfflineCtor();
  if (!Ctor) throw new AudioDecodeError("Este navegador não tem Web Audio.", "unsupported");
  if (file.size === 0) throw new AudioDecodeError("Arquivo vazio.", "no-audio");

  let decoded: AudioBuffer | null = null;
  let lastError: unknown = null;
  // 1) decodifica direto em 16 kHz (o navegador reamostra; usa ~1/3 da memória de 48 kHz)
  // 2) se o navegador recusar 16 kHz no contexto, decodifica em 44,1 kHz e reamostra renderizando
  for (const rate of [WHISPER_SAMPLE_RATE, 44_100]) {
    signal?.throwIfAborted();
    try {
      decoded = await decodeAt(Ctor, file, rate);
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof DOMException && err.name === "EncodingError") break; // codec/contêiner: não adianta repetir
    }
  }
  signal?.throwIfAborted();
  if (!decoded) {
    const name = lastError instanceof DOMException ? lastError.name : "Error";
    throw new AudioDecodeError(
      `O navegador não conseguiu ler o áudio deste arquivo (${name}). Vídeo sem faixa de áudio ou codec não suportado.`,
      "decode-failed",
    );
  }
  if (decoded.duration <= 0 || decoded.length === 0) throw new AudioDecodeError("O vídeo não tem áudio.", "no-audio");
  if (decoded.duration > maxSeconds) throw new AudioDecodeError("Vídeo longo demais para transcrever no navegador.", "too-long");

  return decoded.sampleRate === WHISPER_SAMPLE_RATE ? downmix(decoded) : await resampleTo16k(Ctor, decoded);
}
