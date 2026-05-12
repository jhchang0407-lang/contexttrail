import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, utimesSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runIndex } from "./index-cmd.js";
import { listScopeReport } from "./scope-inspect.js";
import { openDb, closeDb } from "../store/db.js";
import { listSources, listChunkVersionIdsForSource } from "../store/sources.js";
import { getAnchorsForChunk } from "../store/anchors.js";
import { getChunkByVersionId } from "../store/chunks.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

function setup(): TestCorpus {
  return createTestCorpus({ prefix: "contexttrail-import-" });
}

describe("contexttrail import → index → scope inspect lifecycle", () => {
  it("imports markdown sources, populates chunks, anchors, and indexed_doc_sources", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs/payments"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/payments/refunds.md"),
        `---\nscope:\n  layer: project\n  project: payments\n---\n\n# Refunds\n\nSee \`src/payments/refund.ts\` for the impl. The \`RefundService.processRefund\` method must be idempotent.\n\n## Edge Cases\n\nSet STRIPE_API_KEY before running.\n`,
      );

      const result = corpus.importDocs();
      expect(result.files_imported).toBe(1);
      expect(result.chunks_written).toBeGreaterThanOrEqual(2);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const sources = listSources(db);
      expect(sources).toHaveLength(1);
      expect(sources[0]!.source_path).toBe("docs/payments/refunds.md");
      expect(sources[0]!.chunk_count).toBeGreaterThanOrEqual(2);

      const versionIds = listChunkVersionIdsForSource(db, "docs/payments/refunds.md");
      expect(versionIds.length).toBeGreaterThanOrEqual(2);

      // First chunk should carry frontmatter scope (project=payments)
      const refundsChunk = versionIds
        .map((v) => getChunkByVersionId(db, v)!)
        .find((c) => c.title === "Refunds")!;
      expect(refundsChunk.scope.layer).toBe("project");
      expect(refundsChunk.scope.project).toBe("payments");

      // Anchors extracted
      const anchors = getAnchorsForChunk(db, refundsChunk.version_id);
      const values = anchors.map((a) => a.value).sort();
      expect(values).toContain("src/payments/refund.ts");
      expect(values).toContain("RefundService.processRefund");

      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("populates doc_role with frontmatter overriding config/default", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeFileSync(
        join(cwd, ".contexttrail/config.yaml"),
        `version: 1
doc_roles:
  - pattern: "docs/**/*.md"
    role: ideation
`,
      );
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/a.md"),
        `---
doc_role: example
---

# A

body.
`,
      );

      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const ids = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      const c = getChunkByVersionId(db, ids[0]!)!;
      expect(c.doc_role).toBe("example");
      expect(c.role_source).toBe("frontmatter");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("backfills doc_role for unchanged existing chunks on import", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nbody.\n");
      corpus.importDocs();

      writeFileSync(
        join(cwd, ".contexttrail/config.yaml"),
        `version: 1
doc_roles:
  - pattern: "docs/**/*.md"
    role: ideation
`,
      );

      const result = corpus.importDocs();
      expect(result.files_unchanged).toBe(1);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const ids = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      const c = getChunkByVersionId(db, ids[0]!)!;
      expect(c.doc_role).toBe("ideation");
      expect(c.role_source).toBe("config_pattern");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("re-import is idempotent (no duplicate sources, same version_ids)", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nbody.\n");
      const r1 = corpus.importDocs();
      expect(r1.files_imported).toBe(1);
      const r2 = corpus.importDocs();
      // Idempotent: second run sees the file unchanged and skips it.
      expect(r2.files_imported).toBe(0);
      expect(r2.files_unchanged).toBe(1);
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const sources = listSources(db);
      expect(sources).toHaveLength(1);
      const ids = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      expect(ids).toHaveLength(1);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail index: no-op when mtime+size unchanged", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nbody.\n");
      corpus.importDocs();
      const r = runIndex(cwd);
      expect(r.unchanged).toBe(1);
      expect(r.reindexed).toBe(0);
      expect(r.tombstoned_chunks).toBe(0);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail index: reindexes when source content changes; rotates version_id, preserves stable_key", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      const path = join(cwd, "docs/a.md");
      writeFileSync(path, "# Sec\n\noriginal body.\n");
      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const beforeIds = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      const beforeChunk = getChunkByVersionId(db, beforeIds[0]!)!;
      closeDb(db);

      // Edit content, advance mtime
      writeFileSync(path, "# Sec\n\ntotally rewritten body now.\n");
      const future = new Date(Date.now() + 5000);
      utimesSync(path, future, future);

      const r = runIndex(cwd);
      expect(r.reindexed).toBe(1);

      const db2 = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const currentIds = listChunkVersionIdsForSource(db2, "docs/a.md", "current");
      expect(currentIds).toHaveLength(1);
      const afterChunk = getChunkByVersionId(db2, currentIds[0]!)!;
      expect(afterChunk.stable_key).toBe(beforeChunk.stable_key);
      expect(afterChunk.version_id).not.toBe(beforeChunk.version_id);

      // Old version is tombstoned, not deleted
      const all = listChunkVersionIdsForSource(db2, "docs/a.md", "any");
      expect(all.length).toBe(2);
      closeDb(db2);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail index: frontmatter-declared anchors persist across re-index (regression)", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      const path = join(cwd, "docs/a.md");
      writeFileSync(
        path,
        `---\nscope:\n  layer: project\n  project: payments\n  files:\n    - src/payments/refund.ts\n  symbols:\n    - RefundService.processRefund\n  routes:\n    - POST /refunds\n---\n\n# Refunds\n\noriginal body.\n`,
      );
      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const beforeIds = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      const beforeAnchors = getAnchorsForChunk(db, beforeIds[0]!);
      const beforeFmAnchors = beforeAnchors.filter((a) => a.source === "frontmatter");
      expect(beforeFmAnchors.length).toBe(3);
      closeDb(db);

      // Edit content, advance mtime — same frontmatter, different body.
      writeFileSync(
        path,
        `---\nscope:\n  layer: project\n  project: payments\n  files:\n    - src/payments/refund.ts\n  symbols:\n    - RefundService.processRefund\n  routes:\n    - POST /refunds\n---\n\n# Refunds\n\nrewritten body now.\n`,
      );
      const future = new Date(Date.now() + 5000);
      utimesSync(path, future, future);

      runIndex(cwd);

      const db2 = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const afterIds = listChunkVersionIdsForSource(db2, "docs/a.md", "current");
      const afterAnchors = getAnchorsForChunk(db2, afterIds[0]!);
      const afterFmAnchors = afterAnchors.filter((a) => a.source === "frontmatter");
      expect(afterFmAnchors.length).toBe(3);
      const values = afterFmAnchors.map((a) => a.value).sort();
      expect(values).toContain("src/payments/refund.ts");
      expect(values).toContain("RefundService.processRefund");
      expect(values).toContain("POST /refunds");
      closeDb(db2);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail index: tombstones chunks whose source file is removed", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      const path = join(cwd, "docs/a.md");
      writeFileSync(path, "# A\n\nbody.\n");
      corpus.importDocs();

      rmSync(path);
      const r = runIndex(cwd);
      expect(r.tombstoned_chunks).toBeGreaterThanOrEqual(1);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const current = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      expect(current).toHaveLength(0);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail scope inspect --unknown filters to unknown-layer chunks", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      mkdirSync(join(cwd, "random"));
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nbody.\n");
      writeFileSync(join(cwd, "random/b.md"), "# B\n\nbody.\n");
      corpus.importDocs(["docs/**/*.md", "random/**/*.md"]);

      const all = listScopeReport(cwd, { unknownOnly: false });
      const unknown = listScopeReport(cwd, { unknownOnly: true });
      expect(all.length).toBeGreaterThan(unknown.length);
      for (const r of unknown) {
        expect(r.scope_layer).toBe("unknown");
      }
      // doc/a.md is project (matched by docs-project-default rule); random/b.md is unknown.
      const fromDocs = all.filter((r) => r.source_path.startsWith("docs/"));
      expect(fromDocs.every((r) => r.scope_layer === "project")).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });
});
