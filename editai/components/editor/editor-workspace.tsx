"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import { kickJobs } from "@/api/job-runner";
import { ErrorState } from "@/components/app/states";
import { ProjectStatusBadge } from "@/components/project/status-badge";
import { VideoUploader } from "@/components/project/video-uploader";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/hooks/use-polling";
import { describePlan } from "@/lib/editing-plan";
import type { ProjectDetail } from "@/services/projects/project-service";
import type { EditingCommand, ExportQuality, Render } from "@/types/domain";
import { formatBytes, formatDuration } from "@/utils/format";
import { EditingCommandHistory } from "./editing-command-history";
import { ExportModal } from "./export-modal";
import { AIProcessingStatus, RenderProgress } from "./render-progress";
import { Timeline } from "./timeline";
import { TranscriptViewer } from "./transcript-viewer";
import { VersionList } from "./version-list";
import { VideoPreview } from "./video-preview";
import { VoiceCommandBox } from "./voice-command-box";

/**
 * Editor: preview + timeline + conversa com a IA + versões + exportação.
 * Faz polling enquanto há análise ou renderização em andamento.
 */
export function EditorWorkspace({
  initial,
  initialBalance,
  maxQuality,
  maxMb,
  maxMinutes,
}: {
  initial: ProjectDetail;
  initialBalance: number;
  maxQuality: ExportQuality;
  maxMb: number;
  maxMinutes: number;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [balance, setBalance] = useState(initialBalance);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(initial.project.current_version_id);
  const [pendingCommand, setPendingCommand] = useState<EditingCommand | null>(
    initial.commands.filter((c) => c.status === "planned").at(-1) ?? null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const { project, metadata, versions, commands, renders } = detail;

  const activeRender = renders.find((r) => r.kind === "edit" && (r.status === "queued" || r.status === "processing"));
  const lastEditRender = renders.find((r) => r.kind === "edit");
  const analyzing = project.status === "analyzing" || metadata?.analysis_status === "pending" || metadata?.analysis_status === "processing";

  const refresh = useCallback(async () => {
    try {
      const [next, credits] = await Promise.all([
        api.get<ProjectDetail>(`/api/projects/${project.id}`),
        api.get<{ balance: number }>("/api/credits"),
      ]);
      setDetail((prev) => {
        // Quando um render termina, a nova versão vira a selecionada.
        if (next.project.current_version_id !== prev.project.current_version_id) setSelectedVersionId(next.project.current_version_id);
        return keepSignedUrls(prev, next);
      });
      setBalance(credits.balance);
      setLoadError(null);
    } catch {
      setLoadError("Não foi possível atualizar o projeto.");
    }
  }, [project.id]);

  // Qualquer render pendente (edição ou exportação) mantém o processamento vivo.
  const hasPendingWork = renders.some((r) => r.status === "queued" || r.status === "processing") || analyzing;

  // Saldo do cabeçalho (layout) acompanha cobranças e reembolsos.
  const hadActiveRender = useRef(Boolean(activeRender));
  useEffect(() => {
    if (hadActiveRender.current && !activeRender) router.refresh();
    hadActiveRender.current = Boolean(activeRender);
  }, [activeRender, router]);
  const lastKick = useRef(0);
  const kick = useCallback(() => {
    lastKick.current = Date.now();
    void kickJobs();
  }, []);

  // Sem worker dedicado (Vercel), o processamento é disparado pelo navegador.
  useEffect(() => {
    if (hasPendingWork) kick();
  }, [hasPendingWork, activeRender?.id, kick]);

  usePolling(
    async () => {
      await refresh();
      if (Date.now() - lastKick.current > 15_000) kick();
    },
    2000,
    hasPendingWork,
  );

  const selected = versions.find((v) => v.id === selectedVersionId) ?? versions.find((v) => v.id === project.current_version_id) ?? null;
  const hasEdits = versions.some((v) => v.version_number > 1 && v.status === "ready");
  const appliedOps = useMemo(() => (selected ? describePlan(selected.editing_plan) : []), [selected]);

  async function selectVersion(id: string) {
    setSelectedVersionId(id);
    // A versão escolhida passa a ser a base dos próximos comandos.
    await api.post(`/api/projects/${project.id}/versions/${id}`).catch(() => undefined);
    setDetail((d) => ({ ...d, project: { ...d.project, current_version_id: id } }));
  }

  async function rename() {
    const name = window.prompt("Nome do projeto", project.name)?.trim();
    if (!name || name === project.name) return;
    await api.patch(`/api/projects/${project.id}`, { name }).catch(() => undefined);
    setDetail((d) => ({ ...d, project: { ...d.project, name } }));
  }

  function onRenderStarted(render: Render) {
    setPendingCommand(null);
    setDetail((d) => ({ ...d, renders: [{ ...render, signed_url: null }, ...d.renders], project: { ...d.project, status: "processing" } }));
    void refresh();
    router.refresh();
  }

  async function deleteProject() {
    await api.delete(`/api/projects/${project.id}`).catch(() => undefined);
    router.push("/projects");
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-xl font-semibold sm:text-2xl">{project.name}</h1>
          <button onClick={rename} className="text-muted-foreground hover:text-foreground" aria-label="Renomear projeto">
            <Pencil className="size-4" />
          </button>
          <ProjectStatusBadge status={project.status} />
        </div>
        <ExportModal
          projectId={project.id}
          version={selected}
          sourceDuration={metadata?.metadata?.duration ?? 0}
          maxQuality={maxQuality}
          balance={balance}
          onCreditsChanged={() => {
            void refresh();
            router.refresh();
          }}
        />
      </div>

      {loadError && <ErrorState message={loadError} onRetry={refresh} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          <VideoPreview
            videoKey={selected?.id}
            src={selected?.status === "ready" ? (versions.find((v) => v.id === selected.id)?.signed_url ?? null) : null}
            poster={detail.thumbnailUrl}
            label={selected ? `Versão ${selected.version_number}${selected.version_number === 1 ? " · original" : ""}` : undefined}
          />
          {activeRender && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <RenderProgress render={activeRender} />
            </div>
          )}
          {!activeRender && lastEditRender?.status === "completed" && lastEditRender.warnings.length > 0 && lastEditRender.version_id === selected?.id && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
              <p className="font-medium">Observações da última edição</p>
              <ul className="mt-2 list-inside list-disc text-amber-200/80">
                {lastEditRender.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {selected && metadata?.metadata && <Timeline metadata={metadata.metadata} plan={selected.editing_plan} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Comandos aplicados</p>
              {appliedOps.length ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {appliedOps.map((o) => (
                    <li key={o} className="rounded-full bg-muted px-3 py-1 text-xs">
                      {o}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Vídeo original, sem edições.</p>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Vídeo</p>
              <dl className="mt-3 grid grid-cols-2 gap-y-1.5">
                <dt className="text-muted-foreground">Duração</dt>
                <dd>{formatDuration(selected?.duration ?? metadata?.metadata?.duration)}</dd>
                <dt className="text-muted-foreground">Resolução</dt>
                <dd>{selected?.width ? `${selected.width}×${selected.height}` : "—"}</dd>
                <dt className="text-muted-foreground">FPS</dt>
                <dd>{metadata?.metadata?.fps ?? "—"}</dd>
                <dt className="text-muted-foreground">Tamanho</dt>
                <dd>{formatBytes(selected?.size_bytes)}</dd>
              </dl>
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Histórico de versões</p>
            <VersionList versions={versions} selectedId={selected?.id ?? null} currentId={project.current_version_id} onSelect={selectVersion} />
          </div>
        </div>

        <aside className="flex flex-col gap-5 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
          {!project.original_video_url ? (
            <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Envie o vídeo deste projeto</h2>
              <VideoUploader
                projectId={project.id}
                maxMb={maxMb}
                maxMinutes={maxMinutes}
                ensureProject={async () => project.id}
                onUploaded={() => void refresh()}
              />
            </section>
          ) : analyzing ? (
            <AIProcessingStatus title="Analisando vídeo..." description="Medindo duração, áudio, silêncios e fala. Em instantes você poderá dar instruções." />
          ) : project.status === "failed" || metadata?.analysis_status === "failed" ? (
            <div className="flex flex-col gap-3">
              <ErrorState message={metadata?.analysis_error ?? "Não conseguimos processar esse vídeo. Verifique o formato ou tente novamente."} />
              <Button variant="outline" onClick={deleteProject}>
                <Trash2 /> Excluir projeto e enviar outro vídeo
              </Button>
            </div>
          ) : pendingCommand ? (
            <TranscriptViewer
              command={pendingCommand}
              balance={balance}
              basePlan={versions.find((v) => v.id === pendingCommand.base_version_id)?.editing_plan ?? null}
              onConfirmed={onRenderStarted}
              onDiscarded={() => {
                setPendingCommand(null);
                void refresh();
              }}
            />
          ) : (
            <VoiceCommandBox
              projectId={project.id}
              baseVersionId={selected?.id ?? null}
              disabled={Boolean(activeRender)}
              hasEdits={hasEdits}
              onPlanned={(c) => {
                setPendingCommand(c);
                setDetail((d) => ({ ...d, commands: [...d.commands, c] }));
              }}
            />
          )}
          {!analyzing && metadata?.metadata && !metadata.metadata.transcript && metadata.metadata.hasAudio && (
            <p className="rounded-2xl border border-border px-4 py-3 text-xs text-muted-foreground">
              Este vídeo não foi transcrito (nenhum provedor de Speech-to-Text configurado no servidor). Cortes, velocidade, áudio, formato e cor
              funcionam; legendas e zoom por palavra precisam da transcrição.
            </p>
          )}
          <div className="rounded-3xl border border-border bg-card p-5">
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">Conversa</p>
            <EditingCommandHistory commands={commands} versions={versions} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Mantém as URLs assinadas já carregadas enquanto o arquivo não muda: evita que
 * o player reinicie a cada atualização (cada URL nova recarrega o vídeo).
 * As URLs valem 1h; após ~50min usamos as novas.
 */
const signedAt = { current: Date.now() };
function keepSignedUrls(prev: ProjectDetail, next: ProjectDetail): ProjectDetail {
  if (Date.now() - signedAt.current > 50 * 60_000) {
    signedAt.current = Date.now();
    return next;
  }
  const byPath = new Map(prev.versions.map((v) => [v.video_url, v.signed_url]));
  const renderByPath = new Map(prev.renders.map((r) => [r.output_url, r.signed_url]));
  return {
    ...next,
    versions: next.versions.map((v) => {
      const old = v.video_url ? byPath.get(v.video_url) : null;
      return old ? { ...v, signed_url: old } : v;
    }),
    renders: next.renders.map((r) => {
      const old = r.output_url ? renderByPath.get(r.output_url) : null;
      return old ? { ...r, signed_url: old } : r;
    }),
    originalUrl: prev.project.original_video_url === next.project.original_video_url && prev.originalUrl ? prev.originalUrl : next.originalUrl,
    thumbnailUrl: prev.project.thumbnail_url === next.project.thumbnail_url && prev.thumbnailUrl ? prev.thumbnailUrl : next.thumbnailUrl,
  };
}
