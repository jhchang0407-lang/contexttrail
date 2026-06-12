/**
 * Loss-class taxonomy for the synthetic retrieval suites.
 *
 * Each synthetic case declares which named failure mode it probes, so
 * per-class pass rates and Wilson bounds can certify (or flag) a specific
 * ranking behavior instead of one blended accuracy number. The categories
 * came out of source-selection loss audits on real corpora: the retrieval
 * candidate set almost always contains the right source, so the losses
 * worth naming are about source *choice* among visible candidates.
 */
export const SOURCE_SELECTION_LOSS_CATEGORIES = [
  "none",
  "candidate_recall_outlier",
  "parent_vs_leaf",
  "decision_vs_procedural",
  "anchored_exact_vs_broad",
  "overview_vs_reference",
  "adjacent_sibling",
  "changelog_release_intent",
  "generic_display_loss",
] as const;

export type SourceSelectionLossCategory =
  (typeof SOURCE_SELECTION_LOSS_CATEGORIES)[number];
