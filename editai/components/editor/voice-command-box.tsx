"use client";

import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { api, ApiError, uploadToSignedUrl } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { MAX_INSTRUCTION_CHARS } from "@/config/upload";
import type { EditingCommand } from "@/types/domain";
import { AudioRecorder, type RecordedAudio } from "./audio-recorder";

type Phase = "idle" | "uploading" | "transcribing" | "error";

/**
 * COMO VOCÊ QUER SEU VÍDEO? — comando por voz ou texto.
 * Fluxo: grava → envia áudio (URL assinada) → servidor transcreve → IA planeja.
 */
export function VoiceCommandBox({
  projectId,
  baseVersionId,
  disabled,
  hasEdits,
  onPlanned,
}: {
  projectId: string;
  baseVersionId: string | null;
  disabled?: boolean;
  hasEdits: boolean;
  onPlanned: (command: EditingCommand) => void;
}) {
  const [text, setText] = useState("");
  const [audio, setAudio] = useState<RecordedAudio | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [autopilot, setAutopilot] = useState(false);
  const [recorderKey, setRecorderKey] = useState(0);
  const busy = phase === "uploading" || phase === "transcribing";

  async function submit(kind: "audio" | "text") {
    if (kind === "audio" && !audio) return;
    setError(null);
    try {
      let body: Record<string, unknown> = { mode: autopilot ? "autopilot" : "edit", baseVersionId: baseVersionId ?? undefined };
      if (kind === "audio" && audio) {
        setPhase("uploading");
        const mimeType = audio.blob.type || "audio/webm";
        const signed = await api.post<{ signedUrl: string; path: string }>(`/api/projects/${projectId}/audio-upload`, {
          mimeType,
          sizeBytes: audio.blob.size,
        });
        await uploadToSignedUrl(signed.signedUrl, audio.blob);
        body = { ...body, audioPath: signed.path, audioMimeType: mimeType, audioDuration: audio.duration, browserTranscript: audio.browserTranscript || undefined };
      } else {
        body = { ...body, text };
      }
      setPhase("transcribing");
      const { command } = await api.post<{ command: EditingCommand }>(`/api/projects/${projectId}/commands`, body);
      setText("");
      setAudio(null);
      setRecorderKey((k) => k + 1); // descarta a gravação só depois do sucesso
      setPhase("idle");
      onPlanned(command);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não conseguimos entender o comando. Tente novamente.");
      setPhase("error");
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Como você quer seu vídeo?</h2>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground" title="A IA analisa ritmo, hook, legendas, zoom e áudio e monta a versão otimizada.">
          <input type="checkbox" checked={autopilot} onChange={(e) => setAutopilot(e.target.checked)} className="accent-[var(--color-accent)]" />
          <Wand2 className="size-3.5" /> Autopilot
        </label>
      </div>

      {busy && (
        <div className="flex items-center gap-3 rounded-2xl bg-muted/60 px-5 py-6 text-sm">
          <Loader2 className="size-4 animate-spin text-accent" />
          {phase === "uploading" ? "Enviando seu áudio..." : "Ouvindo e interpretando sua instrução..."}
        </div>
      )}
      {/* Continua montado durante o envio: em caso de erro, a gravação não se perde. */}
      <div className={busy ? "hidden" : undefined}>
        <AudioRecorder
          key={recorderKey}
          onRecorded={setAudio}
          onSubmit={() => void submit("audio")}
          disabled={disabled || busy}
          primaryLabel={hasEdits ? "🎙️ ALTERAR VÍDEO" : "🎙️ Pressione para falar"}
        />
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void submit("text");
        }}
        className="flex flex-col gap-3"
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_INSTRUCTION_CHARS}
          placeholder={hasEdits ? "Ex.: agora deixe as legendas maiores e remova o zoom" : "Escreva sua instrução... Ex.: remova os silêncios e coloque legendas grandes"}
          disabled={disabled || busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void submit("text");
          }}
        />
        <Button type="submit" variant="default" size="lg" disabled={disabled || busy || !text.trim()}>
          <Sparkles /> EDITAR COM IA
        </Button>
      </form>

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
