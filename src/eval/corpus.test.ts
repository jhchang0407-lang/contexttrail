import { describe, expect, it } from "vitest";
import { EVAL_SET, EXPECTED_EVAL_CASES, validateEvalSet } from "./corpus.js";

describe("retrieval eval corpus", () => {
  it("loads and validates the fact-finding eval set", () => {
    expect(EVAL_SET).toHaveLength(EXPECTED_EVAL_CASES);
    expect(() => validateEvalSet(EVAL_SET)).not.toThrow();
  });

  it("fails fast when taxonomy is missing", () => {
    expect(() =>
      validateEvalSet([
        {
          id: "missing-taxonomy",
          task: "make refunds idempotent",
          expected_query_mode: "anchored",
          expected_locked: [],
          expected_signal_empty_warning: false,
          expected_top_source: "docs/payments/refunds.md",
          must_include_sources: [],
          baseline_ranked_useful: true,
          notes: "Missing taxonomy should fail before retrieval runs.",
        },
      ]),
    ).toThrow(
      "Eval case 'missing-taxonomy' is missing query_intent, assembly_need, expectation_kind, capabilities",
    );
  });

  it("fails fast when minimal_sufficient_stage is unknown", () => {
    expect(() =>
      validateEvalSet([
        {
          id: "bad-stage",
          task: "make refunds idempotent",
          expected_query_mode: "anchored",
          expected_locked: [],
          expected_signal_empty_warning: false,
          expected_top_source: "docs/payments/refunds.md",
          must_include_sources: [],
          baseline_ranked_useful: true,
          notes: "Unknown stage should fail before retrieval runs.",
          query_intent: "exact_symbol",
          assembly_need: "local_semantics",
          expectation_kind: "deterministic",
          capabilities: ["anchor_recognition"],
          minimal_sufficient_stage: "bogus",
        },
      ] as never[]),
    ).toThrow("Eval case 'bad-stage' has unknown minimal_sufficient_stage 'bogus'");
  });
});
