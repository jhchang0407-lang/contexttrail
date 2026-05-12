import { describe, expect, it } from "vitest";
import {
  renderRecoveryBenchmarkReport,
  recommendRecoveryAction,
  summarizeRecoveryRows,
  type RecoveryBenchmarkRow,
  type RecoverySignal,
} from "./recovery-benchmark.js";

function signal(overrides: Partial<RecoverySignal> = {}): RecoverySignal {
  return {
    query_mode: "anchored",
    coverage_confidence: "confident",
    pack_readiness: "ready",
    ...overrides,
  };
}

function row(overrides: Partial<RecoveryBenchmarkRow> = {}): RecoveryBenchmarkRow {
  return {
    repo: "demo",
    id: "case",
    query_intent: "exact_symbol",
    isAnswerBearing: true,
    failureClass: "none",
    top5Useful: true,
    action: "answer",
    coverage_confidence: "confident",
    pack_readiness: "ready",
    packTokensUsed: 100,
    oracleGoldTokens: 80,
    packGoldDeltaTokens: 20,
    packToGoldRatio: 1.25,
    payloadBytes: 1000,
    ...overrides,
  };
}

describe("recommendRecoveryAction", () => {
  it("answers only when the pack surface is confident and ready", () => {
    expect(recommendRecoveryAction(signal())).toBe("answer");
  });

  it("abstains when the pack reports no evidence", () => {
    expect(recommendRecoveryAction(signal({ coverage_confidence: "empty" }))).toBe("abstain");
    expect(recommendRecoveryAction(signal({ pack_readiness: "unsupported" }))).toBe("abstain");
  });

  it("asks for anchors on signal-empty or needs-anchors surfaces", () => {
    expect(recommendRecoveryAction(signal({ query_mode: "signal_empty", coverage_confidence: "uncertain" }))).toBe(
      "ask_for_anchors",
    );
    expect(recommendRecoveryAction(signal({ pack_readiness: "needs_anchors" }))).toBe("ask_for_anchors");
  });

  it("retries with more context when the pack is partial or uncertain", () => {
    expect(recommendRecoveryAction(signal({ coverage_confidence: "uncertain" }))).toBe("retry_with_followup_searches");
    expect(recommendRecoveryAction(signal({ pack_readiness: "partial" }))).toBe("retry_with_followup_searches");
  });
});

describe("summarizeRecoveryRows", () => {
  it("counts false-green answers and safe recovery actions", () => {
    const summary = summarizeRecoveryRows([
      row({ id: "clean" }),
      row({ id: "miss", failureClass: "answer_recall_miss", action: "answer" }),
      row({
        id: "signal",
        isAnswerBearing: false,
        failureClass: "none",
        action: "ask_for_anchors",
        coverage_confidence: "uncertain",
        pack_readiness: "needs_anchors",
      }),
      row({
        id: "unsafe-signal",
        isAnswerBearing: false,
        failureClass: "signal_empty_dishonest",
        action: "answer",
      }),
    ]);

    expect(summary.cases).toBe(4);
    expect(summary.answerBearingCases).toBe(2);
    expect(summary.signalEmptyCases).toBe(2);
    expect(summary.readyAnswers).toBe(1);
    expect(summary.recoveryNeeded).toBe(3);
    expect(summary.safeRecoveryActions).toBe(1);
    expect(summary.unsafeAnswers).toBe(2);
    expect(summary.signalEmptyHonest).toBe(1);
    expect(summary.avgPackTokens).toBe(100);
    expect(summary.avgOracleGoldTokens).toBe(80);
    expect(summary.avgPackGoldDeltaTokens).toBe(20);
    expect(summary.packToGoldRatio).toBe(1.25);
  });

  it("renders the oracle lower-bound token comparison in the repo table", () => {
    const report = {
      repos: ["demo"],
      rows: [row()],
      summary: summarizeRecoveryRows([row()]),
      byRepo: [{ repo: "demo", summary: summarizeRecoveryRows([row()]) }],
    };

    expect(renderRecoveryBenchmarkReport(report)).toContain("Pack / oracle lower bound");
    expect(renderRecoveryBenchmarkReport(report)).toContain("Pack");
    expect(renderRecoveryBenchmarkReport(report)).toContain("Oracle LB");
  });
});
