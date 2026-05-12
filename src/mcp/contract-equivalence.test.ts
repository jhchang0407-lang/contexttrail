/**
 * Contract equivalence — the load-bearing test for PRD-0003 / 4b.1.
 *
 * For every PRD-0002 golden task, the MCP `retrieve_context_pack` response
 * is structurally equivalent to `contexttrail context --json`: same locked set,
 * same ranked set, same omitted set, identical bodies and tokens, identical
 * rendered_text. After 4b.3 lands, this test is the artifact that prevents
 * silent contract drift.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runContext } from "../cli/context.js";
import { createHandlers } from "./handlers.js";
import { openDb, closeDb } from "../store/db.js";
import { migrateFlatToSubstrate } from "../store/migrate.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tests",
  "fixtures",
  "docs",
);

const GOLDEN_TASKS = [
  {
    name: "make refunds idempotent",
    query: "make refunds idempotent",
    files: ["src/payments/refund.ts"],
    symbols: ["RefundService.processRefund"],
  },
  {
    name: "audit logging for payment events",
    query: "audit logging for payment events",
  },
  {
    name: "renew an existing session",
    query: "renew an existing session",
  },
  {
    name: "idempotency key decision",
    query: "idempotency key decision",
  },
] as const;

describe("MCP retrieve_context_pack — contract equivalence with contexttrail context --json", () => {
  let corpus: TestCorpus;
  let cwd: string;

  beforeAll(() => {
    corpus = createTestCorpus({ prefix: "contexttrail-mcp-eq-" });
    cwd = corpus.cwd;
    corpus.copyDocsFrom(FIXTURE_ROOT);
    corpus.importDocs();
    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    migrateFlatToSubstrate(db, { force: true });
    closeDb(db);
  });

  afterAll(() => corpus.cleanup());

  for (const task of GOLDEN_TASKS) {
    it(`task: "${task.name}" — MCP response is structurally equivalent to JSON`, async () => {
      const opts = {
        files: "files" in task ? task.files : undefined,
        symbols: "symbols" in task ? task.symbols : undefined,
      };
      const cli = runContext(cwd, task.query, { ...opts, json: true });
      const mcp = await createHandlers({ cwd }).retrieve_context_pack({
        task: task.query,
        ...opts,
        // Equivalence test still validates the rendered_text path; opt in.
        include_rendered_text: true,
      });

      // Locked set: same card ids, same order, same bodies, same tokens.
      expect(mcp.locked.map((l) => l.id)).toEqual(cli.json!.locked.map((l) => l.card_id));
      for (let i = 0; i < mcp.locked.length; i++) {
        expect(mcp.locked[i]!.body).toBe(cli.json!.locked[i]!.body);
        expect(mcp.locked[i]!.tokens).toBe(cli.json!.locked[i]!.token_count);
      }

      // Ranked set: same ids in same order, same bodies, same tokens, same scores.
      expect(mcp.ranked.map((r) => r.id)).toEqual(
        cli.json!.included.map((c) => c.version_id),
      );
      for (let i = 0; i < mcp.ranked.length; i++) {
        expect(mcp.ranked[i]!.body).toBe(cli.json!.included[i]!.body);
        expect(mcp.ranked[i]!.tokens).toBe(cli.json!.included[i]!.token_count);
        expect(mcp.ranked[i]!.score).toBeCloseTo(
          cli.json!.included[i]!.score.final_score,
          10,
        );
      }

      // Omitted summary (PRD-0004 / S2): MCP exposes a bounded summary, CLI
      // emits the full list. Equivalence here means: total matches; top is a
      // strict subset of the CLI omitted set; truncated flag is consistent.
      const cliOmittedIds = new Set(cli.json!.omitted.map((o) => o.version_id));
      expect(mcp.omitted.total).toBe(cli.json!.omitted.length);
      for (const o of mcp.omitted.top) {
        expect(cliOmittedIds.has(o.id)).toBe(true);
      }
      expect(mcp.omitted.truncated).toBe(mcp.omitted.top.length < mcp.omitted.total);

      // Budget block matches.
      expect(mcp.budget).toEqual(cli.json!.budget);

      // rendered_text matches the CLI text rendering for the same Pack.
      const cliText = runContext(cwd, task.query, { ...opts });
      expect(mcp.rendered_text).toBe(cliText.text);
    });
  }

  it("rendered_text is opt-in: absent by default, present when include_rendered_text: true (ADR-0012)", async () => {
    const handlers = createHandlers({ cwd });
    const off = await handlers.retrieve_context_pack({ task: "make refunds idempotent" });
    expect(off.rendered_text).toBeUndefined();

    const on = await handlers.retrieve_context_pack({
      task: "make refunds idempotent",
      include_rendered_text: true,
    });
    expect(typeof on.rendered_text).toBe("string");
    expect(on.rendered_text!.length).toBeGreaterThan(0);
  });

  it("explain block populates only when explain: true is in the request", async () => {
    const handlers = createHandlers({ cwd });
    const off = await handlers.retrieve_context_pack({ task: "make refunds idempotent" });
    expect(off.explain).toBeUndefined();

    const on = await handlers.retrieve_context_pack({
      task: "make refunds idempotent",
      explain: true,
    });
    expect(on.explain).toBeDefined();
    expect(on.explain!.per_chunk.length).toBeGreaterThan(0);
  });

  it("ranked entries carry kind/score/scope/contexttrail/type_bias_applied", async () => {
    const mcp = await createHandlers({ cwd }).retrieve_context_pack({
      task: "make refunds idempotent",
    });
    expect(mcp.ranked.length).toBeGreaterThan(0);
    for (const r of mcp.ranked) {
      expect(["chunk", "card"]).toContain(r.kind);
      expect(typeof r.score).toBe("number");
      expect(typeof r.tokens).toBe("number");
      expect(typeof r.contexttrail).toBe("string");
      expect(r.contexttrail.length).toBeGreaterThan(0);
      expect(typeof r.type_bias_applied).toBe("boolean");
    }
  });

  it("omitted summary is always present (PRD-0004 / S2)", async () => {
    const mcp = await createHandlers({ cwd }).retrieve_context_pack({
      task: "make refunds idempotent",
    });
    expect(typeof mcp.omitted.total).toBe("number");
    expect(typeof mcp.omitted.by_reason).toBe("object");
    expect(Array.isArray(mcp.omitted.top)).toBe(true);
    expect(typeof mcp.omitted.truncated).toBe("boolean");
  });

  it("budget block surfaces requested / used / locked_overhead", async () => {
    const mcp = await createHandlers({ cwd }).retrieve_context_pack({
      task: "make refunds idempotent",
      budget: "small",
    });
    expect(typeof mcp.budget.requested).toBe("number");
    expect(typeof mcp.budget.used).toBe("number");
    expect(typeof mcp.budget.locked_overhead).toBe("number");
    expect(mcp.budget.requested).toBeGreaterThan(0);
  });
});
