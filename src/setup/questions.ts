import { existsSync } from "node:fs";
import { join } from "node:path";
import { listInboxItems } from "../inbox/items.js";
import type { ClarificationInboxItem, InboxItem } from "../inbox/items.js";
import { answerClarificationReviewItem } from "../review/flow.js";
import { closeDb, openDb } from "../store/db.js";
import { listCards } from "../store/cards.js";
import type { SetupReadinessRunResult } from "./run.js";
import type { SetupReadinessReport } from "./readiness-scan.js";
import { BOOTSTRAP_MIN_CHUNK_FLOOR, type NextStepSuggestion } from "./next-step.js";

export const SETUP_QUESTION_LIMIT = 3;

export type SetupQuestionKind =
  | "import_docs"
  | "review_inbox"
  | "review_stale_cards"
  | "doc_role_choice"
  | "scope_recovery"
  | "mcp_wiring"
  | "validate_context";

export type SetupQuestionImpactDimension =
  | "corpus_coverage"
  | "scope_coverage"
  | "card_coverage"
  | "retrieval_probes";

export type SetupQuestion = {
  id: string;
  kind: SetupQuestionKind;
  prompt: string;
  reason: string;
  impact: {
    dimensions: SetupQuestionImpactDimension[];
    affected_items?: number;
  };
  choices: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  free_text_allowed: boolean;
  command_preview?: string;
};

export type SetupQuestionPlan = {
  cwd: string;
  dimensions: SetupReadinessReport["dimensions"];
  suggestion: NextStepSuggestion;
  pending_inbox_items: number;
  questions: SetupQuestion[];
};

export type SetupQuestionAnswerInput = {
  question_id: string;
  choice_id?: string;
  free_text?: string;
};

export type SetupQuestionAnswerResult = {
  cwd: string;
  question_id: string;
  kind: SetupQuestionKind;
  choice_id?: string;
  text?: string;
  action:
    | {
        type: "command_preview";
        command: string;
        message: string;
      }
    | {
        type: "inbox_answer_applied";
        review_item_id: string;
        answer_text: string;
        updated_candidate_ids: string[];
        message: string;
      };
  writes: string[];
};

export class SetupQuestionAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupQuestionAnswerError";
  }
}

export function proposeSetupQuestions(
  cwd: string,
  readiness: SetupReadinessRunResult,
): SetupQuestionPlan {
  const pendingInbox = safePendingInboxSummary(cwd);
  const staleCards = safeStaleCardSummary(cwd);
  const questions: SetupQuestion[] = [];
  const dimensions = readiness.report.dimensions;
  const importedChunks = Number(
    dimensions.corpus_coverage.evidence.imported_chunks ?? 0,
  );

  if (!existsSync(join(cwd, ".mcp.json"))) {
    questions.push(mcpWiringQuestion());
  }

  if (
    dimensions.corpus_coverage.score === "low" &&
    importedChunks < BOOTSTRAP_MIN_CHUNK_FLOOR
  ) {
    questions.push(importDocsQuestion());
  }

  if (pendingInbox.total > 0) {
    questions.push(reviewInboxQuestion(pendingInbox));
    const topClarification = pendingInbox.clarification_needs.find(
      (item) => item.affects_candidate_ids.length > 0,
    );
    if (topClarification) {
      questions.push(clarificationQuestion(topClarification));
    }
  }

  if (staleCards.total > 0) {
    questions.push(reviewStaleCardsQuestion(staleCards));
  }

  if (
    dimensions.card_coverage.score === "low" &&
    pendingInbox.total === 0 &&
    importedChunks >= BOOTSTRAP_MIN_CHUNK_FLOOR
  ) {
    questions.push(bootstrapCardsQuestion());
  }

  if (dimensions.scope_coverage.score === "low" && importedChunks > 0) {
    questions.push(scopeRecoveryQuestion());
  }

  if (questions.length === 0) {
    questions.push(validateContextQuestion());
  }

  return {
    cwd: readiness.report.cwd,
    dimensions,
    suggestion: readiness.suggestion,
    pending_inbox_items: readiness.pending_inbox_items,
    questions: questions.slice(0, SETUP_QUESTION_LIMIT),
  };
}

