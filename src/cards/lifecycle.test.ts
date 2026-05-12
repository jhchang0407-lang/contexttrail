import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestCorpus } from "../eval/test-corpus.js";
import { runCardVerify } from "../cli/card-cmds.js";
import { getCardById } from "../store/cards.js";
import { closeDb, openDb } from "../store/db.js";
import { importAcceptedCards } from "./lifecycle.js";

describe("Card lifecycle module", () => {
  it("imports accepted Card files while preserving manual author review state", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-card-lifecycle-" });
    try {
      corpus.writeDoc("docs/rules.md", "# Rules\n\nRefunds must be audited.\n");
      corpus.importDocs();
      writeFileSync(
        join(corpus.cwd, ".contexttrail/cards/c001.md"),
        [
          "---",
          "id: C001",
          "type: constraint",
          "title: Refund audit rule",
          "authority: accepted",
          "scope:",
          "  layer: project",
          "  project: lifecycle",
          "---",
          "",
          "Refunds must be audited.",
          "",
        ].join("\n"),
      );

      expect(importAcceptedCards(corpus.cwd).cards_imported).toBe(1);
      expect(runCardVerify(corpus.cwd, "C001")).toBe(true);

      writeFileSync(
        join(corpus.cwd, ".contexttrail/cards/c001.md"),
        [
          "---",
          "id: C001",
          "type: constraint",
          "title: Refund audit rule",
          "authority: accepted",
          "scope:",
          "  layer: project",
          "  project: lifecycle",
          "---",
          "",
          "Refunds must be audited with a trace id.",
          "",
        ].join("\n"),
      );

      expect(importAcceptedCards(corpus.cwd).cards_imported).toBe(1);
      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        const card = getCardById(db, "C001")!;
        expect(card.body).toContain("trace id");
        expect(card.author_review_state).toBe("verified");
      } finally {
        closeDb(db);
      }
    } finally {
      corpus.cleanup();
    }
  });
});
