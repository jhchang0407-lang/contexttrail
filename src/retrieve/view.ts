import {
  resolvePackPresentation,
  type PackPresentation,
  type PresentedLockedEntry,
  type PresentedOmittedEntry,
  type PresentedRankedEntry,
} from "./presentation.js";
import type { RetrievalRequest, RetrievalResult } from "./retrieve.js";
import type { LockFailure } from "../cards/locked-include.js";

export type RetrievalView = {
  query: string;
  request: RetrievalRequest;
  query_mode: RetrievalResult["query_mode"];
  query_compilation: RetrievalResult["query_compilation"];
  presentation: PackPresentation;
  ranked_full: PresentedRankedEntry[];
  omitted_full: PresentedOmittedEntry[];
  locked_full: PresentedLockedEntry[];
  warnings_full: PackPresentation["warnings"];
  lock_failures: LockFailure[];
  budget: {
    requested: number;
    used: number;
    locked_overhead: number;
    headroom: number;
  };
  result: RetrievalResult;
  has_sources: boolean;
  explain: boolean;
  requested_budget: number;
  min_final_score?: number;
};

export type BuildRetrievalViewArgs = {
  query: string;
  result: RetrievalResult;
  requested_budget?: number;
  has_sources?: boolean;
  explain?: boolean;
  min_final_score?: number;
};

export function buildRetrievalView(args: BuildRetrievalViewArgs): RetrievalView {
  const requested_budget = args.requested_budget ?? args.result.pack.budget.requested;
  const has_sources = args.has_sources ?? args.result.chunksByVersionId.size > 0;
  const explain = args.explain ?? false;
  const presentation = resolvePackPresentation({
    query: args.query,
    pack: args.result.pack,
    chunksByVersionId: args.result.chunksByVersionId,
    cardsByCardId: args.result.cardsByCardId,
    query_mode: args.result.query_mode,
    query_compilation: args.result.query_compilation,
    lock_failures: args.result.lock_failures ?? [],
    has_sources,
    min_final_score: args.min_final_score,
  });

  return {
    query: args.query,
    request: args.result.request,
    query_mode: args.result.query_mode,
    query_compilation: args.result.query_compilation,
    presentation,
    ranked_full: [...presentation.relevant, ...presentation.evidence],
    omitted_full: presentation.omitted,
    locked_full: presentation.locked,
    warnings_full: presentation.warnings,
    lock_failures: presentation.lock_failures,
    budget: {
      requested: presentation.budget.requested || requested_budget,
      used: presentation.budget.used,
      locked_overhead: presentation.budget.locked_overhead,
      headroom: Math.max(
        0,
        (presentation.budget.requested || requested_budget) - presentation.budget.used,
      ),
    },
    result: args.result,
    has_sources,
    explain,
    requested_budget,
    min_final_score: args.min_final_score,
  };
}
