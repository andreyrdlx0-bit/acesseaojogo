import { Film } from "lucide-react";
import Link from "next/link";
import type { ProjectSummary } from "@/services/projects/project-service";
import { formatDate, formatDuration } from "@/utils/format";
import { ProjectStatusBadge } from "./status-badge";

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-accent/40"
    >
      <div className="relative aspect-video overflow-hidden bg-muted">
        {project.thumbnail_signed_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.thumbnail_signed_url} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Film className="size-6" />
          </div>
        )}
        <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px]">{formatDuration(project.duration)}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-1 font-medium">{project.name}</h3>
          <ProjectStatusBadge status={project.status} />
        </div>
        <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatDate(project.updated_at)}</span>
          {project.latest_version_number && <span>Versão {project.latest_version_number}</span>}
        </div>
      </div>
    </Link>
  );
}

export function ProjectGrid({ projects }: { projects: ProjectSummary[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}
