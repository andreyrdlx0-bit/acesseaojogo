import { Bot, Mic, Type } from "lucide-react";
import type { EditingCommand, ProjectVersion } from "@/types/domain";
import { formatRelative } from "@/utils/format";

const RESULT: Record<EditingCommand["status"], string> = {
  planned: "Aguardando sua confirmação.",
  confirmed: "Editando...",
  rendered: "Pronto. Criei uma nova versão.",
  failed: "Não consegui concluir essa edição. Seus créditos foram devolvidos.",
  discarded: "Descartado.",
};

/** Histórico conversacional: você fala, a IA responde, cada edição vira versão. */
export function EditingCommandHistory({ commands, versions }: { commands: EditingCommand[]; versions: ProjectVersion[] }) {
  const visible = commands.filter((c) => c.status !== "discarded");
  if (!visible.length) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Seu histórico de comandos aparece aqui. Comece dizendo o que quer mudar.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-5">
      {visible.map((c) => {
        const version = versions.find((v) => v.id === c.result_version_id);
        return (
          <li key={c.id} className="flex flex-col gap-2">
            <div className="ml-8 flex items-start gap-2 self-end rounded-2xl rounded-tr-sm bg-muted px-4 py-2.5 text-sm">
              {c.audio_url ? <Mic className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <Type className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              <span>{c.instruction_text}</span>
            </div>
            <div className="mr-8 flex items-start gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
                <Bot className="size-3.5" />
              </span>
              <div className="text-sm">
                <p>{c.assistant_reply}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {RESULT[c.status]}
                  {version && c.status === "rendered" && ` (Versão ${version.version_number})`} · {formatRelative(c.created_at)}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
