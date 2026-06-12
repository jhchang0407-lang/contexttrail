/**
 * Integration test that source rerank actually reorders chunks
 * inside the pack while preserving non-ranking contracts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "../cli/import.js";
import { openDb, closeDb } from "../store/db.js";
import { loadConfig } from "../config/load.js";
import { retrieve } from "./retrieve.js";
import { buildRetrievalView } from "./view.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "contexttrail-rerank-int-"));
  mkdirSync(join(cwd, "docs/concepts"), { recursive: true });
  mkdirSync(join(cwd, "docs"), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("source rerank integration", () => {
  it("ranks the on-purpose concept doc above an incidental migration mention", () => {
    writeFileSync(
      join(cwd, "docs/concepts/web-app.md"),
      [
        "# Web app concept",
        "",
        "A web app is a long-lived UI delivered through HTTP.",
        "",
        "## Overview",
        "",
        "Web apps differ from native apps because they ship over HTTP.",
      ].join("\n"),
    );
    writeFileSync(
      join(cwd, "docs/migration-v5.md"),
      [
        "# Migrate to v5",
        "",
        "Web app section: many things changed for web apps in v5.",
        "Other section: web app updates that we shipped in v5 web app v5.",
      ].join("\n"),
    );

    runImport(cwd, ["docs/**/*.md"]);

    const cfg = loadConfig(cwd);
    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    try {
      const result = retrieve(
        db,
        {
          task: "what is a web app",
          query_anchors: {},
          budget: "default",
        },
        cfg,
      );
      expect(result.source_rerank).toBeDefined();
      const top = result.source_rerank![0]!;
      expect(top.candidate.source_path).toBe("docs/concepts/web-app.md");
      // First non-locked included chunk should belong to the top reranked source.
      const firstIncluded = result.pack.included.find((t) => t.kind === "doc_chunk");
      expect(firstIncluded).toBeDefined();
      const chunk = result.chunksByVersionId.get(firstIncluded!.version_id);
      expect(chunk?.source_path).toBe("docs/concepts/web-app.md");

      const view = buildRetrievalView({
        query: "what is a web app",
        result,
        requested_budget: 6000,
        has_sources: true,
        explain: false,
      });
      const firstPresented = view.presentation.relevant.find((t) => t.kind === "doc_chunk");
      expect(firstPresented).toBeDefined();
      expect(firstPresented?.kind === "doc_chunk" ? firstPresented.chunk.source_path : undefined)
        .toBe("docs/concepts/web-app.md");
    } finally {
      closeDb(db);
    }
  });

  it("does NOT demote migration when the query asks for migration", () => {
    writeFileSync(
      join(cwd, "docs/concepts/web-app.md"),
      "# Web app concept\n\nA long-lived UI delivered through HTTP.\n",
    );
    writeFileSync(
      join(cwd, "docs/migration-v5.md"),
      "# Migrate to v5\n\nMigration steps for web apps moving to v5.\n",
    );
    runImport(cwd, ["docs/**/*.md"]);

    const cfg = loadConfig(cwd);
    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    try {
      const result = retrieve(
        db,
        {
          task: "how do I migrate my web app to v5",
          query_anchors: {},
          budget: "default",
        },
        cfg,
      );
      const top = result.source_rerank![0]!;
      expect(top.candidate.source_path).toBe("docs/migration-v5.md");
      // The migration doc should not carry a distractor penalty for this query.
      expect(top.features.distractor_penalty).toBe(0);
    } finally {
      closeDb(db);
    }
  });
});
