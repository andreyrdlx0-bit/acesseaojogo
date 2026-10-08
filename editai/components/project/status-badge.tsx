import { Badge } from "@/components/ui/badge";
import type { ProjectStatus } from "@/types/domain";

const MAP: Record<ProjectStatus, { label: string; variant: "default" | "accent" | "success" | "warning" | "danger" | "outline" }> = {
  draft: { label: "Rascunho", variant: "outline" },
  uploading: { label: "Enviando", variant: "warning" },
  analyzing: { label: "Analisando", variant: "warning" },
  ready: { label: "Pronto", variant: "success" },
  processing: { label: "Editando", variant: "accent" },
  failed: { label: "Falhou", variant: "danger" },
  archived: { label: "Arquivado", variant: "outline" },
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const s = MAP[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
