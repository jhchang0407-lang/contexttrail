/**
 * PRD-0028 / slice 28.3 — code-source mixer tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../store/db.js";
import { closeDb, openDb } from "../store/db.js";
import { upsertCodeSource } from "../store/code-sources.js";
import { syncCodeGraph } from "../store/code-graph.js";
import { buildCodeRankedEntries } from "./code-source-mix.js";

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "contexttrail-csmix-"));
  db = openDb(join(tmp, "contexttrail.db"));
  upsertCodeSource(db, {
    facts: {
      file_path: "src/retrieve/source-rerank.ts",
      exported_symbols: [
        { name: "scoreSourceRerank", kind: "function" },
        { name: "tokenizeForRerank", kind: "function" },
      ],
      exported_signatures: [
        "export function scoreSourceRerank(args: Args): Score",
      ],
      file_purpose: "Source-level reranker for retrieval candidates.",
      imports: [],
    },
    source_content_hash: "h",
    indexed_at: "2026-05-11T00:00:00Z",
  });
  upsertCodeSource(db, {
    facts: {
      file_path: "src/store/cards.ts",
      exported_symbols: [{ name: "upsertCard", kind: "function" }],
      exported_signatures: ["export function upsertCard(db: Db, c: Card): void"],
      file_purpose: "Card persistence layer.",
      imports: [],
    },
    source_content_hash: "h",
    indexed_at: "2026-05-11T00:00:00Z",
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
    });
    expect(out.length).toBeGreaterThan(0);
    const top = out[0]!;
    expect(top.kind).toBe("code");
    expect(top.contexttrail).toContain("src/retrieve/source-rerank.ts");
    expect(top.body).toContain("src/retrieve/source-rerank.ts");
    expect(top.body).toContain("scoreSourceRerank");
  });

  it("body includes the file path so the agent-completion probe regex matches", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "card persistence",
      enabled: true,
    });
    expect(out.some((e) => e.body.includes("src/store/cards.ts"))).toBe(true);
  });

  it("ranks the topically-matching code source above unrelated ones", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "reranker for retrieval",
      enabled: true,
    });
    expect(out[0]?.contexttrail).toContain("source-rerank.ts");
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

  it("keeps lexical hits direct and adds graph-traversed neighbors from the shared code graph", () => {
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/bm25.ts",
        exported_symbols: [{ name: "scoreBm25", kind: "function" }],
        exported_signatures: ["export function scoreBm25(): number"],
        file_purpose: "BM25 scoring substrate.",
        imports: ["src/store/db"],
      },
      source_content_hash: "h",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/store/db.ts",
        exported_symbols: [{ name: "openDb", kind: "function" }],
        exported_signatures: ["export function openDb(filePath: string): Db"],
        file_purpose: "Database open helper.",
        imports: [],
      },
      source_content_hash: "h",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/consumer.ts",
        exported_symbols: [{ name: "consumeRerank", kind: "function" }],
        exported_signatures: ["export function consumeRerank(): void"],
        file_purpose: "Consumes rerank results.",
        imports: ["src/retrieve/source-rerank"],
      },
      source_content_hash: "h",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/source-rerank.ts",
        exported_symbols: [
          { name: "scoreSourceRerank", kind: "function" },
          { name: "tokenizeForRerank", kind: "function" },
        ],
        exported_signatures: [
          "export function scoreSourceRerank(args: Args): Score",
        ],
        file_purpose: "Source-level reranker for retrieval candidates.",
        imports: ["src/retrieve/bm25"],
      },
      source_content_hash: "h",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    syncCodeGraph(db);
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/source-rerank.ts",
        exported_symbols: [
          { name: "scoreSourceRerank", kind: "function" },
          { name: "tokenizeForRerank", kind: "function" },
        ],
        exported_signatures: [
          "export function scoreSourceRerank(args: Args): Score",
        ],
        file_purpose: "Source-level reranker for retrieval candidates.",
        imports: [],
      },
      source_content_hash: "h2",
      indexed_at: "2026-05-11T00:00:01Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/consumer.ts",
        exported_symbols: [{ name: "consumeRerank", kind: "function" }],
        exported_signatures: ["export function consumeRerank(): void"],
        file_purpose: "Consumes rerank results.",
        imports: [],
      },
      source_content_hash: "h2",
      indexed_at: "2026-05-11T00:00:01Z",
    });

    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank",
      enabled: true,
      import_max_hops: 1,
    });

    expect(out[0]?.contexttrail).toBe("Code: src/retrieve/source-rerank.ts");
    expect(out.some((entry) => entry.contexttrail === "Code: src/retrieve/bm25.ts (import-traversed)")).toBe(true);
    expect(out.some((entry) => entry.contexttrail === "Code: src/retrieve/consumer.ts (import-traversed)")).toBe(true);
  });

  it("caps import-traversed additions to the nearest graph neighbors first", () => {
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/source-rerank.ts",
        exported_symbols: [{ name: "scoreSourceRerank", kind: "function" }],
        exported_signatures: ["export function scoreSourceRerank(): number"],
        file_purpose: "Source rerank root.",
        imports: ["src/retrieve/bm25"],
      },
      source_content_hash: "h-root",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/bm25.ts",
        exported_symbols: [{ name: "scoreBm25", kind: "function" }],
        exported_signatures: ["export function scoreBm25(): number"],
        file_purpose: "Direct outgoing neighbor.",
        imports: ["src/store/db"],
      },
      source_content_hash: "h-bm25",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/store/db.ts",
        exported_symbols: [{ name: "openDb", kind: "function" }],
        exported_signatures: ["export function openDb(filePath: string): Db"],
        file_purpose: "Second-hop outgoing neighbor.",
        imports: [],
      },
      source_content_hash: "h-db",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/consumer.ts",
        exported_symbols: [{ name: "consumeRerank", kind: "function" }],
        exported_signatures: ["export function consumeRerank(): void"],
        file_purpose: "Direct incoming neighbor.",
        imports: ["src/retrieve/source-rerank"],
      },
      source_content_hash: "h-consumer",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/entry.ts",
        exported_symbols: [{ name: "entrypoint", kind: "function" }],
        exported_signatures: ["export function entrypoint(): void"],
        file_purpose: "Second-hop incoming neighbor.",
        imports: ["src/retrieve/consumer"],
      },
      source_content_hash: "h-entry",
      indexed_at: "2026-05-11T00:00:00Z",
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
      .filter((entry) => entry.contexttrail.includes("(import-traversed)"))
      .map((entry) => entry.contexttrail)
      .sort();

    expect(traversed).toEqual([
      "Code: src/retrieve/bm25.ts (import-traversed)",
      "Code: src/retrieve/consumer.ts (import-traversed)",
    ]);
  });

  it("caps import-traversed token mass", () => {
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/source-rerank.ts",
        exported_symbols: [{ name: "scoreSourceRerank", kind: "function" }],
        exported_signatures: ["export function scoreSourceRerank(): number"],
        file_purpose: "Source rerank root.",
        imports: ["src/retrieve/small-neighbor"],
      },
      source_content_hash: "h-root",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/small-neighbor.ts",
        exported_symbols: [{ name: "smallNeighbor", kind: "function" }],
        exported_signatures: ["export function smallNeighbor(): void"],
        file_purpose: "Small graph neighbor.",
        imports: [],
      },
      source_content_hash: "h-small",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/large-neighbor.ts",
        exported_symbols: [{ name: "largeNeighbor", kind: "function" }],
        exported_signatures: ["export function largeNeighbor(): void"],
        file_purpose: Array.from({ length: 200 }, () => "oversized").join(" "),
        imports: ["src/retrieve/source-rerank"],
      },
      source_content_hash: "h-large",
      indexed_at: "2026-05-11T00:00:00Z",
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
      entry.contexttrail.includes("(import-traversed)"),
    );
    const small = uncappedTraversed.find((entry) =>
      entry.contexttrail.includes("small-neighbor.ts"),
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
      entry.contexttrail.includes("(import-traversed)"),
    );

    expect(cappedTraversed.reduce((sum, entry) => sum + entry.tokens, 0)).toBeLessThanOrEqual(
      small!.tokens,
    );
    expect(cappedTraversed.some((entry) => entry.contexttrail.includes("small-neighbor.ts"))).toBe(
      true,
    );
    expect(cappedTraversed.some((entry) => entry.contexttrail.includes("large-neighbor.ts"))).toBe(
      false,
    );
  });
});
