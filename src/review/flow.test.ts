import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestCorpus } from "../eval/test-corpus.js";
import {
  AUTHORED_BY_LLM_BOOTSTRAP,
  writeInboxItem,
} from "../inbox/items.js";
import {
  acceptCandidateReviewItem,
  answerClarificationReviewItem,
} from "./flow.js";

describe("review flow", () => {
  it("accepts a candidate review item into a card and review-trace sidecar", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-review-flow-accept-" });
    const cwd = corpus.cwd;
    try {
      writeInboxItem(cwd, {
        id: "cand-review-001",
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
        created_at: "2026-05-07T12:30:00.000Z",
        updated_at: "2026-05-07T12:30:00.000Z",
      });

      const accepted = acceptCandidateReviewItem(cwd, "cand-review-001");
      expect(accepted).not.toBeNull();
      expect(accepted?.review_item_id).toBe("cand-review-001");
      expect(accepted?.card_id).toBe("C001");

      const cardSource = readFileSync(accepted!.path, "utf8");
      expect(cardSource).toContain("review_trace:");
      expect(cardSource).toContain("source_review_item_id: cand-review-001");

      const historyPath = cardSource.match(/history_path: (.+)/)?.[1]?.trim();
      expect(historyPath).toBeTruthy();

      const historySource = readFileSync(`${cwd}/${historyPath!}`, "utf8");
      expect(historySource).toContain("cand-review-001");
      expect(historySource).toContain("candidate_created");
    } finally {
      corpus.cleanup();
    }
  });

  it("preserves LLM bootstrap provenance when accepting a candidate", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-review-flow-llm-prov-" });
    const cwd = corpus.cwd;
    try {
      writeInboxItem(cwd, {
        id: "cand-review-llm-001",
        review_type: "candidate_card",
        status: "pending",
        authored_by: AUTHORED_BY_LLM_BOOTSTRAP,
        title: "Credential rotation cadence",
        candidate_type: "constraint",
        scope: {
          layer: "project",
          project: "contexttrail",
        },
        body: "Credentials must rotate every 90 days.",
        supporting_chunks: [],
        created_at: "2026-05-07T12:30:00.000Z",
        updated_at: "2026-05-07T12:30:00.000Z",
      });

      const accepted = acceptCandidateReviewItem(cwd, "cand-review-llm-001");
      expect(accepted).not.toBeNull();

      const cardSource = readFileSync(accepted!.path, "utf8");
      expect(cardSource).toContain("authored_by: contexttrail-bootstrap-llm");
    } finally {
      corpus.cleanup();
    }
  });

  it("answers a clarification by rewriting affected pending candidates and preserving trace history", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-review-flow-answer-" });
    const cwd = corpus.cwd;
    try {
      writeInboxItem(cwd, {
        id: "cand-review-002",
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
        created_at: "2026-05-07T12:31:00.000Z",
        updated_at: "2026-05-07T12:31:00.000Z",
      });
      writeInboxItem(cwd, {
        id: "clar-review-001",
        review_type: "clarification_need",
        status: "pending",
        title: "Clarify retry module name",
        body: "Which module name should bootstrap use?",
        choices: [{ id: "queue_worker", label: "queue-worker" }],
        free_text_allowed: true,
        affects_candidate_ids: ["cand-review-002"],
        rewrite_rules: [
          { target: "title", match: "{module}", replacement_template: "{{answer}}" },
          { target: "body", match: "{module}", replacement_template: "{{answer}}" },
          { target: "scope.module", replacement_template: "{{answer}}" },
        ],
        created_at: "2026-05-07T12:32:00.000Z",
        updated_at: "2026-05-07T12:32:00.000Z",
      });

      const answered = answerClarificationReviewItem(cwd, "clar-review-001", {
        choice_id: "queue_worker",
      });

      expect(answered).not.toBeNull();
      expect(answered?.updated_candidate_ids).toEqual(["cand-review-002"]);

      const candidateSource = readFileSync(
        `${cwd}/.contexttrail/inbox/cand-review-002.md`,
        "utf8",
      );
      expect(candidateSource).toContain("queue-worker owns retry orchestration");
      expect(candidateSource).toContain("queue-worker must own retry orchestration");
      expect(candidateSource).toContain("clarification_applied");
      expect(candidateSource).toContain("clar-review-001");

      const clarificationSource = readFileSync(
        `${cwd}/.contexttrail/inbox/clar-review-001.md`,
        "utf8",
      );
      expect(clarificationSource).toContain("status: answered");
      expect(clarificationSource).toContain("answered_choice_id: queue_worker");
    } finally {
      corpus.cleanup();
    }
  });
});
