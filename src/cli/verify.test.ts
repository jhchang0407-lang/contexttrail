import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runVerify } from "./verify.js";
import { openDb, closeDb } from "../store/db.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

function setup(): TestCorpus {
  return createTestCorpus({ prefix: "contexttrail-verify-" });
}

describe("contexttrail verify", () => {
  it("exits cleanly on a healthy cache", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody.\n");
      corpus.importDocs();
      const r = runVerify(cwd);
      expect(r.ok).toBe(true);
      expect(r.failures).toEqual([]);
      expect(r.checked.doc_role_sources).toBe(1);
    } finally {
      corpus.cleanup();
    }
  });

  it("detects orphaned card_links rows (link points to unknown stable_key)", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody.\n");
      corpus.importDocs();

      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();

      // Inject an orphan link.
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      db.prepare(
        "INSERT INTO card_links (card_id, chunk_stable_key, version_pin, content_hash_pin, link_type, linked_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("C001", "sk_does_not_exist", "v_x", "h_x", "evidences", "now");
      closeDb(db);

      const r = runVerify(cwd);
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.kind === "orphan_link")).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("detects empty stable_key on doc_chunks", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody.\n");
      corpus.importDocs();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      db.prepare("UPDATE doc_chunks SET stable_key=''").run();
      closeDb(db);
      const r = runVerify(cwd);
      expect(r.failures.some((f) => f.kind === "empty_stable_key")).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("detects stale freshness_state (rebuild from canonical truth disagrees)", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody.\n");
      corpus.importDocs();
      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();

      // Manually corrupt freshness_state so it disagrees with the materialized value.
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      db.prepare(
        "UPDATE cards SET freshness_state='needs_review', freshness_reason='version_drift' WHERE id='C001'",
      ).run();
      closeDb(db);

      const r = runVerify(cwd);
      expect(r.failures.some((f) => f.kind === "stale_freshness_state")).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("accepts authored potentially_superseded freshness as an explicit stale-evidence signal", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody.\n");
      corpus.importDocs();
      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nfreshness_state: potentially_superseded\nfreshness_reason: version_drift\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      db.prepare(
        "UPDATE cards SET freshness_state='potentially_superseded', freshness_reason='version_drift' WHERE id='C001'",
      ).run();
      closeDb(db);

      const r = runVerify(cwd);

      expect(r.ok).toBe(true);
      expect(r.failures).toEqual([]);
    } finally {
      corpus.cleanup();
    }
  });

  it("detects orphaned code_anchors (chunk_version_id no longer exists)", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody.\n");
      corpus.importDocs();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      db.pragma("foreign_keys = OFF");
      db.prepare(
        "INSERT INTO code_anchors (chunk_version_id, kind, value, confidence, source) VALUES (?, ?, ?, ?, ?)",
      ).run("v_does_not_exist", "symbol", "X", "high", "manual");
      closeDb(db);
      const r = runVerify(cwd);
      expect(r.failures.some((f) => f.kind === "orphan_code_anchor")).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("detects card_links with version_pin not present in any chunk row", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody.\n");
      corpus.importDocs();
      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const row = db
        .prepare("SELECT stable_key FROM doc_chunks WHERE status='current' LIMIT 1")
        .get() as { stable_key: string };
      db.prepare(
        "INSERT INTO card_links (card_id, chunk_stable_key, version_pin, content_hash_pin, link_type, linked_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("C001", row.stable_key, "v_phantom", "h_phantom", "evidences", "now");
      closeDb(db);
      const r = runVerify(cwd);
      expect(r.failures.some((f) => f.kind === "unknown_version_pin")).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("detects doc_role rows that still reflect stale default upgrade values", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/IDEAS.md"), "# Ideas\n\nfuture-facing notes.\n");
      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      db.prepare(
        "UPDATE doc_chunks SET doc_role='canonical', role_source='default' WHERE source_path='docs/IDEAS.md'",
      ).run();
      closeDb(db);

      const r = runVerify(cwd);
      expect(r.ok).toBe(false);
      const failure = r.failures.find((f) => f.kind === "stale_doc_role");
      expect(failure?.message).toMatch(/docs\/IDEAS\.md/);
      expect(failure?.message).toMatch(/contexttrail import/);
    } finally {
      corpus.cleanup();
    }
  });

  it("accepts rerunning import as the deterministic activation path for stale doc_role rows", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/IDEAS.md"), "# Ideas\n\nfuture-facing notes.\n");
      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      db.prepare(
        "UPDATE doc_chunks SET doc_role='canonical', role_source='default' WHERE source_path='docs/IDEAS.md'",
      ).run();
      closeDb(db);

      const repaired = corpus.importDocs();
      expect(repaired.files_unchanged).toBe(1);
      expect(runVerify(cwd).ok).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });
});
