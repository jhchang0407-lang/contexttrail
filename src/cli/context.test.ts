import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runContext } from "./context.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

function setup(): TestCorpus {
  return createTestCorpus({ prefix: "contexttrail-ctx-" });
}

describe("contexttrail context — end-to-end retrieval", () => {
  it("returns a Context Pack of relevant chunks within budget", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs/payments"), { recursive: true });
      mkdirSync(join(cwd, "docs/auth"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/payments/refunds.md"),
        "# Refunds\n\nRefunds must be idempotent. The `RefundService.processRefund` method handles them.\n\n## Edge Cases\n\nDouble-charge prevention requires checking refund status first.\n",
      );
      writeFileSync(
        join(cwd, "docs/auth/sessions.md"),
        "# Sessions\n\nSession tokens expire after 24h. Login required for sensitive endpoints.\n",
      );
      corpus.importDocs();

      const r = runContext(cwd, "make refunds idempotent", {
        files: [],
        symbols: ["RefundService.processRefund"],
        budget: "default",
      });
      expect(r.pack.included.length).toBeGreaterThan(0);
      // Refund chunks should outrank session chunks for this query.
      const includedSources = r.pack.included
        .map((t) => r.chunksByVersionId.get(t.version_id)!)
        .map((c) => c.source_path);
      expect(includedSources[0]).toBe("docs/payments/refunds.md");
      expect(r.pack.total_tokens).toBeLessThanOrEqual(r.pack.budget_tokens);
    } finally {
      corpus.cleanup();
    }
  });

  it("unscoped query (no --files / --symbols) still ranks chunks via BM25 + heading (PRD user-story 33)", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(
        join(cwd, "docs/refunds.md"),
        "# Refunds\n\nRefunds must be idempotent and emit audit events on every attempt.\n",
      );
      writeFileSync(
        join(cwd, "docs/sessions.md"),
        "# Sessions\n\nSession tokens expire after 24h.\n",
      );
      corpus.importDocs();

      // No files, no symbols, no routes — purely text-driven retrieval.
      const r = runContext(cwd, "refund idempotency", {});

      expect(r.pack.included.length).toBeGreaterThan(0);
      const top = r.chunksByVersionId.get(r.pack.included[0]!.version_id)!;
      expect(top.source_path).toBe("docs/refunds.md");

      // scope_match and mention_overlap MUST be 0 (neutral) when no query
      // anchors were provided — they did not get a free boost.
      for (const t of r.pack.included) {
        expect(t.scope_match).toBe(0);
        expect(t.mention_overlap).toBe(0);
      }
    } finally {
      corpus.cleanup();
    }
  });

  it("--json output is stable and contains the expected schema (week-4 MCP contract)", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nrefund logic lives here.\n");
      corpus.importDocs();

      const r = runContext(cwd, "refund", { json: true });
      expect(r.json).toBeDefined();
      const j = r.json!;
      expect(j.query).toBe("refund");
      expect(typeof j.total_tokens).toBe("number");
      expect(typeof j.budget_tokens).toBe("number");
      expect(Array.isArray(j.included)).toBe(true);
      const first = j.included[0]!;
      expect(first).toMatchObject({
        version_id: expect.any(String),
        source_path: "docs/a.md",
        heading_path: ["A"],
        body: expect.stringContaining("refund"),
      });
      expect(first.score.bm25_norm).toBeGreaterThan(0);
    } finally {
      corpus.cleanup();
    }
  });

  it("config tunability: zeroing w_heading changes the heading-only chunk's score", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      // B has heading match only (no BM25 body match).
      writeFileSync(
        join(cwd, "docs/b.md"),
        "# Refunds\n\nUnrelated body about something else entirely.\n",
      );
      corpus.importDocs();

      const before = runContext(cwd, "refund", {});
      const beforeB = before.pack.included.find(
        (t) =>
          before.chunksByVersionId.get(t.version_id)!.source_path === "docs/b.md",
      );
      expect(beforeB).toBeDefined();
      expect(beforeB!.final_score).toBeGreaterThan(0);

      // Flip w_heading to 0 in the config and re-run.
      const cfgPath = join(cwd, ".contexttrail/config.yaml");
      const cfgRaw = readFileSync(cfgPath, "utf8");
      writeFileSync(cfgPath, cfgRaw.replace("w_heading: 0.30", "w_heading: 0"));

      const after = runContext(cwd, "refund", {});
      const afterB = after.pack.included.find(
        (t) =>
          after.chunksByVersionId.get(t.version_id)!.source_path === "docs/b.md",
      )!;
      // heading_match contribution removed → text_score and final_score both drop.
      expect(afterB.heading_match).toBeGreaterThan(0); // raw signal still computed
      expect(afterB.text_score).toBeLessThan(beforeB!.text_score);
      expect(afterB.final_score).toBeLessThan(beforeB!.final_score);
    } finally {
      corpus.cleanup();
    }
  });

  it("multi-file scope ORs (max), boosts chunks in either matching scope", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(
        join(cwd, "docs/a.md"),
        "---\nscope:\n  layer: module\n  module: payments\n---\n\n# A\n\nrefund discussion.\n",
      );
      writeFileSync(
        join(cwd, "docs/b.md"),
        "---\nscope:\n  layer: module\n  module: billing\n---\n\n# B\n\nrefund discussion.\n",
      );
      // Replace config with one that includes a src/** rule for query-scope inference.
      const cfgPath = join(cwd, ".contexttrail/config.yaml");
      writeFileSync(
        cfgPath,
        `version: 1
doc_scopes:
  - id: docs-default
    pattern: "docs/**/*.md"
    scope:
      layer: project
code_scopes:
  - id: src-tree
    pattern: "src/**"
    scope:
      layer: module
      module_from_path_after: src
`,
      );
      corpus.importDocs();

      const r = runContext(cwd, "refund", {
        files: ["src/payments/x.ts", "src/billing/y.ts"],
      });
      const includedSources = r.pack.included.map(
        (t) => r.chunksByVersionId.get(t.version_id)!.source_path,
      );
      // Both module chunks are in the OR'd query scope; both make it into the pack.
      expect(includedSources).toContain("docs/a.md");
      expect(includedSources).toContain("docs/b.md");
      // And both have non-zero scope_match (rescued by OR).
      const aTrace = r.pack.included.find(
        (t) => r.chunksByVersionId.get(t.version_id)!.source_path === "docs/a.md",
      )!;
      const bTrace = r.pack.included.find(
        (t) => r.chunksByVersionId.get(t.version_id)!.source_path === "docs/b.md",
      )!;
      expect(aTrace.scope_match).toBe(1.0);
      expect(bTrace.scope_match).toBe(1.0);
    } finally {
      corpus.cleanup();
    }
  });
});