export function renderSetupQuestions(plan: SetupQuestionPlan): string {
  const lines: string[] = [];
  lines.push(`ContextTrail setup questions for ${plan.cwd}`);
  lines.push("");
  if (plan.questions.length === 0) {
    lines.push("No setup questions right now.");
    return lines.join("\n") + "\n";
  }
  plan.questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.prompt}`);
    lines.push(`   kind: ${question.kind}`);
    lines.push(`   why: ${question.reason}`);
    if (question.command_preview) {
      lines.push(`   preview: ${question.command_preview}`);
    }
  });
  return lines.join("\n") + "\n";
}

export function answerSetupQuestion(
  plan: SetupQuestionPlan,
  input: SetupQuestionAnswerInput,
): SetupQuestionAnswerResult {
  const question = plan.questions.find((q) => q.id === input.question_id);
  if (!question) {
    throw new SetupQuestionAnswerError(
      `unknown setup question id: ${input.question_id}`,
    );
  }

  if (!input.choice_id && !input.free_text) {
    throw new SetupQuestionAnswerError("provide choice_id or free_text");
  }
  if (input.choice_id && input.free_text) {
    throw new SetupQuestionAnswerError("provide only one of choice_id or free_text");
  }
  if (input.choice_id && !question.choices.some((c) => c.id === input.choice_id)) {
    throw new SetupQuestionAnswerError(
      `invalid choice for ${question.id}: ${input.choice_id}`,
    );
  }
  if (input.free_text && !question.free_text_allowed) {
    throw new SetupQuestionAnswerError(
      `free text is not allowed for setup question ${question.id}`,
    );
  }

  if (question.id.startsWith("clarification-")) {
    const reviewItemId = question.id.slice("clarification-".length);
    const answered = answerClarificationReviewItem(plan.cwd, reviewItemId, {
      choice_id: input.choice_id,
      free_text: input.free_text,
    });
    if (!answered) {
      throw new SetupQuestionAnswerError(
        `could not answer clarification ${reviewItemId}`,
      );
    }
    return {
      cwd: plan.cwd,
      question_id: question.id,
      kind: question.kind,
      choice_id: input.choice_id,
      text: input.free_text,
      action: {
        type: "inbox_answer_applied",
        review_item_id: answered.review_item_id,
        answer_text: answered.answer_text,
        updated_candidate_ids: answered.updated_candidate_ids,
        message:
          "Clarification answer applied to inbox review state. Candidate Cards remain provisional until explicitly accepted.",
      },
      writes: [
        inboxRelativePath(answered.review_item_id),
        ...answered.updated_candidate_ids.map(inboxRelativePath),
      ],
    };
  }

  const command = question.command_preview;
  if (!command) {
    throw new SetupQuestionAnswerError(
      `setup question ${question.id} has no command preview`,
    );
  }

  return {
    cwd: plan.cwd,
    question_id: question.id,
    kind: question.kind,
    choice_id: input.choice_id,
    text: input.free_text,
    action: {
      type: "command_preview",
      command,
      message:
        "Preview only. Run the command yourself when you are ready; setup answers do not execute operational commands.",
    },
    writes: [],
  };
}

type PendingInboxSummary = {
  total: number;
  candidate_cards: number;
  clarification_needs: ClarificationInboxItem[];
};

type StaleCardSummary = {
  total: number;
  ids: string[];
};

function safePendingInboxSummary(cwd: string): PendingInboxSummary {
  try {
    return summarizePendingInbox(listInboxItems(cwd));
  } catch {
    return { total: 0, candidate_cards: 0, clarification_needs: [] };
  }
}

function safeStaleCardSummary(cwd: string): StaleCardSummary {
  const dbPath = join(cwd, ".contexttrail/cache/contexttrail.db");
  if (!existsSync(dbPath)) return { total: 0, ids: [] };
  try {
    const db = openDb(dbPath);
    try {
      const cards = listCards(db).filter(
        (card) =>
          card.authority === "accepted" &&
          (card.freshness_state === "needs_review" ||
            card.author_review_state === "needs_review_manual"),
      );
      return { total: cards.length, ids: cards.map((card) => card.id) };
    } finally {
      closeDb(db);
    }
  } catch {
    return { total: 0, ids: [] };
  }
}

function summarizePendingInbox(items: InboxItem[]): PendingInboxSummary {
  const pending = items.filter((item) => item.status === "pending");
  return {
    total: pending.length,
    candidate_cards: pending.filter((item) => item.review_type === "candidate_card")
      .length,
    clarification_needs: pending
      .filter((item): item is ClarificationInboxItem =>
        item.review_type === "clarification_need",
      )
      .sort((a, b) => {
        const affected = b.affects_candidate_ids.length - a.affects_candidate_ids.length;
        if (affected !== 0) return affected;
        return a.id.localeCompare(b.id);
      }),
  };
}

function importDocsQuestion(): SetupQuestion {
  return {
    id: "import-docs",
    kind: "import_docs",
    prompt: "Which docs should ContextTrail import first?",
    reason:
      "The local cache does not have enough imported documentation for reliable setup or retrieval.",
    impact: { dimensions: ["corpus_coverage"] },
    choices: [
      {
        id: "docs_glob",
        label: "Import docs/**/*.md",
        description: "Use the default documentation glob.",
      },
      {
        id: "custom_glob",
        label: "Use a custom glob",
        description: "Choose this if your canonical docs live somewhere else.",
      },
    ],
    free_text_allowed: true,
    command_preview: "contexttrail import docs/**/*.md",
  };
}

function reviewInboxQuestion(summary: PendingInboxSummary): SetupQuestion {
  const preferCandidates = summary.candidate_cards > 0;
  return {
    id: "review-inbox",
    kind: "review_inbox",
    prompt: "Which inbox stream should the agent curate next?",
    reason:
      "Bootstrap has proposed review items. Treat the inbox as a curation stream: accept obvious supported invariants, ignore obvious noise, and ask humans only high-leverage semantic questions.",
    impact: { dimensions: ["card_coverage"], affected_items: summary.total },
    choices: orderReviewChoices(preferCandidates),
    free_text_allowed: false,
    command_preview: preferCandidates
      ? "contexttrail inbox list --type candidate_card"
      : "contexttrail inbox list --type clarification_need",
  };
}

function clarificationQuestion(item: ClarificationInboxItem): SetupQuestion {
  const firstChoice = item.choices[0];
  return {
    id: `clarification-${item.id}`,
    kind: "review_inbox",
    prompt: item.title,
    reason:
      "This clarification affects pending candidate Cards, so one answer may resolve a family of provisional setup items.",
    impact: {
      dimensions: ["card_coverage"],
      affected_items: item.affects_candidate_ids.length,
    },
    choices: item.choices,
    free_text_allowed: item.free_text_allowed,
    command_preview: firstChoice
      ? `contexttrail inbox answer ${item.id} --choice ${firstChoice.id}`
      : `contexttrail inbox answer ${item.id} --text "<answer>"`,
  };
}

function reviewStaleCardsQuestion(summary: StaleCardSummary): SetupQuestion {
  return {
    id: "review-stale-cards",
    kind: "review_stale_cards",
    prompt: "Do you want to review accepted Cards affected by changed sources?",
    reason:
      "Ledger sync found accepted Cards whose linked Doc Chunks drifted or were manually marked for review.",
    impact: { dimensions: ["card_coverage"], affected_items: summary.total },
    choices: [
      {
        id: "list_stale_cards",
        label: "List Cards needing review",
        description: `Inspect ${summary.ids.slice(0, 3).join(", ")}${summary.ids.length > 3 ? ", ..." : ""}.`,
      },
    ],
    free_text_allowed: false,
    command_preview: "contexttrail card list --needs-review",
  };
}

function inboxRelativePath(id: string): string {
  return `.contexttrail/inbox/${id}.md`;
}

function orderReviewChoices(preferCandidates: boolean): SetupQuestion["choices"] {
  const candidateChoice = {
    id: "candidate_cards",
    label: "Curate candidate cards",
    description:
      "Accept clear supported invariants, ignore obvious noise, and collect only uncertain semantic clusters for the human.",
  };
  const clarificationChoice = {
    id: "clarifications",
    label: "Curate clarifications",
    description:
      "Answer obvious clarifications and ask the human only when one answer can settle many candidates.",
  };
  return preferCandidates
    ? [candidateChoice, clarificationChoice]
    : [clarificationChoice, candidateChoice];
}

function bootstrapCardsQuestion(): SetupQuestion {
  return {
    id: "bootstrap-cards",
    kind: "review_inbox",
    prompt: "Do you want ContextTrail to propose candidate Cards from the imported docs?",
    reason:
      "The repo has a useful imported corpus, but no accepted Cards yet.",
    impact: { dimensions: ["card_coverage"] },
    choices: [
      {
        id: "bootstrap",
        label: "Propose candidate Cards",
        description: "Generate provisional inbox items for review.",
      },
    ],
    free_text_allowed: false,
    command_preview: "contexttrail card bootstrap",
  };
}

function scopeRecoveryQuestion(): SetupQuestion {
  return {
    id: "scope-recovery",
    kind: "scope_recovery",
    prompt: "Do you want to inspect imported chunks with unknown scope?",
    reason:
      "Most imported chunks have weak scope metadata, which makes task-targeted retrieval less reliable.",
    impact: { dimensions: ["scope_coverage", "retrieval_probes"] },
    choices: [
      {
        id: "inspect_unknown",
        label: "Inspect unknown scope",
        description: "Review chunks whose layer is still unknown.",
      },
    ],
    free_text_allowed: false,
    command_preview: "contexttrail scope inspect --unknown",
  };
}

function validateContextQuestion(): SetupQuestion {
  return {
    id: "validate-context",
    kind: "validate_context",
    prompt: "What sample task should ContextTrail use to validate retrieval?",
    reason:
      "The main setup dimensions are no longer blocked, so the next useful step is an end-to-end context check.",
    impact: { dimensions: ["retrieval_probes"] },
    choices: [
      {
        id: "sample_task",
        label: "Run a sample context query",
        description: "Use a concrete task to check whether the assembled pack is useful.",
      },
    ],
    free_text_allowed: true,
    command_preview: 'contexttrail context "<sample task>"',
  };
}

function mcpWiringQuestion(): SetupQuestion {
  return {
    id: "mcp-wiring",
    kind: "mcp_wiring",
    prompt: "Should ContextTrail write MCP config for this repo?",
    reason:
      "The agent cannot reliably guide setup until the repo exposes the ContextTrail MCP server.",
    impact: { dimensions: ["retrieval_probes"] },
    choices: [
      {
        id: "write_mcp_config",
        label: "Write .mcp.json",
        description: "Run init to create or refresh the MCP config.",
      },
    ],
    free_text_allowed: false,
    command_preview: "contexttrail init",
  };
}
