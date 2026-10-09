import { FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { RefreshOnHistoryNavigation } from "@/components/app/refresh-on-history-navigation";
import { EmptyState } from "@/components/app/states";
import { ProjectGrid } from "@/components/project/project-card";
import { Button } from "@/components/ui/button";
import { requireUserOrRedirect } from "@/lib/auth";
import { listProjects } from "@/services/projects/project-service";

export const metadata = { title: "Meus projetos" };

export default async function ProjectsPage() {
  const user = await requireUserOrRedirect("/projects");
  const projects = await listProjects(user.id, 100);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-8 lg:px-8">
      <RefreshOnHistoryNavigation />
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-4xl">Meus projetos</h1>
        <Button asChild variant="accent">
          <Link href="/projects/new">
            <Plus /> Novo projeto
          </Link>
        </Button>
      </div>
      {projects.length ? (
        <ProjectGrid projects={projects} />
      ) : (
        <EmptyState icon={FolderOpen} title="Nenhum projeto ainda" description="Crie um projeto enviando seu primeiro vídeo." />
      )}
    </div>
  );
}
