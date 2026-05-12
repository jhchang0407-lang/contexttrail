/**
 * THO-141 / PRD-0013 V2.5.8 — deterministic ceiling decision.
 *
 * Derives a single bottleneck label from the V2.5 ceiling-probe report so V3
 * can target the measured remaining primitive instead of starting from
 * vague "better accuracy" anxiety.
 *
 * Precedence (matches PRD-0013 narrative):
 *   1. confidence_separability — false-confident unsupported is nonzero
 *   2. corpus_coverage         — not_imported dominates failure layers
 *   3. candidate_generation    — absent_from_candidates / outside_top50 dominate
 *   4. source_scoring          — recall is fine; top-1 / top-3 floors miss
 *   5. ready_for_v3            — every holdout and combined gate passes
 */
import type { Slice0Report } from "./report.js";
import type { FailureLayer } from "./failure-layer.js";

export const CEILING_BOTTLENECKS = [
  "ready_for_v3",
  "confidence_separability",
  "corpus_coverage",
  "candidate_generation",
  "source_scoring",
] as const;
export type CeilingBottleneck = (typeof CEILING_BOTTLENECKS)[number];

export type DeterministicCeilingDecision = {
  bottleneck: CeilingBottleneck;
  gates_passed: boolean;
  rationale: string;
  failed_gates: string[];
  /** Counts of failure layers that influenced the decision. */
  failure_layer_summary: Record<string, number>;
};

export function decideCeilingBottleneck(
  report: Slice0Report,
): DeterministicCeilingDecision {
  const holdoutFailures = report.holdout_gates?.failures ?? [];
  const combinedFailures = report.slice2_gates?.failures ?? [];
  const allFailures = [...holdoutFailures, ...combinedFailures];
  const failed_gates = Array.from(new Set(allFailures.map((f) => f.gate)));
  const layers: Partial<Record<FailureLayer, number>> =
    report.failure_layer_counts ?? {};
  const failure_layer_summary: Record<string, number> = { ...layers } as Record<
    string,
    number
  >;

  if (
    (report.holdout_gates?.passed ?? true) &&
    (report.slice2_gates?.passed ?? true)
  ) {
    return {
      bottleneck: "ready_for_v3",
      gates_passed: true,
      rationale:
        "every holdout and combined gate passes; V3 can target context assembly with a clean deterministic floor",
      failed_gates,
      failure_layer_summary,
    };
  }

  if (report.metrics.false_confident_unsupported > 0) {
    return {
      bottleneck: "confidence_separability",
      gates_passed: false,
      rationale: `${report.metrics.false_confident_unsupported} unsupported case(s) reported confident; honest abstention must clear before any other gate counts as ship evidence`,
      failed_gates,
      failure_layer_summary,
    };
  }

  const notImported = layers.not_imported ?? 0;
  const absent = (layers.absent_from_candidates ?? 0) + (layers.outside_top50 ?? 0);
  const sourceSelectionLoss =
    (layers.below_threshold ?? 0) +
    (layers.pack_loss ?? 0) +
    (layers.display_loss ?? 0);
  const recallFails = failed_gates.includes("critical_source_recall");

  if (recallFails && notImported > absent && notImported > 0) {
    return {
      bottleneck: "corpus_coverage",
      gates_passed: false,
      rationale: `${notImported} expected source(s) were not imported; corpus coverage (per-repo import globs) is the bottleneck — V3 must address the import surface, not ranking`,
      failed_gates,
      failure_layer_summary,
    };
  }
  if (recallFails && absent > sourceSelectionLoss && absent > 0) {
    return {
      bottleneck: "candidate_generation",
      gates_passed: false,
      rationale: `${absent} expected source(s) were imported but absent from the top-50 candidate set; candidate generation is the remaining bottleneck`,
      failed_gates,
      failure_layer_summary,
    };
  }

  // Top-1 / top-3 floors miss, or recall misses are real but outnumbered by
  // pack/display losses — scoring/aboutness is the bottleneck V3 should target.
  return {
    bottleneck: "source_scoring",
    gates_passed: false,
    rationale:
      absent > 0
        ? `candidate recall has ${absent} miss(es), but source-selection losses (${sourceSelectionLoss}) dominate; source_scoring is the remaining bottleneck — V3 should target deterministic or learned reranking primitives over the existing candidate set`
        : "candidate recall is fine but answerable top-1/top-3 floors miss; source_scoring is the remaining bottleneck — V3 should target deterministic or learned reranking primitives over the existing candidate set",
    failed_gates,
    failure_layer_summary,
  };
}
