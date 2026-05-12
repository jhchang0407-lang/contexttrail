/**
 * THO-166 (PRD-0016 / P16.8): PRD-0016 release verdict.
 *
 * Compares a baseline real-corpus summary against a current run and
 * emits a structured pass/fail verdict. The set of named gates
 * mirrors the PRD-0016 success criteria so reports cannot show
 * top-1 progress while a safety metric (top-3 / signal-empty /
 * coverage / agent / query-mode) silently regresses.
 *
 * Pure module — no IO. Real-corpus eval calls into this module to
 * render a verdict block alongside the per-repo summaries.
 */

export type Prd0016InputSummary = {
  answer_top_1: number;
  answer_top_3: number;
  answer_bearing_cases: number;
  true_top_3_misses: number;
  top_3_hit_top_1_miss: number;
  signal_empty_coverage_honest: number;
  signal_empty_cases: number;
  combined_coverage_honest: number;
  total_cases: number;
  agent_answer: number;
  query_mode_correct: number;
  chunk_correct: number;
  chunk_scored: number;
  avg_payload_bytes: number;
  /** Synthetic-fixture regression gate flag (true ⇒ FAIL the slice). */
  synthetic_regression: boolean;
};

export const PRD0016_GATE_NAMES = [
  "answer_top_1_improvement",
  "answer_top_3_no_regression",
  "true_top_3_misses_target",
  "top_3_hit_top_1_miss_target",
  "signal_empty_coverage_honest",
  "combined_coverage_honest",
  "agent_answer_no_regression",
  "query_mode_no_regression",
  "chunk_correctness_no_regression",
  "payload_size_no_bloat",
  "synthetic_regression",
] as const;
export type Prd0016GateName = (typeof PRD0016_GATE_NAMES)[number];

export type Prd0016GateResult = {
  name: Prd0016GateName;
  pass: boolean;
  baseline: number | string;
  current: number | string;
  detail: string;
};

export type Prd0016Verdict = {
  pass: boolean;
  failed_gates: Prd0016GateName[];
  gates: Prd0016GateResult[];
};

export type EvaluatePrd0016GatesArgs = {
  baseline: Prd0016InputSummary;
  current: Prd0016InputSummary;
};

/** Targets straight from the PRD's "Success Criteria" table. */
const ANSWER_TOP_1_TARGET = 112;
const ANSWER_TOP_3_FLOOR = 118;
const TRUE_TOP_3_MISSES_TARGET = 2;
const TOP_3_HIT_TOP_1_MISS_TARGET = 6;
const PAYLOAD_GROWTH_PCT_LIMIT = 5;

