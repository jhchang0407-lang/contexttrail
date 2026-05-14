import { describe, expect, it } from "vitest";
import {
  classifyLowSignalMissShape,
  renderTaskSuccessLowSignalReport,
  summarizeTaskSuccessLowSignal,
} from "./task-success-low-signal.js";
import type { AgentTaskSuccessVerdict } from "./task-success.js";

function verdict(
  id: string,
  expectation: AgentTaskSuccessVerdict["lowSignalExpectation"],
  reachedRightFiles: boolean,
  acceptableChange: boolean,
): AgentTaskSuccessVerdict {
  return {
    ticket: id,
    commit_sha: "abc1234",
    task: `${id} task`,
    budget: "default",
    lowSignalExpectation: expectation,
    expectedChangeTargetText: "src/example.ts",
    reachedRightFiles,
    acceptableChange,
    missingSurfacedFiles: reachedRightFiles ? [] : ["src/example.ts"],
    missingChangedFiles: acceptableChange ? [] : ["src/example.ts"],
    supportClusterFiles: [],
    supportClusterChangedFiles: [],
    supportClusterContributed: false,
    evaluationMode: "deterministic_file_set",
    acceptableOutcomeNotes: ["Example note."],
  };
}

describe("classifyLowSignalMissShape", () => {
  it("names repeated low-signal miss shapes without mutating recovery behavior", () => {
    expect(
      classifyLowSignalMissShape(verdict("ordinary-miss", "ordinary", false, false)),
    ).toBe("no_right_files");
    expect(
      classifyLowSignalMissShape(verdict("low-signal-miss", "low_signal", false, false)),
    ).toBe("low_signal_no_right_files");
    expect(
      classifyLowSignalMissShape(verdict("signal-empty-miss", "signal_empty", false, false)),
    ).toBe("signal_empty_unresolved");
    expect(
      classifyLowSignalMissShape(verdict("file-hit", "low_signal", true, false)),
    ).toBe("low_signal_file_hit_but_change_miss");
  });
});

describe("summarizeTaskSuccessLowSignal", () => {
  it("separates ordinary, low_signal, and signal_empty validation buckets", () => {
    const summary = summarizeTaskSuccessLowSignal([
      verdict("ordinary-pass", "ordinary", true, true),
      verdict("low-signal-miss", "low_signal", false, false),
      verdict("signal-empty-miss", "signal_empty", false, false),
    ]);

    expect(summary.buckets.ordinary.cases).toBe(1);
    expect(summary.buckets.low_signal.cases).toBe(1);
    expect(summary.buckets.signal_empty.cases).toBe(1);
    expect(summary.missShapes.low_signal_no_right_files).toBe(1);
    expect(summary.missShapes.signal_empty_unresolved).toBe(1);
  });
});

describe("renderTaskSuccessLowSignalReport", () => {
  it("renders a reporting-only low-signal section with named miss buckets", () => {
    const report = renderTaskSuccessLowSignalReport(
      summarizeTaskSuccessLowSignal([
        verdict("ordinary-pass", "ordinary", true, true),
        verdict("low-signal-miss", "low_signal", false, false),
        verdict("signal-empty-miss", "signal_empty", false, false),
      ]),
    );

    expect(report).toContain("LOW-SIGNAL TASK-SUCCESS REPORT");
    expect(report).toContain("reporting-only");
    expect(report).toContain("ordinary");
    expect(report).toContain("low_signal");
    expect(report).toContain("signal_empty");
    expect(report).toContain("low_signal_no_right_files");
    expect(report).toContain("signal_empty_unresolved");
  });
});
