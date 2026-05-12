import { describe, it, expect } from "vitest";
import { buildImportersResolver, expandCodeImportsKHops } from "./code-import-traversal.js";

describe("expandCodeImportsKHops", () => {
  // Chain: source-rerank → bm25 → chunks
  const known = new Set([
    "src/retrieve/source-rerank.ts",
    "src/retrieve/bm25.ts",
    "src/store/chunks.ts",
    "src/store/db.ts",
  ]);
  const importsByPath: Record<string, string[]> = {
    "src/retrieve/source-rerank.ts": ["src/retrieve/bm25.ts"],
    "src/retrieve/bm25.ts": ["src/store/chunks.ts", "src/store/db.ts"],
    "src/store/chunks.ts": ["src/store/db.ts"],
    "src/store/db.ts": [],
  };
  const resolveImports = (p: string) => importsByPath[p] ?? [];

  it("returns seeds when maxHops=0", () => {
    const out = expandCodeImportsKHops({
      seeds: ["src/retrieve/source-rerank.ts"],
      resolveImports,
      knownSources: known,
      maxHops: 0,
    });
    expect([...out].sort()).toEqual(["src/retrieve/source-rerank.ts"]);
  });

  it("includes direct imports at maxHops=1", () => {
    const out = expandCodeImportsKHops({
      seeds: ["src/retrieve/source-rerank.ts"],
      resolveImports,
      knownSources: known,
      maxHops: 1,
    });
    expect([...out].sort()).toEqual([
      "src/retrieve/bm25.ts",
      "src/retrieve/source-rerank.ts",
    ]);
  });

  it("traverses transitive imports at maxHops=2", () => {
    const out = expandCodeImportsKHops({
      seeds: ["src/retrieve/source-rerank.ts"],
      resolveImports,
      knownSources: known,
      maxHops: 2,
    });
    expect([...out].sort()).toEqual([
      "src/retrieve/bm25.ts",
      "src/retrieve/source-rerank.ts",
      "src/store/chunks.ts",
      "src/store/db.ts",
    ]);
  });

  it("filters imports that aren't in the corpus (npm packages, node: builtins)", () => {
    const out = expandCodeImportsKHops({
      seeds: ["src/retrieve/source-rerank.ts"],
      resolveImports: (p) => {
        if (p === "src/retrieve/source-rerank.ts") {
          return ["src/retrieve/bm25.ts", "react", "node:fs"];
        }
        return importsByPath[p] ?? [];
      },
      knownSources: known,
      maxHops: 1,
    });
    expect([...out].sort()).toEqual([
      "src/retrieve/bm25.ts",
      "src/retrieve/source-rerank.ts",
    ]);
  });

  it("handles cycles without infinite looping", () => {
    const cyclic: Record<string, string[]> = {
      "a.ts": ["b.ts"],
      "b.ts": ["a.ts"],
    };
    const out = expandCodeImportsKHops({
      seeds: ["a.ts"],
      resolveImports: (p) => cyclic[p] ?? [],
      knownSources: new Set(["a.ts", "b.ts"]),
      maxHops: 5,
    });
    expect([...out].sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("expands from multiple seeds in parallel", () => {
    const out = expandCodeImportsKHops({
      seeds: ["src/retrieve/source-rerank.ts", "src/store/chunks.ts"],
      resolveImports,
      knownSources: known,
      maxHops: 1,
    });
    expect([...out].sort()).toEqual([
      "src/retrieve/bm25.ts",
      "src/retrieve/source-rerank.ts",
      "src/store/chunks.ts",
      "src/store/db.ts",
    ]);
  });

  it("drops seeds that aren't in knownSources", () => {
    const out = expandCodeImportsKHops({
      seeds: ["src/retrieve/source-rerank.ts", "tests/synthetic/unknown.ts"],
      resolveImports,
      knownSources: known,
      maxHops: 1,
    });
    expect(out.has("tests/synthetic/unknown.ts")).toBe(false);
    expect(out.has("src/retrieve/source-rerank.ts")).toBe(true);
  });
});

describe("buildImportersResolver + reverse traversal", () => {
  // Forward graph: a imports b; c imports b; b imports d
  const importsByPath = new Map<string, string[]>([
    ["a.ts", ["b.ts"]],
    ["b.ts", ["d.ts"]],
    ["c.ts", ["b.ts"]],
    ["d.ts", []],
  ]);
  const known = new Set(["a.ts", "b.ts", "c.ts", "d.ts"]);

  it("builds an importers lookup that returns the inverse of imports", () => {
    const importers = buildImportersResolver(importsByPath);
    expect([...importers("b.ts")].sort()).toEqual(["a.ts", "c.ts"]);
    expect([...importers("d.ts")].sort()).toEqual(["b.ts"]);
    expect(importers("a.ts")).toEqual([]);
  });

  it("walks importers when resolveImporters is supplied", () => {
    const out = expandCodeImportsKHops({
      seeds: ["b.ts"],
      resolveImports: (p) => importsByPath.get(p) ?? [],
      resolveImporters: buildImportersResolver(importsByPath),
      knownSources: known,
      maxHops: 1,
    });
    // forward 1 hop reaches d; reverse 1 hop reaches a + c
    expect([...out].sort()).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });

  it("returns empty importers for a path with no inbound edges", () => {
    const importers = buildImportersResolver(importsByPath);
    expect(importers("a.ts")).toEqual([]);
  });
});
