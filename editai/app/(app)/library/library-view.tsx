"use client";

import { Download, Film, Loader2, Music, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, uploadToSignedUrl } from "@/api/client";
import { EmptyState, ErrorState, LoadingState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import type { MediaAsset } from "@/types/domain";
import { formatBytes, formatDate, formatDuration } from "@/utils/format";

type Asset = MediaAsset & { signed_url: string | null };

export function LibraryView() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { assets } = await api.get<{ assets: Asset[] }>("/api/library");
      setAssets(assets);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível carregar a biblioteca.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadMusic(file: File) {
    setUploading(true);
    setError(null);
    try {
      const signed = await api.post<{ signedUrl: string; path: string }>("/api/library", { fileName: file.name, mimeType: file.type, sizeBytes: file.size });
      await uploadToSignedUrl(signed.signedUrl, file);
      await api.post("/api/library/complete", { path: signed.path, fileName: file.name, mimeType: file.type });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao enviar a música.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    await api.delete(`/api/library/${id}`).catch(() => undefined);
    setAssets((a) => a?.filter((x) => x.id !== id) ?? null);
  }

  const music = assets?.filter((a) => a.kind === "music") ?? [];
  const videos = assets?.filter((a) => a.kind !== "music") ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-8 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Biblioteca</h1>
          <p className="mt-2 text-muted-foreground">Suas músicas de fundo e vídeos exportados.</p>
        </div>
        <Button variant="outline" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Enviar música
        </Button>
        <input
          ref={input}
          type="file"
          accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadMusic(f);
            e.target.value = "";
          }}
        />
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!assets && !error && <LoadingState />}
      {assets && (
        <>
          <section>
            <h2 className="mb-4 flex items-center gap-2 font-semibold">
              <Music className="size-4 text-accent" /> Músicas
            </h2>
            {music.length ? (
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {music.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <span className="flex-1 truncate text-sm">{m.file_name ?? "Música"}</span>
                    {m.signed_url && <audio src={m.signed_url} controls className="h-8 max-w-64" />}
                    <Button variant="ghost" size="icon" aria-label="Remover música" onClick={() => remove(m.id)}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Music} title="Nenhuma música" description="Envie uma faixa e peça “coloque uma música de fundo” no editor." />
            )}
          </section>
          <section>
            <h2 className="mb-4 flex items-center gap-2 font-semibold">
              <Film className="size-4 text-accent" /> Vídeos gerados
            </h2>
            {videos.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {videos.map((v) => (
                  <div key={v.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                    {v.signed_url && <video src={v.signed_url} preload="metadata" controls className="aspect-video w-full bg-black" />}
                    <div className="flex items-center justify-between p-3 text-xs text-muted-foreground">
                      <span>
                        {v.kind === "export" ? "Exportação" : "Versão"} · {formatDuration(v.duration_seconds)} · {formatBytes(v.size_bytes)}
                        <br />
                        {formatDate(v.created_at)}
                      </span>
                      {v.signed_url && (
                        <Button asChild variant="ghost" size="icon" aria-label="Baixar">
                          <a href={v.signed_url} download>
                            <Download />
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Film} title="Nenhum vídeo gerado ainda" />
            )}
          </section>
        </>
      )}
    </div>
  );
}
