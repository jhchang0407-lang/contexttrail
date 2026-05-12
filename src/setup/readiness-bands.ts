/**
 * PRD-0033: locked tolerance bands for the setup readiness scan.
 *
 * Mirrors the ADR-0021 / `assembly-gate-bands.ts` convention — thresholds
 * are frozen constants in version control. Future band changes ship in
 * the same commit as an ADR-0022 amendment (Rule 3 equivalent).
 *
 * Pure module. No IO.
 */

export type ReadinessBand = "low" | "partial" | "confident";

export const SETUP_READINESS_BANDS = Object.freeze({
  corpus_coverage: Object.freeze({
    low_max: 0.30,
    partial_max: 0.70,
    minimum_chunk_floor: 5,
  }),
  scope_coverage: Object.freeze({
    low_max: 0.50,
    partial_max: 0.80,
  }),
  card_coverage: Object.freeze({
    partial_max_cards: 5,
    confident_min_cards: 6,
  }),
  retrieval_probes: Object.freeze({
    low_max: 0.50,
    partial_max: 0.80,
  }),
} as const);

export type CorpusCoverageEvidence = {
  discoverable: number;
  imported: number;
  importedChunks: number;
};

export function bandForCorpusCoverage(e: CorpusCoverageEvidence): ReadinessBand {
  const b = SETUP_READINESS_BANDS.corpus_coverage;
  if (e.importedChunks < b.minimum_chunk_floor) return "low";
  if (e.discoverable === 0) return "low";
  const frac = e.imported / e.discoverable;
  if (frac < b.low_max) return "low";
  if (frac < b.partial_max) return "partial";
  return "confident";
}

export type ScopeCoverageEvidence = {
  totalChunks: number;
  scopedChunks: number;
};

export function bandForScopeCoverage(e: ScopeCoverageEvidence): ReadinessBand {
  const b = SETUP_READINESS_BANDS.scope_coverage;
  if (e.totalChunks === 0) return "low";
  const frac = e.scopedChunks / e.totalChunks;
  if (frac < b.low_max) return "low";
  if (frac < b.partial_max) return "partial";
  return "confident";
}

export type CardCoverageEvidence = {
  acceptedCards: number;
  constraintCards: number;
};

export function bandForCardCoverage(e: CardCoverageEvidence): ReadinessBand {
  const b = SETUP_READINESS_BANDS.card_coverage;
  if (e.acceptedCards === 0) return "low";
  if (e.acceptedCards <= b.partial_max_cards) return "partial";
  if (e.constraintCards < 1) return "partial";
  return "confident";
}

export type RetrievalProbesEvidence = {
  totalProbes: number;
  confidentProbes: number;
};

export function bandForRetrievalProbes(e: RetrievalProbesEvidence): ReadinessBand {
  const b = SETUP_READINESS_BANDS.retrieval_probes;
  if (e.totalProbes === 0) return "low";
  const frac = e.confidentProbes / e.totalProbes;
  if (frac < b.low_max) return "low";
  if (frac < b.partial_max) return "partial";
  return "confident";
}
