import type { ScoreTrace } from "./score.js";
import type { CardType } from "../types/card.js";
import type { LockReason } from "../cards/locked-include.js";
import type { ChunkSelectionReason } from "../readiness/chunk-selector.js";

export type PackOptions = {
  budget_tokens: number;
  min_final_score: number;
};

export const OMITTED_REASONS = ["below_threshold", "budget", "tombstoned"] as const;
export type OmittedReason = (typeof OMITTED_REASONS)[number];

export type DocChunkPackedTrace = ScoreTrace & {
  kind: "doc_chunk";
  /** PRD-0012 Slice 2: deterministic source-rerank rank (1-based). */
  source_rerank_rank?: number;
  /** PRD-0014 V3.5: deterministic source-selection rank (1-based). */
  source_selection_rank?: number;
  /** PRD-0015: source-local priority chosen by the source-scoped selector.
   *  Lower comes first, but only after source selection/rerank ordering has
   *  fixed which source owns the slot. */
  source_scoped_selection_rank?: number;
  source_scoped_selection_reason?: ChunkSelectionReason;
  /** Structural assembly root/neighbor priority. Lower comes first. */
  structural_assembly_rank?: number;
};

export type CardPackedTrace = ScoreTrace & {
  kind: "card";
  card_id: string;
  card_type: CardType;
};

/**
 * Lean locked-include entry — no score fields. Locked cards bypass the global
 * ranker entirely (D37/ADR-0010), so they don't have meaningful BM25, scope_match,
 * etc. Only token_count and lock_reason are load-bearing through the pipeline.
 */
export type LockedEntry = {
  kind: "card";
  card_id: string;
  card_type: CardType;
  token_count: number;
  lock_reason: LockReason;
};

/** @deprecated Use `LockedEntry`. Kept as an alias for now so external consumers don't break. */
export type LockedTrace = LockedEntry;

export type PackedTrace = DocChunkPackedTrace | CardPackedTrace | LockedEntry;
export type IncludedTrace = DocChunkPackedTrace | CardPackedTrace;
export type OmittedTrace = (DocChunkPackedTrace | CardPackedTrace) & {
  reason: string;
  omitted_reason: OmittedReason;
};

export type PackResult = {
  /** Locked-include items (always pulled into the Pack first, D37/ADR-0010). */
  locked: LockedEntry[];
  /** Non-locked items that fit the remaining budget. */
  included: IncludedTrace[];
  omitted: OmittedTrace[];
  /** Pack-level warnings: locked_overflow, etc. */
  warnings: PackWarning[];
  /** total_tokens = locked_overhead + sum(included tokens). Surfaced for back-compat. */
  total_tokens: number;
  /** budget_tokens kept for back-compat; equals budget.requested. */
  budget_tokens: number;
  /** Set when pack fell back to best-effort inclusion because every candidate
   *  scored below the minimum threshold. */
  safety_net_engaged: boolean;
  /** D37 budget block: locked_overhead = max(0, sum(locked_tokens) - requested). */
  budget: {
    requested: number;
    used: number;
    locked_overhead: number;
  };
};

export type PackWarning = {
  kind: "locked_overflow" | "freshness" | "tombstoned_link";
  message: string;
  card_id?: string;
  detail?: Record<string, unknown>;
};

/**
 * Legacy chunk-only pack (week 1–2). Kept for callers that don't yet handle
 * locked-include. The new orchestration path goes through `packWithLocked`.
 */
export function pack(traces: ScoreTrace[], opts: PackOptions): PackResult {
  return packWithLocked({
    locked: [],
    candidates: traces.map((t) => ({ ...t, kind: "doc_chunk" as const })),
    budget_tokens: opts.budget_tokens,
    min_final_score: opts.min_final_score,
  });
}

