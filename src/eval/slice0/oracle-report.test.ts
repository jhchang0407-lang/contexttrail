import { describe, expect, it } from "vitest";
import {
  buildOracleFailureAggregate,
  classifyOracleCase,
  type OracleDiagnosticObservation,
} from "./oracle-report.js";

function obs(
  overrides: Partial<OracleDiagnosticObservation>,
): OracleDiagnosticObservation {
  return {
    id: "case",
    repo: "repo",
    expectation_kind: "deterministic",
    expected_query_mode: "unanchored",
    actual_query_mode: "unanchored",
    expected_top_source: "docs/owner.md",
    acceptable_top_sources: ["docs/owner.md"],
    must_include_sources: ["docs/owner.md"],
    actual_top1_acceptable: false,
    actual_top3_acceptable: false,
    agent_answer_pass: false,
    source_candidates: [
      { source_path: "docs/noisy.md", rank: 1 },
      { source_path: "docs/owner.md", rank: 4 },
    ],
    loss: {
      source_to_threshold_loss: [],
      threshold_to_pack_loss: [],
      budget_loss_sources: [],
    },
    separability: {
      available: {
        coverage_confidence: "confident",
      },
    },
    source_selection: {
      selected_sources: [
        {
          source_path: "docs/noisy.md",
          rank: 1,
          reason_codes: ["covers_label"],
        },
      ],
    },
    source_selection_applied: true,
    displayed_top3_sources: ["docs/noisy.md"],
    ...overrides,
  };
}

describe("classifyOracleCase", () => {
  it("keeps passing top-1 cases separate from misses", () => {
    expect(
      classifyOracleCase(obs({ actual_top1_acceptable: true })).layer,
    ).toBe("top1_pass");
  });

  it("prioritizes query-mode mismatch before downstream ranking labels", () => {
    expect(
      classifyOracleCase(
        obs({ expected_query_mode: "anchored", actual_query_mode: "signal_empty" }),
      ).layer,
    ).toBe("query_mode_mismatch");
  });

  it("labels candidate-generation misses when critical sources are absent from top-50", () => {
    expect(
      classifyOracleCase(
        obs({
          source_candidates: [{ source_path: "docs/noisy.md", rank: 1 }],
        }),
      ).layer,
    ).toBe("candidate_generation");
  });

  it("labels source-selection decisions that found the owner but were not applied", () => {
    expect(
      classifyOracleCase(
        obs({
          source_selection_applied: false,
          source_selection: {
            selected_sources: [
              {
                source_path: "docs/owner.md",
                rank: 1,
                reason_codes: ["covers_label"],
              },
            ],
          },
        }),
      ).layer,
    ).toBe("source_selection_identified_unapplied");
  });

  it("labels selection misses when source selection does not put the owner in top-3", () => {
    expect(classifyOracleCase(obs({ agent_answer_pass: true })).layer).toBe(
      "source_selection_missed_owner",
    );
  });

  it("labels unsupported cases by coverage honesty", () => {
    expect(
      classifyOracleCase(
        obs({
          expectation_kind: "signal_empty",
          must_include_sources: [],
          acceptable_top_sources: [],
          separability: { available: { coverage_confidence: "uncertain" } },
        }),
      ).layer,
    ).toBe("unsupported_honest");
    expect(
      classifyOracleCase(
        obs({
          expectation_kind: "signal_empty",
          must_include_sources: [],
          acceptable_top_sources: [],
          separability: { available: { coverage_confidence: "confident" } },
        }),
      ).layer,
    ).toBe("unsupported_false_confident");
  });
});

describe("buildOracleFailureAggregate", () => {
  it("counts layer totals and candidate reachability", () => {
    const aggregate = buildOracleFailureAggregate([
      obs({ id: "pass", actual_top1_acceptable: true }),
      obs({ id: "miss" }),
      obs({
        id: "unsupported",
        expectation_kind: "signal_empty",
        must_include_sources: [],
        acceptable_top_sources: [],
        separability: { available: { coverage_confidence: "empty" } },
      }),
    ]);
    expect(aggregate.counts.top1_pass).toBe(1);
    expect(aggregate.counts.source_selection_missed_owner).toBe(1);
    expect(aggregate.counts.unsupported_honest).toBe(1);
    expect(aggregate.reachability.answerable_cases).toBe(2);
    expect(aggregate.reachability.expected_at_5).toBe(2);
    expect(aggregate.top1_misses.map((c) => c.id)).toEqual(["miss"]);
  });
});
