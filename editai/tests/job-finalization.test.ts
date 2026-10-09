import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finalização de jobs com o banco instável: reembolso nunca espera a limpeza,
 * passos finais são refeitos na nova tentativa (sem renderizar de novo), uma
 * edição pronta nunca é reembolsada, análise concluída nunca vira falha e a
 * autocorreção ao abrir o projeto conclui o que ficou pela metade.
 * Supabase e fila são falsos (em memória), com injeção de erro.
 */
type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** tabela -> quantas operações (update/select) devolvem erro */
  updateErrors: {} as Record<string, number>,
  selectErrors: {} as Record<string, number>,
  /** falha updates específicos (ex.: o que grava status "completed") */
  failUpdate: null as null | ((table: string, payload: Row) => boolean),
  grantErrors: 0,
  engine: "fail" as "fail" | "ok",
  renders: 0,
  /** atraso por consulta (ms): deixa execuções concorrentes se intercalarem */
  delayMs: 0,
}));

const fakeDb = vi.hoisted(() => {
  class Query {
    private filters: ((r: Row) => boolean)[] = [];
    private op: "select" | "update" = "select";
    private payload: Row = {};
    private mode: "many" | "single" | "maybe" = "many";
    private head = false;
    constructor(private readonly table: string) {}
    select(_cols?: string, opts?: { head?: boolean }) {
      this.head = Boolean(opts?.head);
      return this;
    }
    update(payload: Row) {
      this.op = "update";
      this.payload = payload;
      return this;
    }
    upsert() {
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push((r) => r[column] === value);
      return this;
    }
    neq(column: string, value: unknown) {
      this.filters.push((r) => r[column] !== value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push((r) => values.includes(r[column]));
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    single() {
      this.mode = "single";
      return this;
    }
    maybeSingle() {
      this.mode = "maybe";
      return this;
    }
    private run() {
      const rows = (db.tables[this.table] ??= []);
      const match = rows.filter((r) => this.filters.every((f) => f(r)));
      const errors = this.op === "update" ? db.updateErrors : db.selectErrors;
      const pending = errors[this.table] ?? 0;
      const injected = this.op === "update" && db.failUpdate?.(this.table, this.payload);
      if (pending > 0 || injected) {
        if (pending > 0) errors[this.table] = pending - 1;
        if (injected) db.failUpdate = null;
        return { data: null, count: null, error: { message: `erro injetado em ${this.table}` } };
      }
      if (this.op === "update") {
        match.forEach((r) => Object.assign(r, this.payload));
        return { data: match, error: null };
      }
      if (this.head) return { data: null, count: match.length, error: null };
      if (this.mode === "single") return match.length === 1 ? { data: { ...match[0] }, error: null } : { data: null, error: { message: "not single" } };
      if (this.mode === "maybe") return { data: match[0] ? { ...match[0] } : null, error: null };
      return { data: match.map((r) => ({ ...r })), error: null };
    }
    then<A = unknown, B = never>(
      ok?: ((v: unknown) => A | PromiseLike<A>) | null,
      ko?: ((e: unknown) => B | PromiseLike<B>) | null,
    ): Promise<A | B> {
      const wait = db.delayMs ? new Promise((r) => setTimeout(r, db.delayMs)) : Promise.resolve();
      return wait.then(() => this.run()).then(ok, ko);
    }
  }
  return {
    from: (table: string) => new Query(table),
    // grant_credits: idempotente por (reference_id, reason), como no SQL.
    rpc: async (_fn: string, p: { p_user_id: string; p_amount: number; p_reason: string; p_reference_id: string }) => {
      if (db.grantErrors > 0) {
        db.grantErrors--;
        return { data: null, error: { message: "grant falhou" } };
      }
      const txs = (db.tables.credit_transactions ??= []);
      const credits = (db.tables.credits ?? []).find((c) => c.user_id === p.p_user_id)!;
      if (!txs.some((t) => t.reference_id === p.p_reference_id && t.reason === p.p_reason)) {
        credits.balance = (credits.balance as number) + p.p_amount;
        txs.push({ reference_id: p.p_reference_id, reason: p.p_reason, amount: p.p_amount });
      }
      return { data: credits.balance, error: null };
    },
  };
});

const queue = vi.hoisted(() => {
  const jobs: { id: string; type: string; payload: Row; attempts: number; maxAttempts: number; status: string }[] = [];
  return {
    jobs,
    enqueue(type: string, payload: Row, attempts = 0) {
      jobs.push({ id: `job-${jobs.length + 1}`, type, payload, attempts, maxAttempts: 3, status: "queued" });
    },
    api: {
      async claim(_worker: string, types: string[]) {
        const job = jobs.find((j) => j.status === "queued" && types.includes(j.type));
        if (!job) return null;
        job.status = "processing";
        job.attempts++;
        return { id: job.id, type: job.type, userId: "u1", payload: job.payload, attempts: job.attempts, maxAttempts: job.maxAttempts };
      },
      async complete(id: string) {
        const job = jobs.find((j) => j.id === id);
        if (job) job.status = "completed";
        return true;
      },
      async fail(id: string, _worker: string, _error: string, retry: boolean) {
        const job = jobs.find((j) => j.id === id);
        if (job) job.status = retry ? "queued" : "failed";
        return true;
      },
      async heartbeat() {},
      async countQueued() {
        return 0;
      },
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeDb }));
vi.mock("@/services/queue", () => ({ getQueue: () => queue.api }));
vi.mock("@/services/storage", () => ({
  getStorage: () => ({ downloadToFile: async () => {}, uploadFile: async () => {}, createSignedUrls: async () => ({}) }),
}));
vi.mock("@/services/video/engine", async () => {
  const { PermanentJobError } = await import("@/services/jobs/errors");
  return {
    FfmpegVideoProcessor: class {
      async process(input: { outputPath: string }) {
        db.renders++;
        if (db.engine === "fail") throw new PermanentJobError("não cabe", "Esse vídeo é longo demais.");
        return { outputPath: input.outputPath, sizeBytes: 1000, duration: 8, width: 720, height: 1280, warnings: [] };
      }
    },
  };
});

const { runNextJob } = await import("@/services/jobs/job-runner");
const { VideoAnalysisService } = await import("@/services/video/analysis-service");
const { VideoProcessingService } = await import("@/services/video/processing-service");
const { getProjectDetail } = await import("@/services/projects/project-service");

// Caminhos de storage exigem UUIDs.
const U = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";

const rows = (table: string) => db.tables[table] ?? [];
const row = (table: string, index = 0) => rows(table)[index] ?? {};
const byId = (table: string, id: string) => rows(table).find((r) => r.id === id) ?? {};
const balance = () => row("credits").balance;
const refunds = () => rows("credit_transactions").filter((x) => x.reason === "refund");
const run = () => runNextJob({ workerId: "w1" });

function editRender(id: string, versionId: string, commandId: string | null, status = "queued"): Row {
  return { id, project_id: P, user_id: U, version_id: versionId, command_id: commandId, kind: "edit", status, options: { quality: "720p" }, credits_charged: 10 };
}

function seedProject(renders: Row[], versions: Row[] = [], commands: Row[] = []) {
  db.tables = {
    credits: [{ user_id: U, balance: 90 }],
    credit_transactions: renders.map((r) => ({ reference_id: r.id, reason: "render", amount: -10 })),
    projects: [{ id: P, user_id: U, status: "processing", current_version_id: "v1", original_video_url: `${U}/${P}/original/v.mp4` }],
    project_versions: [
      { id: "v1", project_id: P, version_number: 1, status: "ready", editing_plan: { version: 1, operations: [] } },
      ...versions,
    ],
    video_metadata: [{ project_id: P, analysis_status: "completed", metadata: { duration: 10, width: 1280, height: 720 } }],
    editing_commands: commands,
    renders,
  };
}

/** Uma edição (r1 → v2, comando c1) na fila. */
function seedEditRender(extra: Row[] = []) {
  seedProject(
    [editRender("r1", "v2", "c1"), ...extra],
    [{ id: "v2", project_id: P, version_number: 2, status: "pending", editing_plan: { version: 1, operations: [] } }],
    [{ id: "c1", project_id: P, status: "confirmed" }],
  );
  queue.enqueue("render", { renderId: "r1" });
}

beforeEach(() => {
  queue.jobs.length = 0;
  db.updateErrors = {};
  db.selectErrors = {};
  db.failUpdate = null;
  db.grantErrors = 0;
  db.engine = "fail";
  db.renders = 0;
  db.delayMs = 0;
});

describe("render com falha definitiva", () => {
  it("reembolsa na hora mesmo se a limpeza falhar, e a nova tentativa refaz a limpeza", async () => {
    seedEditRender();
    db.updateErrors.projects = 1;
    expect((await run()).status).toBe("retry");
    expect(balance()).toBe(100);
    expect(row("renders").status).toBe("failed");
    expect(row("projects").status).toBe("processing");

    expect((await run()).status).toBe("completed");
    expect(row("projects").status).toBe("ready");
    expect(byId("project_versions", "v2").status).toBe("failed");
    expect(row("editing_commands").status).toBe("failed");
    expect(balance()).toBe(100);
    expect(refunds()).toHaveLength(1);
    expect(db.renders).toBe(1);
  });

  it("refaz o reembolso que falhou sem renderizar de novo", async () => {
    seedEditRender();
    db.grantErrors = 1;
    expect((await run()).status).toBe("retry");
    expect(balance()).toBe(90);
    expect((await run()).status).toBe("completed");
    expect(balance()).toBe(100);
    expect(row("projects").status).toBe("ready");
    expect(db.renders).toBe(1);
  });

  it("não tira o 'processing' de outra edição em andamento no mesmo projeto", async () => {
    seedEditRender([editRender("r2", "v3", null, "processing")]);
    await run();
    expect(row("renders").status).toBe("failed");
    expect(row("projects").status).toBe("processing");
    expect(balance()).toBe(100);
  });

  it("erro de leitura do render é temporário: nova tentativa, sem falha nem reembolso", async () => {
    seedEditRender();
    db.selectErrors.renders = 1;
    expect((await run()).status).toBe("retry");
    expect(row("renders").status).toBe("queued");
    expect(balance()).toBe(90);
  });

  it("desiste de finalizar depois de várias tentativas e a autocorreção conclui ao abrir o projeto", async () => {
    seedEditRender();
    db.grantErrors = 1000;
    let last = "";
    for (let i = 0; i < 20 && last !== "failed"; i++) last = (await run()).status;
    expect(last).toBe("failed");
    expect(queue.jobs[0]?.attempts).toBeLessThanOrEqual(3 + 6);
    expect(balance()).toBe(90);

    db.grantErrors = 0;
    const detail = await getProjectDetail(U, P);
    expect(balance()).toBe(100);
    expect(refunds()).toHaveLength(1);
    expect(detail.project.status).toBe("ready");
    expect(byId("project_versions", "v2").status).toBe("failed");
  });
});

describe("render concluído", () => {
  it("conclui a edição: versão pronta, projeto pronto, comando renderizado", async () => {
    seedEditRender();
    db.engine = "ok";
    expect((await run()).status).toBe("completed");
    expect(row("renders").status).toBe("completed");
    expect(byId("project_versions", "v2")).toMatchObject({ status: "ready", duration: 8, width: 720, height: 1280 });
    expect(row("projects")).toMatchObject({ status: "ready", current_version_id: "v2" });
    expect(row("editing_commands").status).toBe("rendered");
    expect(balance()).toBe(90);
  });

  it("com outra edição ativa, troca a versão atual mas mantém o 'processing'", async () => {
    seedEditRender([editRender("r2", "v3", null, "processing")]);
    db.engine = "ok";
    await run();
    expect(row("projects")).toMatchObject({ status: "processing", current_version_id: "v2" });
  });

  it("duas edições que terminam juntas devolvem o projeto para 'ready'", async () => {
    seedProject(
      [editRender("r1", "v2", "c1"), editRender("r2", "v3", "c2")],
      [
        { id: "v2", project_id: P, version_number: 2, status: "pending", editing_plan: { version: 1, operations: [] } },
        { id: "v3", project_id: P, version_number: 3, status: "pending", editing_plan: { version: 1, operations: [] } },
      ],
      [
        { id: "c1", project_id: P, status: "confirmed" },
        { id: "c2", project_id: P, status: "confirmed" },
      ],
    );
    db.engine = "ok";
    db.delayMs = 2;
    const service = new VideoProcessingService();
    await Promise.all([service.runRender("r1"), service.runRender("r2")]);
    expect(rows("renders").map((r) => r.status)).toEqual(["completed", "completed"]);
    expect(row("projects").status).toBe("ready");
  });

  it("erro do banco depois do upload, na última tentativa, conclui a edição sem reembolsar", async () => {
    seedProject(
      [editRender("r1", "v2", "c1")],
      [{ id: "v2", project_id: P, version_number: 2, status: "pending", editing_plan: { version: 1, operations: [] } }],
      [{ id: "c1", project_id: P, status: "confirmed" }],
    );
    queue.enqueue("render", { renderId: "r1" }, 2);
    db.engine = "ok";
    db.updateErrors.projects = 1;
    await run();
    expect(row("renders").status).toBe("completed");
    expect(row("projects")).toMatchObject({ status: "ready", current_version_id: "v2" });
    expect(row("editing_commands").status).toBe("rendered");
    expect(balance()).toBe(90);
    expect(refunds()).toHaveLength(0);
  });

  it("se gravar 'completed' falhar, o job volta à fila (sem render zumbi)", async () => {
    seedEditRender();
    db.engine = "ok";
    db.failUpdate = (table, payload) => table === "renders" && payload.status === "completed";
    expect((await run()).status).toBe("retry");
    expect((await run()).status).toBe("completed");
    expect(row("renders").status).toBe("completed");
    expect(row("projects").status).toBe("ready");
  });

  it("passos finais pendentes são refeitos pela nova tentativa sem renderizar de novo", async () => {
    seedEditRender();
    db.engine = "ok";
    db.updateErrors.editing_commands = 1;
    expect((await run()).status).toBe("retry");
    expect(row("renders").status).toBe("completed");
    expect((await run()).status).toBe("completed");
    expect(row("editing_commands").status).toBe("rendered");
    expect(db.renders).toBe(1);
  });
});

describe("autocorreção ao abrir o projeto", () => {
  it("edição concluída com o passo do projeto pendente: abre já na versão nova", async () => {
    seedEditRender();
    db.engine = "ok";
    db.updateErrors.projects = 1;
    expect((await run()).status).toBe("retry");
    expect(row("projects")).toMatchObject({ status: "processing", current_version_id: "v1" });

    const detail = await getProjectDetail(U, P);
    expect(detail.project).toMatchObject({ status: "ready", current_version_id: "v2" });
    expect(row("editing_commands").status).toBe("rendered");

    expect((await run()).status).toBe("completed");
    expect(row("projects").current_version_id).toBe("v2");
    expect(db.renders).toBe(1);
  });

  it("nova tentativa atrasada não desfaz a versão que o usuário escolheu depois", async () => {
    seedEditRender();
    db.engine = "ok";
    db.updateErrors.project_versions = 1;
    expect((await run()).status).toBe("retry");
    await getProjectDetail(U, P);
    expect(row("projects").current_version_id).toBe("v2");

    // O usuário volta para o vídeo original.
    Object.assign(row("projects"), { current_version_id: "v1" });
    expect((await run()).status).toBe("completed");
    expect(row("projects").current_version_id).toBe("v1");
  });

  it("destrava projeto 'processing' sem nenhuma edição ativa", async () => {
    seedProject([]);
    const detail = await getProjectDetail(U, P);
    expect(detail.project.status).toBe("ready");
  });

  it("conclui edição gravada como 'completed' com a versão ainda pendente", async () => {
    seedProject(
      [{ ...editRender("r1", "v2", "c1", "completed"), output_url: "x.mp4", output_duration: 8, output_width: 720, output_height: 1280, output_size_bytes: 1 }],
      [{ id: "v2", project_id: P, version_number: 2, status: "pending", editing_plan: { version: 1, operations: [] } }],
      [{ id: "c1", project_id: P, status: "confirmed" }],
    );
    const detail = await getProjectDetail(U, P);
    expect(detail.project).toMatchObject({ status: "ready", current_version_id: "v2" });
    expect(byId("project_versions", "v2").status).toBe("ready");
    expect(row("editing_commands").status).toBe("rendered");
  });

  it("não mexe em edição em andamento", async () => {
    seedEditRender();
    const detail = await getProjectDetail(U, P);
    expect(detail.project.status).toBe("processing");
    expect(byId("project_versions", "v2").status).toBe("pending");
  });
});

describe("análise", () => {
  function seedAnalysis(analysisStatus: string) {
    db.tables = {
      projects: [{ id: P, user_id: U, status: "analyzing", original_video_url: `${U}/${P}/original/v.mp4` }],
      project_versions: [{ id: "v1", project_id: P, version_number: 1, duration: null }],
      video_metadata: [
        { project_id: P, analysis_status: analysisStatus, metadata: { duration: 12, width: 1280, height: 720, sizeBytes: 1000 } },
      ],
    };
  }

  it("não marca como falha uma análise concluída quando a leitura do projeto falha", async () => {
    seedAnalysis("completed");
    db.selectErrors.projects = 1;
    await expect(new VideoAnalysisService().fail(P, new Error("x"))).rejects.toThrow();
    expect(row("video_metadata").analysis_status).toBe("completed");
    expect(row("projects").status).toBe("analyzing");
  });

  it("job repetido de análise concluída termina o projeto e os dados da versão 1", async () => {
    seedAnalysis("completed");
    await new VideoAnalysisService().run(P);
    expect(row("projects").status).toBe("ready");
    expect(row("project_versions").duration).toBe(12);
  });

  it("erro de leitura do projeto é temporário (nova tentativa), não falha definitiva", async () => {
    seedAnalysis("pending");
    db.selectErrors.projects = 1;
    queue.enqueue("analyze", { projectId: P });
    expect((await run()).status).toBe("retry");
    expect(row("projects").status).toBe("analyzing");
  });
});
