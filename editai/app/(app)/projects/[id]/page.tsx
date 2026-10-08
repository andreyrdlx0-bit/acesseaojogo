import { notFound } from "next/navigation";
import { EditorWorkspace } from "@/components/editor/editor-workspace";
import { requireUserOrRedirect } from "@/lib/auth";
import { isAppError } from "@/lib/errors";
import { creditService } from "@/services/credits/credit-service";
import { serverEnv } from "@/config/env";
import { getUserPlan } from "@/services/projects/command-service";
import { getProjectDetail } from "@/services/projects/project-service";

export const metadata = { title: "Editor" };

export default async function ProjectEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserOrRedirect(`/projects/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    const [detail, balance, plan] = await Promise.all([
      getProjectDetail(user.id, id),
      creditService.getBalance(user.id),
      getUserPlan(user.id),
    ]);
    return (
      <EditorWorkspace
        initial={detail}
        initialBalance={balance}
        maxQuality={plan.maxQuality}
        maxMb={serverEnv().MAX_UPLOAD_MB}
        maxMinutes={plan.maxVideoMinutes}
      />
    );
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}
