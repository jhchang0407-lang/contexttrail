/**
 * PRD-0028 / slice 28.3 — code-source mixer tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../store/db.js";
import { closeDb, openDb } from "../store/db.js";
import { replaceCodeChunksForSource } from "../store/code-chunks.js";
import { upsertCodeSource } from "../store/code-sources.js";
import { syncCodeGraph } from "../store/code-graph.js";
import { buildCodeRankedEntries } from "./code-source-mix.js";

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "contexttrail-csmix-"));
  db = openDb(join(tmp, "contexttrail.db"));
  seedCodeFile({
    path: "src/retrieve/source-rerank.ts",
    imports: [],
    purpose: "Source-level reranker for retrieval candidates.",
    symbols: [
      { name: "scoreSourceRerank", kind: "function" },
      { name: "tokenizeForRerank", kind: "function" },
    ],
    signatures: [
      "export function scoreSourceRerank(args: Args): Score",
    ],
    chunks: [
      {
        stable_key: "src/retrieve/source-rerank.ts::orientation",
        symbol_path: null,
        code_role: "orientation",
        declaration_kind: null,
        exported: false,
        body: "/** Retrieval reranker orientation */",
        start_line: 1,
        end_line: 1,
      },
      {
        stable_key: "src/retrieve/source-rerank.ts::scoreSourceRerank",
        symbol_path: "scoreSourceRerank",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreSourceRerank(args: Args): Score { return 1; }",
        start_line: 3,
        end_line: 5,
      },
      {
        stable_key: "src/retrieve/source-rerank.ts::tokenizeForRerank",
        symbol_path: "tokenizeForRerank",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function tokenizeForRerank(query: string): string[] { return []; }",
        start_line: 7,
        end_line: 9,
      },
    ],
  });
  seedCodeFile({
    path: "src/store/cards.ts",
    imports: [],
    purpose: "Card persistence layer.",
    symbols: [{ name: "upsertCard", kind: "function" }],
    signatures: ["export function upsertCard(db: Db, c: Card): void"],
    chunks: [
      {
        stable_key: "src/store/cards.ts::upsertCard",
        symbol_path: "upsertCard",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function upsertCard(db: Db, c: Card): void {}",
        start_line: 1,
        end_line: 1,
      },
    ],
  });
});

afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.RETRIEVAL_CODE_SOURCE_INDEX;
});

