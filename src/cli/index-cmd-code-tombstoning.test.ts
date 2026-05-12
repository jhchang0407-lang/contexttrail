/**
 * PRD-0035 / slice 35.1 — code-source tombstoning in `contexttrail index`.
 *
 * Parity with the existing doc-chunk tombstoning loop in `runIndex`:
 * when a code file disappears from disk, its `code_sources` row (and
 * FTS5 entry) must be removed on the next `contexttrail index` pass.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runIndex, formatIndexSummary } from "./index-cmd.js";
import { openDb, closeDb } from "../store/db.js";
import { getCodeSource, listCodeSources } from "../store/code-sources.js";
import { createTestCorpus } from "../eval/test-corpus.js";

describe("contexttrail index: code-source tombstoning (PRD-0035 / 35.1)", () => {
  it("tombstones a code-source whose file is removed and reports the count", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-index-code-" });
    const cwd = corpus.cwd;
    try {
      // Write a code file matched by the default `code_globs` (src/**/*.ts)
      mkdirSync(join(cwd, "src"), { recursive: true });
      const codePath = join(cwd, "src/foo.ts");
      writeFileSync(
        codePath,
        "export function foo(x: number): number { return x + 1; }\n",
      );
      // Also write a doc so importDocs() finds something; the import pass
      // is what populates code_sources via `importCodeSources()`.
      corpus.writeDoc("docs/a.md", "# A\n\nbody.\n");
      corpus.importDocs();

      // Confirm baseline: the code source is in the table.
      const dbPre = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      expect(getCodeSource(dbPre, "src/foo.ts")).not.toBeNull();
      closeDb(dbPre);

      // Delete the code file from disk and run index.
      rmSync(codePath);
      const r = runIndex(cwd);

      expect(r.tombstoned_code_sources).toBe(1);

      const dbPost = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      expect(getCodeSource(dbPost, "src/foo.ts")).toBeNull();
      expect(listCodeSources(dbPost)).toEqual([]);
      closeDb(dbPost);
    } finally {
      corpus.cleanup();
    }
  });

  it("rename pattern: old path is tombstoned on next contexttrail index", () => {
    // Rename = delete-then-add. contexttrail index handles the delete side;
    // a subsequent contexttrail import would index the new path. We only test
    // the delete side here — that's what slice 35.1 owns.
    const corpus = createTestCorpus({ prefix: "contexttrail-index-code-" });
    const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(join(cwd, "src/old-name.ts"), "export const x = 1;\n");
      corpus.writeDoc("docs/a.md", "# A\n");
      corpus.importDocs();

      const dbPre = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      expect(getCodeSource(dbPre, "src/old-name.ts")).not.toBeNull();
      closeDb(dbPre);

      // Simulate rename: remove the old path.
      rmSync(join(cwd, "src/old-name.ts"));
      const r = runIndex(cwd);
      expect(r.tombstoned_code_sources).toBe(1);

      const dbPost = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      expect(getCodeSource(dbPost, "src/old-name.ts")).toBeNull();
      closeDb(dbPost);
    } finally {
      corpus.cleanup();
    }
  });

  it("formatIndexSummary appends code-sources line only when count > 0", () => {
    expect(
      formatIndexSummary({
        unchanged: 1,
        reindexed: 2,
        tombstoned_chunks: 3,
        tombstoned_code_sources: 0,
      }),
    ).toBe("1 unchanged, 2 reindexed, 3 chunks tombstoned");

    expect(
      formatIndexSummary({
        unchanged: 1,
        reindexed: 2,
        tombstoned_chunks: 3,
        tombstoned_code_sources: 4,
      }),
    ).toBe("1 unchanged, 2 reindexed, 3 chunks tombstoned, 4 code-sources tombstoned");
  });

  it("does not disturb existing doc-chunk tombstoning behavior", () => {
    // Regression: removing a markdown doc still tombstones its chunks
    // and reports `tombstoned_chunks`. Code-source tombstoning must not
    // affect the doc-chunk loop.
    const corpus = createTestCorpus({ prefix: "contexttrail-index-code-" });
    const cwd = corpus.cwd;
    try {
      corpus.writeDoc("docs/gone.md", "# Gone\n\nbody.\n");
      corpus.importDocs();
      rmSync(join(cwd, "docs/gone.md"));

      const r = runIndex(cwd);
      expect(r.tombstoned_chunks).toBeGreaterThanOrEqual(1);
      expect(r.tombstoned_code_sources).toBe(0);
    } finally {
      corpus.cleanup();
    }
  });

  it("is idempotent — re-running contexttrail index after tombstoning is a no-op", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-index-code-" });
    const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(join(cwd, "src/foo.ts"), "export const x = 1;\n");
      corpus.writeDoc("docs/a.md", "# A\n");
      corpus.importDocs();

      rmSync(join(cwd, "src/foo.ts"));
      const first = runIndex(cwd);
      expect(first.tombstoned_code_sources).toBe(1);

      const second = runIndex(cwd);
      expect(second.tombstoned_code_sources).toBe(0);
    } finally {
      corpus.cleanup();
    }
  });
});
