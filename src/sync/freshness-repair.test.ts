import { describe, expect, it } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestCorpus } from "../eval/test-corpus.js";
import { openDb, closeDb } from "../store/db.js";
import { getSource } from "../store/sources.js";
import {
  detectLedgerFreshness,
  runFreshnessPrePass,
} from "./freshness-repair.js";

describe("freshness repair seam", () => {
  it("supports detect-only warnings and apply repair through one module", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-freshness-repair-" });
    try {
      corpus.writeDoc("docs/a.md", "# A\n\noriginal body.\n");
      corpus.writeDoc("docs/gone.md", "# Gone\n\nwill disappear.\n");
      corpus.importDocs();

      const beforeDb = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const docBefore = getSource(beforeDb, "docs/a.md")!;
      closeDb(beforeDb);

      writeFileSync(join(corpus.cwd, "docs/a.md"), "# A\n\nedited body.\n");
      rmSync(join(corpus.cwd, "docs/gone.md"));

      const detectOnly = runFreshnessPrePass(corpus.cwd, { autoReindex: false });
      expect(detectOnly.warnings.map((warning) => warning.kind)).toEqual([
        "stale_source",
        "missing_source",
      ]);
      expect(detectOnly.writes).toEqual([]);

      const unchangedDb = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      expect(getSource(unchangedDb, "docs/a.md")?.source_content_hash).toBe(
        docBefore.source_content_hash,
      );
      closeDb(unchangedDb);

      const repaired = runFreshnessPrePass(corpus.cwd, { autoReindex: true });
      expect(repaired.warnings).toEqual([]);
      expect(repaired.writes).toContain(".contexttrail/cache/contexttrail.db");
      expect(detectLedgerFreshness(corpus.cwd)).toEqual({
        stale_doc_sources: [],
        missing_sources: [],
      });
    } finally {
      corpus.cleanup();
    }
  });
});
