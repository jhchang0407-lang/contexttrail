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
import {
  buildCodeRankedEntries,
  resolveCodeLaneRankingMethod,
} from "./code-source-mix.js";

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

  it("treats source as a generic prompt word instead of a reason to rank source.ts first", () => {
    seedCodeFile({
      path: "packages/docs/loaders/source.ts",
      imports: [],
      purpose: "Documentation source loader.",
      symbols: [{ name: "source", kind: "const" }],
      signatures: ["export const source = loader()"],
      chunks: [{
        stable_key: "packages/docs/loaders/source.ts::source",
        symbol_path: "source",
        code_role: "declaration",
        declaration_kind: "const",
        exported: true,
        body: "const source = loader({ source: docs.toFumadocsSource() });",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "packages/zod/src/v4/core/regexes.ts",
      imports: [],
      purpose: "Core validation regex definitions.",
      symbols: [{ name: "cidrv6", kind: "const" }],
      signatures: ["export const cidrv6: RegExp"],
      chunks: [{
        stable_key: "packages/zod/src/v4/core/regexes.ts::cidrv6",
        symbol_path: "cidrv6",
        code_role: "declaration",
        declaration_kind: "const",
        exported: true,
        body: "const cidrv6: RegExp = /^ipv6-cidr-pattern$/;",
        start_line: 1,
        end_line: 1,
      }],
    });

    const out = buildCodeRankedEntries({
      db,
      query: "packages zod core regexes source implementation",
      enabled: true,
      max_results: 3,
    });

    expect(out[0]?.source_path).toBe("packages/zod/src/v4/core/regexes.ts");
  });

  it("lets an exact symbol token beat broader multi-token implementation noise", () => {
    seedCodeFile({
      path: "packages/zod/src/v4/core/regexes.ts",
      imports: [],
      purpose: "Core validation regex definitions.",
      symbols: [{ name: "cidrv6", kind: "const" }],
      signatures: ["export const cidrv6: RegExp"],
      chunks: [{
        stable_key: "packages/zod/src/v4/core/regexes.ts::cidrv6",
        symbol_path: "cidrv6",
        code_role: "declaration",
        declaration_kind: "const",
        exported: true,
        body: "const cidrv6: RegExp = /^ipv6-cidr-pattern$/;",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "packages/zod/src/v4/core/json-schema-processors.ts",
      imports: [],
      purpose: "JSON schema pattern processor runtime.",
      symbols: [{ name: "stringProcessor", kind: "const" }],
      signatures: ["export const stringProcessor: Processor"],
      chunks: [{
        stable_key: "packages/zod/src/v4/core/json-schema-processors.ts::stringProcessor",
        symbol_path: "stringProcessor",
        code_role: "declaration",
        declaration_kind: "const",
        exported: true,
        body: "const stringProcessor = jsonSchemaPatternRuntime(json, schema, pattern, runtime);",
        start_line: 1,
        end_line: 1,
      }],
    });

    const out = buildCodeRankedEntries({
      db,
      query: "fix(v4): cidrv6 JSON schema pattern matches runtime",
      enabled: true,
      max_results: 3,
    });

    expect(out[0]?.source_path).toBe("packages/zod/src/v4/core/regexes.ts");
  });

  it("boosts split path tokens so basename matches beat broad same-package files", () => {
    seedCodeFile({
      path: "crates/biome_configuration/src/vcs.rs",
      imports: [],
      purpose: "VCS configuration options.",
      symbols: [{ name: "VcsConfiguration", kind: "class" }],
      signatures: ["pub struct VcsConfiguration"],
      chunks: [{
        stable_key: "crates/biome_configuration/src/vcs.rs::orientation",
        symbol_path: null,
        code_role: "orientation",
        declaration_kind: null,
        exported: false,
        body: "Code file: crates/biome_configuration/src/vcs.rs\nExports: class VcsConfiguration",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "crates/biome_configuration/src/json.rs",
      imports: [],
      purpose: "Biome configuration schema with many generic configuration terms.",
      symbols: [{ name: "JsonConfiguration", kind: "class" }],
      signatures: ["pub struct JsonConfiguration"],
      chunks: [{
        stable_key: "crates/biome_configuration/src/json.rs::orientation",
        symbol_path: null,
        code_role: "orientation",
        declaration_kind: null,
        exported: false,
        body: "Code file: crates/biome_configuration/src/json.rs\nconfiguration configuration configuration biome crates",
        start_line: 1,
        end_line: 1,
      }],
    });

    const out = buildCodeRankedEntries({
      db,
      query: "crates biome configuration vcs source implementation",
      enabled: true,
      max_results: 3,
    });

    expect(out[0]?.source_path).toBe("crates/biome_configuration/src/vcs.rs");
  });

  it("keeps explicit crate path prompts ahead of same-word package names", () => {
    seedCodeFile({
      path: "packages/create-turbo/src/commands/create/index.ts",
      imports: ["packages/create-turbo/src/transforms/errors"],
      purpose: "Create Turbo package command.",
      symbols: [{ name: "create", kind: "function" }],
      signatures: ["export function create(): void"],
      chunks: [{
        stable_key: "packages/create-turbo/src/commands/create/index.ts::create",
        symbol_path: "create",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function create(): void { /* create turbo package command */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "packages/create-turbo/src/transforms/errors.ts",
      imports: [],
      purpose: "Create Turbo transform errors.",
      symbols: [{ name: "TransformErrorOptions", kind: "interface" }],
      signatures: ["export interface TransformErrorOptions"],
      chunks: [{
        stable_key: "packages/create-turbo/src/transforms/errors.ts::TransformErrorOptions",
        symbol_path: "TransformErrorOptions",
        code_role: "declaration",
        declaration_kind: "interface",
        exported: true,
        body: "export interface TransformErrorOptions { transform?: string }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "crates/turborepo-cache/src/cache_archive/mod.rs",
      imports: [],
      purpose: "Cache archive module.",
      symbols: [],
      signatures: [],
      chunks: [{
        stable_key: "crates/turborepo-cache/src/cache_archive/mod.rs::orientation",
        symbol_path: null,
        code_role: "orientation",
        declaration_kind: null,
        exported: false,
        body: "Code file: crates/turborepo-cache/src/cache_archive/mod.rs",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "crates/turborepo-cache/src/cache_archive/create.rs",
      imports: [],
      purpose: "Create cache archive entries.",
      symbols: [],
      signatures: [],
      chunks: [{
        stable_key: "crates/turborepo-cache/src/cache_archive/create.rs::orientation",
        symbol_path: null,
        code_role: "orientation",
        declaration_kind: null,
        exported: false,
        body: "Code file: crates/turborepo-cache/src/cache_archive/create.rs",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "crates turborepo cache archive create source implementation",
      enabled: true,
      max_results: 4,
    });

    expect(out[0]?.source_path).toBe("crates/turborepo-cache/src/cache_archive/create.rs");
  });

  it("filters passive benchmark/example/type-test paths unless the query asks for them", () => {
    seedCodeFile({
      path: "benchmarks/webapp/hono.js",
      imports: [],
      purpose: "Benchmark webapp for Hono streaming.",
      symbols: [{ name: "hono", kind: "function" }],
      signatures: ["function hono()"],
      chunks: [{
        stable_key: "benchmarks/webapp/hono.js::hono",
        symbol_path: "hono",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "function hono() { /* stream abort handling benchmark */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "type-tests/mysql/db.ts",
      imports: [],
      purpose: "Type tests for database pool detection.",
      symbols: [{ name: "pool", kind: "const" }],
      signatures: ["const pool = createPool()"],
      chunks: [{
        stable_key: "type-tests/mysql/db.ts::pool",
        symbol_path: "pool",
        code_role: "declaration",
        declaration_kind: "const",
        exported: true,
        body: "const pool = createPool(); // node postgres pool detection",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "examples/basic/stream.ts",
      imports: [],
      purpose: "Example stream demo.",
      symbols: [{ name: "streamExample", kind: "function" }],
      signatures: ["export function streamExample(): void"],
      chunks: [{
        stable_key: "examples/basic/stream.ts::streamExample",
        symbol_path: "streamExample",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function streamExample(): void { /* stream abort handling */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/utils/stream.ts",
      imports: [],
      purpose: "Runtime stream utilities.",
      symbols: [{ name: "abortStream", kind: "function" }],
      signatures: ["export function abortStream(): void"],
      chunks: [{
        stable_key: "src/utils/stream.ts::abortStream",
        symbol_path: "abortStream",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function abortStream(): void { /* stream abort handling */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const implementation = buildCodeRankedEntries({
      db,
      query: "fix stream abort handling implementation files",
      enabled: true,
      max_results: 8,
    });
    expect(implementation.map((entry) => entry.source_path)).toContain(
      "src/utils/stream.ts",
    );
    expect(implementation.map((entry) => entry.source_path)).not.toContain(
      "benchmarks/webapp/hono.js",
    );
    expect(implementation.map((entry) => entry.source_path)).not.toContain(
      "type-tests/mysql/db.ts",
    );
    expect(implementation.map((entry) => entry.source_path)).not.toContain(
      "examples/basic/stream.ts",
    );

    const benchmark = buildCodeRankedEntries({
      db,
      query: "benchmark stream abort handling",
      enabled: true,
      max_results: 8,
    });
    expect(benchmark.map((entry) => entry.source_path)).toContain(
      "benchmarks/webapp/hono.js",
    );
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

  it("admits persistence substrate support by family evidence without import edges", () => {
    seedCodeFile({
      path: "src/store/schema.ts",
      imports: [],
      purpose: "SQLite schema substrate for card persistence tables.",
      symbols: [{ name: "createSchema", kind: "function" }],
      signatures: ["export function createSchema(): string"],
      chunks: [{
        stable_key: "src/store/schema.ts::createSchema",
        symbol_path: "createSchema",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function createSchema(): string { return 'cards'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/db.ts",
      imports: [],
      purpose: "Database open helper for persisted card storage.",
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
      path: "src/store/code-chunks.ts",
      imports: [],
      purpose: "Chunk storage helpers for persisted retrieval records.",
      symbols: [{ name: "replaceCodeChunksForSource", kind: "function" }],
      signatures: ["export function replaceCodeChunksForSource(): void"],
      chunks: [{
        stable_key: "src/store/code-chunks.ts::replaceCodeChunksForSource",
        symbol_path: "replaceCodeChunksForSource",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function replaceCodeChunksForSource(): void { /* chunk table rows */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/session-storage.ts",
      imports: [],
      purpose: "Session storage helpers for UI preferences.",
      symbols: [{ name: "saveSessionStorage", kind: "function" }],
      signatures: ["export function saveSessionStorage(): void"],
      chunks: [{
        stable_key: "src/store/session-storage.ts::saveSessionStorage",
        symbol_path: "saveSessionStorage",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function saveSessionStorage(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/eval/card-persistence-report.ts",
      imports: [],
      purpose: "Passive report for card persistence metrics.",
      symbols: [{ name: "renderCardPersistenceReport", kind: "function" }],
      signatures: ["export function renderCardPersistenceReport(): string"],
      chunks: [{
        stable_key: "src/eval/card-persistence-report.ts::renderCardPersistenceReport",
        symbol_path: "renderCardPersistenceReport",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderCardPersistenceReport(): string { return 'metrics'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "upsertCard card persistence storage createSchema openDb replaceCodeChunksForSource",
      enabled: true,
      query_anchors: { symbols: ["upsertCard"] },
      query_intent: "exact_symbol",
      max_results: 8,
      import_max_hops: 1,
      import_traversed_max_results: 8,
      import_traversed_max_tokens: 10000,
    });

    expect(out[0]?.source_path).toBe("src/store/cards.ts");
    const supportPaths = out
      .filter((entry) => entry.support_cluster?.role === "support")
      .map((entry) => entry.source_path)
      .sort();
    expect(supportPaths).toEqual([
      "src/store/code-chunks.ts",
      "src/store/db.ts",
      "src/store/schema.ts",
    ]);
    expect(out.some((entry) => entry.source_path.startsWith("src/eval/"))).toBe(false);
    expect(
      out
        .filter((entry) => entry.support_cluster?.role === "support")
        .every((entry) =>
          entry.support_cluster?.family_evidence?.reasons.includes(
            "persistence_companion",
          ),
        ),
    ).toBe(true);
  });

  it("keeps SourceProfile storage support conservative without source-card expansion", () => {
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
      purpose: "Persists SourceProfile records in storage.",
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
      path: "src/store/schema.ts",
      imports: [],
      purpose: "Schema table substrate for SourceProfile storage.",
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
      path: "src/retrieve/source-card.ts",
      imports: [],
      purpose: "Renders source cards for retrieval context.",
      symbols: [{ name: "renderSourceCard", kind: "function" }],
      signatures: ["export function renderSourceCard(): string"],
      chunks: [{
        stable_key: "src/retrieve/source-card.ts::renderSourceCard",
        symbol_path: "renderSourceCard",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderSourceCard(): string { return 'card'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-profile-example.ts",
      imports: [],
      purpose: "Example report for source profile demos.",
      symbols: [{ name: "renderSourceProfileExample", kind: "function" }],
      signatures: ["export function renderSourceProfileExample(): string"],
      chunks: [{
        stable_key: "src/retrieve/source-profile-example.ts::renderSourceProfileExample",
        symbol_path: "renderSourceProfileExample",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderSourceProfileExample(): string { return 'demo'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "SourceProfile storage buildSourceProfile schema upsertSourceProfile",
      enabled: true,
      query_anchors: {
        files: ["src/parse/source-profile.ts"],
        symbols: ["buildSourceProfile"],
      },
      query_intent: "exact_symbol",
      max_results: 8,
      import_traversed_max_results: 8,
      import_traversed_max_tokens: 10000,
    });

    const supportPaths = out
      .filter((entry) => entry.support_cluster?.role === "support")
      .map((entry) => entry.source_path)
      .sort();
    expect(supportPaths).toEqual([
      "src/store/schema.ts",
      "src/store/source-profiles.ts",
      "src/types/source-profile.ts",
    ]);
    expect(supportPaths).not.toContain("src/retrieve/source-card.ts");
    expect(supportPaths).not.toContain("src/store/cards.ts");
  });

  it("limits generic CLI workflow support to existing import and persistence evidence", () => {
    seedCodeFile({
      path: "src/commands/reset.ts",
      imports: [],
      purpose: "CLI command that resets stale lock and run state.",
      symbols: [{ name: "resetRunState", kind: "function" }],
      signatures: ["export function resetRunState(): void"],
      chunks: [{
        stable_key: "src/commands/reset.ts::resetRunState",
        symbol_path: "resetRunState",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function resetRunState(): void { /* clear lock */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/runs/manifest.ts",
      imports: [],
      purpose: "Run manifest storage for command runner artifacts.",
      symbols: [{ name: "writeRunManifest", kind: "function" }],
      signatures: ["export function writeRunManifest(): void"],
      chunks: [{
        stable_key: "src/runs/manifest.ts::writeRunManifest",
        symbol_path: "writeRunManifest",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function writeRunManifest(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/policy/validator.ts",
      imports: [],
      purpose: "Worker result validator and policy classification.",
      symbols: [{ name: "validateWorkerOutput", kind: "function" }],
      signatures: ["export function validateWorkerOutput(): void"],
      chunks: [{
        stable_key: "src/policy/validator.ts::validateWorkerOutput",
        symbol_path: "validateWorkerOutput",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function validateWorkerOutput(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/reports/manifest-report.ts",
      imports: [],
      purpose: "Passive manifest validation metrics report.",
      symbols: [{ name: "renderManifestReport", kind: "function" }],
      signatures: ["export function renderManifestReport(): string"],
      chunks: [{
        stable_key: "src/reports/manifest-report.ts::renderManifestReport",
        symbol_path: "renderManifestReport",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderManifestReport(): string { return 'metrics'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "reset command runner clears lock state writes manifest validateWorkerOutput",
      enabled: true,
      query_anchors: { symbols: ["resetRunState"] },
      query_intent: "exact_symbol",
      max_results: 6,
      import_traversed_max_results: 6,
      import_traversed_max_tokens: 10000,
    });

    expect(out[0]?.source_path).toBe("src/commands/reset.ts");
    const support = out.filter((entry) => entry.support_cluster?.role === "support");
    expect(support.map((entry) => entry.source_path).sort()).toEqual([
      "src/runs/manifest.ts",
    ]);
    expect(
      support.flatMap((entry) =>
        entry.support_cluster?.family_evidence?.families ?? [],
      ),
    ).not.toContain("cli_workflow");
    expect(support[0]?.support_cluster?.family_evidence?.families).toEqual(
      expect.arrayContaining(["import_workflow", "persistence"]),
    );
    expect(support.some((entry) => entry.source_path.includes("report"))).toBe(false);
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

  it("keeps a direct sibling in the top three when multiple support files are available", () => {
    seedCodeFile({
      path: "src/retrieve/primary-owner.ts",
      imports: ["src/store/owner-schema", "src/store/owner-db"],
      purpose: "Primary workflow owner.",
      symbols: [{ name: "primaryOwner", kind: "function" }],
      signatures: ["export function primaryOwner(): void"],
      chunks: [{
        stable_key: "src/retrieve/primary-owner.ts::primaryOwner",
        symbol_path: "primaryOwner",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function primaryOwner(): void { ownerSchema(); ownerDb(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/secondary-owner.ts",
      imports: [],
      purpose: "Secondary workflow owner.",
      symbols: [{ name: "secondaryOwner", kind: "function" }],
      signatures: ["export function secondaryOwner(): void"],
      chunks: [{
        stable_key: "src/retrieve/secondary-owner.ts::secondaryOwner",
        symbol_path: "secondaryOwner",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function secondaryOwner(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/owner-schema.ts",
      imports: [],
      purpose: "Schema support substrate for the owner workflow.",
      symbols: [{ name: "ownerSchema", kind: "function" }],
      signatures: ["export function ownerSchema(): void"],
      chunks: [{
        stable_key: "src/store/owner-schema.ts::ownerSchema",
        symbol_path: "ownerSchema",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function ownerSchema(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/owner-db.ts",
      imports: [],
      purpose: "Database support substrate for the owner workflow.",
      symbols: [{ name: "ownerDb", kind: "function" }],
      signatures: ["export function ownerDb(): void"],
      chunks: [{
        stable_key: "src/store/owner-db.ts::ownerDb",
        symbol_path: "ownerDb",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function ownerDb(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "primaryOwner secondaryOwner",
      enabled: true,
      query_anchors: { symbols: ["primaryOwner"] },
      query_intent: "exact_symbol",
      max_results: 28,
      import_max_hops: 1,
      import_traversed_max_results: 28,
      import_traversed_max_tokens: 10000,
    });
    const topThree = out.slice(0, 3).map((entry) => entry.source_path);

    expect(topThree).toContain("src/retrieve/secondary-owner.ts");
    expect(
      out.findIndex((entry) => entry.source_path === "src/store/owner-schema.ts"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      out.findIndex((entry) => entry.source_path === "src/retrieve/secondary-owner.ts"),
    ).toBeLessThan(
      out.findIndex((entry) => entry.source_path === "src/store/owner-schema.ts"),
    );
  });

  it("uses the strongest active direct sibling for the top-three rest slot", () => {
    seedCodeFile({
      path: "src/retrieve/retrieve.ts",
      imports: ["src/store/db"],
      purpose: "Generic retrieval entrypoint.",
      symbols: [{ name: "retrieve", kind: "function" }],
      signatures: ["export function retrieve(): void"],
      chunks: [{
        stable_key: "src/retrieve/retrieve.ts::retrieve",
        symbol_path: "retrieve",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function retrieve(): void { /* code fence entities import time source rerank wiring */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/db.ts",
      imports: [],
      purpose: "Database support for retrieval.",
      symbols: [{ name: "openDb", kind: "function" }],
      signatures: ["export function openDb(): Db"],
      chunks: [{
        stable_key: "src/store/db.ts::openDb",
        symbol_path: "openDb",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function openDb(): Db { throw new Error(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
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
        body: "export function buildSourceProfile(): SourceProfile { /* code fence entities import time */ throw new Error(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
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
        body: "export function scoreSourceRerank(): number { /* source rerank source rerank source rerank */ return 1; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "code_fence_entities import-time source-rerank wiring",
      enabled: true,
      max_results: 8,
      import_max_hops: 1,
      import_traversed_max_results: 8,
      import_traversed_max_tokens: 10000,
    });

    expect(out.slice(0, 3).map((entry) => entry.source_path)).toContain(
      "src/retrieve/source-rerank.ts",
    );
  });

  it("prefers close query-evidence support over same-family substrate support", () => {
    seedCodeFile({
      path: "src/parse/source-profile.ts",
      imports: ["src/store/source-profiles", "src/retrieve/heading-aliases"],
      purpose: "Builds SourceProfile metadata during import.",
      symbols: [{ name: "buildSourceProfile", kind: "function" }],
      signatures: ["export function buildSourceProfile(): SourceProfile"],
      chunks: [{
        stable_key: "src/parse/source-profile.ts::buildSourceProfile",
        symbol_path: "buildSourceProfile",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function buildSourceProfile(): SourceProfile { /* heading aliases markdown extractor */ throw new Error(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/source-profiles.ts",
      imports: [],
      purpose: "Persists SourceProfile records.",
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
      path: "src/retrieve/heading-aliases.ts",
      imports: [],
      purpose: "Heading alias markdown extractor.",
      symbols: [{ name: "extractHeadingAliases", kind: "function" }],
      signatures: ["export function extractHeadingAliases(): string[]"],
      chunks: [{
        stable_key: "src/retrieve/heading-aliases.ts::extractHeadingAliases",
        symbol_path: "extractHeadingAliases",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function extractHeadingAliases(): string[] { return []; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "heading aliases markdown H1 H2 H3 extractor",
      enabled: true,
      query_anchors: { symbols: ["buildSourceProfile"] },
      query_intent: "exact_symbol",
      max_results: 4,
      import_max_hops: 1,
      import_traversed_max_results: 4,
      import_traversed_max_tokens: 10000,
    });

    expect(out[1]?.source_path).toBe("src/retrieve/heading-aliases.ts");
  });

  it("promotes a SourceProfile carrier companion for import-time extractor wiring", () => {
    seedCodeFile({
      path: "src/retrieve/retrieve.ts",
      imports: ["src/readiness/task-need"],
      purpose: "Generic retrieval entrypoint.",
      symbols: [{ name: "retrieve", kind: "function" }],
      signatures: ["export function retrieve(): void"],
      chunks: [{
        stable_key: "src/retrieve/retrieve.ts::retrieve",
        symbol_path: "retrieve",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function retrieve(): void { /* import time wiring heading aliases extractor */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/readiness/task-need.ts",
      imports: [],
      purpose: "Generic readiness extractor support.",
      symbols: [{ name: "inferTaskNeed", kind: "function" }],
      signatures: ["export function inferTaskNeed(): void"],
      chunks: [{
        stable_key: "src/readiness/task-need.ts::inferTaskNeed",
        symbol_path: "inferTaskNeed",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function inferTaskNeed(): void { /* import time extractor */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/heading-aliases.ts",
      imports: [],
      purpose: "Heading aliases extractor.",
      symbols: [{ name: "extractHeadingAliases", kind: "function" }],
      signatures: ["export function extractHeadingAliases(): string[]"],
      chunks: [{
        stable_key: "src/retrieve/heading-aliases.ts::extractHeadingAliases",
        symbol_path: "extractHeadingAliases",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function extractHeadingAliases(): string[] { return []; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/types/source-profile.ts",
      imports: [],
      purpose: "Shared SourceProfile heading_aliases field definitions.",
      symbols: [{ name: "SourceProfile", kind: "interface" }],
      signatures: ["export interface SourceProfile {}"],
      chunks: [{
        stable_key: "src/types/source-profile.ts::SourceProfile",
        symbol_path: "SourceProfile",
        code_role: "declaration",
        declaration_kind: "interface",
        exported: true,
        body: "export interface SourceProfile { heading_aliases?: string[] }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "import-time wiring heading aliases extractor",
      enabled: true,
      max_results: 6,
      import_max_hops: 1,
      import_traversed_max_results: 6,
      import_traversed_max_tokens: 10000,
    });

    expect(out.slice(0, 3).map((entry) => entry.source_path)).toContain(
      "src/types/source-profile.ts",
    );
  });

  it("does not let extracted-field identities displace carrier files for import-time wiring", () => {
    seedCodeFile({
      path: "src/retrieve/retrieve.ts",
      imports: ["src/readiness/task-need"],
      purpose: "Generic retrieval entrypoint.",
      symbols: [{ name: "retrieve", kind: "function" }],
      signatures: ["export function retrieve(): void"],
      chunks: [{
        stable_key: "src/retrieve/retrieve.ts::retrieve",
        symbol_path: "retrieve",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function retrieve(): void { /* code_fence_entities import time wiring */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/readiness/task-need.ts",
      imports: [],
      purpose: "Generic readiness extractor support.",
      symbols: [{ name: "inferTaskNeed", kind: "function" }],
      signatures: ["export function inferTaskNeed(): void"],
      chunks: [{
        stable_key: "src/readiness/task-need.ts::inferTaskNeed",
        symbol_path: "inferTaskNeed",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function inferTaskNeed(): void { /* import time extractor */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/code-fence-entities.ts",
      imports: [],
      purpose: "Code fence entity extractor.",
      symbols: [{ name: "extractCodeFenceEntities", kind: "function" }],
      signatures: ["export function extractCodeFenceEntities(): string[]"],
      chunks: [{
        stable_key: "src/retrieve/code-fence-entities.ts::extractCodeFenceEntities",
        symbol_path: "extractCodeFenceEntities",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function extractCodeFenceEntities(): string[] { return []; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/types/source-profile.ts",
      imports: [],
      purpose: "Shared SourceProfile code_fence_entities field definitions.",
      symbols: [{ name: "SourceProfile", kind: "interface" }],
      signatures: ["export interface SourceProfile {}"],
      chunks: [{
        stable_key: "src/types/source-profile.ts::SourceProfile",
        symbol_path: "SourceProfile",
        code_role: "declaration",
        declaration_kind: "interface",
        exported: true,
        body: "export interface SourceProfile { code_fence_entities?: string[] }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "code_fence_entities import-time wiring",
      enabled: true,
      max_results: 6,
      import_max_hops: 1,
      import_traversed_max_results: 6,
      import_traversed_max_tokens: 10000,
    });

    expect(out.slice(0, 3).map((entry) => entry.source_path)).toContain(
      "src/types/source-profile.ts",
    );
  });

  it("promotes a persistence substrate companion for explicit chunk-table work", () => {
    seedCodeFile({
      path: "src/retrieve/retrieve.ts",
      imports: ["src/setup/next-step", "src/store/code-chunks"],
      purpose: "Generic retrieval entrypoint.",
      symbols: [{ name: "retrieve", kind: "function" }],
      signatures: ["export function retrieve(): void"],
      chunks: [{
        stable_key: "src/retrieve/retrieve.ts::retrieve",
        symbol_path: "retrieve",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function retrieve(): void { /* chunk table virtual table recreation reindex */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/setup/next-step.ts",
      imports: [],
      purpose: "Tiny setup schema note for table reindex next steps.",
      symbols: [{ name: "nextStep", kind: "function" }],
      signatures: ["export function nextStep(): void"],
      chunks: [{
        stable_key: "src/setup/next-step.ts::nextStep",
        symbol_path: "nextStep",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function nextStep(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/chunks.ts",
      imports: [],
      purpose: "Chunk storage helpers for persisted retrieval index records.",
      symbols: [{ name: "replaceChunks", kind: "function" }],
      signatures: ["export function replaceChunks(): void"],
      chunks: [{
        stable_key: "src/store/chunks.ts::replaceChunks",
        symbol_path: "replaceChunks",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function replaceChunks(): void { /* chunk table rows */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/code-chunks.ts",
      imports: [],
      purpose: "Code-source chunk storage helpers.",
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
      path: "src/store/code-sources.ts",
      imports: [],
      purpose: "Code source virtual table helpers for source-file search.",
      symbols: [{ name: "searchCodeSources", kind: "function" }],
      signatures: ["export function searchCodeSources(): void"],
      chunks: [{
        stable_key: "src/store/code-sources.ts::searchCodeSources",
        symbol_path: "searchCodeSources",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function searchCodeSources(): void { /* chunk table virtual table recreation reindex */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "chunk-table virtual table recreation reindex",
      enabled: true,
      max_results: 6,
      import_max_hops: 1,
      import_traversed_max_results: 6,
      import_traversed_max_tokens: 10000,
    });

    expect(out[0]?.source_path).toBe("src/retrieve/retrieve.ts");
    expect(out[1]?.source_path).toBe("src/setup/next-step.ts");
    expect(out.slice(0, 3).map((entry) => entry.source_path)).toContain(
      "src/store/chunks.ts",
    );
  });

  it("infers exact symbol anchors from code-shaped query tokens", () => {
    seedCodeFile({
      path: "src/retrieve/path-topology.ts",
      imports: [],
      purpose: "Generic path topology support.",
      symbols: [{ name: "scorePathTopology", kind: "function" }],
      signatures: ["export function scorePathTopology(): void"],
      chunks: [{
        stable_key: "src/retrieve/path-topology.ts::scorePathTopology",
        symbol_path: "scorePathTopology",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scorePathTopology(): void { /* synthetic property gate synthetic property gate */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/heading-aliases.ts",
      imports: [],
      purpose: "Heading alias extractor.",
      symbols: [{ name: "extractHeadingAliases", kind: "function" }],
      signatures: ["export function extractHeadingAliases(): string[]"],
      chunks: [{
        stable_key: "src/retrieve/heading-aliases.ts::extractHeadingAliases",
        symbol_path: "extractHeadingAliases",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function extractHeadingAliases(): string[] { return []; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "extractHeadingAliases synthetic property gate",
      enabled: true,
      max_results: 3,
    });

    expect(out[0]?.source_path).toBe("src/retrieve/heading-aliases.ts");
  });

  it("infers exact compound file anchors from snake and kebab query tokens", () => {
    seedCodeFile({
      path: "src/retrieve/retrieve.ts",
      imports: [],
      purpose: "Generic retrieval entrypoint.",
      symbols: [{ name: "retrieve", kind: "function" }],
      signatures: ["export function retrieve(): void"],
      chunks: [{
        stable_key: "src/retrieve/retrieve.ts::retrieve",
        symbol_path: "retrieve",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function retrieve(): void { /* code fence entities source rerank wiring code fence entities source rerank wiring */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
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
    seedCodeFile({
      path: "src/retrieve/code-fence-entities.ts",
      imports: [],
      purpose: "Code fence entity extractor.",
      symbols: [{ name: "extractCodeFenceEntities", kind: "function" }],
      signatures: ["export function extractCodeFenceEntities(): string[]"],
      chunks: [{
        stable_key: "src/retrieve/code-fence-entities.ts::extractCodeFenceEntities",
        symbol_path: "extractCodeFenceEntities",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function extractCodeFenceEntities(): string[] { return []; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "code_fence_entities source-rerank wiring",
      enabled: true,
      max_results: 3,
    });

    expect(out.slice(0, 3).map((entry) => entry.source_path)).toEqual(
      expect.arrayContaining([
        "src/retrieve/code-fence-entities.ts",
        "src/retrieve/source-rerank.ts",
      ]),
    );
  });

  it("ignores generic coding-task wrappers when ranking compound code identities", () => {
    seedCodeFile({
      path: "src/retrieve/retrieve.ts",
      imports: [],
      purpose: "Generic implementation files debug path for code wiring.",
      symbols: [{ name: "retrieve", kind: "function" }],
      signatures: ["export function retrieve(): void"],
      chunks: [{
        stable_key: "src/retrieve/retrieve.ts::retrieve",
        symbol_path: "retrieve",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function retrieve(): void { /* implementation files debug path code wiring */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-card.ts",
      imports: [],
      purpose: "Generic source metadata context renderer.",
      symbols: [{ name: "renderSourceCard", kind: "function" }],
      signatures: ["export function renderSourceCard(): string"],
      chunks: [{
        stable_key: "src/retrieve/source-card.ts::renderSourceCard",
        symbol_path: "renderSourceCard",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderSourceCard(): string { return 'source metadata context'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: [],
      purpose: "Source rerank scoring owner.",
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
      path: "src/retrieve/nav-metadata-flag.ts",
      imports: [],
      purpose: "Nav metadata flag wiring.",
      symbols: [{ name: "navMetadataEnabled", kind: "function" }],
      signatures: ["export function navMetadataEnabled(): boolean"],
      chunks: [{
        stable_key: "src/retrieve/nav-metadata-flag.ts::navMetadataEnabled",
        symbol_path: "navMetadataEnabled",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function navMetadataEnabled(): boolean { return true; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "implementation files for PRD-0027 source-rerank wiring nav metadata flag",
      enabled: true,
      max_results: 4,
    });

    expect(out.slice(0, 3).map((entry) => entry.source_path)).toEqual(
      expect.arrayContaining([
        "src/retrieve/source-rerank.ts",
        "src/retrieve/nav-metadata-flag.ts",
      ]),
    );
  });

  it("does not let implementation-intent helper symbols outrank the requested file identity", () => {
    seedCodeFile({
      path: "src/retrieve/retrieve.ts",
      imports: [],
      purpose: "Generic implementation-shaped task intent classifier.",
      symbols: [{ name: "IMPLEMENTATION_SHAPED_TASK_RE", kind: "const" }],
      signatures: ["const IMPLEMENTATION_SHAPED_TASK_RE = /implementation files/"],
      chunks: [{
        stable_key: "src/retrieve/retrieve.ts::IMPLEMENTATION_SHAPED_TASK_RE",
        symbol_path: "IMPLEMENTATION_SHAPED_TASK_RE",
        code_role: "declaration",
        declaration_kind: "const",
        exported: true,
        body: "export const IMPLEMENTATION_SHAPED_TASK_RE = /implementation files debug path code/;",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: [],
      purpose: "Source rerank scoring owner.",
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
      query: "implementation files for source-rerank scoring",
      enabled: true,
      max_results: 3,
    });

    expect(out[0]?.source_path).toBe("src/retrieve/source-rerank.ts");
  });

  it("does not let generic context helpers outrank the requested implementation identity", () => {
    seedCodeFile({
      path: "src/cli/context.ts",
      imports: [],
      purpose: "Generic CLI context rendering helpers.",
      symbols: [{ name: "renderContext", kind: "function" }],
      signatures: ["export function renderContext(): string"],
      chunks: [{
        stable_key: "src/cli/context.ts::renderContext",
        symbol_path: "renderContext",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderContext(): string { return 'minimal code context context context'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: [],
      purpose: "Source rerank scoring owner.",
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
      query: "minimal code context for source-rerank scoring",
      enabled: true,
      max_results: 3,
    });

    expect(out[0]?.source_path).toBe("src/retrieve/source-rerank.ts");
  });

  it("uses explicit kebab-case file identity when generic prompt wording adds stronger topical distractors", () => {
    seedCodeFile({
      path: "src/parse/nav-parser.ts",
      imports: [],
      purpose: "Nav landing parser with scoring context.",
      symbols: [{ name: "parseNavLanding", kind: "function" }],
      signatures: ["export function parseNavLanding(): void"],
      chunks: [{
        stable_key: "src/parse/nav-parser.ts::parseNavLanding",
        symbol_path: "parseNavLanding",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function parseNavLanding(): void { /* nav landing path scoring nav landing */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/heading-aliases.ts",
      imports: [],
      purpose: "Heading alias scoring support.",
      symbols: [{ name: "scoreHeadingAliases", kind: "function" }],
      signatures: ["export function scoreHeadingAliases(): void"],
      chunks: [{
        stable_key: "src/retrieve/heading-aliases.ts::scoreHeadingAliases",
        symbol_path: "scoreHeadingAliases",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreHeadingAliases(): void { /* source scoring path */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: [],
      purpose: "Source rerank scoring owner.",
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
      query: "debug the implementation path for nav-landing source-rerank scoring",
      enabled: true,
      max_results: 3,
    });

    expect(out.slice(0, 3).map((entry) => entry.source_path)).toContain(
      "src/retrieve/source-rerank.ts",
    );
  });

  it("keeps a named component owner in the top three when support-cluster files are stronger lexical hits", () => {
    seedCodeFile({
      path: "src/retrieve/heading-aliases.ts",
      imports: ["src/retrieve/multi-path-candidates"],
      purpose: "Heading alias scorer with nav landing debug path wording.",
      symbols: [{ name: "scoreHeadingAliases", kind: "function" }],
      signatures: ["export function scoreHeadingAliases(): void"],
      chunks: [{
        stable_key: "src/retrieve/heading-aliases.ts::scoreHeadingAliases",
        symbol_path: "scoreHeadingAliases",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function scoreHeadingAliases(): void { /* debug implementation path nav landing source rerank scoring debug implementation path */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/multi-path-candidates.ts",
      imports: [],
      purpose: "Candidate path support for source rerank scoring.",
      symbols: [{ name: "collectMultiPathCandidates", kind: "function" }],
      signatures: ["export function collectMultiPathCandidates(): void"],
      chunks: [{
        stable_key: "src/retrieve/multi-path-candidates.ts::collectMultiPathCandidates",
        symbol_path: "collectMultiPathCandidates",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function collectMultiPathCandidates(): void { /* path rerank support */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/retrieve.ts",
      imports: [],
      purpose: "Generic retrieval implementation path scorer.",
      symbols: [{ name: "retrieve", kind: "function" }],
      signatures: ["export function retrieve(): void"],
      chunks: [{
        stable_key: "src/retrieve/retrieve.ts::retrieve",
        symbol_path: "retrieve",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function retrieve(): void { /* implementation path scoring implementation path scoring */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: [],
      purpose: "Source rerank implementation owner.",
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
      query: "debug the implementation path for nav-landing source-rerank scoring",
      enabled: true,
      max_results: 4,
      import_max_hops: 1,
      import_traversed_max_results: 4,
      import_traversed_max_tokens: 10000,
    });

    expect(out.slice(0, 3).map((entry) => entry.source_path)).toContain(
      "src/retrieve/source-rerank.ts",
    );
  });

  it("treats BM25F prompts as a request for the BM25 ranking component", () => {
    seedCodeFile({
      path: "src/retrieve/source-adjudicator.ts",
      imports: ["src/retrieve/source-card"],
      purpose: "Structural context adjudicator.",
      symbols: [{ name: "adjudicateSourceContext", kind: "function" }],
      signatures: ["export function adjudicateSourceContext(): void"],
      chunks: [{
        stable_key: "src/retrieve/source-adjudicator.ts::adjudicateSourceContext",
        symbol_path: "adjudicateSourceContext",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function adjudicateSourceContext(): void { /* BM25F field-weight extension structural context BM25F structural context */ }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/source-card.ts",
      imports: [],
      purpose: "Source card structural context renderer.",
      symbols: [{ name: "renderSourceCard", kind: "function" }],
      signatures: ["export function renderSourceCard(): string"],
      chunks: [{
        stable_key: "src/retrieve/source-card.ts::renderSourceCard",
        symbol_path: "renderSourceCard",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function renderSourceCard(): string { return 'structural context'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/types/source-profile.ts",
      imports: [],
      purpose: "Structural context SourceProfile type carrier.",
      symbols: [{ name: "SourceProfile", kind: "interface" }],
      signatures: ["export interface SourceProfile {}"],
      chunks: [{
        stable_key: "src/types/source-profile.ts::SourceProfile",
        symbol_path: "SourceProfile",
        code_role: "declaration",
        declaration_kind: "interface",
        exported: true,
        body: "export interface SourceProfile { structuralContext?: string }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/retrieve/bm25.ts",
      imports: [],
      purpose: "BM25 ranking component and field-weight scoring substrate.",
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
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "PRD-0025 BM25F field-weight extension structural context",
      enabled: true,
      max_results: 4,
      import_max_hops: 1,
      import_traversed_max_results: 4,
      import_traversed_max_tokens: 10000,
    });

    expect(out.slice(0, 3).map((entry) => entry.source_path)).toContain(
      "src/retrieve/bm25.ts",
    );
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

  it("admits persistence support for an import workflow owner even when path families differ", () => {
    seedCodeFile({
      path: "src/cli/reindex.ts",
      imports: [],
      purpose: "CLI reindex workflow entrypoint.",
      symbols: [{ name: "runReindex", kind: "function" }],
      signatures: ["export function runReindex(): void"],
      chunks: [{
        stable_key: "src/cli/reindex.ts::runReindex",
        symbol_path: "runReindex",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function runReindex(): void {}",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/schema.ts",
      imports: [],
      purpose: "SQLite schema substrate for storage tables.",
      symbols: [{ name: "createSchema", kind: "function" }],
      signatures: ["export function createSchema(): string"],
      chunks: [{
        stable_key: "src/store/schema.ts::createSchema",
        symbol_path: "createSchema",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function createSchema(): string { return 'chunks'; }",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const out = buildCodeRankedEntries({
      db,
      query: "runReindex createSchema storage",
      enabled: true,
      query_anchors: {
        files: ["src/cli/reindex.ts"],
        symbols: ["runReindex"],
      },
      query_intent: "exact_symbol",
      max_results: 3,
      import_traversed_max_results: 3,
      import_traversed_max_tokens: 10000,
    });

    expect(out[0]?.source_path).toBe("src/cli/reindex.ts");
    const schema = out.find((entry) => entry.source_path === "src/store/schema.ts");
    expect(schema?.support_cluster?.reason).toBe("code_family_evidence");
    expect(schema?.support_cluster?.family_evidence?.reasons).toContain(
      "persistence_companion",
    );
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

  it("keeps the bundle-aware runtime method behind an explicit reversible boundary", () => {
    expect(resolveCodeLaneRankingMethod({ requested: "bundle-aware" })).toBe(
      "chunk-first",
    );
    expect(
      resolveCodeLaneRankingMethod({
        requested: "bundle-aware",
        promotionEnabled: true,
      }),
    ).toBe("bundle-aware");
    expect(resolveCodeLaneRankingMethod({ requested: "unknown" })).toBe(
      "chunk-first",
    );

    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank",
      enabled: true,
      ranking_method: "chunk-first",
    });
    expect(out[0]?.source_path).toBe("src/retrieve/source-rerank.ts");
  });

  it("makes the promoted bundle-aware method reserve additional support slots when explicitly enabled", () => {
    seedCodeFile({
      path: "src/retrieve/source-rerank.ts",
      imports: ["src/retrieve/source-profile", "src/store/schema"],
      purpose: "Source rerank owner for source-profile scoring.",
      symbols: [{ name: "scoreSourceRerank", kind: "function" }],
      signatures: ["export function scoreSourceRerank(): number"],
      chunks: [
        {
          stable_key: "src/retrieve/source-rerank.ts::orientation",
          symbol_path: null,
          code_role: "orientation",
          declaration_kind: null,
          exported: false,
          body: "/** Source rerank owner overview. */",
          start_line: 1,
          end_line: 1,
        },
        {
          stable_key: "src/retrieve/source-rerank.ts::scoreSourceRerank",
          symbol_path: "scoreSourceRerank",
          code_role: "declaration",
          declaration_kind: "function",
          exported: true,
          body: "export function scoreSourceRerank(): number { return 1; }",
          start_line: 3,
          end_line: 3,
        },
      ],
    });
    seedCodeFile({
      path: "src/retrieve/source-profile.ts",
      imports: [],
      purpose: "SourceProfile support substrate for source ranking.",
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
      purpose: "SQLite schema substrate for source ranking persistence.",
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
    syncCodeGraph(db);

    const oldPromotion = process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED;
    process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED = "on";
    try {
      const commonArgs = {
        db,
        query: "scoreSourceRerank",
        enabled: true,
        query_anchors: { symbols: ["scoreSourceRerank"] },
        query_intent: "exact_symbol",
        max_results: 3,
        import_max_hops: 1,
        import_traversed_max_results: 3,
        import_traversed_max_tokens: 10000,
      } as const;

      const chunkFirst = buildCodeRankedEntries({
        ...commonArgs,
        ranking_method: "chunk-first",
      });
      const bundleAware = buildCodeRankedEntries({
        ...commonArgs,
        ranking_method: "bundle-aware",
      });

      expect(
        chunkFirst.filter((entry) => entry.support_cluster?.role === "support"),
      ).toHaveLength(1);
      expect(
        bundleAware
          .filter((entry) => entry.support_cluster?.role === "support")
          .map((entry) => entry.source_path)
          .sort(),
      ).toEqual([
        "src/retrieve/source-profile.ts",
        "src/store/schema.ts",
      ]);
    } finally {
      if (oldPromotion === undefined) {
        delete process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED;
      } else {
        process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED = oldPromotion;
      }
    }
  });

  it("lets the promoted bundle-aware method recover support from secondary direct owners", () => {
    seedCodeFile({
      path: "src/workflows/root-command.ts",
      imports: [],
      purpose: "Root command owner for order processing.",
      symbols: [{ name: "runRootCommand", kind: "function" }],
      signatures: ["export function runRootCommand(): void"],
      chunks: [{
        stable_key: "src/workflows/root-command.ts::runRootCommand",
        symbol_path: "runRootCommand",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function runRootCommand(): void { processOrder(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/workflows/order-service.ts",
      imports: ["src/store/order-schema"],
      purpose: "Order workflow implementation owner that writes persistent order rows.",
      symbols: [{ name: "processOrder", kind: "function" }],
      signatures: ["export function processOrder(): OrderRow"],
      chunks: [{
        stable_key: "src/workflows/order-service.ts::processOrder",
        symbol_path: "processOrder",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function processOrder(): OrderRow { return readOrderSchema(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/order-schema.ts",
      imports: [],
      purpose: "Schema substrate for persistent order rows.",
      symbols: [{ name: "OrderRow", kind: "type" }],
      signatures: ["export type OrderRow = { id: string }"],
      chunks: [{
        stable_key: "src/store/order-schema.ts::OrderRow",
        symbol_path: "OrderRow",
        code_role: "declaration",
        declaration_kind: "type",
        exported: true,
        body: "export type OrderRow = { id: string; status: string };",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const oldPromotion = process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED;
    process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED = "on";
    try {
      const commonArgs = {
        db,
        query: "runRootCommand processOrder",
        enabled: true,
        query_anchors: { symbols: ["runRootCommand"] },
        query_intent: "exact_symbol",
        max_results: 3,
        import_max_hops: 1,
        import_traversed_max_results: 3,
        import_traversed_max_tokens: 10000,
      } as const;

      const chunkFirst = buildCodeRankedEntries({
        ...commonArgs,
        ranking_method: "chunk-first",
      });
      const bundleAware = buildCodeRankedEntries({
        ...commonArgs,
        ranking_method: "bundle-aware",
      });

      expect(
        chunkFirst.some((entry) =>
          entry.source_path === "src/store/order-schema.ts" &&
          entry.support_cluster?.role === "support",
        ),
      ).toBe(false);
      expect(
        bundleAware.some((entry) =>
          entry.source_path === "src/store/order-schema.ts" &&
          entry.support_cluster?.role === "support" &&
          entry.support_cluster.seed_source_path === "src/workflows/order-service.ts",
        ),
      ).toBe(true);
    } finally {
      if (oldPromotion === undefined) {
        delete process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED;
      } else {
        process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED = oldPromotion;
      }
    }
  });

  it("uses secondary direct-owner support only as a bundle-aware fallback", () => {
    seedCodeFile({
      path: "src/workflows/root-command.ts",
      imports: ["src/store/root-schema"],
      purpose: "Root command owner for order processing.",
      symbols: [{ name: "runRootCommand", kind: "function" }],
      signatures: ["export function runRootCommand(): void"],
      chunks: [{
        stable_key: "src/workflows/root-command.ts::runRootCommand",
        symbol_path: "runRootCommand",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function runRootCommand(): void { processOrder(); readRootSchema(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/workflows/order-service.ts",
      imports: ["src/store/order-schema"],
      purpose: "Order workflow implementation owner that writes persistent order rows.",
      symbols: [{ name: "processOrder", kind: "function" }],
      signatures: ["export function processOrder(): OrderRow"],
      chunks: [{
        stable_key: "src/workflows/order-service.ts::processOrder",
        symbol_path: "processOrder",
        code_role: "declaration",
        declaration_kind: "function",
        exported: true,
        body: "export function processOrder(): OrderRow { return readOrderSchema(); }",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/root-schema.ts",
      imports: [],
      purpose: "Schema substrate for the root command state.",
      symbols: [{ name: "RootRow", kind: "type" }],
      signatures: ["export type RootRow = { id: string }"],
      chunks: [{
        stable_key: "src/store/root-schema.ts::RootRow",
        symbol_path: "RootRow",
        code_role: "declaration",
        declaration_kind: "type",
        exported: true,
        body: "export type RootRow = { id: string; source: string };",
        start_line: 1,
        end_line: 1,
      }],
    });
    seedCodeFile({
      path: "src/store/order-schema.ts",
      imports: [],
      purpose: "Schema substrate for persistent order rows.",
      symbols: [{ name: "OrderRow", kind: "type" }],
      signatures: ["export type OrderRow = { id: string }"],
      chunks: [{
        stable_key: "src/store/order-schema.ts::OrderRow",
        symbol_path: "OrderRow",
        code_role: "declaration",
        declaration_kind: "type",
        exported: true,
        body: "export type OrderRow = { id: string; status: string };",
        start_line: 1,
        end_line: 1,
      }],
    });
    syncCodeGraph(db);

    const oldPromotion = process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED;
    process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED = "on";
    try {
      const bundleAware = buildCodeRankedEntries({
        db,
        query: "runRootCommand processOrder",
        enabled: true,
        query_anchors: { symbols: ["runRootCommand"] },
        query_intent: "exact_symbol",
        max_results: 3,
        import_max_hops: 1,
        import_traversed_max_results: 3,
        import_traversed_max_tokens: 10000,
        ranking_method: "bundle-aware",
      });

      expect(
        bundleAware.some((entry) =>
          entry.source_path === "src/store/root-schema.ts" &&
          entry.support_cluster?.role === "support" &&
          entry.support_cluster.seed_source_path === "src/workflows/root-command.ts",
        ),
      ).toBe(true);
      expect(
        bundleAware.some((entry) =>
          entry.source_path === "src/store/order-schema.ts" &&
          entry.support_cluster?.role === "support" &&
          entry.support_cluster.seed_source_path === "src/workflows/order-service.ts",
        ),
      ).toBe(false);
    } finally {
      if (oldPromotion === undefined) {
        delete process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED;
      } else {
        process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED = oldPromotion;
      }
    }
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
