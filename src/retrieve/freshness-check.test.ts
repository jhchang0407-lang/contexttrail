/**
 * PRD-0035 / slice 35.2 — pre-retrieve freshness check.
 *
 * Pure-function behavior tests. The MCP-handler wiring (warning emission
 * into pack.warnings and the optional auto-reindex path) lives in
 * src/mcp/handlers.test.ts integration tests.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, rmSync, mkdirSync, utimesSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb, closeDb } from "../store/db.js";
import { createTestCorpus } from "../eval/test-corpus.js";
import {
  detectStaleSources,
  FRESHNESS_EARLY_EXIT_THRESHOLD,
} from "./freshness-check.js";

describe("detectStaleSources (PRD-0035 / 35.2)", () => {
  it("returns empty result when the corpus is fresh", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-fresh-" });
    try {
      corpus.writeDoc("docs/a.md", "# A\n\nbody.\n");
      corpus.importDocs();

      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const result = detectStaleSources(db, corpus.cwd);
      closeDb(db);

      expect(result.stale_doc_sources).toEqual([]);
      expect(result.stale_code_sources).toEqual([]);
      expect(result.missing_sources).toEqual([]);
    } finally {
      corpus.cleanup();
    }
  });

  it("flags edited doc whose content-hash no longer matches", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-fresh-" });
    try {
      corpus.writeDoc("docs/a.md", "# A\n\noriginal body.\n");
      corpus.importDocs();

      // Edit content (changes size + hash, no re-import yet)
      writeFileSync(join(corpus.cwd, "docs/a.md"), "# A\n\nedited body now longer than before.\n");

      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const result = detectStaleSources(db, corpus.cwd);
      closeDb(db);

      expect(result.stale_doc_sources).toEqual(["docs/a.md"]);
      expect(result.missing_sources).toEqual([]);
    } finally {
      corpus.cleanup();
    }
  });

  it("flags same-size doc edits when mtime advances", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-fresh-" });
    try {
      corpus.writeDoc("docs/a.md", "# A\n\nabc.\n");
      corpus.importDocs();

      writeFileSync(join(corpus.cwd, "docs/a.md"), "# A\n\nxyz.\n");
      const now = Date.now() / 1000 + 60;
      utimesSync(join(corpus.cwd, "docs/a.md"), now, now);

      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const result = detectStaleSources(db, corpus.cwd);
      closeDb(db);

      expect(result.stale_doc_sources).toEqual(["docs/a.md"]);
    } finally {
      corpus.cleanup();
    }
  });

  it("does not flag a touched-but-unchanged file (mtime updated, content identical)", () => {
    // Content-hash semantics, not mtime. Save-without-change must not warn.
    const corpus = createTestCorpus({ prefix: "contexttrail-fresh-" });
    try {
      const body = "# A\n\nbody.\n";
      corpus.writeDoc("docs/a.md", body);
      corpus.importDocs();

      // Touch the file (mtime advances) but write identical content.
      writeFileSync(join(corpus.cwd, "docs/a.md"), body);
      const now = Date.now() / 1000 + 60;
      utimesSync(join(corpus.cwd, "docs/a.md"), now, now);

      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const result = detectStaleSources(db, corpus.cwd);
      closeDb(db);

      expect(result.stale_doc_sources).toEqual([]);
      expect(result.missing_sources).toEqual([]);
    } finally {
      corpus.cleanup();
    }
  });

  it("flags edited code-source whose content-hash no longer matches", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-fresh-" });
    try {
      mkdirSync(join(corpus.cwd, "src"), { recursive: true });
      writeFileSync(
        join(corpus.cwd, "src/foo.ts"),
        "export function foo(x: number): number { return x + 1; }\n",
      );
      corpus.writeDoc("docs/a.md", "# A\n");
      corpus.importDocs();

      writeFileSync(
        join(corpus.cwd, "src/foo.ts"),
        "export function foo(x: number): number { return x + 2; }\n",
      );

      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const result = detectStaleSources(db, corpus.cwd);
      closeDb(db);

      expect(result.stale_code_sources).toEqual(["src/foo.ts"]);
    } finally {
      corpus.cleanup();
    }
  });

  it("early-exits at the configured threshold (warning fires; doesn't enumerate all)", () => {
    // When more than FRESHNESS_EARLY_EXIT_THRESHOLD sources are indexed, the
    // check stops at the first detected stale source instead of walking the
    // whole corpus — this keeps latency floor predictable on large repos.
    // The warning still fires; downstream consumers don't depend on the full
    // enumeration to render a warning.
    const corpus = createTestCorpus({ prefix: "contexttrail-fresh-" });
    try {
      const N = FRESHNESS_EARLY_EXIT_THRESHOLD + 5;
      for (let i = 0; i < N; i++) {
        corpus.writeDoc(`docs/${String(i).padStart(4, "0")}.md`, `# ${i}\n\nbody.\n`);
      }
      corpus.importDocs();
      // Delete the first two (sorted) docs so multiple are stale on disk.
      rmSync(join(corpus.cwd, "docs/0000.md"));
      rmSync(join(corpus.cwd, "docs/0001.md"));

      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const result = detectStaleSources(db, corpus.cwd);
      closeDb(db);

      // Early-exit: only one missing source is reported even though two were deleted.
      expect(result.missing_sources.length).toBe(1);
      expect(result.missing_sources[0]).toBe("docs/0000.md");
    } finally {
      corpus.cleanup();
    }
  });

  it("can disable early-exit for repair mode", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-fresh-" });
    try {
      const N = FRESHNESS_EARLY_EXIT_THRESHOLD + 5;
      for (let i = 0; i < N; i++) {
        corpus.writeDoc(`docs/${String(i).padStart(4, "0")}.md`, `# ${i}\n\nbody.\n`);
      }
      corpus.importDocs();
      rmSync(join(corpus.cwd, "docs/0000.md"));
      rmSync(join(corpus.cwd, "docs/0001.md"));

      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const result = detectStaleSources(db, corpus.cwd, { earlyExit: false });
      closeDb(db);

      expect(result.missing_sources).toEqual(["docs/0000.md", "docs/0001.md"]);
    } finally {
      corpus.cleanup();
    }
  });

  it("flags a deleted doc as a missing_source", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-fresh-" });
    try {
      corpus.writeDoc("docs/gone.md", "# Gone\n\nbody.\n");
      corpus.importDocs();

      rmSync(join(corpus.cwd, "docs/gone.md"));

      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const result = detectStaleSources(db, corpus.cwd);
      closeDb(db);

      expect(result.missing_sources).toEqual(["docs/gone.md"]);
      expect(result.stale_doc_sources).toEqual([]);
    } finally {
      corpus.cleanup();
    }
  });
});
