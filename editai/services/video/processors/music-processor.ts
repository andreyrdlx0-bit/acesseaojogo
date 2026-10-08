import { findOperation } from "@/lib/editing-plan/validate";
import type { OperationProcessor } from "./types";

/** Música de fundo com ducking automático sob a voz. */
export const MusicProcessor: OperationProcessor = {
  name: "MusicProcessor",
  handles: ["background_music"],
  apply(ctx) {
    const op = findOperation(ctx.plan, "background_music");
    if (!op) return;
    if (!ctx.assets.musicPath) {
      ctx.warnings.push("Para música de fundo, envie uma faixa para a sua Biblioteca. Nenhuma música foi aplicada.");
      return;
    }
    ctx.graph.extraInputs.push(["-stream_loop", "-1", "-i", ctx.assets.musicPath]);
    ctx.graph.music = { inputIndex: ctx.graph.extraInputs.length, volumeDb: op.volumeDb };
  },
};