export type CandidateDocChunkTrace = ScoreTrace & {
  kind: "doc_chunk";
  /** PRD-0012 Slice 2 v2: deterministic source-rerank rank (1-based). When
   *  present, packing promotes one chunk per reranked source before repeats so
   *  the source-first contract holds. Cards never carry it. */
  source_rerank_rank?: number;
  /** PRD-0014 V3.5 / THO-147: source-selection rank from the V3 decision.
   *  When present, takes precedence over `source_rerank_rank` so V3 selection
   *  drives display order. Cards never carry it. */
  source_selection_rank?: number;
  /** PRD-0015: source-local chunk priority from the readiness selector. */
  source_scoped_selection_rank?: number;
  source_scoped_selection_reason?: ChunkSelectionReason;
  /** Structural assembly root/neighbor priority. Lower comes first. */
  structural_assembly_rank?: number;
};

export type CandidateCardTrace = ScoreTrace & {
  kind: "card";
  card_id: string;
  card_type: CardType;
};

export type CandidateTrace = CandidateDocChunkTrace | CandidateCardTrace;

export type PackWithLockedArgs = {
  locked: LockedEntry[];
  candidates: CandidateTrace[];
  budget_tokens: number;
  min_final_score: number;
};

function toOmittedTrace(
  candidate: CandidateTrace,
  omitted_reason: OmittedReason,
  reason: string,
): OmittedTrace {
  return { ...candidate, omitted_reason, reason };
}

function cloneIncludedTrace(candidate: CandidateTrace): IncludedTrace {
  return { ...candidate };
}

/**
 * Locked-first pack (D37 / ADR-0010 / D42).
 *
 *  1. Every locked Card is pulled into the Pack first regardless of cost.
 *  2. `remaining_budget = max(0, requested − sum(locked_tokens))`.
 *  3. The global ranker (Doc Chunks + non-locked Cards) competes under
 *     `remaining_budget` only.
 *  4. If `sum(locked_tokens) > requested`, emit a `locked_overflow` warning
 *     listing the deficit and per-card costs. `budget.locked_overhead`
 *     surfaces the deficit so agents can audit consumption.
 */
export function packWithLocked(args: PackWithLockedArgs): PackResult {
  const { locked, candidates, budget_tokens, min_final_score } = args;

  const locked_total = locked.reduce((s, l) => s + l.token_count, 0);
  const locked_overhead = Math.max(0, locked_total - budget_tokens);
  const remaining_budget = Math.max(0, budget_tokens - locked_total);

  const eligible: CandidateTrace[] = [];
  const omitted: OmittedTrace[] = [];

  for (const c of candidates) {
    if (!clearsMinimumScore(c, min_final_score)) {
      omitted.push(
        toOmittedTrace(
          c,
          "below_threshold",
          `final_score below min_final_score (${min_final_score})`,
        ),
      );
    } else {
      eligible.push(c);
    }
  }

  let safety_net_engaged = false;
  // Zero-signal safety net: if everything fell below the threshold, fall back
  // to the full candidate set rather than returning an empty pack.
  if (eligible.length === 0 && candidates.length > 0) {
    safety_net_engaged = true;
    eligible.push(...candidates);
    omitted.length = 0;
  }

  const included: IncludedTrace[] = [];
  let used = 0;

  eligible.sort(compareCandidateForPacking);
  const packingOrder = promoteFirstChunkPerRerankedSource(eligible);

  for (const c of packingOrder) {
    if (used + c.token_count <= remaining_budget) {
      included.push(cloneIncludedTrace(c));
      used += c.token_count;
    } else {
      omitted.push(
        toOmittedTrace(
          c,
          "budget",
          `did not fit budget (used=${used}, candidate_budget=${remaining_budget}, item=${c.token_count})`,
        ),
      );
    }
  }

  const warnings: PackWarning[] = [];
  if (locked_overhead > 0) {
    const perCard = locked
      .map((l) => `${l.card_id}=${l.token_count}t`)
      .join(", ");
    warnings.push({
      kind: "locked_overflow",
      message: `Locked content exceeds budget by ${locked_overhead} tokens. Locked cards: [${perCard}]. Requested=${budget_tokens}, locked_subtotal=${locked_total}, remaining_for_docs=${remaining_budget}.`,
      detail: {
        deficit: locked_overhead,
        per_card: locked.map((l) => ({
          card_id: l.card_id,
          token_count: l.token_count,
        })),
        requested: budget_tokens,
        locked_subtotal: locked_total,
      },
    });
  }

  return {
    locked: locked.map((l) => ({ ...l })),
    included,
    omitted,
    warnings,
    total_tokens: locked_total + used,
    budget_tokens,
    safety_net_engaged,
    budget: {
      requested: budget_tokens,
      used: locked_total + used,
      locked_overhead,
    },
  };
}

