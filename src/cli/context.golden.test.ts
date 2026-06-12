import { describe, it, expect } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runContext } from "./context.js";
import { listScopeReport } from "./scope-inspect.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tests",
  "fixtures",
  "docs",
);

function setupWithFixture(): TestCorpus {
  const corpus = createTestCorpus({ prefix: "contexttrail-golden-" });
  corpus.copyDocsFrom(FIXTURE_ROOT);
  return corpus;
}

describe("fixture corpus — golden retrieval contract", () => {
  it("hand-picked tasks rank the right chunks at the top", () => {
    const corpus = setupWithFixture();
    const cwd = corpus.cwd;
    try {
      corpus.importDocs();

      // Task 1: the canonical refund-idempotency query — refund chunks must
      // outrank everything else, and the auth/sessions chunk must NOT be top.
      const t1 = runContext(cwd, "make refunds idempotent", {
        files: ["src/payments/refund.ts"],
        symbols: ["RefundService.processRefund"],
      });
      const t1Top = t1.chunksByVersionId.get(t1.pack.included[0]!.version_id)!;
      expect(t1Top.source_path).toMatch(/payments\/refunds\.md/);

      // Task 2: payment audit query — audit chunk should rank above sessions.
      const t2 = runContext(cwd, "audit logging for payment events", {});
      const t2Top = t2.chunksByVersionId.get(t2.pack.included[0]!.version_id)!;
      expect(t2Top.source_path).toMatch(/payments\/audit\.md/);

      // Task 3: session renewal — sessions chunk should rank first.
      const t3 = runContext(cwd, "renew an existing session", {});
      const t3Top = t3.chunksByVersionId.get(t3.pack.included[0]!.version_id)!;
      expect(t3Top.source_path).toMatch(/auth\/sessions\.md/);

      // Task 4: ADR query — decision-layer chunk should rank above the
      // module-layer ones for an explicit ADR question.
      const t4 = runContext(cwd, "idempotency keys for payment retries", {});
      const t4Top = t4.chunksByVersionId.get(t4.pack.included[0]!.version_id)!;
      expect(t4Top.source_path).toMatch(/adr\/0001-idempotency-keys\.md/);
    } finally {
      corpus.cleanup();
    }
  });

  it("anchor false-positive audit: every extracted code anchor on the corpus is justified", () => {
    const corpus = setupWithFixture();
    const cwd = corpus.cwd;
    try {
      corpus.importDocs();
      const rows = listScopeReport(cwd, {});

      // The known-true anchor set in the fixture corpus, derived by hand from
      // the markdown source. Any anchor outside this set is a false positive.
      const allowed = new Set([
        "file::src/payments/refund.ts",
        "file::src/payments/audit.ts",
        "file::src/auth/session.ts",
        "symbol::RefundService.processRefund",
        "symbol::RefundService",
        "symbol::AuditLogger.record",
        "symbol::SessionStore.get",
        "symbol::SessionStore",
        "symbol::ReconciliationService.reconcileRefund",
        "symbol::InvoiceService",
        "symbol::InvoiceService.create",
        "symbol::SubscriptionService",
        "symbol::SubscriptionService.cancel",
        "symbol::SubscriptionService.upgrade",
        "symbol::TokenStore",
        "symbol::TokenStore.issue",
        "symbol::TokenStore.revoke",
        "symbol::PermissionChecker.can",
        "symbol::EmailWorker",
        "symbol::EmailWorker.send",
        "symbol::WebhookDispatcher",
        "symbol::WebhookDispatcher.dispatch",
        "symbol::Dispatcher",
        "test::refund.test.ts",
        "env_var::STRIPE_API_KEY",
        "route::DELETE /sessions/:id",
        "route::POST /sessions/:id/renew",
        "route::POST /tokens",
      ]);

      let extracted = 0;
      let falsePositives = 0;
      for (const row of rows) {
        for (const a of row.anchors) {
          if (a.source !== "mention_extraction") continue;
          extracted++;
          const key = `${a.kind}::${a.value}`;
          if (!allowed.has(key)) falsePositives++;
        }
      }

      // Acceptance threshold: <5% false-positive rate on a real-doc audit.
      expect(extracted).toBeGreaterThan(0);
      const fpRate = falsePositives / extracted;
      expect(fpRate).toBeLessThan(0.05);
    } finally {
      corpus.cleanup();
    }
  });

  it("--json output schema is stable (week-4 MCP contract)", () => {
    const corpus = setupWithFixture();
    const cwd = corpus.cwd;
    try {
      corpus.importDocs();
      const r = runContext(cwd, "make refunds idempotent", {
        files: ["src/payments/refund.ts"],
        symbols: ["RefundService.processRefund"],
        json: true,
      });
      const j = r.json!;
      // Top-level shape: locked, warnings, budget plus the earlier contract keys.
      expect(Object.keys(j).sort()).toEqual(
        [
          "budget",
          "budget_tokens",
          "included",
          "locked",
          "omitted",
          "query",
          "total_tokens",
          "warnings",
        ].sort(),
      );
      // Each included entry has the contract fields, including the 'kind'
      // discriminator (doc_chunk vs card) for forward-compat.
      for (const c of j.included) {
        expect(Object.keys(c).sort()).toEqual(
          [
            "body",
            "chunk_count",
            "chunk_index",
            "end_line",
            "heading_path",
            "kind",
            "score",
            "source_path",
            "start_line",
            "title",
            "token_count",
            "version_id",
          ].sort(),
        );
        expect(Object.keys(c.score).sort()).toEqual(
          [
            "bm25_norm",
            "final_score",
            "heading_match",
            "mention_overlap",
            "packing_score",
            "scope_match",
            "specificity",
            "text_score",
            "token_count",
            "version_id",
          ].sort(),
        );
      }
      expect(j.total_tokens).toBeLessThanOrEqual(j.budget_tokens);
    } finally {
      corpus.cleanup();
    }
  });
});