describe("buildCodeRankedEntries", () => {
  it("returns nothing when the flag is off", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "source rerank",
      enabled: false,
    });
    expect(out).toEqual([]);
  });

  it("returns code entries with kind='code' and a code-shaped contexttrail", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank",
      enabled: true,
      query_anchors: { symbols: ["scoreSourceRerank"] },
      query_intent: "exact_symbol",
    });
    expect(out.length).toBeGreaterThan(0);
    const top = out[0]!;
    expect(top.kind).toBe("code");
    expect(top.contexttrail).toContain("src/retrieve/source-rerank.ts");
    expect(top.body).toContain("scoreSourceRerank");
    expect(top.symbol_path).toBe("scoreSourceRerank");
  });

  it("returns the matching declaration chunk body instead of a file summary blob", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "card persistence",
      enabled: true,
    });
    expect(out.some((e) => e.body.includes("upsertCard"))).toBe(true);
  });

  it("does not add corpus path aliases for query-named historical implementation files", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank structural chunk context flag candidate recall eval",
      enabled: true,
    });

    expect(out[0]?.body).not.toContain("Corpus path aliases");
    expect(out[0]?.body).not.toContain(
      "src/retrieve/structural-chunk-context-flag.ts",
    );
  });

  it("ranks the topically-matching code source above unrelated ones", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "reranker for retrieval",
      enabled: true,
    });
    expect(out[0]?.source_path).toBe("src/retrieve/source-rerank.ts");
  });

  it("returns nothing on an empty or operator-only query (no FTS crash)", () => {
    expect(buildCodeRankedEntries({ db, query: "", enabled: true })).toEqual([]);
    expect(buildCodeRankedEntries({ db, query: "   :", enabled: true })).toEqual([]);
  });

  it("scores fall in [floor, 1]", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "source rerank cards",
      enabled: true,
    });
    for (const e of out) {
      expect(e.score).toBeGreaterThanOrEqual(0);
      expect(e.score).toBeLessThanOrEqual(1);
    }
  });

  it("derives parent-file strength from multiple child chunk hits", () => {
    seedCodeFile({
      path: "src/retrieve/one-hit.ts",
      imports: [],
      purpose: "Single-match file.",
      symbols: [{ name: "singleHit", kind: "function" }],
      signatures: ["export function singleHit(): void"],
      chunks: [
        {
          stable_key: "src/retrieve/one-hit.ts::singleHit",
          symbol_path: "singleHit",
          code_role: "declaration",
          declaration_kind: "function",
          exported: true,
          body: "export function singleHit(): void { rerank(); }",
          start_line: 1,
          end_line: 1,
        },
      ],
    });

    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank tokenizeForRerank",
      enabled: true,
      max_results: 3,
    });

    expect(out[0]?.source_path).toBe("src/retrieve/source-rerank.ts");
    expect(out[0]?.parent_score).toBeGreaterThan(out[1]?.parent_score ?? 0);
  });

  it("selects one best chunk per file before an orientation companion", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank card persistence",
      enabled: true,
      query_anchors: {
        files: ["src/retrieve/source-rerank.ts"],
        symbols: ["scoreSourceRerank"],
      },
      query_intent: "exact_symbol",
      max_results: 3,
    });

    expect(out[0]?.symbol_path).toBe("scoreSourceRerank");
    expect(out[1]?.source_path).toBe("src/store/cards.ts");
    expect(out[2]?.code_role).toBe("orientation");
  });

  it("keeps lexical hits direct and adds graph-traversed neighbors from the shared code graph", () => {
    seedCodeFile({
      path: "src/retrieve/bm25.ts",
      imports: ["src/store/db"],
      purpose: "BM25 scoring substrate.",
      symbols: [{ name: "scoreBm25", kind: "function" }],
      signatures: ["export function scoreBm25(): number"],
      chunks: [
        {
          stable_key: "src/retrieve/bm25.ts::scoreBm25",
          symbol_path: "scoreBm25",
          code_role: "declaration",
          declaration_kind: "function",
          exported: true,
          body: "export function scoreBm25(): number { return 1; }",
          start_line: 1,
          end_line: 1,
        },
      ],
    });
    seedCodeFile({
      path: "src/store/db.ts",
      imports: ["src/store/schema"],
      purpose: "Database open helper.",
      symbols: [{ name: "openDb", kind: "function" }],
      signatures: ["export function openDb(filePath: string): Db"],
      chunks: [
        {
          stable_key: "src/store/db.ts::openDb",
          symbol_path: "openDb",
          code_role: "declaration",
          declaration_kind: "function",
          exported: true,
          body: "export function openDb(filePath: string): Db { throw new Error(); }",
          start_line: 1,
          end_line: 1,
        },
      ],
    });
    seedCodeFile({
      path: "src/store/schema.ts",
      imports: [],
      purpose: "SQLite schema substrate.",
      symbols: [{ name: "createSchema", kind: "function" }],
      signatures: ["export function createSchema(): string"],
      chunks: [
        {
          stable_key: "src/store/schema.ts::createSchema",
          symbol_path: "createSchema",
          code_role: "declaration",
          declaration_kind: "function",
          exported: true,
          body: "export function createSchema(): string { return 'schema'; }",
          start_line: 1,
          end_line: 1,
        },
      ],
    });
    seedCodeFile({
      path: "src/retrieve/consumer.ts",
      imports: ["src/retrieve/source-rerank"],
      purpose: "Consumes rerank results.",
      symbols: [{ name: "consumeRerank", kind: "function" }],
      signatures: ["export function consumeRerank(): void"],
      chunks: [
        {
          stable_key: "src/retrieve/consumer.ts::consumeRerank",
          symbol_path: "consumeRerank",
          code_role: "declaration",
          declaration_kind: "function",
          exported: true,
          body: "export function consumeRerank(): void { runPipeline(); }",
          start_line: 1,
          end_line: 1,
        },
      ],
    });
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: ["src/retrieve/bm25"],
      purpose: "Source-level reranker for retrieval candidates.",
      symbols: [
        { name: "scoreSourceRerank", kind: "function" },
        { name: "tokenizeForRerank", kind: "function" },
      ],
      signatures: ["export function scoreSourceRerank(args: Args): Score"],
      chunks: [
        {
          stable_key: "src/retrieve/source-rerank.ts::scoreSourceRerank",
          symbol_path: "scoreSourceRerank",
          code_role: "declaration",
          declaration_kind: "function",
          exported: true,
          body: "export function scoreSourceRerank(args: Args): Score { return scoreBm25(); }",
          start_line: 1,
          end_line: 1,
        },
      ],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank",
      enabled: true,
      import_max_hops: 1,
    });

    expect(out[0]?.source_path).toBe("src/retrieve/source-rerank.ts");
    expect(out.some((entry) => entry.import_traversed && entry.source_path === "src/retrieve/bm25.ts")).toBe(true);
    expect(out.some((entry) => entry.import_traversed && entry.source_path === "src/retrieve/consumer.ts")).toBe(true);
  });

  it("surfaces winner-centered support-cluster candidates without admitting measurement files", () => {
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: ["src/retrieve/source-profile", "src/store/schema"],
      purpose: "Source rerank owner for source-profile scoring.",
      symbols: [{ name: "scoreSourceRerank", kind: "function" }],
      signatures: ["export function scoreSourceRerank(): number"],
      chunks: [{
        stable_key: "src/retrieve/source-rerank.ts::scoreSourceRerank",
        symbol_path: "scoreSourceRerank",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreSourceRerank(): number { return scoreSourceProfile(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-profile.ts",
      imports: ["src/store/schema"],
      purpose: "SourceProfile scoring substrate for canonical source ranking.",
      symbols: [{ name: "scoreSourceProfile", kind: "function" }],
      signatures: ["export function scoreSourceProfile(): number"],
      chunks: [{
        stable_key: "src/retrieve/source-profile.ts::scoreSourceProfile",
        symbol_path: "scoreSourceProfile",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreSourceProfile(): number { return 1; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/schema.ts",
      imports: [],
      purpose: "SQLite schema substrate for retrieval source profiles.",
      symbols: [{ name: "createSchema", kind: "function" }],
      signatures: ["export function createSchema(): string"],
      chunks: [{
        stable_key: "src/store/schema.ts::createSchema",
        symbol_path: "createSchema",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function createSchema(): string { return 'source_profiles'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/eval/source-rerank-probe.ts",
      imports: ["src/retrieve/source-rerank"],
      purpose: "Measurement probe for source-rerank corpus evaluation.",
      symbols: [{ name: "runSourceRerankProbe", kind: "function" }],
      signatures: ["export function runSourceRerankProbe(): void"],
      chunks: [{
        stable_key: "src/eval/source-rerank-probe.ts::runSourceRerankProbe",
        symbol_path: "runSourceRerankProbe",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function runSourceRerankProbe(): void { /* measurement only */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank source profile ranking",
      enabled: true,
      query_anchors: { symbols: ["scoreSourceRerank"] },
      query_intent: "exact_symbol",
      max_results: 4,
    });

    expect(out[0]?.source_path).toBe("src/retrieve/source-rerank.ts");
    const support = out.filter((entry) => entry.support_cluster?.role === "support");
    expect(support.map((entry) => entry.source_path).sort()).toEqual([
      "src/retrieve/source-profile.ts",
      "src/store/schema.ts",
    ]);
    expect(support.every((entry) =>
      entry.support_cluster?.seed_source_path === "src/retrieve/source-rerank.ts",
    )).toBe(true);
    expect(out.some((entry) => entry.source_path.startsWith("src/eval/"))).toBe(false);
  });

  it("bounds support-cluster admission even when support files are also direct lexical hits", () => {
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: ["src/retrieve/source-profile", "src/store/schema"],
      purpose: "Source rerank owner for source-profile and schema scoring.",
      symbols: [{ name: "scoreSourceRerank", kind: "function" }],
      signatures: ["export function scoreSourceRerank(): number"],
      chunks: [{
        stable_key: "src/retrieve/source-rerank.ts::scoreSourceRerank",
        symbol_path: "scoreSourceRerank",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreSourceRerank(): number { return 1; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-profile.ts",
      imports: [],
      purpose: "SourceProfile support substrate for source ranking.",
      symbols: [{ name: "loadSourceProfile", kind: "function" }],
      signatures: ["export function loadSourceProfile(): void"],
      chunks: [{
        stable_key: "src/retrieve/source-profile.ts::loadSourceProfile",
        symbol_path: "loadSourceProfile",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function loadSourceProfile(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/schema.ts",
      imports: [],
      purpose: "Schema support substrate for source ranking.",
      symbols: [{ name: "loadSchema", kind: "function" }],
      signatures: ["export function loadSchema(): void"],
      chunks: [{
        stable_key: "src/store/schema.ts::loadSchema",
        symbol_path: "loadSchema",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function loadSchema(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank source profile schema ranking",
      enabled: true,
      query_anchors: { symbols: ["scoreSourceRerank"] },
      query_intent: "exact_symbol",
      max_results: 5,
      import_traversed_max_results: 1,
      import_traversed_max_tokens: 10000,
    });

    expect(out[0]?.support_cluster?.role).toBe("primary");
    const support = out.filter((entry) => entry.support_cluster?.role === "support");
    expect(support).toHaveLength(1);
    expect(support[0]?.support_cluster?.seed_source_path).toBe(
      "src/retrieve/source-rerank.ts",
    );
  });

  it("prefers fewer support-cluster entries over passive example or report neighbors", () => {
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: ["src/retrieve/source-rerank-example"],
      purpose: "Source rerank owner for production scoring.",
      symbols: [{ name: "scoreSourceRerank", kind: "function" }],
      signatures: ["export function scoreSourceRerank(): number"],
      chunks: [{
        stable_key: "src/retrieve/source-rerank.ts::scoreSourceRerank",
        symbol_path: "scoreSourceRerank",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreSourceRerank(): number { return 1; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-rerank-example.ts",
      imports: [],
      purpose: "Example report for source rerank demos.",
      symbols: [{ name: "renderSourceRerankExample", kind: "function" }],
      signatures: ["export function renderSourceRerankExample(): string"],
      chunks: [{
        stable_key: "src/retrieve/source-rerank-example.ts::renderSourceRerankExample",
        symbol_path: "renderSourceRerankExample",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderSourceRerankExample(): string { return 'demo'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank production scoring",
      enabled: true,
      query_anchors: { symbols: ["scoreSourceRerank"] },
      query_intent: "exact_symbol",
      max_results: 4,
    });

    expect(out[0]?.source_path).toBe("src/retrieve/source-rerank.ts");
    expect(out.filter((entry) => entry.support_cluster?.role === "support")).toEqual([]);
  });

  it("adds bounded same-family substrate support around a source-profile winner", () => {
    seedCodeFile({
      path: "src/parse/source-profile.ts",
      imports: [],
      purpose: "Builds SourceProfile metadata during import.",
      symbols: [{ name: "buildSourceProfile", kind: "function" }],
      signatures: ["export function buildSourceProfile(): SourceProfile"],
      chunks: [{
        stable_key: "src/parse/source-profile.ts::buildSourceProfile",
        symbol_path: "buildSourceProfile",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function buildSourceProfile(): SourceProfile { throw new Error(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/source-profiles.ts",
      imports: [],
      purpose: "Persists SourceProfile records in the database.",
      symbols: [{ name: "upsertSourceProfile", kind: "function" }],
      signatures: ["export function upsertSourceProfile(): void"],
      chunks: [{
        stable_key: "src/store/source-profiles.ts::upsertSourceProfile",
        symbol_path: "upsertSourceProfile",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function upsertSourceProfile(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/types/source-profile.ts",
      imports: [],
      purpose: "Shared SourceProfile type definitions.",
      symbols: [{ name: "SourceProfile", kind: "interface" }],
      signatures: ["export interface SourceProfile {}"],
      chunks: [{
        stable_key: "src/types/source-profile.ts::orientation",
        symbol_path: null,
        code_role: "orientation",
        declaration_kind: null,
        exported: false,
        body: "/** Shared SourceProfile type definitions. */",
        start_line: 1,
        end_line: 1,
      }, {
        stable_key: "src/types/source-profile.ts::SourceProfile",
        symbol_path: "SourceProfile",
        code_role: "declaration",
        declaration_kind: "interface",
        exported: true,
        body: "export interface SourceProfile {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-profile-report.ts",
      imports: [],
      purpose: "Example report for SourceProfile diagnostics.",
      symbols: [{ name: "renderSourceProfileReport", kind: "function" }],
      signatures: ["export function renderSourceProfileReport(): string"],
      chunks: [{
        stable_key: "src/retrieve/source-profile-report.ts::renderSourceProfileReport",
        symbol_path: "renderSourceProfileReport",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderSourceProfileReport(): string { return 'report'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "SourceProfile nav fields buildSourceProfile",
      enabled: true,
      query_anchors: {
        files: ["src/parse/source-profile.ts"],
        symbols: ["buildSourceProfile"],
      },
      query_intent: "exact_symbol",
      max_results: 4,
    });

    expect(out[0]?.source_path).toBe("src/parse/source-profile.ts");
    expect(out.filter((entry) => entry.support_cluster?.role === "support").map((entry) => entry.source_path).sort()).toEqual([
      "src/store/source-profiles.ts",
      "src/types/source-profile.ts",
    ]);
  });

  it("uses a compact orientation chunk when a support file's matching declaration would blow the support budget", () => {
    seedCodeFile({
      path: "src/parse/source-profile.ts",
      imports: [],
      purpose: "Builds SourceProfile metadata during import.",
      symbols: [{ name: "buildSourceProfile", kind: "function" }],
      signatures: ["export function buildSourceProfile(): SourceProfile"],
      chunks: [{
        stable_key: "src/parse/source-profile.ts::buildSourceProfile",
        symbol_path: "buildSourceProfile",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function buildSourceProfile(): SourceProfile { throw new Error(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/types/source-profile.ts",
      imports: [],
      purpose: "Shared SourceProfile type definitions.",
      symbols: [{ name: "SourceProfile", kind: "interface" }],
      signatures: ["export interface SourceProfile {}"],
      chunks: [{
        stable_key: "src/types/source-profile.ts::orientation",
        symbol_path: null,
        code_role: "orientation",
        declaration_kind: null,
        exported: false,
        body: "/** Shared SourceProfile type definitions. */",
        start_line: 1,
        end_line: 1,
      }, {
        stable_key: "src/types/source-profile.ts::SourceProfile",
        symbol_path: "SourceProfile",
        code_role: "declaration",
        declaration_kind: "interface",
        exported: true,
        body: Array.from({ length: 220 }, () => "field: string;").join("\n"),
        start_line: 2,
        end_line: 222,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "SourceProfile buildSourceProfile type definitions",
      enabled: true,
      query_anchors: {
        files: ["src/parse/source-profile.ts"],
        symbols: ["buildSourceProfile"],
      },
      query_intent: "exact_symbol",
      max_results: 3,
      import_traversed_max_results: 2,
      import_traversed_max_tokens: 200,
    });

    const support = out.find((entry) =>
      entry.source_path === "src/types/source-profile.ts" &&
      entry.support_cluster?.role === "support",
    );
    expect(support?.code_role).toBe("orientation");
    expect(support?.tokens).toBeLessThan(200);
  });

  it("orders compact support-cluster entries ahead of incidental lexical hits", () => {
    seedCodeFile({
      path: "src/parse/source-profile.ts",
      imports: [],
      purpose: "Builds SourceProfile metadata during import.",
      symbols: [{ name: "buildSourceProfile", kind: "function" }],
      signatures: ["export function buildSourceProfile(): SourceProfile"],
      chunks: [{
        stable_key: "src/parse/source-profile.ts::buildSourceProfile",
        symbol_path: "buildSourceProfile",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function buildSourceProfile(): SourceProfile { throw new Error(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/types/source-profile.ts",
      imports: [],
      purpose: "Shared SourceProfile type definitions.",
      symbols: [{ name: "SourceProfile", kind: "interface" }],
      signatures: ["export interface SourceProfile {}"],
      chunks: [{
        stable_key: "src/types/source-profile.ts::orientation",
        symbol_path: null,
        code_role: "orientation",
        declaration_kind: null,
        exported: false,
        body: "/** Shared SourceProfile type definitions. */",
        start_line: 1,
        end_line: 1,
      }, {
        stable_key: "src/types/source-profile.ts::SourceProfile",
        symbol_path: "SourceProfile",
        code_role: "declaration",
        declaration_kind: "interface",
        exported: true,
        body: Array.from({ length: 180 }, () => "navField?: string;").join("\n"),
        start_line: 2,
        end_line: 182,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/nav-fields.ts",
      imports: [],
      purpose: "Lexical nav fields helper that is not SourceProfile substrate.",
      symbols: [{ name: "renderNavFields", kind: "function" }],
      signatures: ["export function renderNavFields(): string"],
      chunks: [{
        stable_key: "src/retrieve/nav-fields.ts::renderNavFields",
        symbol_path: "renderNavFields",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderNavFields(): string { return 'SourceProfile nav fields'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "SourceProfile nav fields buildSourceProfile",
      enabled: true,
      query_anchors: {
        files: ["src/parse/source-profile.ts"],
        symbols: ["buildSourceProfile"],
      },
      query_intent: "exact_symbol",
      max_results: 5,
    });

    const supportIndex = out.findIndex((entry) =>
      entry.source_path === "src/types/source-profile.ts" &&
      entry.support_cluster?.role === "support",
    );
    const incidentalIndex = out.findIndex((entry) =>
      entry.source_path === "src/retrieve/nav-fields.ts",
    );
    expect(supportIndex).toBeGreaterThan(0);
    expect(incidentalIndex).toBeGreaterThan(supportIndex);
    expect(out[supportIndex]?.code_role).toBe("orientation");
  });

  it("does not satisfy file coverage by injecting corpus-specific path aliases into code bodies", () => {
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: [],
      purpose: "Source rerank owner.",
      symbols: [{ name: "scoreSourceRerank", kind: "function" }],
      signatures: ["export function scoreSourceRerank(): number"],
      chunks: [{
        stable_key: "src/retrieve/source-rerank.ts::scoreSourceRerank",
        symbol_path: "scoreSourceRerank",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreSourceRerank(): number { return 1; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "chunk structural context flag reindex scoreSourceRerank",
      enabled: true,
      query_anchors: { symbols: ["scoreSourceRerank"] },
      query_intent: "exact_symbol",
      max_results: 3,
    });

    expect(out.length).toBeGreaterThan(0);
    expect(out.map((entry) => entry.body).join("\n")).not.toContain(
      "src/parse/chunk-structural-context.ts",
    );
    expect(out.map((entry) => entry.body).join("\n")).not.toContain(
      "Corpus path aliases",
    );
  });

  it("keeps support-cluster candidates centered on the primary winner at larger result caps", () => {
    seedCodeFile({
      path: "src/retrieve/primary-owner.ts",
      imports: ["src/store/primary-schema"],
      purpose: "Primary owner for source-profile work.",
      symbols: [{ name: "primaryOwner", kind: "function" }],
      signatures: ["export function primaryOwner(): void"],
      chunks: [{
        stable_key: "src/retrieve/primary-owner.ts::primaryOwner",
        symbol_path: "primaryOwner",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function primaryOwner(): void { sourceProfile(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/primary-schema.ts",
      imports: [],
      purpose: "Schema substrate for the primary owner.",
      symbols: [{ name: "primarySchema", kind: "function" }],
      signatures: ["export function primarySchema(): void"],
      chunks: [{
        stable_key: "src/store/primary-schema.ts::primarySchema",
        symbol_path: "primarySchema",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function primarySchema(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/secondary-owner.ts",
      imports: ["src/store/secondary-schema"],
      purpose: "Secondary lexical hit that should not seed the support cluster.",
      symbols: [{ name: "secondaryOwner", kind: "function" }],
      signatures: ["export function secondaryOwner(): void"],
      chunks: [{
        stable_key: "src/retrieve/secondary-owner.ts::secondaryOwner",
        symbol_path: "secondaryOwner",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function secondaryOwner(): void { sourceProfile(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/secondary-schema.ts",
      imports: [],
      purpose: "Schema substrate for the secondary lexical hit.",
      symbols: [{ name: "secondarySchema", kind: "function" }],
      signatures: ["export function secondarySchema(): void"],
      chunks: [{
        stable_key: "src/store/secondary-schema.ts::secondarySchema",
        symbol_path: "secondarySchema",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function secondarySchema(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "primaryOwner secondaryOwner sourceProfile schema",
      enabled: true,
      query_anchors: { symbols: ["primaryOwner"] },
      query_intent: "exact_symbol",
      max_results: 20,
    });

    const support = out.filter((entry) => entry.support_cluster?.role === "support");
    expect(out[0]?.source_path).toBe("src/retrieve/primary-owner.ts");
    expect(support.map((entry) => entry.source_path)).toContain(
      "src/store/primary-schema.ts",
    );
    expect(support.map((entry) => entry.source_path)).not.toContain(
      "src/store/secondary-schema.ts",
    );
    expect(support.every((entry) =>
      entry.support_cluster?.seed_source_path === "src/retrieve/primary-owner.ts",
    )).toBe(true);
  });

  it("promotes SourceProfile family companions into the first code slate over passive lexical hits", () => {
    seedCodeFile({
      path: "src/parse/source-profile.ts",
      imports: [],
      purpose: "Builds SourceProfile metadata during import.",
      symbols: [{ name: "buildSourceProfile", kind: "function" }],
      signatures: ["export function buildSourceProfile(): SourceProfile"],
      chunks: [{
        stable_key: "src/parse/source-profile.ts::buildSourceProfile",
        symbol_path: "buildSourceProfile",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function buildSourceProfile(): SourceProfile { throw new Error(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/schema.ts",
      imports: [],
      purpose: "SQLite schema substrate for SourceProfile persistence.",
      symbols: [{ name: "createSchema", kind: "function" }],
      signatures: ["export function createSchema(): string"],
      chunks: [{
        stable_key: "src/store/schema.ts::createSchema",
        symbol_path: "createSchema",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function createSchema(): string { return 'source_profiles'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/types/source-profile.ts",
      imports: [],
      purpose: "Shared SourceProfile type definitions.",
      symbols: [{ name: "SourceProfile", kind: "interface" }],
      signatures: ["export interface SourceProfile {}"],
      chunks: [{
        stable_key: "src/types/source-profile.ts::SourceProfile",
        symbol_path: "SourceProfile",
        code_role: "declaration",
        declaration_kind: "interface",
        exported: true,
        body: "export interface SourceProfile {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-profile-report.ts",
      imports: [],
      purpose: "Passive SourceProfile schema report for diagnostics.",
      symbols: [{ name: "renderSourceProfileReport", kind: "function" }],
      signatures: ["export function renderSourceProfileReport(): string"],
      chunks: [{
        stable_key: "src/retrieve/source-profile-report.ts::renderSourceProfileReport",
        symbol_path: "renderSourceProfileReport",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderSourceProfileReport(): string { return 'SourceProfile schema buildSourceProfile report'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "SourceProfile schema buildSourceProfile",
      enabled: true,
      query_anchors: {
        files: ["src/parse/source-profile.ts"],
        symbols: ["buildSourceProfile"],
      },
      query_intent: "exact_symbol",
      max_results: 4,
    });

    const firstSlate = out.slice(0, 3).map((entry) => entry.source_path);
    expect(firstSlate[0]).toBe("src/parse/source-profile.ts");
    expect(firstSlate).toContain("src/types/source-profile.ts");
    expect(firstSlate).toContain("src/store/schema.ts");
    expect(firstSlate).not.toContain("src/retrieve/source-profile-report.ts");
    const schemaSupport = out.find((entry) =>
      entry.source_path === "src/store/schema.ts"
    );
    expect(schemaSupport?.support_cluster?.reason).toBe("code_family_evidence");
    expect(schemaSupport?.support_cluster?.family_evidence?.reasons).toContain(
      "source_profile_companion",
    );
  });

  it("uses code-family evidence for persistence and import workflow first-slate companions", () => {
    seedCodeFile({
      path: "src/cli/import.ts",
      imports: [],
      purpose: "CLI import and reindex workflow entrypoint.",
      symbols: [{ name: "runImport", kind: "function" }],
      signatures: ["export function runImport(): void"],
      chunks: [{
        stable_key: "src/cli/import.ts::runImport",
        symbol_path: "runImport",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function runImport(): void { /* import docs and code */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/parse/chunker.ts",
      imports: [],
      purpose: "Parser and chunker for import-time indexing.",
      symbols: [{ name: "chunkMarkdown", kind: "function" }],
      signatures: ["export function chunkMarkdown(): void"],
      chunks: [{
        stable_key: "src/parse/chunker.ts::chunkMarkdown",
        symbol_path: "chunkMarkdown",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function chunkMarkdown(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/code-chunks.ts",
      imports: [],
      purpose: "Persists code chunks for the retrieval index.",
      symbols: [{ name: "replaceCodeChunksForSource", kind: "function" }],
      signatures: ["export function replaceCodeChunksForSource(): void"],
      chunks: [{
        stable_key: "src/store/code-chunks.ts::replaceCodeChunksForSource",
        symbol_path: "replaceCodeChunksForSource",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function replaceCodeChunksForSource(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/eval/import-workflow-report.ts",
      imports: [],
      purpose: "Report for import workflow validation metrics.",
      symbols: [{ name: "renderImportWorkflowReport", kind: "function" }],
      signatures: ["export function renderImportWorkflowReport(): string"],
      chunks: [{
        stable_key: "src/eval/import-workflow-report.ts::renderImportWorkflowReport",
        symbol_path: "renderImportWorkflowReport",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderImportWorkflowReport(): string { return 'import reindex chunk index report'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "CLI import reindex chunkMarkdown replaceCodeChunksForSource storage",
      enabled: true,
      query_anchors: {
        files: ["src/cli/import.ts"],
        symbols: ["runImport"],
      },
      query_intent: "exact_symbol",
      max_results: 4,
    });

    const firstSlate = out.slice(0, 3).map((entry) => entry.source_path);
    expect(firstSlate[0]).toBe("src/cli/import.ts");
    expect(firstSlate).toContain("src/parse/chunker.ts");
    expect(firstSlate).toContain("src/store/code-chunks.ts");
    expect(firstSlate).not.toContain("src/eval/import-workflow-report.ts");

    const supportReasons = out
      .filter((entry) => entry.support_cluster?.role === "support")
      .flatMap((entry) => entry.support_cluster?.family_evidence?.reasons ?? []);
    expect(supportReasons).toContain("import_workflow_companion");
    expect(supportReasons).toContain("persistence_companion");
  });

  it("uses compact orientation projection for oversized broad-query direct hits", () => {
    seedCodeFile({
      path: "src/store/schema.ts",
      imports: [],
      purpose: "SQLite schema substrate.",
      symbols: [{ name: "SCHEMA_DDL", kind: "const" }],
      signatures: ["export const SCHEMA_DDL = `...`"],
      chunks: [
        {
          stable_key: "src/store/schema.ts::orientation",
          symbol_path: null,
          code_role: "orientation",
          declaration_kind: null,
          exported: false,
          body: "Schema persistence overview for chunks and source profiles.",
          start_line: 1,
          end_line: 1,
        },
        {
          stable_key: "src/store/schema.ts::SCHEMA_DDL",
          symbol_path: "SCHEMA_DDL",
          code_role: "declaration",
          declaration_kind: "const",
          exported: true,
          body: Array.from({ length: 900 }, () => "schema").join(" "),
          start_line: 2,
          end_line: 900,
        },
      ],
    });

    const out = buildCodeRankedEntries({
      db,
      query: "schema migration storage",
      enabled: true,
      query_intent: "broad_domain",
      max_results: 2,
    });

    const schema = out.find((entry) => entry.source_path === "src/store/schema.ts");
    expect(schema?.code_role).toBe("orientation");
    expect(schema?.tokens).toBeLessThan(100);
  });

  it("caps import-traversed additions to the nearest graph neighbors first", () => {
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: ["src/retrieve/bm25"],
      purpose: "Source rerank root.",
      symbols: [{ name: "scoreSourceRerank", kind: "function" }],
      signatures: ["export function scoreSourceRerank(): number"],
      chunks: [{
        stable_key: "src/retrieve/source-rerank.ts::scoreSourceRerank",
        symbol_path: "scoreSourceRerank",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreSourceRerank(): number { return 1; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/bm25.ts",
      imports: ["src/store/db"],
      purpose: "Direct outgoing neighbor.",
      symbols: [{ name: "scoreBm25", kind: "function" }],
      signatures: ["export function scoreBm25(): number"],
      chunks: [{
        stable_key: "src/retrieve/bm25.ts::scoreBm25",
        symbol_path: "scoreBm25",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreBm25(): number { return 1; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/db.ts",
      imports: [],
      purpose: "Second-hop outgoing neighbor.",
      symbols: [{ name: "openDb", kind: "function" }],
      signatures: ["export function openDb(filePath: string): Db"],
      chunks: [{
        stable_key: "src/store/db.ts::openDb",
        symbol_path: "openDb",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function openDb(filePath: string): Db { throw new Error(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/consumer.ts",
      imports: ["src/retrieve/source-rerank"],
      purpose: "Direct incoming neighbor.",
      symbols: [{ name: "consumeRerank", kind: "function" }],
      signatures: ["export function consumeRerank(): void"],
      chunks: [{
        stable_key: "src/retrieve/consumer.ts::consumeRerank",
        symbol_path: "consumeRerank",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function consumeRerank(): void { runPipeline(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/entry.ts",
      imports: ["src/retrieve/consumer"],
      purpose: "Second-hop incoming neighbor.",
      symbols: [{ name: "entrypoint", kind: "function" }],
      signatures: ["export function entrypoint(): void"],
      chunks: [{
        stable_key: "src/retrieve/entry.ts::entrypoint",
        symbol_path: "entrypoint",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function entrypoint(): void { consumeRerank(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank",
      enabled: true,
      import_max_hops: 2,
      import_traversed_max_results: 2,
      import_traversed_max_tokens: 10000,
    });

    const traversed = out
      .filter((entry) => entry.import_traversed)
      .map((entry) => entry.source_path)
      .sort();

    expect(traversed).toEqual([
      "src/retrieve/bm25.ts",
      "src/retrieve/consumer.ts",
    ]);
  });

  it("caps import-traversed token mass", () => {
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: ["src/retrieve/small-neighbor"],
      purpose: "Source rerank root.",
      symbols: [{ name: "scoreSourceRerank", kind: "function" }],
      signatures: ["export function scoreSourceRerank(): number"],
      chunks: [{
        stable_key: "src/retrieve/source-rerank.ts::scoreSourceRerank",
        symbol_path: "scoreSourceRerank",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreSourceRerank(): number { return 1; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/small-neighbor.ts",
      imports: [],
      purpose: "Small graph neighbor.",
      symbols: [{ name: "smallNeighbor", kind: "function" }],
      signatures: ["export function smallNeighbor(): void"],
      chunks: [{
        stable_key: "src/retrieve/small-neighbor.ts::smallNeighbor",
        symbol_path: "smallNeighbor",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function smallNeighbor(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/large-neighbor.ts",
      imports: ["src/retrieve/source-rerank"],
      purpose: Array.from({ length: 200 }, () => "oversized").join(" "),
      symbols: [{ name: "largeNeighbor", kind: "function" }],
      signatures: ["export function largeNeighbor(): void"],
      chunks: [{
        stable_key: "src/retrieve/large-neighbor.ts::largeNeighbor",
        symbol_path: "largeNeighbor",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: Array.from({ length: 200 }, () => "oversized").join(" "),
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const uncapped = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank",
      enabled: true,
      import_max_hops: 1,
      import_traversed_max_results: 10,
      import_traversed_max_tokens: 10000,
    });
    const uncappedTraversed = uncapped.filter((entry) =>
      entry.import_traversed,
    );
    const small = uncappedTraversed.find((entry) =>
      entry.source_path.includes("small-neighbor.ts"),
    );
    expect(small).toBeDefined();

    const capped = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank",
      enabled: true,
      import_max_hops: 1,
      import_traversed_max_results: 10,
      import_traversed_max_tokens: small!.tokens,
    });
    const cappedTraversed = capped.filter((entry) =>
      entry.import_traversed,
    );

    expect(cappedTraversed.reduce((sum, entry) => sum + entry.tokens, 0)).toBeLessThanOrEqual(
      small!.tokens,
    );
    expect(cappedTraversed.some((entry) => entry.source_path.includes("small-neighbor.ts"))).toBe(
      true,
    );
    expect(cappedTraversed.some((entry) => entry.source_path.includes("large-neighbor.ts"))).toBe(
      false,
    );
  });
});

function seedCodeFile(args: {
  path: string;
  imports: string[];
  purpose: string | null;
  symbols: Array<{ name: string; kind: "function" | "type" | "interface" | "class" | "const" | "enum" }>;
  signatures: string[];
  chunks: Array<{
    stable_key: string;
    symbol_path: string | null;
    code_role: "orientation" | "declaration";
    declaration_kind:
      | "function"
      | "type"
      | "interface"
      | "class"
      | "const"
      | "enum"
      | "method"
      | null;
    exported: boolean;
    body: string;
    start_line: number;
    end_line: number;
  }>;
}): void {
  upsertCodeSource(db, {
    facts: {
      file_path: args.path,
      exported_symbols: args.symbols,
      exported_signatures: args.signatures,
      file_purpose: args.purpose,
      imports: args.imports,
    },
    source_content_hash: `hash:${args.path}`,
    indexed_at: "2026-05-11T00:00:00Z",
  });
  replaceCodeChunksForSource(db, {
    source_path: args.path,
    source_content_hash: `hash:${args.path}`,
    indexed_at: "2026-05-11T00:00:00Z",
    chunks: args.chunks.map((chunk) => ({
      source_path: args.path,
      ...chunk,
    })),
  });
}
