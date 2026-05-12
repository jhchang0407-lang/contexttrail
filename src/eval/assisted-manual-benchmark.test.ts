import { describe, expect, it } from "vitest";
import {
  renderAssistedManualBenchmarkReport,
  summarizeAssistedManualRows,
  type AssistedManualBenchmarkRow,
} from "./assisted-manual-benchmark.js";

function row(overrides: Partial<AssistedManualBenchmarkRow> = {}): AssistedManualBenchmarkRow {
  return {
    repo: "demo",
    id: "case",
    query_intent: "exact_symbol",
    isAnswerBearing: true,
    failureClass: "none",
    initialAction: "retry_with_followup_searches",
    retryAction: "answer",
    coverage_confidence: "uncertain",
    pack_readiness: "partial",
    initialTop5Hit: true,
    retryTop5Hit: true,
    retryImproved: true,
    retryRecovered: true,
    packTokensUsed: 100,
    manualTargetedTokensUsed: 200,
    manualCorpusTokensUsed: 1000,
    oracleGoldTokens: 80,
    assistedToManualTargetedRatio: 0.5,
    assistedToManualCorpusRatio: 0.1,
    assistedToOracleRatio: 1.25,
    payloadBytes: 1000,
    ...overrides,
  };
}

describe("summarizeAssistedManualRows", () => {
  it("counts top-5 usefulness, retry improvement, and token ratios", () => {
    const summary = summarizeAssistedManualRows([
      row(),
      row({
        id: "miss",
        isAnswerBearing: false,
        initialAction: "ask_for_anchors",
        retryAction: null,
        initialTop5Hit: null,
        retryTop5Hit: null,
        retryImproved: false,
        retryRecovered: false,
        coverage_confidence: "empty",
        pack_readiness: "needs_anchors",
        manualTargetedTokensUsed: 0,
        manualCorpusTokensUsed: 300,
        oracleGoldTokens: 0,
        assistedToManualTargetedRatio: 0,
        assistedToManualCorpusRatio: 1 / 3,
        assistedToOracleRatio: 0,
      }),
    ]);

    expect(summary.cases).toBe(2);
    expect(summary.answerBearingCases).toBe(1);
    expect(summary.signalEmptyCases).toBe(1);
    expect(summary.top5Useful).toBe(1);
    expect(summary.retryAttempts).toBe(1);
    expect(summary.retryImproved).toBe(1);
    expect(summary.retryRecovered).toBe(1);
    expect(summary.avgAssistedPackTokens).toBe(100);
    expect(summary.avgManualTargetedTokens).toBe(200);
    expect(summary.avgManualCorpusTokens).toBe(650);
    expect(summary.avgOracleGoldTokens).toBe(40);
  });

  it("renders the assisted/manual comparison and retry sections", () => {
    const report = {
      repos: ["demo"],
      rows: [row()],
      summary: summarizeAssistedManualRows([row()]),
      byRepo: [{ repo: "demo", summary: summarizeAssistedManualRows([row()]) }],
    };

    const rendered = renderAssistedManualBenchmarkReport(report);
    expect(rendered).toContain("Assisted-vs-manual benchmark");
    expect(rendered).toContain("Avg targeted manual tokens");
    expect(rendered).toContain("Retry improved");
  });
});
