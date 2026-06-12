/**
 * Snapshot coverage of the MCP wire shape.
 *
 * ≥10 representative responses across the golden corpus + edge cases.
 * If any of them diff, the wire shape (or the scoring math feeding it) has
 * genuinely changed — the test exists to make that change visible at PR time
 * rather than hidden in downstream agent breakage.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

/** Round floats to 4 decimals so micro-jitter from float arithmetic doesn't
 *  diff the snapshot. The wire shape is what matters here, not rounding noise. */
function stabilize(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 10000) / 10000;
  if (Array.isArray(v)) return v.map(stabilize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = stabilize(val);
    return out;
  }
  return v;
}

describe("MCP wire shape snapshots", () => {
  let corpus: TestCorpus;
  let cwd: string;

  beforeAll(() => {
    corpus = createTestCorpus({ prefix: "contexttrail-mcp-snap-" });
    cwd = corpus.cwd;
    corpus.copyDocsFrom(FIXTURE_ROOT);
    corpus.importDocs();
    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    migrateFlatToSubstrate(db, { force: true });
    closeDb(db);
  });

  afterAll(() => corpus.cleanup());

  const TASKS = [
    { name: "01-refunds-idempotent", task: "make refunds idempotent",
      files: ["src/payments/refund.ts"], symbols: ["RefundService.processRefund"] },
    { name: "02-audit-logging", task: "audit logging for payment events" },
    { name: "03-sessions-renew", task: "renew an existing session" },
    { name: "04-idempotency-decision", task: "idempotency key decision" },
    { name: "05-refunds-with-explain", task: "make refunds idempotent",
      files: ["src/payments/refund.ts"], symbols: ["RefundService.processRefund"],
      explain: true },
    { name: "06-audit-with-explain", task: "audit logging for payment events", explain: true },
    { name: "07-budget-small", task: "make refunds idempotent", budget: "small" as const },
    { name: "08-budget-large", task: "audit logging for payment events", budget: "large" as const },
    { name: "09-files-only", task: "fix bug",
      files: ["src/payments/refund.ts"] },
    { name: "10-symbols-only", task: "behavior question",
      symbols: ["SessionStore.get"] },
    { name: "11-empty-anchors", task: "stripe integration overview" },
    { name: "12-routes-only", task: "session renew",
      routes: ["POST /sessions/:id/renew"] },
  ];

  for (const t of TASKS) {
    it(`snapshot: ${t.name}`, async () => {
      const r = await createHandlers({ cwd }).retrieve_context_pack({
        task: t.task,
        files: "files" in t ? t.files : undefined,
        symbols: "symbols" in t ? t.symbols : undefined,
        routes: "routes" in t ? t.routes : undefined,
        budget: "budget" in t ? t.budget : undefined,
        explain: "explain" in t ? t.explain : undefined,
      });
      // Drop rendered_text — it contains a token-count line that's already
      // covered by the structural fields. Snapshotting it doubles the size
      // and adds nothing; structural diffs are what we care about.
      const { rendered_text: _, ...rest } = r;
      expect(stabilize(rest)).toMatchSnapshot();
    });
  }
});
