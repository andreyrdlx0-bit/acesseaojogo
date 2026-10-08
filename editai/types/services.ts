/**
 * Contratos dos serviços externos. Toda integração (LLM, STT, storage, fila,
 * pagamento, FFmpeg) é acessada SOMENTE por estas interfaces, para que qualquer
 * fornecedor possa ser trocado sem reescrever a aplicação.
 */
import type { EditingPlan } from "@/lib/editing-plan";
import type { RejectedOperation } from "@/lib/editing-plan/validate";
import type { JobType, RenderOptions } from "./domain";
import type { Transcript, VideoMetadata } from "./video";

// ---------------------------------------------------------------- Speech-to-Text
export type AudioSource =
  | { kind: "url"; url: string; fileName?: string; mimeType?: string }
  | { kind: "buffer"; data: ArrayBuffer; fileName: string; mimeType: string };

export interface TranscribeOptions {
  language?: string;
  /** Pede timestamps por palavra (necessário para legendas e zoom por palavra). */
  wordTimestamps?: boolean;
  /** Termos que ajudam o reconhecimento (nomes, jargões). */
  prompt?: string;
}

export interface SpeechToTextProvider {
  readonly name: string;
  /** false quando o provedor real não está configurado (sem chave). */
  readonly isConfigured: boolean;
  transcribe(audio: AudioSource, options?: TranscribeOptions): Promise<Transcript>;
}

// ---------------------------------------------------------------- AI Editing Planner
export type PlannerMode = "edit" | "autopilot";

export interface VideoContext {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  silenceCount: number;
  silenceSeconds: number;
  hasTranscript: boolean;
  transcriptText: string | null;
  /** Músicas disponíveis na biblioteca do usuário (para background_music). */
  musicAssets: { id: string; name: string }[];
}

export interface EditingRequest {
  instruction: string;
  currentPlan: EditingPlan;
  video: VideoContext;
  mode: PlannerMode;
  /** Últimas trocas da conversa, para comandos como "agora deixe maior". */
  history: { instruction: string; reply: string }[];
}

export interface EditingPlanResult {
  /** Plano COMPLETO resultante (cumulativo), já validado. */
  plan: EditingPlan;
  /** Resposta conversacional em pt-BR ("Entendi. Vou..."). */
  reply: string;
  rejected: RejectedOperation[];
  provider: string;
}

export interface AIEditingPlanner {
  readonly name: string;
  readonly isConfigured: boolean;
  createEditingPlan(input: EditingRequest): Promise<EditingPlanResult>;
}

// ---------------------------------------------------------------- Video processing
export interface ProcessProgress {
  percent: number;
  stage: string;
  message: string;
}

export interface VideoProcessInput {
  /** Arquivo local do vídeo ORIGINAL (nunca re-renderizamos sobre versões). */
  sourcePath: string;
  outputPath: string;
  plan: EditingPlan;
  metadata: VideoMetadata;
  options: RenderOptions;
  /** Arquivos locais auxiliares já baixados (ex.: música). */
  assets: { musicPath?: string };
  workDir: string;
  /** Limites do ambiente (ex.: Vercel: tempo da função e tamanho máx. do upload). */
  limits?: { timeoutMs?: number; maxOutputBytes?: number };
}

export interface VideoProcessResult {
  outputPath: string;
  duration: number;
  width: number;
  height: number;
  sizeBytes: number;
  /** Operações que não puderam ser aplicadas, explicadas ao usuário. */
  warnings: string[];
}

export interface VideoProcessor {
  process(input: VideoProcessInput, onProgress?: (p: ProcessProgress) => void): Promise<VideoProcessResult>;
}

export interface VideoAnalyzer {
  analyze(localPath: string, onProgress?: (p: ProcessProgress) => void): Promise<VideoMetadata>;
}

// ---------------------------------------------------------------- Storage
export interface SignedUpload {
  path: string;
  token: string;
  signedUrl: string;
}

export interface StorageProvider {
  createSignedUploadUrl(path: string): Promise<SignedUpload>;
  /** `download`: força o navegador a baixar (Content-Disposition) com esse nome. */
  createSignedUrl(path: string, expiresInSeconds: number, opts?: { download?: string }): Promise<string>;
  createSignedUrls(paths: string[], expiresInSeconds: number): Promise<Record<string, string>>;
  exists(path: string): Promise<{ exists: boolean; sizeBytes: number | null }>;
  downloadToFile(path: string, localPath: string): Promise<void>;
  downloadBuffer(path: string): Promise<ArrayBuffer>;
  uploadFile(path: string, localPath: string, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
}

// ---------------------------------------------------------------- Queue
export interface QueuedJob<P = Record<string, unknown>> {
  id: string;
  type: JobType;
  userId: string;
  payload: P;
  attempts: number;
  maxAttempts: number;
}

export interface RenderQueue {
  enqueue(type: JobType, userId: string, payload: Record<string, unknown>, options?: { priority?: number }): Promise<string>;
  /** Com `userId`, só pega jobs daquele usuário (processamento inline na Vercel). */
  claim(workerId: string, types: JobType[], options?: { userId?: string; staleMinutes?: number }): Promise<QueuedJob | null>;
  /** Quantos jobs o usuário ainda tem na fila (para o cliente decidir se dispara de novo). */
  countQueued(userId: string): Promise<number>;
  /** Só conclui se o job ainda pertence a `workerId` (cerca contra execuções duplicadas). */
  complete(jobId: string, workerId: string): Promise<boolean>;
  fail(jobId: string, workerId: string, error: string, retry: boolean): Promise<boolean>;
  /** Renova o lock de um job em execução (sinal de vida). */
  heartbeat(jobId: string, workerId: string): Promise<void>;
}

// ---------------------------------------------------------------- Payments
export interface CheckoutSession {
  url: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  createCheckoutSession(input: {
    userId: string;
    email: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  createCreditPackCheckout(input: {
    userId: string;
    email: string;
    packId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
}
