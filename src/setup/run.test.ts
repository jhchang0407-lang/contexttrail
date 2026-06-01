/**
 * THO-251 (PRD-0033 / 33.3) — orchestrator tests.
 *
 * Wires runProbes + scanSetupReadiness + suggestNextStep together. The
 * orchestrator threads a `retriever` callback through so it can be
 * exercised without spinning up the full retrieval pipeline.
 */
import { describe, expect, it } from "vitest";
import { createTestCorpus } from "../eval/test-corpus.js";
import { writeInboxItem } from "../inbox/items.js";
import { runSetupReadiness } from "./run.js";
import { renderSetupReadiness } from "./render.js";

function allConfidentRetriever(): (task: string) => Promise<{ coverage_confidence: "confident" }> {
  return async () => ({ coverage_confidence: "confident" });
}

function allEmptyRetriever(): (task: string) => Promise<{ coverage_confidence: "empty" }> {
  return async () => ({ coverage_confidence: "empty" });
}

describe("runSetupReadiness — orchestration on a fresh fixture repo", () => {
  it("runs all six probes and surfaces a deterministic suggestion", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-" });
    try {
      // Fresh repo: no docs, no cards. Probes all 'empty' (nothing to retrieve).
      const r1 = await runSetupReadiness(corpus.cwd, allEmptyRetriever());
      const r2 = await runSetupReadiness(corpus.cwd, allEmptyRetriever());
      expect(r1.report.dimensions.corpus_coverage.score).toBe("low");
      expect(r1.report.dimensions.card_coverage.score).toBe("low");
      expect(r1.report.dimensions.retrieval_probes.score).toBe("low");
      // Determinism — two consecutive runs return identical output.
      expect(r2).toEqual(r1);
      // No inbox content yet.
      expect(r1.pending_inbox_items).toBe(0);
    } finally {
      corpus.cleanup();
    }
  });

  it("matches the import_more_docs row when corpus_coverage is low", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-" });
    try {
      const r = await runSetupReadiness(corpus.cwd, allEmptyRetriever());
      expect(r.suggestion.row_name).toBe("import_more_docs");
    } finally {
      corpus.cleanup();
    }
  });

  it("counts pending inbox candidates and lets review_inbox win over bootstrap_cards", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-" });
    try {
      // Seed a discoverable + imported markdown so corpus_coverage isn't low.
      corpus.writeDoc("README.md", "# r");
      for (let i = 0; i < 6; i++) {
        corpus.writeDoc(`docs/d${i}.md`, `# d${i}\n\nsome scoped body`);
      }
      corpus.importDocs();

      writeInboxItem(corpus.cwd, {
        id: "cand-001",
        review_type: "candidate_card",
        status: "pending",
        title: "Test candidate",
        created_at: "2026-05-11T00:00:00Z",
        updated_at: "2026-05-11T00:00:00Z",
        candidate_type: "constraint",
        scope: { layer: "project", project: "fixture" },
        symbol_anchors: [],
        supporting_chunks: [],
        trace_history: [],
        body: "Candidate body",
      });

      const r = await runSetupReadiness(corpus.cwd, allConfidentRetriever());
      expect(r.pending_inbox_items).toBe(1);
      // card_coverage will still be low (0 accepted cards) but the inbox path wins.
      expect(r.suggestion.row_name).toBe("review_inbox");
    } finally {
      corpus.cleanup();
    }
  });

  it("does not count open candidate suggestions already represented by accepted cards", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-accepted-dupe-" });
    try {
      corpus.writeCard({
        id: "C001",
        type: "constraint",
        title: "Signed docs outrank drafts",
        authority: "accepted",
        scope: { layer: "project", project: "fixture" },
        body: "Signed source documents outrank draft notes when they conflict.",
      });
      corpus.importCards();
      writeInboxItem(corpus.cwd, {
        id: "cand-accepted-dupe",
        review_type: "candidate_card",
        status: "pending",
        title: "Signed docs outrank drafts",
        created_at: "2026-05-11T00:00:00Z",
        updated_at: "2026-05-11T00:00:00Z",
        candidate_type: "constraint",
        scope: { layer: "project", project: "fixture" },
        symbol_anchors: [],
        supporting_chunks: [],
        trace_history: [],
        body: "Signed source documents outrank draft notes when they conflict.",
      });

      const result = await runSetupReadiness(corpus.cwd, allConfidentRetriever());

      expect(result.pending_inbox_items).toBe(0);
      expect(result.suggestion.row_name).not.toBe("review_inbox");
    } finally {
      corpus.cleanup();
    }
  });
});

describe("renderSetupReadiness — plain text shape", () => {
  it("matches PRD-0033's layout (one line per dimension + a suggested next step)", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-render-" });
    try {
      const result = await runSetupReadiness(corpus.cwd, allEmptyRetriever());
      const text = renderSetupReadiness({
        report: result.report,
        suggestion: result.suggestion,
        explain: false,
      });
      expect(text).toMatch(/ContextTrail setup readiness/);
      expect(text).toMatch(/corpus_coverage:/);
      expect(text).toMatch(/scope_coverage:/);
      expect(text).toMatch(/card_coverage:/);
      expect(text).toMatch(/retrieval_probes:/);
      expect(text).toMatch(/Suggested next step:/);
      // Without --explain, point users at it.
      expect(text).toMatch(/contexttrail setup --explain/);
    } finally {
      corpus.cleanup();
    }
  });

  it("--explain includes per-probe rationale", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-render-" });
    try {
      const result = await runSetupReadiness(corpus.cwd, allConfidentRetriever());
      const text = renderSetupReadiness({
        report: result.report,
        suggestion: result.suggestion,
        explain: true,
      });
      expect(text).toMatch(/per-dimension evidence/);
      expect(text).toMatch(/project_overview/);
      expect(text).toMatch(/signal_empty/);
    } finally {
      corpus.cleanup();
    }
  });
});
