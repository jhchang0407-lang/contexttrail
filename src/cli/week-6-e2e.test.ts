import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createTestCorpus } from "../eval/test-corpus.js";
import { runCardBootstrap } from "./card-bootstrap.js";
import { runCardImport } from "./card-import.js";
import { runContext } from "./context.js";
import { runInboxAccept, runInboxAnswer } from "./inbox-cmds.js";
import { getInboxItem, listInboxItems } from "../inbox/items.js";

describe("week-6 end-to-end: bootstrap → review → accept → retrieve", () => {
  it("walks the full PRD-0009 product loop on a single corpus", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-week6-e2e-" });
    const cwd = corpus.cwd;
    try {
      // Plant docs that should produce, in one bootstrap run:
      // - one merged strong constraint candidate (same MUST/NEVER rule in two files)
      // - one symbol_note candidate (backticked symbol + "coordinates" hint)
      // - one clarification need (a SHOULD rule that should not become a candidate)
      corpus.writeDoc(
        "docs/payments/refunds.md",
        [
          "---",
          "doc_role: canonical",
          "---",
          "",
          "# Refund runbook",
          "",
          "Refunds must never exceed the captured amount.",
          "",
        ].join("\n"),
      );
      corpus.writeDoc(
        "docs/payments/audit.md",
        [
          "---",
          "doc_role: canonical",
          "---",
          "",
          "# Audit",
          "",
          "Refunds must never exceed the captured amount.",
          "",
          "Operators should bypass the ledger review step only with caution.",
          "",
        ].join("\n"),
      );
      corpus.writeDoc(
        "docs/billing/ledger.md",
        [
          "---",
          "doc_role: canonical",
          "---",
          "",
          "# Ledger",
          "",
          "The `Billing.LedgerEntry` symbol coordinates billing writes across services.",
          "",
        ].join("\n"),
      );
      corpus.importDocs();

      // ── Bootstrap ───────────────────────────────────────────────────────
      const summary = await runCardBootstrap(cwd);
      expect(summary.constraint_candidates_written).toBe(1);
      expect(summary.symbol_note_candidates_written).toBe(1);
      expect(summary.clarification_needs_written).toBe(1);
      // Same strong rule appeared in two docs → one merge.
      expect(summary.merged_duplicates).toBeGreaterThanOrEqual(1);

      // ── Inbox shape (US 15-21) ──────────────────────────────────────────
      const items = listInboxItems(cwd);
      const candidates = items.filter((i) => i.review_type === "candidate_card");
      const clarifications = items.filter(
        (i) => i.review_type === "clarification_need",
      );
      expect(candidates).toHaveLength(2);
      expect(clarifications).toHaveLength(1);

      // Merged constraint: one candidate covering two supporting chunks (US 16).
      const constraint = candidates.find((c) => c.candidate_type === "constraint");
      expect(constraint).toBeDefined();
      expect(constraint!.body).toContain(
        "Refunds must never exceed the captured amount",
      );
      expect(constraint!.supporting_chunks).toHaveLength(2);
      const supportingPaths = constraint!.supporting_chunks.map((c) => c.source_path);
      expect(supportingPaths).toContain("docs/payments/refunds.md");
      expect(supportingPaths).toContain("docs/payments/audit.md");

      // Trace history populated by bootstrap (US 28).
      expect(constraint!.trace_history?.length ?? 0).toBeGreaterThan(0);
      expect(constraint!.trace_history?.[0]?.kind).toBe("candidate_created");

      // Symbol note: produced from "coordinates" hint + backticked symbol.
      const symbolNote = candidates.find((c) => c.candidate_type === "symbol_note");
      expect(symbolNote).toBeDefined();
      expect(symbolNote!.symbol_anchors).toContain("Billing.LedgerEntry");

      // Clarification: from the SHOULD rule, with the constrained-choice template
      // (US 18, 22).
      const clarification = clarifications[0]!;
      expect(clarification.choices.map((c) => c.id)).toEqual(["constraint", "ignore"]);
      expect(clarification.free_text_allowed).toBe(true);
      expect(clarification.body).toContain("ledger review step");

      // ── Answer the clarification (US 26) ────────────────────────────────
      // Bootstrap-generated clarifications carry no rewrite_rules, so this
      // exercises the answer-state-transition path, not the rewrite path.
      const answered = runInboxAnswer(cwd, clarification.id, {
        choice_id: "constraint",
      });
      expect(answered).not.toBeNull();
      expect(answered!.answer_text).toBe("Treat this as a hard constraint");
      const reAnswered = getInboxItem(cwd, clarification.id);
      expect(reAnswered?.status).toBe("answered");
      expect(
        reAnswered?.review_type === "clarification_need" &&
          reAnswered.answered_choice_id,
      ).toBe("constraint");

      // ── Accept the symbol_note candidate (US 5-7, 28-29) ────────────────
      const accepted = runInboxAccept(cwd, symbolNote!.id);
      expect(accepted).not.toBeNull();
      expect(accepted!.card_id).toMatch(/^S\d{3}$/);
      expect(existsSync(accepted!.path)).toBe(true);

      // Card on disk has accepted authority + bootstrap audit metadata.
      const cardSource = readFileSync(accepted!.path, "utf8");
      expect(cardSource).toContain("authority: accepted");
      expect(cardSource).toContain("provenance: system_derived");
      expect(cardSource).toContain("authored_by: contexttrail-bootstrap");
      expect(cardSource).toContain("review_trace:");
      expect(cardSource).toContain(`source_review_item_id: ${symbolNote!.id}`);

      // Per-card sidecar with full trace history (US 28-29).
      const sidecarPath = join(
        cwd,
        ".contexttrail/review-trace",
        `${accepted!.card_id.toLowerCase()}.yml`,
      );
      expect(existsSync(sidecarPath)).toBe(true);
      const sidecar = parseYaml(readFileSync(sidecarPath, "utf8")) as {
        card_id: string;
        source_review_item_id: string;
        material_review_item_ids: string[];
        entries: Array<{ kind: string; source_review_item_id: string }>;
      };
      expect(sidecar.card_id).toBe(accepted!.card_id);
      expect(sidecar.source_review_item_id).toBe(symbolNote!.id);
      expect(sidecar.material_review_item_ids).toContain(symbolNote!.id);
      expect(sidecar.entries.length).toBeGreaterThan(0);
      expect(sidecar.entries[0]?.kind).toBe("candidate_created");

      // Inbox item now flipped to accepted status.
      const acceptedItem = getInboxItem(cwd, symbolNote!.id);
      expect(acceptedItem?.status).toBe("accepted");

      // ── Retrieval integration (US 35) ───────────────────────────────────
      // Accepted bootstrap card flows through normal card import + retrieval.
      const importResult = runCardImport(cwd);
      expect(importResult.cards_imported).toBeGreaterThan(0);

      const context = runContext(cwd, "billing ledger entry semantics", {
        symbols: ["Billing.LedgerEntry"],
      });
      const lockedIds = context.pack.locked.map((entry) => entry.card_id);
      expect(lockedIds).toContain(accepted!.card_id);
    } finally {
      corpus.cleanup();
    }
  });
});
