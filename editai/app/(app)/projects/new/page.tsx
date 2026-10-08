import { serverEnv } from "@/config/env";
import { requireUserOrRedirect } from "@/lib/auth";
import { getUserPlan } from "@/services/projects/command-service";
import { NewProjectFlow } from "./new-project-flow";

export const metadata = { title: "Novo projeto" };

export default async function NewProjectPage() {
  const user = await requireUserOrRedirect("/projects/new");
  const plan = await getUserPlan(user.id);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-10 lg:px-8">
      <div>
        <p className="text-xs uppercase tracking-[0.25em] text-accent">Passo 1 de 3</p>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">Envie seu vídeo</h1>
        <p className="mt-3 text-muted-foreground">Depois é só falar o que você quer. A IA cuida do resto.</p>
      </div>
      <NewProjectFlow maxMb={serverEnv().MAX_UPLOAD_MB} maxMinutes={plan.maxVideoMinutes} />
    </div>
  );
}
