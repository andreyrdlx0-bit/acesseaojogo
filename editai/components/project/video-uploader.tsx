"use client";

import { CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api, ApiError, uploadToSignedUrl } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ACCEPTED_VIDEO_EXTENSIONS, VIDEO_MIME_TYPES } from "@/config/upload";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration } from "@/utils/format";

export interface LocalVideoInfo {
  file: File;
  duration: number;
  width: number;
  height: number;
  thumbnail: string | null;
}

type Phase = "idle" | "reading" | "uploading" | "finalizing" | "done" | "error";

/** Lê metadados e gera thumbnail localmente (feedback instantâneo antes da análise no servidor). */
async function inspectVideo(file: File): Promise<LocalVideoInfo> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("invalid"));
    });
    let thumbnail: string | null = null;
    try {
      video.currentTime = Math.min(1, video.duration / 3);
      await new Promise((r) => (video.onseeked = r));
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = Math.round((480 * video.videoHeight) / Math.max(1, video.videoWidth));
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      thumbnail = canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      thumbnail = null;
    }
    return { file, duration: video.duration, width: video.videoWidth, height: video.videoHeight, thumbnail };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function VideoUploader({
  projectId,
  maxMb,
  onUploaded,
  ensureProject,
}: {
  projectId?: string;
  maxMb: number;
  /** Chamado após o upload ser confirmado no servidor. */
  onUploaded: (projectId: string, info: LocalVideoInfo) => void;
  /** Cria o projeto sob demanda (página /projects/new). */
  ensureProject: (fileName: string) => Promise<string>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [info, setInfo] = useState<LocalVideoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!(file.type in VIDEO_MIME_TYPES)) {
        setError("Formato não suportado. Envie um vídeo MP4, MOV ou WEBM.");
        setPhase("error");
        return;
      }
      if (file.size > maxMb * 1024 * 1024) {
        setError(`O vídeo deve ter no máximo ${maxMb} MB.`);
        setPhase("error");
        return;
      }
      try {
        setPhase("reading");
        const local = await inspectVideo(file).catch(() => ({ file, duration: 0, width: 0, height: 0, thumbnail: null }));
        setInfo(local);
        const id = projectId ?? (await ensureProject(file.name));
        setPhase("uploading");
        const signed = await api.post<{ signedUrl: string; path: string }>(`/api/projects/${id}/upload`, {
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        });
        await uploadToSignedUrl(signed.signedUrl, file, setProgress);
        setPhase("finalizing");
        await api.post(`/api/projects/${id}/upload/complete`, { path: signed.path });
        setPhase("done");
        onUploaded(id, local);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Não conseguimos enviar esse vídeo. Tente novamente.");
        setPhase("error");
      }
    },
    [ensureProject, maxMb, onUploaded, projectId],
  );

  const busy = phase === "reading" || phase === "uploading" || phase === "finalizing";

  return (
    <div className="flex flex-col gap-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const file = e.dataTransfer.files[0];
          if (file && !busy) void handleFile(file);
        }}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-16 text-center transition-colors",
          drag ? "border-accent bg-accent/5" : "border-border bg-card/40",
          busy && "pointer-events-none opacity-70",
        )}
      >
        <span className="grid size-14 place-items-center rounded-2xl bg-muted">
          {busy ? <Loader2 className="size-6 animate-spin text-accent" /> : <UploadCloud className="size-6 text-accent" />}
        </span>
        <p className="mt-5 text-lg font-medium">Arraste seu vídeo aqui</p>
        <p className="mt-1 text-sm text-muted-foreground">ou</p>
        <Button className="mt-3" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
          Selecionar vídeo
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">MP4, MOV ou WEBM · até {maxMb} MB</p>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_VIDEO_EXTENSIONS}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {info && (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center">
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-muted sm:w-48">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {info.thumbnail && <img src={info.thumbnail} alt="" className="size-full object-cover" />}
          </div>
          <div className="flex-1">
            <p className="line-clamp-1 font-medium">{info.file.name}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
              <div><dt className="inline">Tamanho: </dt><dd className="inline text-foreground">{formatBytes(info.file.size)}</dd></div>
              <div><dt className="inline">Duração: </dt><dd className="inline text-foreground">{formatDuration(info.duration)}</dd></div>
              <div><dt className="inline">Resolução: </dt><dd className="inline text-foreground">{info.width ? `${info.width}×${info.height}` : "—"}</dd></div>
              <div><dt className="inline">Status: </dt><dd className="inline text-foreground">{PHASE_LABEL[phase]}</dd></div>
            </dl>
            {(phase === "uploading" || phase === "finalizing") && <Progress value={phase === "finalizing" ? 100 : progress * 100} className="mt-3" />}
            {phase === "done" && (
              <p className="mt-3 flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle2 className="size-4" /> Seu vídeo está pronto para receber instruções.
              </p>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "—",
  reading: "Lendo arquivo...",
  uploading: "Enviando...",
  finalizing: "Finalizando...",
  done: "Enviado",
  error: "Erro",
};