function clearsMinimumScore(
  candidate: CandidateTrace,
  min_final_score: number,
): boolean {
  if (candidate.final_score >= min_final_score) return true;
  return (
    candidate.kind === "doc_chunk" &&
    candidate.source_selection_rank !== undefined &&
    candidate.source_selection_rank <= 3
  );
}

function compareCandidateForPacking(a: CandidateTrace, b: CandidateTrace): number {
  // PRD-0014 V3.5: source_selection_rank takes precedence over the legacy
  // source_rerank_rank when both candidates carry it. PRD-0012 Slice 2 v2
  // source-rerank ordering is the secondary key for doc chunks that carry
  // only that field. Cards never carry these and fall back to packing_score.
  const aSel = a.kind === "doc_chunk" ? a.source_selection_rank : undefined;
  const bSel = b.kind === "doc_chunk" ? b.source_selection_rank : undefined;
  const selectionBias = compareOptionalRank(aSel, bSel);
  if (selectionBias !== 0) return selectionBias;
  const aRank = a.kind === "doc_chunk" ? a.source_rerank_rank : undefined;
  const bRank = b.kind === "doc_chunk" ? b.source_rerank_rank : undefined;
  const rerankBias = compareOptionalRank(aRank, bRank);
  if (rerankBias !== 0) return rerankBias;
  const aScoped = a.kind === "doc_chunk" ? a.source_scoped_selection_rank : undefined;
  const bScoped = b.kind === "doc_chunk" ? b.source_scoped_selection_rank : undefined;
  const scopedBias = compareOptionalRank(aScoped, bScoped);
  if (scopedBias !== 0) return scopedBias;
  if (b.packing_score !== a.packing_score) return b.packing_score - a.packing_score;
  if (b.final_score !== a.final_score) return b.final_score - a.final_score;
  if (b.specificity !== a.specificity) return b.specificity - a.specificity;
  if (b.bm25_norm !== a.bm25_norm) return b.bm25_norm - a.bm25_norm;
  if (b.heading_match !== a.heading_match) return b.heading_match - a.heading_match;
  return a.version_id.localeCompare(b.version_id);
}

function compareOptionalRank(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (a === b) return 0;
  return a - b;
}

function promoteFirstChunkPerRerankedSource(candidates: CandidateTrace[]): CandidateTrace[] {
  // PRD-0014 V3.5: prefer V3 source_selection_rank when present; fall back to
  // V2.5 source_rerank_rank otherwise. The promotion rule is the same: at
  // least one chunk per selected source survives ahead of repeats.
  const useSelection = candidates.some(
    (c) => c.kind === "doc_chunk" && c.source_selection_rank !== undefined,
  );
  const rankOf = (c: CandidateTrace): number | undefined => {
    if (c.kind !== "doc_chunk") return undefined;
    if (useSelection) return c.source_selection_rank;
    return c.source_rerank_rank;
  };
  const distinctSources = new Set(
    candidates.flatMap((candidate) => {
      const r = rankOf(candidate);
      return r !== undefined ? [r] : [];
    }),
  ).size;
  if (distinctSources < 2) return candidates;

  const seenSourceRanks = new Set<number>();
  const firstPerSource: CandidateTrace[] = [];
  const rest: CandidateTrace[] = [];
  for (const candidate of candidates) {
    const r = rankOf(candidate);
    if (r === undefined) {
      rest.push(candidate);
      continue;
    }
    if (seenSourceRanks.has(r)) {
      rest.push(candidate);
      continue;
    }
    seenSourceRanks.add(r);
    firstPerSource.push(candidate);
  }
  return [...firstPerSource, ...rest];
}
