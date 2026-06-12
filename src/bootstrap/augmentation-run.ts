/**
 * LLM augmentation pass + cost guardrails.
 *
 * `runAugmentationPass` is the orchestration layer between the regex
 * bootstrap and the inbox materialization path. It:
 *
 *   - filters the chunk list down to those eligible for augmentation
 *     (selective invocation rule from `llm-augment.ts`)
 *   - sorts them deterministically by stable_key
 *   - enforces the per-run cap (default 50)
 *   - calls the `LlmClient` per chunk with try/catch — a chunk that
 *     errors or times out is recorded as a warning and skipped; the
 *     regex output for that chunk is unaffected
 *   - converts validated `LlmAugmentationResult`s into the same
 *     `CandidateProposalDraft` / `ClarificationProposalDraft` shape the
 *     regex pass produces, marked with `authored_by: contexttrail-bootstrap-llm`
 *
 * The authority boundary holds because the only effect of this module
 * is to write provisional items to the inbox. Nothing reaches accepted
 * truth without human review.
 */
import {
  augmentChunk,
  shouldAugment,
  type LlmClient,
} from "./llm-augment.js";
import type {
  CandidateProposalDraft,
  ClarificationProposalDraft,
} from "../inbox/bootstrap.js";
import type { InboxScope, SupportingChunk } from "../inbox/items.js";

export const LLM_AUTHORED_BY = "contexttrail-bootstrap-llm";
export const REGEX_AUTHORED_BY = "contexttrail-bootstrap";
export const DEFAULT_PER_RUN_CAP = 50;

export type AugmentationChunkRecord = {
  stable_key: string;
  source_path: string;
  heading_path: string[];
  version_id: string;
  body: string;
  scope: InboxScope;
  regex: { candidates: number; clarifications: number };
};

export type AugmentationWarning =
  | {
      kind: "cap_exceeded";
      qualifying_chunks: number;
      cap: number;
    }
  | {
      kind: "chunk_failed";
      chunk_stable_key: string;
      message: string;
    };

export type AugmentationRunSummary = {
  chunks_qualifying: number;
  chunks_processed: number;
  chunks_skipped_over_cap: number;
  chunks_failed: number;
  candidates_added: number;
  clarifications_added: number;
  warnings: AugmentationWarning[];
};

export type AugmentationRunResult = {
  candidates: CandidateProposalDraft[];
  clarifications: ClarificationProposalDraft[];
  summary: AugmentationRunSummary;
};

export type AugmentationRunOptions = {
  chunks: readonly AugmentationChunkRecord[];
  client: LlmClient;
  perRunCap?: number;
};

function supportingChunkFor(chunk: AugmentationChunkRecord): SupportingChunk {
  return {
    chunk_stable_key: chunk.stable_key,
    source_path: chunk.source_path,
    heading_path: chunk.heading_path,
    version_id: chunk.version_id,
  };
}

export async function runAugmentationPass(
  options: AugmentationRunOptions,
): Promise<AugmentationRunResult> {
  const cap = options.perRunCap ?? DEFAULT_PER_RUN_CAP;
  const qualifying = options.chunks
    .filter((chunk) => shouldAugment(chunk.regex))
    .slice()
    .sort((a, b) => a.stable_key.localeCompare(b.stable_key));

  const warnings: AugmentationWarning[] = [];
  const candidates: CandidateProposalDraft[] = [];
  const clarifications: ClarificationProposalDraft[] = [];
  let chunksFailed = 0;
  let chunksProcessed = 0;

  const toProcess = qualifying.slice(0, cap);
  const overCap = qualifying.length - toProcess.length;
  if (overCap > 0) {
    warnings.push({
      kind: "cap_exceeded",
      qualifying_chunks: qualifying.length,
      cap,
    });
  }

  for (const chunk of toProcess) {
    chunksProcessed += 1;
    try {
      const result = await augmentChunk(chunk, chunk.regex, options.client);
      if (result.candidate) {
        candidates.push({
          candidate_type: result.candidate.candidate_type,
          title: result.candidate.title,
          body: result.candidate.body,
          scope: result.candidate.scope,
          symbol_anchors: result.candidate.symbol_anchors,
          supporting_chunks: [supportingChunkFor(chunk)],
          authored_by: LLM_AUTHORED_BY,
        });
      }
      if (result.clarification) {
        clarifications.push({
          body: result.clarification.body,
          scope: result.clarification.scope,
          choices: result.clarification.choices,
          free_text_allowed: false,
          authored_by: LLM_AUTHORED_BY,
        });
      }
    } catch (err) {
      chunksFailed += 1;
      warnings.push({
        kind: "chunk_failed",
        chunk_stable_key: chunk.stable_key,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    candidates,
    clarifications,
    summary: {
      chunks_qualifying: qualifying.length,
      chunks_processed: chunksProcessed,
      chunks_skipped_over_cap: overCap,
      chunks_failed: chunksFailed,
      candidates_added: candidates.length,
      clarifications_added: clarifications.length,
      warnings,
    },
  };
}

export function formatAugmentationSummary(summary: AugmentationRunSummary): string {
  const parts = [
    `LLM augmentation: ${summary.chunks_processed} chunk${
      summary.chunks_processed === 1 ? "" : "s"
    } processed`,
    `${summary.candidates_added} candidate${summary.candidates_added === 1 ? "" : "s"} added`,
    `${summary.clarifications_added} clarification${summary.clarifications_added === 1 ? "" : "s"} added`,
  ];
  if (summary.chunks_skipped_over_cap > 0) {
    parts.push(`${summary.chunks_skipped_over_cap} skipped over cap`);
  }
  if (summary.chunks_failed > 0) {
    parts.push(`${summary.chunks_failed} failed`);
  }
  return parts.join(", ");
}
