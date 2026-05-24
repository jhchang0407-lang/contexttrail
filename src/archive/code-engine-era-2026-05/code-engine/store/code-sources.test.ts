/**
 * PRD-0028 / slice 28.2 — code_sources storage round-trip tests.
 *
 * Covers CRUD on the new `code_sources` table + FTS5 virtual table, including
 * the pre-PRD-0028 cache case (no rows) which must remain queryable.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../../../../store/db.js";
import { openDb, closeDb } from "../../../../store/db.js";
import {
  upsertCodeSource,
  getCodeSource,
  listCodeSources,
  deleteCodeSource,
  searchCodeSourcesFts,
  CODE_SOURCES_FTS_WEIGHTS,
} from "./code-sources.js";
import type { CodeSourceFacts } from "../types/code-source.js";

const NOW = "2026-05-11T00:00:00Z";

function makeFacts(overrides: Partial<CodeSourceFacts> = {}): CodeSourceFacts {
  return {
    file_path: "src/retrieve/foo.ts",
    exported_symbols: [
      { name: "foo", kind: "function" },
      { name: "FooConfig", kind: "type" },
    ],
    exported_signatures: ["export function foo(x: number): number"],
    file_purpose: "Module purpose.",
    imports: ["src/retrieve/bar"],
    ...overrides,
  };
}

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "contexttrail-cs-"));
  db = openDb(join(tmp, "contexttrail.db"));
});

afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
});

describe("code_sources storage", () => {
  it("round-trips a record by file_path", () => {
    const f = makeFacts();
    upsertCodeSource(db, {
      facts: f,
      source_content_hash: "h0",
      indexed_at: NOW,
    });
    const got = getCodeSource(db, "src/retrieve/foo.ts");
    expect(got).not.toBeNull();
    expect(got!.facts).toMatchObject(f);
    expect(got!.facts.role_facts?.package_root).toBeNull();
    expect(got!.facts.role_facts?.file_roles.length).toBeGreaterThan(0);
    expect(got!.source_content_hash).toBe("h0");
    expect(got!.indexed_at).toBe(NOW);
  });

  it("persists package role facts for retrieval fanout", () => {
    upsertCodeSource(db, {
      facts: makeFacts({
        file_path: "packages/preact-query-devtools/tsup.config.ts",
        exported_symbols: [],
        exported_signatures: [],
        file_purpose: "Build configuration.",
        imports: [],
      }),
      source_content_hash: "h0",
      indexed_at: NOW,
    });

    const got = getCodeSource(
      db,
      "packages/preact-query-devtools/tsup.config.ts",
    );
    expect(got?.facts.role_facts?.package_root).toBe(
      "packages/preact-query-devtools",
    );
    expect(got?.facts.role_facts?.workspace_family_keys).toContain(
      "query-devtools",
    );
    expect(got?.facts.role_facts?.file_roles).toEqual(
      expect.arrayContaining(["config", "build"]),
    );
  });

  it("round-trips manifest package facts for dependency fanout", () => {
    upsertCodeSource(db, {
      facts: makeFacts({
        file_path: "packages/angular-query-experimental/src/index.ts",
        package_facts: {
          package_root: "packages/angular-query-experimental",
          package_name: "@tanstack/angular-query-experimental",
          manifest_path: "packages/angular-query-experimental/package.json",
          internal_dependency_names: ["@tanstack/query-core"],
          internal_dependency_roots: ["packages/query-core"],
          internal_dependent_names: [],
          internal_dependent_roots: [],
          script_names: ["build"],
          export_keys: ["."],
        },
      }),
      source_content_hash: "h0",
      indexed_at: NOW,
    });

    const got = getCodeSource(
      db,
      "packages/angular-query-experimental/src/index.ts",
    );
    expect(got?.facts.package_facts?.package_name).toBe(
      "@tanstack/angular-query-experimental",
    );
    expect(got?.facts.package_facts?.internal_dependency_roots).toEqual([
      "packages/query-core",
    ]);
  });

  it("round-trips git co-change facts for patch-set fanout", () => {
    upsertCodeSource(db, {
      facts: makeFacts({
        cochange_facts: {
          related_paths: [
            { source_path: "packages/adapter-d1/helpers/build.ts", count: 3 },
          ],
        },
      }),
      source_content_hash: "h0",
      indexed_at: NOW,
    });

    const got = getCodeSource(db, "src/retrieve/foo.ts");
    expect(got?.facts.cochange_facts?.related_paths).toEqual([
      { source_path: "packages/adapter-d1/helpers/build.ts", count: 3 },
    ]);
  });

  it("upsert replaces previous content", () => {
    upsertCodeSource(db, {
      facts: makeFacts(),
      source_content_hash: "h0",
      indexed_at: NOW,
    });
    upsertCodeSource(db, {
      facts: makeFacts({
        exported_symbols: [{ name: "bar", kind: "function" }],
        exported_signatures: ["export function bar(): void"],
        file_purpose: null,
        imports: [],
      }),
      source_content_hash: "h1",
      indexed_at: NOW,
    });
    const got = getCodeSource(db, "src/retrieve/foo.ts")!;
    expect(got.facts.exported_symbols).toEqual([{ name: "bar", kind: "function" }]);
    expect(got.facts.file_purpose).toBeNull();
    expect(got.facts.imports).toEqual([]);
    expect(got.source_content_hash).toBe("h1");
  });

  it("listCodeSources returns rows in source_path order", () => {
    upsertCodeSource(db, {
      facts: makeFacts({ file_path: "src/b.ts" }),
      source_content_hash: "h",
      indexed_at: NOW,
    });
    upsertCodeSource(db, {
      facts: makeFacts({ file_path: "src/a.ts" }),
      source_content_hash: "h",
      indexed_at: NOW,
    });
    const all = listCodeSources(db);
    expect(all.map((r) => r.facts.file_path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("delete removes the record and its FTS entry", () => {
    upsertCodeSource(db, {
      facts: makeFacts(),
      source_content_hash: "h0",
      indexed_at: NOW,
    });
    deleteCodeSource(db, "src/retrieve/foo.ts");
    expect(getCodeSource(db, "src/retrieve/foo.ts")).toBeNull();
    expect(searchCodeSourcesFts(db, "foo")).toEqual([]);
  });

  it("pre-PRD-0028 cache (no code_sources rows) returns empty results, not an error", () => {
    expect(listCodeSources(db)).toEqual([]);
    expect(getCodeSource(db, "anything")).toBeNull();
    expect(searchCodeSourcesFts(db, "anything")).toEqual([]);
  });

  it("exposes the principled fixed BM25F weights from the PRD", () => {
    expect(CODE_SOURCES_FTS_WEIGHTS.file_path).toBe(2.5);
    expect(CODE_SOURCES_FTS_WEIGHTS.exported_symbols).toBe(2.5);
    expect(CODE_SOURCES_FTS_WEIGHTS.file_purpose).toBe(1.2);
    expect(CODE_SOURCES_FTS_WEIGHTS.exported_signatures).toBe(1.0);
  });
});

describe("code_sources FTS search", () => {
  beforeEach(() => {
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/source-rerank.ts",
        exported_symbols: [
          { name: "scoreSourceRerank", kind: "function" },
          { name: "tokenizeForRerank", kind: "function" },
        ],
        exported_signatures: [
          "export function scoreSourceRerank(args: ScoreArgs): RerankScore",
        ],
        file_purpose: "Source-level reranker for retrieval candidates.",
        imports: ["src/retrieve/source-candidates"],
      },
      source_content_hash: "h0",
      indexed_at: NOW,
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/store/cards.ts",
        exported_symbols: [{ name: "upsertCard", kind: "function" }],
        exported_signatures: ["export function upsertCard(db: Db, card: Card): void"],
        file_purpose: "Card persistence layer.",
        imports: [],
      },
      source_content_hash: "h0",
      indexed_at: NOW,
    });
  });

  it("matches exported symbol tokens", () => {
    const hits = searchCodeSourcesFts(db, "scoreSourceRerank");
    expect(hits.map((h) => h.file_path)).toContain("src/retrieve/source-rerank.ts");
  });

  it("matches file-path tokens", () => {
    const hits = searchCodeSourcesFts(db, "cards");
    expect(hits.map((h) => h.file_path)).toContain("src/store/cards.ts");
  });

  it("matches file_purpose tokens", () => {
    const hits = searchCodeSourcesFts(db, "reranker");
    expect(hits.map((h) => h.file_path)).toContain("src/retrieve/source-rerank.ts");
  });
});
