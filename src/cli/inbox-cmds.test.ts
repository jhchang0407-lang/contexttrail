import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runInboxAccept,
  runInboxAnswer,
  runInboxList,
  runInboxShow,
  renderInboxList,
  renderInboxShow,
} from "./inbox-cmds.js";
import { runCardAdd } from "./card-cmds.js";
import { createTestCorpus } from "../eval/test-corpus.js";
import { writeInboxItem } from "../inbox/items.js";
import { openDb, closeDb } from "../store/db.js";
import { runContext } from "./context.js";
import { runCardImport } from "./card-import.js";
import { getCardById } from "../store/cards.js";

// PRD-0036 / 36.3 (B4): inbox list flags + summary on a 344-item fixture
// matching the fastapi pilot dump shape (204 candidate_card + 140 clarification_need).
describe("contexttrail inbox list — PRD-0036 / 36.3 flags + summary", () => {
  function seedFastapiShapeInbox(cwd: string): void {
    // 200 candidate cards (pending) + 4 candidate cards (accepted) = 204
    // 140 clarification needs (pending). Total 344 matches the pilot dump.
    for (let i = 0; i < 200; i++) {
      writeInboxItem(cwd, {
        id: `cand-${String(i).padStart(3, "0")}`,
        review_type: "candidate_card",
        status: "pending",
        title: `Candidate ${i}`,
        candidate_type: "constraint",
        scope: { layer: "project", project: "fastapi" },
        body: `Body for candidate ${i}.`,
        supporting_chunks: [],
        created_at: `2026-05-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
        updated_at: `2026-05-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      });
    }
    for (let i = 200; i < 204; i++) {
      writeInboxItem(cwd, {
        id: `cand-${String(i).padStart(3, "0")}`,
        review_type: "candidate_card",
        status: "accepted",
        title: `Accepted candidate ${i}`,
        candidate_type: "constraint",
        scope: { layer: "project", project: "fastapi" },
        body: `Body for accepted candidate ${i}.`,
        supporting_chunks: [],
        created_at: `2026-05-01T00:01:${String(i % 60).padStart(2, "0")}.000Z`,
        updated_at: `2026-05-01T00:01:${String(i % 60).padStart(2, "0")}.000Z`,
      });
    }
    for (let i = 0; i < 140; i++) {
      writeInboxItem(cwd, {
        id: `clar-${String(i).padStart(3, "0")}`,
        review_type: "clarification_need",
        status: "pending",
        title: `Clarification ${i}`,
        body: `Body for clarification ${i}.`,
        choices: [{ id: "a", label: "A" }],
        free_text_allowed: true,
        affects_candidate_ids: [],
        created_at: `2026-05-01T00:02:${String(i % 60).padStart(2, "0")}.000Z`,
        updated_at: `2026-05-01T00:02:${String(i % 60).padStart(2, "0")}.000Z`,
      });
    }
  }

  it("default limit is 20 and header shows total + type + status breakdown", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-flags-default-" });
    const cwd = corpus.cwd;
    try {
      seedFastapiShapeInbox(cwd);
      const view = runInboxList(cwd);
      expect(view.total).toBe(344);
      expect(view.type_counts).toEqual({
        candidate_card: 204,
        clarification_need: 140,
      });
      expect(view.status_counts.pending).toBe(340);
      expect(view.status_counts.accepted).toBe(4);
      expect(view.rows).toHaveLength(20);
      // Sort: pending first, candidate_card before clarification_need, id ascending.
      // First 20 are pending candidate_cards (cand-000 .. cand-019).
      expect(view.rows[0]!.id).toBe("cand-000");
      expect(view.rows[19]!.id).toBe("cand-019");

      const text = renderInboxList(view);
      expect(text).toMatch(/Inbox: 344 total/);
      expect(text).toMatch(/204 candidate_card, 140 clarification_need/);
      expect(text).toMatch(/Pending: 340/);
      expect(text).toMatch(/Accepted: 4/);
      expect(text).toMatch(/Showing 1-20 of 344/);
      // Footer pagination hint when more items remain.
      expect(text).toMatch(/More items exist/);
    } finally {
      corpus.cleanup();
    }
  });

  it("--limit caps rows and footer reflects the limit", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-flags-limit-" });
    const cwd = corpus.cwd;
    try {
      seedFastapiShapeInbox(cwd);
      const view = runInboxList(cwd, { limit: 5 });
      expect(view.rows).toHaveLength(5);
      expect(view.rows[0]!.id).toBe("cand-000");
      const text = renderInboxList(view);
      expect(text).toMatch(/Showing 1-5 of 344/);
    } finally {
      corpus.cleanup();
    }
  });

  it("--type candidate_card filters to candidates only", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-flags-typec-" });
    const cwd = corpus.cwd;
    try {
      seedFastapiShapeInbox(cwd);
      const view = runInboxList(cwd, { type: "candidate_card", limit: 1000 });
      expect(view.total_filtered).toBe(204);
      expect(view.rows.every((r) => r.review_type === "candidate_card")).toBe(true);
      const text = renderInboxList(view);
      expect(text).toMatch(/filtered: type=candidate_card/);
    } finally {
      corpus.cleanup();
    }
  });

  it("--type clarification_need filters to clarifications only", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-flags-typel-" });
    const cwd = corpus.cwd;
    try {
      seedFastapiShapeInbox(cwd);
      const view = runInboxList(cwd, { type: "clarification_need", limit: 1000 });
      expect(view.total_filtered).toBe(140);
      expect(view.rows.every((r) => r.review_type === "clarification_need")).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("--status accepted filters to accepted items", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-flags-status-" });
    const cwd = corpus.cwd;
    try {
      seedFastapiShapeInbox(cwd);
      const view = runInboxList(cwd, { status: "accepted", limit: 1000 });
      expect(view.total_filtered).toBe(4);
      expect(view.rows.every((r) => r.status === "accepted")).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("combines --type and --status filters", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-flags-combo-" });
    const cwd = corpus.cwd;
    try {
      seedFastapiShapeInbox(cwd);
      const view = runInboxList(cwd, {
        type: "candidate_card",
        status: "accepted",
        limit: 1000,
      });
      expect(view.total_filtered).toBe(4);
      expect(
        view.rows.every(
          (r) => r.review_type === "candidate_card" && r.status === "accepted",
        ),
      ).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("empty filter result prints a no-match line, not pagination", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-flags-empty-" });
    const cwd = corpus.cwd;
    try {
      seedFastapiShapeInbox(cwd);
      const view = runInboxList(cwd, { status: "rejected" });
      expect(view.total_filtered).toBe(0);
      const text = renderInboxList(view);
      expect(text).toMatch(/No items match the current filters/);
    } finally {
      corpus.cleanup();
    }
  });

  it("sort order: pending first, candidate_card before clarification_need, id ascending", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-flags-sort-" });
    const cwd = corpus.cwd;
    try {
      writeInboxItem(cwd, {
        id: "clar-z",
        review_type: "clarification_need",
        status: "pending",
        title: "later clarification",
        body: "x",
        choices: [],
        free_text_allowed: false,
        affects_candidate_ids: [],
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
      });
      writeInboxItem(cwd, {
        id: "cand-z",
        review_type: "candidate_card",
        status: "accepted",
        title: "already accepted cand",
        candidate_type: "constraint",
        scope: { layer: "project", project: "p" },
        body: "x",
        supporting_chunks: [],
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
      });
      writeInboxItem(cwd, {
        id: "cand-a",
        review_type: "candidate_card",
        status: "pending",
        title: "first pending cand",
        candidate_type: "constraint",
        scope: { layer: "project", project: "p" },
        body: "x",
        supporting_chunks: [],
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
      });

      const view = runInboxList(cwd);
      expect(view.rows.map((r) => r.id)).toEqual([
        "cand-a",   // pending candidate
        "clar-z",   // pending clarification
        "cand-z",   // accepted
      ]);
    } finally {
      corpus.cleanup();
    }
  });
});

describe("contexttrail inbox list / show", () => {
  it("lists candidate cards and clarification needs from the shared inbox backing store", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-cmd-" });
    const cwd = corpus.cwd;
    try {
      writeInboxItem(cwd, {
        id: "cand-001",
        review_type: "candidate_card",
        status: "pending",
        title: "Lock retries behind the queue worker",
        candidate_type: "constraint",
        scope: {
          layer: "project",
          project: "contexttrail",
        },
        body: "All retry work must run through the queue worker.",
        supporting_chunks: [
          {
            chunk_stable_key: "docs/core.md#retry-worker",
            source_path: "docs/CORE.md",
            heading_path: ["Runtime"],
          },
        ],
        created_at: "2026-05-07T12:00:00.000Z",
        updated_at: "2026-05-07T12:00:00.000Z",
      });
      writeInboxItem(cwd, {
        id: "clar-001",
        review_type: "clarification_need",
        status: "pending",
        title: "Clarify the canonical payments module name",
        body: "Which module name should bootstrap use for payments rules?",
        choices: [
          { id: "billing", label: "billing" },
          { id: "ledger", label: "ledger" },
        ],
        free_text_allowed: true,
        affects_candidate_ids: ["cand-002", "cand-003"],
        created_at: "2026-05-07T12:01:00.000Z",
        updated_at: "2026-05-07T12:01:00.000Z",
      });

      const view = runInboxList(cwd);
      expect(view.rows).toHaveLength(2);
      expect(view.rows.map((row) => row.id)).toEqual(["cand-001", "clar-001"]);
      expect(view.rows.map((row) => row.review_type)).toEqual([
        "candidate_card",
        "clarification_need",
      ]);
      expect(view.total).toBe(2);
      expect(view.type_counts).toEqual({ candidate_card: 1, clarification_need: 1 });

      const text = renderInboxList(view);
      expect(text).toContain("candidate_card");
      expect(text).toContain("clarification_need");
    } finally {
      corpus.cleanup();
    }
  });

  it("shows the full stored review item details for each inbox type", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-show-" });
    const cwd = corpus.cwd;
    try {
      writeInboxItem(cwd, {
        id: "cand-001",
        review_type: "candidate_card",
        status: "pending",
        title: "Lock retries behind the queue worker",
        candidate_type: "constraint",
        scope: {
          layer: "project",
          project: "contexttrail",
        },
        body: "All retry work must run through the queue worker.",
        supporting_chunks: [
          {
            chunk_stable_key: "docs/core.md#retry-worker",
            source_path: "docs/CORE.md",
            heading_path: ["Runtime"],
          },
        ],
        created_at: "2026-05-07T12:00:00.000Z",
        updated_at: "2026-05-07T12:00:00.000Z",
      });

      const candidate = runInboxShow(cwd, "cand-001");
      expect(candidate?.review_type).toBe("candidate_card");
      expect(candidate?.body).toContain("queue worker");
      expect(renderInboxShow(candidate!)).toContain("supporting chunks");

      writeInboxItem(cwd, {
        id: "clar-001",
        review_type: "clarification_need",
        status: "pending",
        title: "Clarify the canonical payments module name",
        body: "Which module name should bootstrap use for payments rules?",
        choices: [
          { id: "billing", label: "billing" },
          { id: "ledger", label: "ledger" },
        ],
        free_text_allowed: true,
        affects_candidate_ids: ["cand-002", "cand-003"],
        created_at: "2026-05-07T12:01:00.000Z",
        updated_at: "2026-05-07T12:01:00.000Z",
      });

      const clarification = runInboxShow(cwd, "clar-001");
      expect(clarification?.review_type).toBe("clarification_need");
      expect(renderInboxShow(clarification!)).toContain("billing");
      expect(renderInboxShow(clarification!)).toContain("cand-003");
    } finally {
      corpus.cleanup();
    }
  });

  it("accepts a candidate into the normal cards flow with audit metadata and normal retrieval behavior", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-accept-" });
    const cwd = corpus.cwd;
    try {
      corpus.writeDoc(
        "docs/billing.md",
        [
          "# Billing",
          "",
          "## Ledger entry",
          "",
          "LedgerEntry coordinates billing writes.",
          "",
        ].join("\n"),
      );
      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const chunk = db
        .prepare(
          "SELECT stable_key, version_id FROM doc_chunks WHERE source_path = 'docs/billing.md' AND status = 'current' LIMIT 1",
        )
        .get() as { stable_key: string; version_id: string };
      closeDb(db);

      writeInboxItem(cwd, {
        id: "cand-accept-001",
        review_type: "candidate_card",
        status: "pending",
        title: "LedgerEntry owns billing writes",
        candidate_type: "symbol_note",
        scope: {
          layer: "module",
          project: "contexttrail",
          module: "billing",
        },
        symbol_anchors: ["Billing.LedgerEntry"],
        body: "LedgerEntry is the coordinating symbol for billing writes.",
        supporting_chunks: [
          {
            chunk_stable_key: chunk.stable_key,
            source_path: "docs/billing.md",
            heading_path: ["Billing", "Ledger entry"],
            version_id: chunk.version_id,
          },
        ],
        created_at: "2026-05-07T12:10:00.000Z",
        updated_at: "2026-05-07T12:10:00.000Z",
      });

      const accepted = runInboxAccept(cwd, "cand-accept-001");
      expect(accepted).not.toBeNull();
      expect(accepted?.card_id).toMatch(/^S\d{3}$/);

      const cardSource = readFileSync(accepted!.path, "utf8");
      expect(cardSource).toContain("authority: accepted");
      expect(cardSource).toContain("provenance: system_derived");
      expect(cardSource).toContain("authored_by: contexttrail-bootstrap");
      expect(cardSource).toContain("review_trace:");
      expect(cardSource).toContain("source_review_item_id: cand-accept-001");

      const db2 = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const imported = getCardById(db2, accepted!.card_id);
      closeDb(db2);
      expect(imported?.authority).toBe("accepted");
      expect(imported?.provenance).toBe("system_derived");
      expect(imported?.authored_by).toBe("contexttrail-bootstrap");

      const context = runContext(cwd, "update billing entry", {
        symbols: ["Billing.LedgerEntry"],
      });
      expect(context.pack.locked.map((entry) => entry.card_id)).toContain(
        accepted!.card_id,
      );

      const inboxItem = runInboxShow(cwd, "cand-accept-001");
      expect(inboxItem?.status).toBe("accepted");
    } finally {
      corpus.cleanup();
    }
  });

  it("does not reuse a scaffolded card id when accepting a candidate before card import", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-accept-id-" });
    const cwd = corpus.cwd;
    try {
      const scaffold = runCardAdd(cwd, "constraint");
      expect(scaffold.id).toBe("C001");

      writeInboxItem(cwd, {
        id: "cand-accept-constraint-001",
        review_type: "candidate_card",
        status: "pending",
        title: "Queue worker owns retry orchestration",
        candidate_type: "constraint",
        scope: {
          layer: "project",
          project: "contexttrail",
        },
        body: "All retry work must run through the queue worker.",
        supporting_chunks: [],
        created_at: "2026-05-07T12:11:00.000Z",
        updated_at: "2026-05-07T12:11:00.000Z",
      });

      const accepted = runInboxAccept(cwd, "cand-accept-constraint-001");
      expect(accepted).not.toBeNull();
      expect(accepted?.card_id).toBe("C002");
    } finally {
      corpus.cleanup();
    }
  });

  it("answers a clarification by rewriting multiple pending candidates and preserving visible causal trace", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-answer-" });
    const cwd = corpus.cwd;
    try {
      writeInboxItem(cwd, {
        id: "cand-002",
        review_type: "candidate_card",
        status: "pending",
        title: "{module} owns retry orchestration",
        candidate_type: "constraint",
        scope: {
          layer: "module",
          project: "contexttrail",
          module: "unknown",
        },
        body: "{module} must own retry orchestration before dispatch.",
        supporting_chunks: [],
        created_at: "2026-05-07T12:15:00.000Z",
        updated_at: "2026-05-07T12:15:00.000Z",
      });
      writeInboxItem(cwd, {
        id: "cand-003",
        review_type: "candidate_card",
        status: "pending",
        title: "{module} records retry failures",
        candidate_type: "constraint",
        scope: {
          layer: "module",
          project: "contexttrail",
          module: "unknown",
        },
        body: "{module} should record retry failures before escalation.",
        supporting_chunks: [],
        created_at: "2026-05-07T12:16:00.000Z",
        updated_at: "2026-05-07T12:16:00.000Z",
      });
      writeInboxItem(cwd, {
        id: "clar-apply-001",
        review_type: "clarification_need",
        status: "pending",
        title: "Clarify the canonical retry module name",
        body: "Which module name should these retry candidates use?",
        choices: [
          { id: "queue_worker", label: "queue-worker" },
          { id: "dispatcher", label: "dispatcher" },
        ],
        free_text_allowed: true,
        affects_candidate_ids: ["cand-002", "cand-003"],
        rewrite_rules: [
          { target: "title", match: "{module}", replacement_template: "{{answer}}" },
          { target: "body", match: "{module}", replacement_template: "{{answer}}" },
          { target: "scope.module", replacement_template: "{{answer}}" },
        ],
        created_at: "2026-05-07T12:17:00.000Z",
        updated_at: "2026-05-07T12:17:00.000Z",
      });

      const result = runInboxAnswer(cwd, "clar-apply-001", {
        choice_id: "queue_worker",
      });

      expect(result).not.toBeNull();
      expect(result?.updated_candidate_ids).toEqual(["cand-002", "cand-003"]);

      const candidateA = runInboxShow(cwd, "cand-002");
      expect(candidateA?.review_type).toBe("candidate_card");
      expect(candidateA?.title).toBe("queue-worker owns retry orchestration");
      expect(candidateA?.body).toContain("queue-worker must own retry orchestration");
      expect(candidateA?.scope.module).toBe("queue-worker");
      expect(renderInboxShow(candidateA!)).toContain("clarification_applied");
      expect(renderInboxShow(candidateA!)).toContain("clar-apply-001");

      const candidateB = runInboxShow(cwd, "cand-003");
      expect(candidateB?.review_type).toBe("candidate_card");
      expect(candidateB?.title).toBe("queue-worker records retry failures");
      expect(candidateB?.body).toContain("queue-worker should record retry failures");
      expect(candidateB?.scope.module).toBe("queue-worker");

      const clarification = runInboxShow(cwd, "clar-apply-001");
      expect(clarification?.status).toBe("answered");
      expect(renderInboxShow(clarification!)).toContain("answer: queue-worker");
    } finally {
      corpus.cleanup();
    }
  });

  it("accepts a rewritten candidate with stable per-card trace linkage without bloating the card body", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-trace-" });
    const cwd = corpus.cwd;
    try {
      writeInboxItem(cwd, {
        id: "cand-trace-001",
        review_type: "candidate_card",
        status: "pending",
        title: "{module} owns retry orchestration",
        candidate_type: "constraint",
        scope: {
          layer: "module",
          project: "contexttrail",
          module: "unknown",
        },
        body: "{module} must own retry orchestration before dispatch.",
        supporting_chunks: [],
        trace_history: [
          {
            kind: "candidate_created",
            at: "2026-05-07T12:20:00.000Z",
            source_review_item_id: "cand-trace-001",
            summary: "Bootstrap candidate created from imported docs",
            materiality: "substantive",
          },
        ],
        created_at: "2026-05-07T12:20:00.000Z",
        updated_at: "2026-05-07T12:20:00.000Z",
      });
      writeInboxItem(cwd, {
        id: "clar-trace-001",
        review_type: "clarification_need",
        status: "pending",
        title: "Clarify the canonical retry module name",
        body: "Which module name should these retry candidates use?",
        choices: [{ id: "queue_worker", label: "queue-worker" }],
        free_text_allowed: true,
        affects_candidate_ids: ["cand-trace-001"],
        rewrite_rules: [
          {
            target: "title",
            match: "{module}",
            replacement_template: "{{answer}}",
          },
          {
            target: "body",
            match: "{module}",
            replacement_template: "{{answer}}",
          },
          {
            target: "scope.module",
            replacement_template: "{{answer}}",
          },
        ],
        created_at: "2026-05-07T12:21:00.000Z",
        updated_at: "2026-05-07T12:21:00.000Z",
      });

      runInboxAnswer(cwd, "clar-trace-001", { choice_id: "queue_worker" });
      const accepted = runInboxAccept(cwd, "cand-trace-001");

      expect(accepted).not.toBeNull();

      const cardSource = readFileSync(accepted!.path, "utf8");
      expect(cardSource).toContain("review_trace:");
      expect(cardSource).toContain("source_review_item_id: cand-trace-001");
      expect(cardSource).toContain("history_path:");
      expect(cardSource).toContain("material_review_item_ids:");
      expect(cardSource).not.toContain("clarification_applied");

      const historyPath = cardSource.match(/history_path: (.+)/)?.[1]?.trim();
      expect(historyPath).toBeTruthy();

      const historySource = readFileSync(join(cwd, historyPath!), "utf8");
      expect(historySource).toContain("card_id:");
      expect(historySource).toContain("cand-trace-001");
      expect(historySource).toContain("clar-trace-001");
      expect(historySource).toContain("clarification_applied");
      expect(historySource).toContain("materiality: substantive");
    } finally {
      corpus.cleanup();
    }
  });

  it("keeps cosmetic clarification rewrites in review history without promoting them into the material accepted-card path", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-inbox-cosmetic-" });
    const cwd = corpus.cwd;
    try {
      writeInboxItem(cwd, {
        id: "cand-cosmetic-001",
        review_type: "candidate_card",
        status: "pending",
        title: "Queue Worker owns retry orchestration",
        candidate_type: "constraint",
        scope: {
          layer: "module",
          project: "contexttrail",
          module: "queue-worker",
        },
        body: "Queue Worker must own retry orchestration before dispatch.",
        supporting_chunks: [],
        trace_history: [
          {
            kind: "candidate_created",
            at: "2026-05-07T12:25:00.000Z",
            source_review_item_id: "cand-cosmetic-001",
            summary: "Bootstrap candidate created from imported docs",
            materiality: "substantive",
          },
        ],
        created_at: "2026-05-07T12:25:00.000Z",
        updated_at: "2026-05-07T12:25:00.000Z",
      });
      writeInboxItem(cwd, {
        id: "clar-cosmetic-001",
        review_type: "clarification_need",
        status: "pending",
        title: "Normalize retry module casing",
        body: "Should this title use repo-style lowercase casing?",
        choices: [{ id: "lowercase", label: "queue worker" }],
        free_text_allowed: true,
        affects_candidate_ids: ["cand-cosmetic-001"],
        rewrite_rules: [
          {
            target: "title",
            match: "Queue Worker",
            replacement_template: "{{answer}}",
            materiality: "cosmetic",
          },
        ],
        created_at: "2026-05-07T12:26:00.000Z",
        updated_at: "2026-05-07T12:26:00.000Z",
      });

      runInboxAnswer(cwd, "clar-cosmetic-001", { choice_id: "lowercase" });
      const candidate = runInboxShow(cwd, "cand-cosmetic-001");
      expect(renderInboxShow(candidate!)).toContain("clar-cosmetic-001 (cosmetic)");

      const accepted = runInboxAccept(cwd, "cand-cosmetic-001");
      const cardSource = readFileSync(accepted!.path, "utf8");
      expect(cardSource).toContain("material_review_item_ids:");
      expect(cardSource).not.toContain("clar-cosmetic-001");

      const historyPath = cardSource.match(/history_path: (.+)/)?.[1]?.trim();
      const historySource = readFileSync(join(cwd, historyPath!), "utf8");
      expect(historySource).toContain("clar-cosmetic-001");
      expect(historySource).toContain("materiality: cosmetic");
    } finally {
      corpus.cleanup();
    }
  });
});
