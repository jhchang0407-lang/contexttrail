import { describe, it, expect } from "vitest";
import { chmodSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatIndexSummary, runIndex } from "./index-cmd.js";
import { saveDocumentSource } from "../config/document-sources.js";
import { openDb, closeDb } from "../store/db.js";
import { listSources, listChunkVersionIdsForSource } from "../store/sources.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

function setup(): TestCorpus {
  return createTestCorpus({ prefix: "contexttrail-index-cmd-" });
}

const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("contexttrail index — failure and unreachable-source handling", () => {
  it.skipIf(runningAsRoot)(
    "reports a warning when re-extraction fails instead of counting the file unchanged",
    () => {
      const corpus = setup();
      const cwd = corpus.cwd;
      const path = join(cwd, "docs/a.md");
      try {
        mkdirSync(join(cwd, "docs"), { recursive: true });
        writeFileSync(path, "# A\n\nbody.\n");
        corpus.importDocs();

        // Touch mtime so the indexer attempts re-extraction, then make the
        // file unreadable so that re-extraction fails.
        const future = new Date(Date.now() + 5000);
        utimesSync(path, future, future);
        chmodSync(path, 0o000);

        const summary = runIndex(cwd);
        expect(summary.failed).toBe(1);
        expect(summary.unchanged).toBe(0);
        expect(summary.reindexed).toBe(0);
        expect(summary.warnings).toHaveLength(1);
        expect(summary.warnings[0]).toContain("docs/a.md");

        // The previously indexed chunks survive the failed pass untouched.
        const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
        expect(listChunkVersionIdsForSource(db, "docs/a.md", "current")).toHaveLength(1);
        closeDb(db);

        const formatted = formatIndexSummary(summary);
        expect(formatted).toContain("1 failed");
        expect(formatted).toContain("docs/a.md");
      } finally {
        try {
          chmodSync(path, 0o644);
        } catch {
          // file may already be gone
        }
        corpus.cleanup();
      }
    },
  );

  it("skips tombstoning when a configured document source root is unreachable", () => {
    const corpus = setup();
    const cwd = corpus.cwd;
    try {
      const docsDir = join(cwd, "docs");
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(join(docsDir, "a.md"), "# A\n\nbody a.\n");
      writeFileSync(join(docsDir, "b.md"), "# B\n\nbody b.\n");
      saveDocumentSource(cwd, { path: docsDir });
      corpus.importDocs();

      // Simulate an unmounted volume: the whole configured root vanishes.
      rmSync(docsDir, { recursive: true, force: true });

      const summary = runIndex(cwd);
      expect(summary.tombstoned_chunks).toBe(0);
      expect(summary.warnings.some((warning) =>
        warning.includes("is not reachable; skipping cleanup for its files"),
      )).toBe(true);
      expect(formatIndexSummary(summary)).toContain("is not reachable");

      // Indexed data for the unreachable root is left alone.
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const sourcePaths = listSources(db).map((source) => source.source_path).sort();
      expect(sourcePaths).toEqual(["docs/a.md", "docs/b.md"]);
      expect(listChunkVersionIdsForSource(db, "docs/a.md", "current")).toHaveLength(1);
      expect(listChunkVersionIdsForSource(db, "docs/b.md", "current")).toHaveLength(1);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("still tombstones a single deleted file when its configured root exists", () => {
    const corpus = setup();
    const cwd = corpus.cwd;
    try {
      const docsDir = join(cwd, "docs");
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(join(docsDir, "a.md"), "# A\n\nbody a.\n");
      writeFileSync(join(docsDir, "b.md"), "# B\n\nbody b.\n");
      saveDocumentSource(cwd, { path: docsDir });
      corpus.importDocs();

      // Only one file disappears; the root itself is still reachable.
      rmSync(join(docsDir, "a.md"));

      const summary = runIndex(cwd);
      expect(summary.tombstoned_chunks).toBeGreaterThanOrEqual(1);
      expect(summary.unchanged).toBe(1);
      expect(summary.warnings).toEqual([]);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      expect(listChunkVersionIdsForSource(db, "docs/a.md", "current")).toHaveLength(0);
      expect(listChunkVersionIdsForSource(db, "docs/b.md", "current")).toHaveLength(1);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });
});
