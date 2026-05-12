/**
 * Slice 2 (PRD-0012 / THO-132) — eval diagnostics and hard gates layered on
 * Slice 0 substrate. Reports source-rerank movement before/after and enforces
 * the PRD-0012 floors without weakening any earlier gate.
 */
import type { SourceRerankFeatures } from "../../retrieve/source-rerank.js";

export type SourceRerankObservation = {
  source_path: string;
  pre_rerank_rank: number;
  post_rerank_rank: number;
  pre_rerank_score: number;
  post_rerank_score: number;
  feature_reasons: SourceRerankFeatures;
  /** THO-137 / PRD-0013 V2.5.4: post-RRF source-level rank from multi-path fusion. */
  fused_rank?: number;
  /** Distinct deterministic paths that contributed to fusion for this source. */
  fused_path_count?: number;
};

export type Slice2CaseRerankCapture = {
  case_id: string;
  repo: string;
  query_intent: string;
  /** Top reranked sources for the case, with movement diagnostics. */
  rerank_top: SourceRerankObservation[];
  /** Whether the actual top-1 source after rerank is acceptable. */
  actual_top1_acceptable_after_rerank: boolean;
  /** Whether top-3 after rerank covers an acceptable source. */
  actual_top3_acceptable_after_rerank: boolean;
};

/** PRD-0012 floors. */
export const SLICE2_RECALL_FLOOR = 1.0;
export const SLICE2_TOP1_FLOOR = 0.75;
export const SLICE2_TOP3_FLOOR = 0.938;

export type Slice2Gate =
  | "synthetic_regression"
  | "critical_source_recall"
  | "false_confident_unsupported"
  | "answerable_top1_floor"
  | "answerable_top3_floor";

export type Slice2GateFailure = {
  gate: Slice2Gate;
  message: string;
};

export type Slice2GateResult = {
  passed: boolean;
  failures: Slice2GateFailure[];
};

export type Slice2GateInputs = {
  synthetic_regression: boolean;
  critical_source_set_recall_at_50_rate: number;
  false_confident_unsupported: number;
  answerable_top1_rate: number;
  answerable_top3_rate: number;
};

export function evaluateSlice2Gates(input: Slice2GateInputs): Slice2GateResult {
  const failures: Slice2GateFailure[] = [];

  if (input.synthetic_regression) {
    failures.push({
      gate: "synthetic_regression",
      message: "synthetic 126-case fixture regressed; Slice 2 cannot interpret real-corpus movement",
    });
  }

  if (input.critical_source_set_recall_at_50_rate < SLICE2_RECALL_FLOOR) {
    failures.push({
      gate: "critical_source_recall",
      message:
        `critical-source-set recall@50 = ${(input.critical_source_set_recall_at_50_rate * 100).toFixed(1)}% < ${(SLICE2_RECALL_FLOOR * 100).toFixed(1)}% floor`,
    });
  }

  if (input.false_confident_unsupported > 0) {
    failures.push({
      gate: "false_confident_unsupported",
      message: `${input.false_confident_unsupported} unsupported case(s) reported \`confident\`; PRD-0011 floor requires 0`,
    });
  }

  if (input.answerable_top1_rate < SLICE2_TOP1_FLOOR) {
    failures.push({
      gate: "answerable_top1_floor",
      message:
        `answerable top-1 = ${(input.answerable_top1_rate * 100).toFixed(1)}% < ${(SLICE2_TOP1_FLOOR * 100).toFixed(1)}% floor`,
    });
  }

  if (input.answerable_top3_rate < SLICE2_TOP3_FLOOR) {
    failures.push({
      gate: "answerable_top3_floor",
      message:
        `answerable top-3 = ${(input.answerable_top3_rate * 100).toFixed(1)}% < ${(SLICE2_TOP3_FLOOR * 100).toFixed(1)}% floor`,
    });
  }

  return { passed: failures.length === 0, failures };
}
