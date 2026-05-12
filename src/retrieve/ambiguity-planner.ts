/**
 * THO-165 (PRD-0016 / P16.7): ambiguity-aware compact pack planner.
 *
 * Given top-N source cards (which already carry source-family
 * membership from THO-162 and source-role labels from THO-161), decide
 * whether the live top-1 is a confident pick or whether a related
 * close-call family should travel together as a compact set.
 *
 * Pure function — no IO, deterministic. Diagnostic output:
 *   - is_ambiguous: should the pack assembler treat the top group as
 *     a family unit (one chunk per family member) instead of trusting
 *     top-1 alone?
 *   - selected_family_paths: ordered paths the family pack should
 *     guarantee at least one chunk for, when ambiguity is true.
 *   - reason_codes: structured diagnostic codes consumed by pack
 *     readiness so reports can show *why* a pack is labeled
 *     ambiguous.
 *
 * The planner never invents ambiguity from incidental query overlap
 * — it relies on the source-family graph (which already filters out
 * unrelated same-token sources) plus a tight score margin between
 * top-1 and top-2.
 */
import type { SourceCard } from "./source-card.js";

export const AMBIGUITY_PLANNER_REASON_CODES = [
  "ambiguous_top_family",
  "clear_top_winner",
  "no_top_pair",
] as const;
export type AmbiguityPlannerReasonCode =
  (typeof AMBIGUITY_PLANNER_REASON_CODES)[number];

export type TopFamilyAmbiguityPlan = {
  is_ambiguous: boolean;
  /** Source paths the pack should preserve a representative chunk
   *  for, in priority order. When is_ambiguous is false this contains
   *  only the top-1 path (or is empty for empty input). */
  selected_family_paths: string[];
  reason_codes: AmbiguityPlannerReasonCode[];
};

export type PlanTopFamilyAmbiguityArgs = {
  cards: SourceCard[];
  /** top1.score - top2.score from the source-selection decision. */
  top1_top2_margin: number;
  /** Score gap below which top-1 vs top-2 is treated as a close call.
   *  Defaults to 0.05 — tight by design so the planner doesn't
   *  fabricate ambiguity for every borderline case. */
  close_call_margin?: number;
};

const DEFAULT_CLOSE_CALL_MARGIN = 0.05;

export function planTopFamilyAmbiguity(
  args: PlanTopFamilyAmbiguityArgs,
): TopFamilyAmbiguityPlan {
  const { cards, top1_top2_margin } = args;
  const closeCallMargin = args.close_call_margin ?? DEFAULT_CLOSE_CALL_MARGIN;

  if (cards.length === 0) {
    return {
      is_ambiguous: false,
      selected_family_paths: [],
      reason_codes: ["no_top_pair"],
    };
  }
  if (cards.length === 1) {
    return {
      is_ambiguous: false,
      selected_family_paths: [cards[0]!.source_path],
      reason_codes: ["clear_top_winner"],
    };
  }

  const [top, second] = cards;
  const sameFamily =
    top!.source_family !== null &&
    second!.source_family !== null &&
    top!.source_family.family_id === second!.source_family.family_id;

  // Ambiguity requires BOTH a same-family pair AND a tight score gap.
  // Either signal alone is too weak: same-family with a clear score
  // win means top-1 is correct; close score gap across families means
  // we should still trust the rerank order, not bundle unrelated docs.
  const closeCall = top1_top2_margin <= closeCallMargin;
  if (!(sameFamily && closeCall)) {
    return {
      is_ambiguous: false,
      selected_family_paths: [top!.source_path],
      reason_codes: ["clear_top_winner"],
    };
  }

  // Order the family-member paths by source-card rank so the planned
  // set lines up with retrieval-side priority.
  const familyId = top!.source_family!.family_id;
  const familyPaths = cards
    .filter((c) => c.source_family && c.source_family.family_id === familyId)
    .sort((a, b) => a.rank - b.rank)
    .map((c) => c.source_path);

  return {
    is_ambiguous: true,
    selected_family_paths: familyPaths,
    reason_codes: ["ambiguous_top_family"],
  };
}
