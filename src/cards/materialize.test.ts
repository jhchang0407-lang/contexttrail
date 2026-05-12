import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestCorpus } from "../eval/test-corpus.js";
import { nextCardIdentity, writeCardFile } from "./materialize.js";

describe("card materialization", () => {
  it("writes scaffold and materialized card files from different content shapes", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-card-materialize-" });
    const cwd = corpus.cwd;
    try {
      const scaffoldIdentity = nextCardIdentity(cwd, "constraint", "new");
      writeCardFile({
        kind: "scaffold",
        path: scaffoldIdentity.path,
        card_id: scaffoldIdentity.card_id,
        card_type: "constraint",
      });

      const scaffoldSource = readFileSync(scaffoldIdentity.path, "utf8");
      expect(scaffoldSource).toContain("id: C001");
      expect(scaffoldSource).toContain("type: constraint");
      expect(scaffoldSource).not.toContain("review_trace:");

      const materializedIdentity = nextCardIdentity(
        cwd,
        "constraint",
        "Queue worker owns retry orchestration",
      );
      writeCardFile({
        kind: "materialized",
        path: materializedIdentity.path,
        card_id: materializedIdentity.card_id,
        card_type: "constraint",
        title: "Queue worker owns retry orchestration",
        authority: "accepted",
        provenance: "system_derived",
        authored_by: "contexttrail-bootstrap",
        scope: {
          layer: "project",
          project: "contexttrail",
        },
        symbol_anchors: [],
        linked_chunks: [],
        review_trace: {
          source_review_item_id: "cand-001",
          history_path: ".contexttrail/review-trace/c001.yml",
          material_review_item_ids: ["cand-001"],
        },
        body: "All retry work must run through the queue worker.",
      });

      const materializedSource = readFileSync(materializedIdentity.path, "utf8");
      expect(materializedSource).toContain("id: C002");
      expect(materializedSource).toContain("review_trace:");
      expect(materializedSource).toContain("source_review_item_id: cand-001");
      expect(materializedSource).toContain("All retry work must run through the queue worker.");
    } finally {
      corpus.cleanup();
    }
  });
});
