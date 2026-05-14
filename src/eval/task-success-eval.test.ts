import { describe, expect, it } from "vitest";
import type { PresentedContextPack } from "../mcp/presenter.js";
import type { AgentTaskSuccessCase } from "./task-success.js";
import {
  evaluateTaskSuccessHonesty,
  summarizeTaskSuccessHonesty,
} from "./task-success-eval.js";

function pack(
  overrides: Partial<PresentedContextPack>,
): PresentedContextPack {
  return {
    query_mode: "anchored",
    coverage_confidence: "uncertain",
    assembly_stage_reached: "not_applicable",
    locked: [],
    ranked: [],
    omitted: [],
    warnings: [],
    budget: { requested: 6000, used: 300, locked_overhead: 0 },
    explain: {
      per_chunk: [],
      query_compilation: {
        query_mode: "anchored",
        provided_anchor_count: 1,
        recognized_anchor_count: 1,
        anchors: [],
      },
      lock_failures: [],
      pack_readiness: {
        state: "partial",
        needs: [],
        satisfied_needs: [],
        missing_needs: [],
        reason_codes: [],
      },
    },
    ...overrides,
  };
}

const fixture: AgentTaskSuccessCase = {
  ticket: "THO-1",
  commit_sha: "abc1234",
  task: "Implement the feature",
  budget: "default",
  expected_change_target: {
    kind: "all_of",
    files: ["src/example.ts"],
  },
  acceptable_outcome_notes: ["note"],
  required_anchors: {
    files: ["src/example.ts"],
    symbols: [],
    routes: [],
  },
  low_signal_expectation: "ordinary",
};

describe("evaluateTaskSuccessHonesty", () => {
  it("flags overconfident misses as dishonest", () => {
    const row = evaluateTaskSuccessHonesty({
      fixture,
      pack: pack({
        query_mode: "unanchored",
        coverage_confidence: "confident",
        explain: {
          per_chunk: [],
          query_compilation: {
            query_mode: "unanchored",
            provided_anchor_count: 1,
            recognized_anchor_count: 0,
            anchors: [],
          },
          lock_failures: [],
          pack_readiness: {
            state: "ready",
            needs: [],
            satisfied_needs: [],
            missing_needs: [],
            reason_codes: [],
          },
        },
      }),
      verdict: {
        ticket: "THO-1",
        commit_sha: "abc1234",
        task: "Implement the feature",
        budget: "default",
        lowSignalExpectation: "ordinary",
        expectedChangeTargetText: "src/example.ts",
        reachedRightFiles: false,
        acceptableChange: false,
        missingSurfacedFiles: ["src/example.ts"],
        missingChangedFiles: ["src/example.ts"],
        supportClusterFiles: [],
        supportClusterChangedFiles: [],
        supportClusterContributed: false,
        evaluationMode: "deterministic_file_set",
        acceptableOutcomeNotes: ["note"],
      },
    });

    expect(row.queryModeHonest).toBe(false);
    expect(row.coverageConfidenceHonest).toBe(false);
    expect(row.packReadinessHonest).toBe(false);
  });
});

describe("summarizeTaskSuccessHonesty", () => {
  it("requires every case to stay honest on all three axes", () => {
    const summary = summarizeTaskSuccessHonesty([
      {
        ticket: "THO-1",
        queryModeHonest: true,
        coverageConfidenceHonest: true,
        packReadinessHonest: true,
      },
      {
        ticket: "THO-2",
        queryModeHonest: true,
        coverageConfidenceHonest: false,
        packReadinessHonest: true,
      },
    ]);

    expect(summary.queryModeHonest).toBe(true);
    expect(summary.coverageConfidenceHonest).toBe(false);
    expect(summary.packReadinessHonest).toBe(true);
    expect(summary.rows).toHaveLength(2);
  });
});
