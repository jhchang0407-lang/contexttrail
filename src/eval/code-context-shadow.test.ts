import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb, type Db } from "../store/db.js";
import { replaceCodeChunksForSource } from "../store/code-chunks.js";
import { upsertCodeSource } from "../store/code-sources.js";
import { syncCodeGraph } from "../store/code-graph.js";
import type { CodeSourceFacts, ExtractedCodeChunk } from "../types/code-source.js";
import {
  PRD_0049_PRIOR_ART_METHODS,
  createCombinedBundleShadowAdapter,
  createCurrentProductionShadowAdapter,
  createGraphXrefShadowAdapter,
  createHybridRerankShadowAdapter,
  createPrd0050FullPanelShadowAdapters,
  createRepositoryMapShadowAdapter,
  renderCodeContextShadowComparison,
  renderCodeGraphCapabilityInventory,
  renderPrd0049MethodVerdict,
  renderPrd0050FullPanelVerdict,
  renderPrd0050PromotionVerdict,
  renderPriorArtMatrix,
  runCodeContextShadowComparison,
} from "./code-context-shadow.js";

const NOW = "2026-05-15T00:00:00Z";

function withDb(run: (db: Db) => void): void {
  const tmp = mkdtempSync(join(tmpdir(), "contexttrail-shadow-"));
  const db = openDb(join(tmp, "contexttrail.db"));
  try {
    run(db);
  } finally {
    closeDb(db);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function addCodeSource(
  db: Db,
  facts: CodeSourceFacts,
  chunks: ExtractedCodeChunk[],
): void {
  upsertCodeSource(db, {
    facts,
    source_content_hash: `hash:${facts.file_path}`,
    indexed_at: NOW,
  });
  replaceCodeChunksForSource(db, {
    source_path: facts.file_path,
    source_content_hash: `hash:${facts.file_path}`,
    indexed_at: NOW,
    chunks,
  });
}

function declarationChunk(
  source_path: string,
  symbol_path: string,
  body: string,
  start_line = 3,
): ExtractedCodeChunk {
  return {
    source_path,
    stable_key: `${source_path}::${symbol_path}`,
    symbol_path,
    code_role: "declaration",
    declaration_kind: "function",
    exported: true,
    body,
    start_line,
    end_line: start_line + body.split("\n").length - 1,
  };
}

function orientationChunk(
  source_path: string,
  body: string,
): ExtractedCodeChunk {
  return {
    source_path,
    stable_key: `${source_path}::orientation`,
    symbol_path: null,
    code_role: "orientation",
    declaration_kind: null,
    exported: false,
    body,
    start_line: 1,
    end_line: body.split("\n").length,
  };
}

describe("PRD-0049 prior-art matrix", () => {
  it("renders durable method, license, dependency, offline, and expected-impact fields", () => {
    const rendered = renderPriorArtMatrix(PRD_0049_PRIOR_ART_METHODS);

    expect(rendered).toContain("PRD-0049 Prior-Art Matrix");
    expect(rendered).toContain("Aider-style repository map");
    expect(rendered).toContain("Continue-style hybrid retrieval/rerank");
    expect(rendered).toContain("Sourcegraph/Cody-style multi-source context");
    expect(rendered).toContain("OpenGrok-style search/cross-reference");
    expect(rendered).toContain("REPOFUSE-style fused repository context");
    expect(rendered).toContain("License");
    expect(rendered).toContain("Attribution");
    expect(rendered).toContain("Dependency footprint");
    expect(rendered).toContain("Local/offline");
    expect(rendered).toContain("Candidate recall");
    expect(rendered).toContain("Top-3 ordering");
    expect(rendered).toContain("Support-cluster usefulness");
    expect(rendered).toContain("Cross-repo holdout");
    expect(rendered).toContain("Hosted service / credentials boundary");
    expect(rendered).toContain("Method adaptation only");
  });
});

describe("runCodeContextShadowComparison", () => {
  it("runs a current-production adapter without changing retrieval and reports recall/top-k/support counters", () => {
    withDb((db) => {
      addCodeSource(
        db,
        {
          file_path: "src/retrieve/context-pack.ts",
          exported_symbols: [{ name: "buildContextPack", kind: "function" }],
          exported_signatures: [
            "export function buildContextPack(query: string): ContextPack",
          ],
          file_purpose: "Builds the Context Pack retrieval payload.",
          imports: [],
        },
        [
          orientationChunk(
            "src/retrieve/context-pack.ts",
            "Context Pack retrieval payload builder.",
          ),
          declarationChunk(
            "src/retrieve/context-pack.ts",
            "buildContextPack",
            "export function buildContextPack(query: string): ContextPack { return assemble(query); }",
          ),
        ],
      );
      syncCodeGraph(db);

      const report = runCodeContextShadowComparison({
        db,
        cases: [
          {
            id: "THO-HARNESS",
            query: "buildContextPack Context Pack retrieval payload",
            expectedOwnerFiles: ["src/retrieve/context-pack.ts"],
            expectedSupportFiles: [],
            residualFamily: "retrieval_index",
          },
        ],
        adapters: [createCurrentProductionShadowAdapter()],
        candidateLimit: 5,
        topK: 3,
      });

      expect(report.methods[0]).toMatchObject({
        method: { id: "prd-0048-baseline", name: "PRD-0048 current production" },
        caseCount: 1,
        candidateRecall: { hits: 1, total: 1 },
        topKUsefulness: { hits: 1, total: 1 },
        rankedUsefulness: { hits: 1, total: 1 },
      });
      expect(report.methods[0]?.rows[0]?.topCandidates[0]).toMatchObject({
        source_path: "src/retrieve/context-pack.ts",
        trace_reasons: [{ kind: "production_current" }],
      });

      const rendered = renderCodeContextShadowComparison(report);
      expect(rendered).toContain("CODE-CONTEXT SHADOW COMPARISON");
      expect(rendered).toContain("candidate recall@5: 1/1");
      expect(rendered).toContain("top-3 usefulness: 1/1");
      expect(rendered).toContain("payload tokens");
      expect(JSON.stringify(report)).toContain("dependency_notes");
    });
  });

  it("separates owner, support, and set-level candidate recall before top-k reranking", () => {
    withDb((db) => {
      const ownerCandidate = {
        source_path: "src/refunds/refund-service.ts",
        symbol_path: "processRefund",
        start_line: 3,
        end_line: 3,
        score: 0.9,
        tokens: 12,
        support_candidate: false,
        trace_reasons: [{ kind: "lexical_candidate" as const }],
      };
      const supportCandidate = {
        source_path: "src/db/refund-schema.ts",
        symbol_path: "RefundLedgerRow",
        start_line: 3,
        end_line: 3,
        score: 0.8,
        tokens: 9,
        support_candidate: true,
        trace_reasons: [{ kind: "schema_store_support" as const }],
      };

      const report = runCodeContextShadowComparison({
        db,
        cases: [
          {
            id: "THO-CANDIDATE-RECALL",
            query: "processRefund refund ledger schema",
            expectedOwnerFiles: ["src/refunds/refund-service.ts"],
            expectedSupportFiles: ["src/db/refund-schema.ts"],
            residualFamily: "persistence_substrate",
          },
        ],
        adapters: [
          {
            method: {
              id: "hybrid-rerank",
              name: "Support miss before rerank",
              description: "Synthetic adapter that finds the owner before rerank but not support.",
              dependency_notes: ["test adapter"],
              shadow_only: true,
            },
            run: ({ testCase }) => ({
              method: {
                id: "hybrid-rerank",
                name: "Support miss before rerank",
                description:
                  "Synthetic adapter that finds the owner before rerank but not support.",
                dependency_notes: ["test adapter"],
                shadow_only: true,
              },
              caseId: testCase.id,
              query: testCase.query,
              initialCandidates: [ownerCandidate],
              topCandidates: [ownerCandidate, supportCandidate],
            }),
          },
        ],
        candidateLimit: 5,
        topK: 2,
      });

      expect(report.methods[0]).toMatchObject({
        ownerCandidateRecall: { hits: 1, total: 1 },
        supportCandidateRecall: { hits: 0, total: 1 },
        setCandidateRecall: { hits: 0, total: 1 },
        candidateRecall: { hits: 0, total: 1 },
        topKUsefulness: { hits: 1, total: 1 },
        supportClusterUsefulness: { hits: 1, total: 1 },
        setLevelContextQuality: { hits: 1, total: 1 },
      });
      expect(report.methods[0]?.familyMovement[0]).toMatchObject({
        ownerCandidateRecall: { hits: 1, total: 1 },
        supportCandidateRecall: { hits: 0, total: 1 },
        setCandidateRecall: { hits: 0, total: 1 },
      });

      const rendered = renderCodeContextShadowComparison(report);
      expect(rendered).toContain("owner candidate recall@5: 1/1");
      expect(rendered).toContain("support candidate recall@5: 0/1");
      expect(rendered).toContain("set candidate recall@5: 0/1");
    });
  });

  it("supports full-panel cases where any changed source file can satisfy owner and support recall", () => {
    withDb((db) => {
      const ownerCandidate = {
        source_path: "src/retrieve/bundle-ranker.ts",
        symbol_path: "rankBundle",
        start_line: 10,
        end_line: 10,
        score: 0.9,
        tokens: 14,
        support_candidate: false,
        trace_reasons: [{ kind: "lexical_candidate" as const }],
      };
      const supportCandidate = {
        source_path: "src/store/bundle-schema.ts",
        symbol_path: "BundleRow",
        start_line: 4,
        end_line: 4,
        score: 0.8,
        tokens: 11,
        support_candidate: true,
        trace_reasons: [{ kind: "schema_store_support" as const }],
      };

      const report = runCodeContextShadowComparison({
        db,
        cases: [
          {
            id: "THO-FULL-PANEL-ANY",
            query: "bundle ranking schema",
            expectedOwnerFiles: [
              "src/retrieve/unmatched-owner.ts",
              "src/retrieve/bundle-ranker.ts",
            ],
            expectedSupportFiles: [
              "src/store/unmatched-schema.ts",
              "src/store/bundle-schema.ts",
            ],
            expectedOwnerMatch: "any",
            expectedSupportMatch: "any",
            residualFamily: "retrieval_index",
          },
        ],
        adapters: [
          {
            method: {
              id: "combined-bundle",
              name: "Any-match synthetic adapter",
              description:
                "Synthetic adapter that hits one file from each expected full-panel set.",
              dependency_notes: ["test adapter"],
              shadow_only: true,
            },
            run: ({ testCase }) => ({
              method: {
                id: "combined-bundle",
                name: "Any-match synthetic adapter",
                description:
                  "Synthetic adapter that hits one file from each expected full-panel set.",
                dependency_notes: ["test adapter"],
                shadow_only: true,
              },
              caseId: testCase.id,
              query: testCase.query,
              initialCandidates: [ownerCandidate, supportCandidate],
              topCandidates: [ownerCandidate, supportCandidate],
            }),
          },
        ],
        candidateLimit: 5,
        topK: 2,
      });

      expect(report.methods[0]).toMatchObject({
        ownerCandidateRecall: { hits: 1, total: 1 },
        supportCandidateRecall: { hits: 1, total: 1 },
        setCandidateRecall: { hits: 1, total: 1 },
        topKUsefulness: { hits: 1, total: 1 },
        supportClusterUsefulness: { hits: 1, total: 1 },
        setLevelContextQuality: { hits: 1, total: 1 },
      });
    });
  });
});

describe("repository-map shadow adapter", () => {
  it("keeps the symbol owner first while adding budgeted map-context support with exact navigation", () => {
    withDb((db) => {
      addCodeSource(
        db,
        {
          file_path: "src/refunds/refund-service.ts",
          exported_symbols: [{ name: "processRefund", kind: "function" }],
          exported_signatures: [
            "export function processRefund(input: RefundInput): RefundLedgerRow",
          ],
          file_purpose: "Owns refund processing and writes refund ledger rows.",
          imports: ["src/db/refund-schema"],
        },
        [
          orientationChunk(
            "src/refunds/refund-service.ts",
            "Refund processing service.",
          ),
          declarationChunk(
            "src/refunds/refund-service.ts",
            "processRefund",
            "export function processRefund(input: RefundInput): RefundLedgerRow { return insertRefundLedger(input); }",
            5,
          ),
        ],
      );
      addCodeSource(
        db,
        {
          file_path: "src/db/refund-schema.ts",
          exported_symbols: [{ name: "RefundLedgerRow", kind: "type" }],
          exported_signatures: ["export type RefundLedgerRow = { id: string }"],
          file_purpose: "Database schema types for refund ledger storage.",
          imports: [],
        },
        [
          orientationChunk(
            "src/db/refund-schema.ts",
            "Refund ledger database schema.",
          ),
          declarationChunk(
            "src/db/refund-schema.ts",
            "RefundLedgerRow",
            "export type RefundLedgerRow = { id: string; amount: number };",
          ),
        ],
      );
      addCodeSource(
        db,
        {
          file_path: "src/notifications/refund-email.ts",
          exported_symbols: [{ name: "sendRefundEmail", kind: "function" }],
          exported_signatures: ["export function sendRefundEmail(): void"],
          file_purpose: "Sends refund notification emails.",
          imports: [],
        },
        [
          orientationChunk(
            "src/notifications/refund-email.ts",
            "Refund email notification helper.",
          ),
          declarationChunk(
            "src/notifications/refund-email.ts",
            "sendRefundEmail",
            "export function sendRefundEmail(): void {}",
          ),
        ],
      );
      syncCodeGraph(db);

      const result = createRepositoryMapShadowAdapter().run({
        db,
        testCase: {
          id: "THO-REPO-MAP",
          query: "processRefund refund ledger schema",
          expectedOwnerFiles: ["src/refunds/refund-service.ts"],
          expectedSupportFiles: ["src/db/refund-schema.ts"],
          residualFamily: "persistence_substrate",
        },
        candidateLimit: 2,
        topK: 2,
      });

      expect(result.topCandidates.map((candidate) => candidate.source_path)).toEqual([
        "src/refunds/refund-service.ts",
        "src/db/refund-schema.ts",
      ]);
      expect(result.topCandidates[0]).toMatchObject({
        symbol_path: "processRefund",
        start_line: 5,
        support_candidate: false,
      });
      expect(result.topCandidates[0]?.trace_reasons.map((reason) => reason.kind)).toEqual(
        expect.arrayContaining(["symbol_hit", "exported_symbol_importance"]),
      );
      expect(result.topCandidates[1]).toMatchObject({
        symbol_path: "RefundLedgerRow",
        support_candidate: true,
      });
      expect(result.topCandidates[1]?.trace_reasons.map((reason) => reason.kind)).toEqual(
        expect.arrayContaining(["repository_map_context", "schema_store_support"]),
      );
      expect(result.initialCandidates).toHaveLength(2);
    });
  });
});

describe("hybrid-rerank shadow adapter", () => {
  it("separates broad candidate recall from deterministic local top-k reranking", () => {
    withDb((db) => {
      addCodeSource(
        db,
        {
          file_path: "src/cli/import-command.ts",
          exported_symbols: [{ name: "runImportCommand", kind: "function" }],
          exported_signatures: ["export function runImportCommand(): void"],
          file_purpose: "CLI owner for the import workflow command.",
          imports: ["src/parse/chunker"],
        },
        [
          orientationChunk(
            "src/cli/import-command.ts",
            "Import workflow CLI command owner.",
          ),
          declarationChunk(
            "src/cli/import-command.ts",
            "runImportCommand",
            "export function runImportCommand(): void { chunkMarkdown(); }",
          ),
        ],
      );
      addCodeSource(
        db,
        {
          file_path: "src/parse/chunker.ts",
          exported_symbols: [{ name: "chunkMarkdown", kind: "function" }],
          exported_signatures: ["export function chunkMarkdown(markdown: string): Chunk[]"],
          file_purpose: "Parser and chunker support for import reindex workflows.",
          imports: [],
        },
        [
          orientationChunk("src/parse/chunker.ts", "Markdown parser chunker."),
          declarationChunk(
            "src/parse/chunker.ts",
            "chunkMarkdown",
            "export function chunkMarkdown(markdown: string): Chunk[] { return []; }",
          ),
        ],
      );
      addCodeSource(
        db,
        {
          file_path: "src/notifications/import-email.ts",
          exported_symbols: [{ name: "sendImportEmail", kind: "function" }],
          exported_signatures: ["export function sendImportEmail(): void"],
          file_purpose: "Notification helper for completed imports.",
          imports: [],
        },
        [
          orientationChunk(
            "src/notifications/import-email.ts",
            "Import notification email helper.",
          ),
          declarationChunk(
            "src/notifications/import-email.ts",
            "sendImportEmail",
            "export function sendImportEmail(): void {}",
          ),
        ],
      );
      syncCodeGraph(db);

      const result = createHybridRerankShadowAdapter().run({
        db,
        testCase: {
          id: "THO-HYBRID",
          query: "import workflow command parser chunker",
          expectedOwnerFiles: ["src/cli/import-command.ts"],
          expectedSupportFiles: ["src/parse/chunker.ts"],
          residualFamily: "import_workflow",
        },
        candidateLimit: 3,
        topK: 2,
      });

      expect(result.initialCandidates.map((candidate) => candidate.source_path)).toEqual(
        expect.arrayContaining([
          "src/cli/import-command.ts",
          "src/parse/chunker.ts",
          "src/notifications/import-email.ts",
        ]),
      );
      expect(result.topCandidates.map((candidate) => candidate.source_path)).toEqual([
        "src/cli/import-command.ts",
        "src/parse/chunker.ts",
      ]);
      expect(result.topCandidates[0]?.trace_reasons.map((reason) => reason.kind)).toEqual(
        expect.arrayContaining(["lexical_candidate", "rerank_promotion"]),
      );
      expect(result.topCandidates[1]?.support_candidate).toBe(true);
      expect(result.topCandidates[1]?.trace_reasons.map((reason) => reason.kind)).toEqual(
        expect.arrayContaining(["support_necessity", "rerank_promotion"]),
      );
      const demoted = result.initialCandidates.find(
        (candidate) => candidate.source_path === "src/notifications/import-email.ts",
      );
      expect(demoted?.trace_reasons.map((reason) => reason.kind)).toContain(
        "rerank_demotion",
      );
    });
  });
});

describe("graph/xref shadow adapter", () => {
  it("documents existing graph capabilities and explains import/reverse-import support candidates", () => {
    withDb((db) => {
      addCodeSource(
        db,
        {
          file_path: "src/retrieve/retrieval-index.ts",
          exported_symbols: [{ name: "buildRetrievalIndex", kind: "function" }],
          exported_signatures: ["export function buildRetrievalIndex(): Index"],
          file_purpose: "Owner for retrieval index construction.",
          imports: ["src/store/index-schema"],
        },
        [
          orientationChunk(
            "src/retrieve/retrieval-index.ts",
            "Retrieval index owner.",
          ),
          declarationChunk(
            "src/retrieve/retrieval-index.ts",
            "buildRetrievalIndex",
            "export function buildRetrievalIndex(): Index { return readIndexSchema(); }",
          ),
        ],
      );
      addCodeSource(
        db,
        {
          file_path: "src/store/index-schema.ts",
          exported_symbols: [{ name: "IndexSchema", kind: "type" }],
          exported_signatures: ["export type IndexSchema = { name: string }"],
          file_purpose: "Store schema for retrieval index persistence.",
          imports: [],
        },
        [
          orientationChunk("src/store/index-schema.ts", "Retrieval index schema."),
          declarationChunk(
            "src/store/index-schema.ts",
            "IndexSchema",
            "export type IndexSchema = { name: string };",
          ),
        ],
      );
      addCodeSource(
        db,
        {
          file_path: "src/cli/index-command.ts",
          exported_symbols: [{ name: "runIndexCommand", kind: "function" }],
          exported_signatures: ["export function runIndexCommand(): void"],
          file_purpose: "CLI workflow command that invokes retrieval index construction.",
          imports: ["src/retrieve/retrieval-index"],
        },
        [
          orientationChunk("src/cli/index-command.ts", "Retrieval index CLI command."),
          declarationChunk(
            "src/cli/index-command.ts",
            "runIndexCommand",
            "export function runIndexCommand(): void { buildRetrievalIndex(); }",
          ),
        ],
      );
      syncCodeGraph(db);

      const inventory = renderCodeGraphCapabilityInventory();
      expect(inventory).toContain("Existing capabilities");
      expect(inventory).toContain("code_sources");
      expect(inventory).toContain("code_chunks");
      expect(inventory).toContain("code_graph_edges");
      expect(inventory).toContain("Genuinely missing shadow signals");
      expect(inventory).toContain("typed symbol references");

      const result = createGraphXrefShadowAdapter().run({
        db,
        testCase: {
          id: "THO-GRAPH",
          query: "retrieval index schema CLI workflow",
          expectedOwnerFiles: ["src/retrieve/retrieval-index.ts"],
          expectedSupportFiles: [
            "src/store/index-schema.ts",
            "src/cli/index-command.ts",
          ],
          residualFamily: "retrieval_index",
        },
        candidateLimit: 3,
        topK: 3,
      });

      expect(result.topCandidates.map((candidate) => candidate.source_path)).toEqual([
        "src/retrieve/retrieval-index.ts",
        "src/store/index-schema.ts",
        "src/cli/index-command.ts",
      ]);
      expect(result.topCandidates.every((candidate) => candidate.score <= 1)).toBe(
        true,
      );
      expect(result.topCandidates[1]?.trace_reasons.map((reason) => reason.kind)).toEqual(
        expect.arrayContaining(["import_edge", "schema_store_support"]),
      );
      expect(result.topCandidates[2]?.trace_reasons.map((reason) => reason.kind)).toEqual(
        expect.arrayContaining(["reverse_import_edge", "support_necessity"]),
      );
    });
  });
});

describe("renderPrd0049MethodVerdict", () => {
  it("names every method disposition and keeps promotion tied to guardrail evidence", () => {
    withDb((db) => {
      addCodeSource(
        db,
        {
          file_path: "src/refunds/refund-service.ts",
          exported_symbols: [{ name: "processRefund", kind: "function" }],
          exported_signatures: [
            "export function processRefund(input: RefundInput): RefundLedgerRow",
          ],
          file_purpose: "Owner for refund processing and ledger writes.",
          imports: ["src/db/refund-schema"],
        },
        [
          orientationChunk(
            "src/refunds/refund-service.ts",
            "Refund processing owner.",
          ),
          declarationChunk(
            "src/refunds/refund-service.ts",
            "processRefund",
            "export function processRefund(input: RefundInput): RefundLedgerRow { return insertRefundLedger(input); }",
          ),
        ],
      );
      addCodeSource(
        db,
        {
          file_path: "src/db/refund-schema.ts",
          exported_symbols: [{ name: "RefundLedgerRow", kind: "type" }],
          exported_signatures: ["export type RefundLedgerRow = { id: string }"],
          file_purpose: "Database schema support for refund ledger storage.",
          imports: [],
        },
        [
          orientationChunk(
            "src/db/refund-schema.ts",
            "Refund ledger database schema.",
          ),
          declarationChunk(
            "src/db/refund-schema.ts",
            "RefundLedgerRow",
            "export type RefundLedgerRow = { id: string; amount: number };",
          ),
        ],
      );
      syncCodeGraph(db);

      const report = runCodeContextShadowComparison({
        db,
        cases: [
          {
            id: "THO-VERDICT",
            query: "processRefund refund ledger schema",
            expectedOwnerFiles: ["src/refunds/refund-service.ts"],
            expectedSupportFiles: ["src/db/refund-schema.ts"],
            residualFamily: "persistence_substrate",
          },
        ],
        adapters: [
          createCurrentProductionShadowAdapter(),
          createRepositoryMapShadowAdapter(),
          createHybridRerankShadowAdapter(),
          createGraphXrefShadowAdapter(),
        ],
        candidateLimit: 5,
        topK: 3,
      });

      const rendered = renderPrd0049MethodVerdict(report, {
        baselineName: "PRD-0048 final",
        evidenceScope: "focused_synthetic",
        realCorpusNoRegressionPassed: true,
        realCorpusSummary: "No production behavior changed in shadow mode.",
        crossRepoHoldoutSummary:
          "Holdout result is directional until the adapters run on imported holdout workspaces.",
      });

      expect(rendered).toContain("PRD-0049 Method Comparison Verdict");
      expect(rendered).toContain("PRD-0048 final");
      expect(rendered).toContain("candidate recall@5");
      expect(rendered).toContain("top-3 usefulness");
      expect(rendered).toContain("ranked usefulness");
      expect(rendered).toContain("support-cluster usefulness");
      expect(rendered).toContain("per-family movement");
      expect(rendered).toContain("ticket robustness");
      expect(rendered).toContain("payload-size impact");
      expect(rendered).toContain("real-corpus guardrails");
      expect(rendered).toContain("prd-0048-baseline:");
      expect(rendered).toContain("repository-map:");
      expect(rendered).toContain("hybrid-rerank:");
      expect(rendered).toContain("graph-xref:");
      expect(rendered).toContain("Evidence scope: focused_synthetic");
      expect(rendered).toContain("repository-map: Aider-style repository-map | combine");
      expect(rendered).toContain(
        "hybrid-rerank: Hybrid broad-recall/local-rerank | promote to full-panel shadow eval",
      );
      expect(rendered).toContain("graph-xref: Local code graph/xref expansion | defer");
      expect(rendered).not.toContain(" | promote | ");
      expect(rendered).toContain("Next production PRD recommendation");
      expect(rendered).toContain("No production PRD is recommended");
    });
  });
});

describe("PRD-0050 full-panel shadow comparison", () => {
  it("runs every method slot over the same full-panel cases and renders promotion-safe diagnostics", () => {
    withDb((db) => {
      seedImportWorkflowBundle(db);
      syncCodeGraph(db);

      const report = runCodeContextShadowComparison({
        db,
        cases: [
          {
            id: "THO-355-FULL-PANEL",
            query: "runImportCommand import workflow parser chunker storage schema",
            expectedOwnerFiles: ["src/cli/import-command.ts"],
            expectedSupportFiles: [
              "src/parse/chunker.ts",
              "src/store/import-schema.ts",
            ],
            residualFamily: "import_workflow",
          },
        ],
        adapters: createPrd0050FullPanelShadowAdapters(),
        candidateLimit: 6,
        topK: 3,
        evidenceScope: "full_panel_shadow",
      });

      expect(report.evidenceScope).toBe("full_panel_shadow");
      expect(report.methods.map((method) => method.method.id)).toEqual([
        "prd-0048-baseline",
        "repository-map",
        "hybrid-rerank",
        "graph-xref",
        "combined-bundle",
      ]);

      const rendered = renderPrd0050FullPanelVerdict(report, {
        baselineName: "PRD-0048 final",
      });
      expect(rendered).toContain("PRD-0050 Full-Panel Shadow Verdict");
      expect(rendered).toContain("Evidence scope: full_panel_shadow");
      expect(rendered).toContain("owner candidate recall@6");
      expect(rendered).toContain("support candidate recall@6");
      expect(rendered).toContain("full-set candidate recall@6");
      expect(rendered).toContain("top-3 usefulness");
      expect(rendered).toContain("ranked usefulness");
      expect(rendered).toContain("support-cluster usefulness");
      expect(rendered).toContain("ticket robustness");
      expect(rendered).toContain("payload-size impact");
      expect(rendered).toContain("combined-bundle");
      expect(rendered).not.toContain("production promotion earned");
    });
  });
});

describe("combined bundle rerank shadow adapter", () => {
  it("separates generation from final top-3 bundle assembly and emits stable support-lens traces", () => {
    withDb((db) => {
      seedImportWorkflowBundle(db);
      syncCodeGraph(db);

      const result = createCombinedBundleShadowAdapter().run({
        db,
        testCase: {
          id: "THO-356-BUNDLE",
          query: "runImportCommand import workflow parser chunker storage schema",
          expectedOwnerFiles: ["src/cli/import-command.ts"],
          expectedSupportFiles: [
            "src/parse/chunker.ts",
            "src/store/import-schema.ts",
          ],
          residualFamily: "import_workflow",
        },
        candidateLimit: 6,
        topK: 3,
      });

      expect(result.initialCandidates.map((candidate) => candidate.source_path)).toEqual(
        expect.arrayContaining([
          "src/cli/import-command.ts",
          "src/parse/chunker.ts",
          "src/store/import-schema.ts",
          "src/eval/import-workflow-report.ts",
        ]),
      );
      expect(result.topCandidates.map((candidate) => candidate.source_path)).toEqual([
        "src/cli/import-command.ts",
        "src/parse/chunker.ts",
        "src/store/import-schema.ts",
      ]);
      expect(result.ownerRetentionDecision).toMatchObject({
        kind: "retained",
        owner_source_path: "src/cli/import-command.ts",
      });
      expect(result.topCandidates[0]).toMatchObject({
        symbol_path: "runImportCommand",
        start_line: 5,
        support_candidate: false,
      });
      expect(result.topCandidates[0]?.trace_reasons.map((reason) => reason.kind)).toEqual(
        expect.arrayContaining(["owner_retention", "direct_owner_evidence"]),
      );
      expect(result.topCandidates[1]?.trace_reasons.map((reason) => reason.detail)).toEqual(
        expect.arrayContaining([
          "import_workflow: parser/chunker/reindex/index support necessary",
        ]),
      );
      expect(result.topCandidates[2]?.trace_reasons.map((reason) => reason.detail)).toEqual(
        expect.arrayContaining([
          "persistence_substrate: schema/database/store support necessary",
        ]),
      );
      const passive = result.initialCandidates.find(
        (candidate) => candidate.source_path === "src/eval/import-workflow-report.ts",
      );
      expect(passive?.trace_reasons.map((reason) => reason.kind)).toContain(
        "rerank_demotion",
      );
    });
  });

  it("reports ambiguous owner evidence instead of forcing an owner-retention decision", () => {
    withDb((db) => {
      addCodeSource(
        db,
        {
          file_path: "src/refunds/refund-service.ts",
          exported_symbols: [{ name: "handleRefund", kind: "function" }],
          exported_signatures: ["export function handleRefund(): RefundResult"],
          file_purpose: "Refund workflow service owner.",
          imports: [],
        },
        [
          orientationChunk("src/refunds/refund-service.ts", "Refund workflow service."),
          declarationChunk(
            "src/refunds/refund-service.ts",
            "handleRefund",
            "export function handleRefund(): RefundResult { return {}; }",
          ),
        ],
      );
      addCodeSource(
        db,
        {
          file_path: "src/refunds/refund-handler.ts",
          exported_symbols: [{ name: "processRefund", kind: "function" }],
          exported_signatures: ["export function processRefund(): RefundResult"],
          file_purpose: "Refund workflow handler owner.",
          imports: [],
        },
        [
          orientationChunk("src/refunds/refund-handler.ts", "Refund workflow handler."),
          declarationChunk(
            "src/refunds/refund-handler.ts",
            "processRefund",
            "export function processRefund(): RefundResult { return {}; }",
          ),
        ],
      );
      syncCodeGraph(db);

      const result = createCombinedBundleShadowAdapter().run({
        db,
        testCase: {
          id: "THO-357-AMBIGUOUS",
          query: "refund workflow owner",
          expectedOwnerFiles: ["src/refunds/refund-service.ts"],
          expectedSupportFiles: [],
          residualFamily: "other",
        },
        candidateLimit: 4,
        topK: 3,
      });

      expect(result.ownerRetentionDecision).toMatchObject({
        kind: "ambiguous",
      });
      expect(result.ownerRetentionDecision?.reason).toContain(
        "multiple plausible owners",
      );
      expect(
        result.topCandidates
          .flatMap((candidate) => candidate.trace_reasons)
          .map((reason) => reason.kind),
      ).toContain("owner_ambiguous");
    });
  });
});

describe("renderPrd0050PromotionVerdict", () => {
  it("keeps missed thresholds shadow-only and promotes only when every runtime gate clears", () => {
    const baselineMetrics = {
      promptVariantTop3: { hits: 26, total: 42 },
      ticketsTop3Robust: { hits: 5, total: 14 },
      supportFileHits: { hits: 39, total: 66 },
      codeTop1Acceptable: { hits: 12, total: 14 },
      codeRankedUseful: { hits: 14, total: 14 },
      supportClusterUseful: { hits: 14, total: 14 },
      payloadTokens: 900,
    };

    const deferred = renderPrd0050PromotionVerdict({
      baselineName: "PRD-0048 final",
      candidateName: "combined-bundle",
      evidenceScope: "full_panel_shadow",
      baselineMetrics,
      candidateMetrics: {
        ...baselineMetrics,
        promptVariantTop3: { hits: 31, total: 42 },
        ticketsTop3Robust: { hits: 9, total: 14 },
        supportFileHits: { hits: 49, total: 66 },
        payloadTokens: 940,
      },
      guardrails: {
        noRegression: true,
        details: ["focused tests, build, paired comparison, holdout, and real-corpus eval were checked"],
      },
    });

    expect(deferred).toContain("Disposition: shadow-only");
    expect(deferred).toContain("next blocker");
    expect(deferred).toContain("tickets top-3 robust below 10/14");
    expect(deferred).toContain("support file hits below 50/66");
    expect(deferred).not.toContain("CodeLaneRankingMethod: bundle-aware");

    const promoted = renderPrd0050PromotionVerdict({
      baselineName: "PRD-0048 final",
      candidateName: "combined-bundle",
      evidenceScope: "production_candidate",
      baselineMetrics,
      candidateMetrics: {
        ...baselineMetrics,
        promptVariantTop3: { hits: 32, total: 42 },
        ticketsTop3Robust: { hits: 10, total: 14 },
        supportFileHits: { hits: 50, total: 66 },
        payloadTokens: 910,
      },
      guardrails: {
        noRegression: true,
        details: ["focused tests, build, full suite, paired comparison, holdout, and real-corpus eval passed"],
      },
    });

    expect(promoted).toContain("Disposition: production promotion");
    expect(promoted).toContain("CodeLaneRankingMethod: bundle-aware");
    expect(promoted).toContain("reversible");
  });
});

function seedImportWorkflowBundle(db: Db): void {
  addCodeSource(
    db,
    {
      file_path: "src/cli/import-command.ts",
      exported_symbols: [{ name: "runImportCommand", kind: "function" }],
      exported_signatures: ["export function runImportCommand(): void"],
      file_purpose: "CLI owner for the import workflow command.",
      imports: ["src/parse/chunker", "src/store/import-schema"],
    },
    [
      orientationChunk(
        "src/cli/import-command.ts",
        "Import workflow CLI command owner.",
      ),
      declarationChunk(
        "src/cli/import-command.ts",
        "runImportCommand",
        "export function runImportCommand(): void { chunkMarkdown(); persistImportRecord(); }",
        5,
      ),
    ],
  );
  addCodeSource(
    db,
    {
      file_path: "src/parse/chunker.ts",
      exported_symbols: [{ name: "chunkMarkdown", kind: "function" }],
      exported_signatures: ["export function chunkMarkdown(markdown: string): Chunk[]"],
      file_purpose: "Parser and chunker support for import reindex workflows.",
      imports: [],
    },
    [
      orientationChunk("src/parse/chunker.ts", "Markdown parser chunker."),
      declarationChunk(
        "src/parse/chunker.ts",
        "chunkMarkdown",
        "export function chunkMarkdown(markdown: string): Chunk[] { return []; }",
      ),
    ],
  );
  addCodeSource(
    db,
    {
      file_path: "src/store/import-schema.ts",
      exported_symbols: [{ name: "persistImportRecord", kind: "function" }],
      exported_signatures: ["export function persistImportRecord(): void"],
      file_purpose: "Database schema and store support for persisted import records.",
      imports: [],
    },
    [
      orientationChunk(
        "src/store/import-schema.ts",
        "Import database schema and storage.",
      ),
      declarationChunk(
        "src/store/import-schema.ts",
        "persistImportRecord",
        "export function persistImportRecord(): void {}",
      ),
    ],
  );
  addCodeSource(
    db,
    {
      file_path: "src/eval/import-workflow-report.ts",
      exported_symbols: [{ name: "renderImportWorkflowReport", kind: "function" }],
      exported_signatures: ["export function renderImportWorkflowReport(): string"],
      file_purpose: "Passive report for import workflow metrics and examples.",
      imports: [],
    },
    [
      orientationChunk(
        "src/eval/import-workflow-report.ts",
        "Import workflow report.",
      ),
      declarationChunk(
        "src/eval/import-workflow-report.ts",
        "renderImportWorkflowReport",
        "export function renderImportWorkflowReport(): string { return 'metrics'; }",
      ),
    ],
  );
}
