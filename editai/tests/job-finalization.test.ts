import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finalização de jobs com o banco instável: reembolso nunca espera a limpeza,
 * limpeza é refeita na nova tentativa e análise concluída nunca vira falha.
 * Supabase e fila são falsos (em memória), com injeção de erro por tabela.
 */
type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** tabela -> quantas operações (update/select) devolvem erro */
  updateErrors: {} as Record<string, number>,
  selectErrors: {} as Record<string, number>,
  grantErrors: 0,
  renders: 0,
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
      if (pending > 0) {
        errors[this.table] = pending - 1;
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
      return Promise.resolve().then(() => this.run()).then(ok, ko);
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
    enqueue(type: string, payload: Row) {
      jobs.push({ id: `job-${jobs.length + 1}`, type, payload, attempts: 0, maxAttempts: 3, status: "queued" });
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
      async process() {
        db.renders++;
        throw new PermanentJobError("não cabe", "Esse vídeo é longo demais.");
      }
    },
  };
});

const { runNextJob } = await import("@/services/jobs/job-runner");
const { VideoAnalysisService } = await import("@/services/video/analysis-service");

const rows = (table: string) => db.tables[table] ?? [];
const row = (table: string, index = 0) => rows(table)[index] ?? {};
const balance = () => row("credits").balance;
const run = () => runNextJob({ workerId: "w1" });

function seedEditRender(extra: Row[] = []) {
  db.tables = {
    credits: [{ user_id: "u1", balance: 90 }],
    credit_transactions: [{ reference_id: "r1", reason: "render", amount: -10 }],
    projects: [{ id: "p1", user_id: "u1", status: "processing", original_video_url: "u1/p1/original/v.mp4" }],
    project_versions: [{ id: "v2", project_id: "p1", version_number: 2, status: "pending", editing_plan: { version: 1, operations: [] } }],
    video_metadata: [{ project_id: "p1", analysis_status: "completed", metadata: { duration: 10, width: 1280, height: 720 } }],
    editing_commands: [{ id: "c1", status: "confirmed" }],
    renders: [
      {
        id: "r1",
        project_id: "p1",
        user_id: "u1",
        version_id: "v2",
        command_id: "c1",
        kind: "edit",
        status: "queued",
        options: { quality: "720p" },
        credits_charged: 10,
      },
      ...extra,
    ],
  };
  queue.enqueue("render", { renderId: "r1" });
}

beforeEach(() => {
  queue.jobs.length = 0;
  db.updateErrors = {};
  db.selectErrors = {};
  db.grantErrors = 0;
  db.renders = 0;
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
    expect(row("project_versions").status).toBe("failed");
    expect(row("editing_commands").status).toBe("failed");
    expect(balance()).toBe(100);
    expect(rows("credit_transactions").filter((x) => x.reason === "refund")).toHaveLength(1);
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
    seedEditRender([{ id: "r2", project_id: "p1", user_id: "u1", version_id: "v3", kind: "edit", status: "processing", credits_charged: 5 }]);
    await run();
    expect(row("renders").status).toBe("failed");
    expect(row("projects").status).toBe("processing");
    expect(balance()).toBe(100);
  });

  it("desiste de finalizar depois de várias tentativas com o banco fora", async () => {
    seedEditRender();
    db.grantErrors = 1000;
    let last = "";
    for (let i = 0; i < 20 && last !== "failed"; i++) last = (await run()).status;
    expect(last).toBe("failed");
    expect(queue.jobs[0]?.attempts).toBeLessThanOrEqual(3 + 6);
  });
});

describe("análise", () => {
  // Caminhos de storage exigem UUIDs.
  const U = "11111111-1111-4111-8111-111111111111";
  const P = "22222222-2222-4222-8222-222222222222";
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