export function evaluatePrd0016Gates(args: EvaluatePrd0016GatesArgs): Prd0016Verdict {
  const { baseline, current } = args;
  const gates: Prd0016GateResult[] = [];

  gates.push({
    name: "answer_top_1_improvement",
    pass: current.answer_top_1 >= ANSWER_TOP_1_TARGET,
    baseline: baseline.answer_top_1,
    current: current.answer_top_1,
    detail: `target ≥ ${ANSWER_TOP_1_TARGET}/${current.answer_bearing_cases}`,
  });

  gates.push({
    name: "answer_top_3_no_regression",
    pass: current.answer_top_3 >= Math.max(ANSWER_TOP_3_FLOOR, baseline.answer_top_3),
    baseline: baseline.answer_top_3,
    current: current.answer_top_3,
    detail: `must remain ≥ ${ANSWER_TOP_3_FLOOR} (and not below baseline)`,
  });

  gates.push({
    name: "true_top_3_misses_target",
    pass: current.true_top_3_misses <= TRUE_TOP_3_MISSES_TARGET,
    baseline: baseline.true_top_3_misses,
    current: current.true_top_3_misses,
    detail: `target ≤ ${TRUE_TOP_3_MISSES_TARGET}`,
  });

  gates.push({
    name: "top_3_hit_top_1_miss_target",
    pass: current.top_3_hit_top_1_miss <= TOP_3_HIT_TOP_1_MISS_TARGET,
    baseline: baseline.top_3_hit_top_1_miss,
    current: current.top_3_hit_top_1_miss,
    detail: `target ≤ ${TOP_3_HIT_TOP_1_MISS_TARGET}`,
  });

  gates.push({
    name: "signal_empty_coverage_honest",
    pass: current.signal_empty_coverage_honest >= baseline.signal_empty_coverage_honest,
    baseline: baseline.signal_empty_coverage_honest,
    current: current.signal_empty_coverage_honest,
    detail: `must remain ≥ ${baseline.signal_empty_coverage_honest}/${current.signal_empty_cases}`,
  });

  gates.push({
    name: "combined_coverage_honest",
    pass: current.combined_coverage_honest >= baseline.combined_coverage_honest,
    baseline: baseline.combined_coverage_honest,
    current: current.combined_coverage_honest,
    detail: `must remain ≥ ${baseline.combined_coverage_honest}/${current.total_cases}`,
  });

  gates.push({
    name: "agent_answer_no_regression",
    pass: current.agent_answer >= baseline.agent_answer,
    baseline: baseline.agent_answer,
    current: current.agent_answer,
    detail: `must remain ≥ ${baseline.agent_answer}/${current.total_cases}`,
  });

  gates.push({
    name: "query_mode_no_regression",
    pass: current.query_mode_correct >= baseline.query_mode_correct,
    baseline: baseline.query_mode_correct,
    current: current.query_mode_correct,
    detail: `must remain ≥ ${baseline.query_mode_correct}/${current.total_cases}`,
  });

  gates.push({
    name: "chunk_correctness_no_regression",
    pass: current.chunk_correct >= baseline.chunk_correct,
    baseline: `${baseline.chunk_correct}/${baseline.chunk_scored}`,
    current: `${current.chunk_correct}/${current.chunk_scored}`,
    detail: `chunk-correct count must remain ≥ ${baseline.chunk_correct}`,
  });

  const payloadGrowthPct =
    baseline.avg_payload_bytes === 0
      ? 0
      : ((current.avg_payload_bytes - baseline.avg_payload_bytes) / baseline.avg_payload_bytes) * 100;
  gates.push({
    name: "payload_size_no_bloat",
    pass: payloadGrowthPct <= PAYLOAD_GROWTH_PCT_LIMIT,
    baseline: baseline.avg_payload_bytes,
    current: current.avg_payload_bytes,
    detail: `avg bytes growth ≤ ${PAYLOAD_GROWTH_PCT_LIMIT}% (current: ${payloadGrowthPct.toFixed(1)}%)`,
  });

  gates.push({
    name: "synthetic_regression",
    pass: !current.synthetic_regression,
    baseline: baseline.synthetic_regression ? "regressed" : "passed",
    current: current.synthetic_regression ? "regressed" : "passed",
    detail: `synthetic fixture must pass`,
  });

  const failed_gates = gates.filter((g) => !g.pass).map((g) => g.name);
  return {
    pass: failed_gates.length === 0,
    failed_gates,
    gates,
  };
}

export function renderPrd0016Verdict(verdict: Prd0016Verdict): string {
  const lines: string[] = [];
  lines.push(`PRD-0016 Release Verdict: ${verdict.pass ? "PASS" : "FAIL"}`);
  if (!verdict.pass) {
    lines.push(`Failed gates: ${verdict.failed_gates.join(", ")}`);
  }
  lines.push("");
  lines.push("Gate                                 baseline     current      result   detail");
  lines.push("─".repeat(96));
  for (const g of verdict.gates) {
    lines.push(
      `${g.name.padEnd(36)} ${String(g.baseline).padEnd(12)} ${String(g.current).padEnd(12)} ${(g.pass ? "PASS" : "FAIL").padEnd(8)} ${g.detail}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
