import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  documentSourceImportPatterns,
  importConfiguredDocumentSources,
  saveDocumentSource,
} from "./document-sources.js";
import { openDb, closeDb } from "../store/db.js";
import { listSources } from "../store/sources.js";
import { createTestCorpus } from "../eval/test-corpus.js";

describe("document source import patterns", () => {
  it("escapes glob metacharacters in the folder path but not the glob suffix", () => {
    const patterns = documentSourceImportPatterns([
      { id: "docsrc-reports", path: "/tmp/Reports (2024)", glob: "**/*.md" },
    ]);
    expect(patterns).toEqual(["/tmp/Reports \\(2024\\)/**/*.md"]);
  });

  it("imports files from a registered folder whose name contains glob metacharacters", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-docsrc-" });
    const cwd = corpus.cwd;
    try {
      const reportsDir = join(cwd, "Reports (2024)");
      mkdirSync(reportsDir, { recursive: true });
      writeFileSync(join(reportsDir, "summary.md"), "# Summary\n\nQuarterly numbers.\n");

      const saved = saveDocumentSource(cwd, { path: "Reports (2024)", glob: "**/*.md" });
      expect(saved.action).toBe("created");

      const summary = importConfiguredDocumentSources(cwd);
      expect(summary.files_imported).toBe(1);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      expect(listSources(db).map((source) => source.source_path)).toEqual([
        "Reports (2024)/summary.md",
      ]);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });
});
