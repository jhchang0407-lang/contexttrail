import { createHash } from "node:crypto";
import {
  AUTHORED_BY_REGEX_BOOTSTRAP,
  writeInboxItem,
  type ClarificationChoice,
} from "./items.js";
import type { InboxScope, SupportingChunk } from "./items.js";

export type CardBootstrapSummary = {
  chunks_considered: number;
  candidate_sentences: number;
  constraint_candidates_written: number;
  symbol_note_candidates_written: number;
  clarification_needs_written: number;
  merged_duplicates: number;
};

export type CandidateProposalDraft = {
  candidate_type: "constraint" | "symbol_note";
  title: string;
  body: string;
  scope: InboxScope;
  symbol_anchors?: string[];
  supporting_chunks: SupportingChunk[];
  /**
   * Provenance: identifies the system that authored this draft. Defaults
   * to the regex-bootstrap value when omitted. LLM augmentation passes
   * mark drafts with the slice-34.3 `contexttrail-bootstrap-llm` value.
   */
  authored_by?: string;
};

export type ClarificationProposalDraft = {
  body: string;
  scope: InboxScope;
  /**
   * Internal attribution for regex-bootstrap accounting. Clarification
   * inbox items do not expose supporting chunks today, but the LLM
   * augmentation pass needs to know whether regex already produced an
   * item for a given chunk.
   */
  supporting_chunks?: SupportingChunk[];
  /** Optional explicit choices (slice-34.3 LLM augmentation provides these). */
  choices?: ClarificationChoice[];
  /** Whether the inbox UI should accept a free-text answer in addition to choices. */
  free_text_allowed?: boolean;
  /** Provenance — same semantics as `CandidateProposalDraft.authored_by`. */
  authored_by?: string;
};

export type BootstrapProposals = {
  candidates: CandidateProposalDraft[];
  clarifications: ClarificationProposalDraft[];
  summary: CardBootstrapSummary;
};

function candidateId(
  candidateType: "constraint" | "symbol_note" | "clarification_need",
  body: string,
  scope: InboxScope,
): string {
  const digest = createHash("sha256")
    .update(
      `${candidateType}:${scope.layer}:${scope.project ?? ""}:${scope.module ?? ""}:${body}`,
    )
    .digest("hex")
    .slice(0, 10);
  return `cand-${digest}`;
}

function titleFor(body: string): string {
  const plain = body.replace(/[.!?]+$/, "");
  return plain.length > 72 ? `${plain.slice(0, 69)}...` : plain;
}

export function materializeBootstrapProposals(
  cwd: string,
  proposals: BootstrapProposals,
): CardBootstrapSummary {
  const timestamp = new Date().toISOString();

  for (const candidate of proposals.candidates) {
    const id = candidateId(candidate.candidate_type, candidate.body, candidate.scope);
    const authoredBy = candidate.authored_by ?? AUTHORED_BY_REGEX_BOOTSTRAP;
    writeInboxItem(cwd, {
      id,
      review_type: "candidate_card",
      status: "pending",
      authored_by: authoredBy,
      title: candidate.title,
      candidate_type: candidate.candidate_type,
      scope: candidate.scope,
      symbol_anchors: candidate.symbol_anchors ?? [],
      body: candidate.body,
      supporting_chunks: candidate.supporting_chunks,
      trace_history: [
        {
          kind: "candidate_created",
          at: timestamp,
          source_review_item_id: id,
          summary:
            authoredBy === AUTHORED_BY_REGEX_BOOTSTRAP
              ? "Bootstrap candidate created from imported docs"
              : "LLM augmentation candidate created from imported docs",
          materiality: "substantive",
        },
      ],
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  for (const clarification of proposals.clarifications) {
    const authoredBy = clarification.authored_by ?? AUTHORED_BY_REGEX_BOOTSTRAP;
    const choices = clarification.choices ?? [
      { id: "constraint", label: "Treat this as a hard constraint" },
      { id: "ignore", label: "Do not create a card from this" },
    ];
    // Default free-text on for regex clarifications (preserves existing
    // behavior); off for LLM clarifications which already include
    // constrained choices per PRD-0034.
    const freeTextAllowed =
      clarification.free_text_allowed ??
      (authoredBy === AUTHORED_BY_REGEX_BOOTSTRAP);
    writeInboxItem(cwd, {
      id: candidateId(
        "clarification_need",
        `clarification:${clarification.body}`,
        clarification.scope,
      ),
      review_type: "clarification_need",
      status: "pending",
      authored_by: authoredBy,
      title: `Clarify: ${titleFor(clarification.body)}`,
      body: `Bootstrap found a low-confidence rule candidate and needs guidance before creating a card.\n\n${clarification.body}`,
      choices,
      free_text_allowed: freeTextAllowed,
      affects_candidate_ids: [],
      rewrite_rules: [],
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  return proposals.summary;
}
