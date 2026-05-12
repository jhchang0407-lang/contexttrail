/**
 * THO-135 / PRD-0013 V2.5.2 — repo-configurable corpus import coverage.
 *
 * `computeImportCoverage` separates "the corpus did not include this source"
 * from any retrieval-stage failure. Holdout exposed Zod's `wiki/optionality.md`
 * misses as an import-surface bug — making this distinction first-class lets
 * reports point at corpus coverage instead of ranking.
 */
import { describe, it, expect } from "vitest";
import { computeImportCoverage } from "./import-coverage.js";

describe("computeImportCoverage", () => {
  it("classifies every expected source as imported when all paths are present", () => {
    const result = computeImportCoverage({
      expected_sources: ["docs/a.md", "docs/b.md"],
      imported_sources: ["docs/a.md", "docs/b.md", "docs/c.md"],
    });
    expect(result.not_imported_sources).toEqual([]);
    expect(result.imported_set.has("docs/a.md")).toBe(true);
  });

  it("returns the missing expected sources as not_imported", () => {
    const result = computeImportCoverage({
      expected_sources: ["wiki/optionality.md", "packages/zod/README.md"],
      imported_sources: ["packages/zod/README.md"],
    });
    expect(result.not_imported_sources).toEqual(["wiki/optionality.md"]);
  });

  it("preserves expected source order in not_imported_sources for deterministic reports", () => {
    const result = computeImportCoverage({
      expected_sources: ["a", "b", "c", "d"],
      imported_sources: ["b"],
    });
    expect(result.not_imported_sources).toEqual(["a", "c", "d"]);
  });

  it("handles an empty imported inventory", () => {
    const result = computeImportCoverage({
      expected_sources: ["x"],
      imported_sources: [],
    });
    expect(result.not_imported_sources).toEqual(["x"]);
    expect(result.imported_set.size).toBe(0);
  });
});
