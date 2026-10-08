import { Coins, Film, FolderOpen, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/states";
import { ProjectGrid } from "@/components/project/project-card";
import { Button } from "@/components/ui/button";
import { requireUserOrRedirect } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listProjects } from "@/services/projects/project-service";

export const metadata = { title: "Início" };

export default async function DashboardPage() {
  const user = await requireUserOrRedirect("/dashboard");
  const supabase = await createSupabaseServerClient();
  const [projects, { data: credits }, { count: processed }, { data: profile }, { count: projectCount }] = await Promise.all([
    listProjects(user.id, 6),
    supabase.from("credits").select("balance").maybeSingle(),
    supabase.from("renders").select("id", { count: "exact", head: true }).eq("status", "completed"),
    supabase.from("users").select("full_name").maybeSingle(),
    supabase.from("projects").select("id", { count: "exact", head: true }).neq("status", "archived"),
  ]);
  const firstName = profile?.full_name?.split(" ")[0];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-8 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Olá{firstName ? `, ${firstName}` : ""}.</p>
          <h1 className="mt-1 font-display text-4xl sm:text-5xl">O que vamos editar hoje?</h1>
        </div>
        <Button asChild size="lg" variant="accent">
          <Link href="/projects/new">
            <Plus /> Novo projeto
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Coins} label="Créditos disponíveis" value={credits?.balance ?? 0} href="/billing" />
        <Stat icon={FolderOpen} label="Projetos" value={projectCount ?? projects.length} href="/projects" />
        <Stat icon={Film} label="Vídeos processados" value={processed ?? 0} href="/library" />
      </div>

      <section>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projetos recentes</h2>
          {projects.length > 0 && (
            <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground">
              Ver todos
            </Link>
          )}
        </div>
        {projects.length ? (
          <ProjectGrid projects={projects} />
        ) : (
          <EmptyState
            icon={Sparkles}
            title="Seu primeiro vídeo está a poucos cliques"
            description="Envie um vídeo, diga o que quer mudar e a IA faz a edição."
            action={
              <Button asChild variant="accent">
                <Link href="/projects/new">🎙️ Editar com IA</Link>
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value, href }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent/40">
      <Icon className="size-4 text-accent" />
      <p className="mt-4 font-display text-4xl tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </Link>
  );
}
