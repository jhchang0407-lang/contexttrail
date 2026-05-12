import { describe, expect, it } from "vitest";
import { renderCompressionBenchmark, summarizeCompressionRow, withBudgets } from "./compression-benchmark.js";
import type { EvalReport } from "./types.js";

function stubReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    fixture: "tests/fixtures/eval-set.yaml",
    cases: 1,
    observations: [],
    summary: {
      bucket: {
        all: { cases: 1, locked: 1, signalEmptyWarning: 1, rankedUseful: 0.91, agentAnswer: 1, omittedUseful: 1, avgPayloadBytes: 100 },
        anchored: { cases: 1, locked: 1, signalEmptyWarning: 1, rankedUseful: 0.985, agentAnswer: 1, omittedUseful: 1, avgPayloadBytes: 100 },
        signal_empty: { cases: 0, locked: 1, signalEmptyWarning: 1, rankedUseful: 0.545, agentAnswer: 1, omittedUseful: 1, avgPayloadBytes: 100 },
        unanchored: { cases: 1, locked: 1, signalEmptyWarning: 1, rankedUseful: 1, agentAnswer: 1, omittedUseful: 1, avgPayloadBytes: 100 },
      },
      query_intent: {},
      assembly_need: {},
      expectation_kind: {},
      capability: {},
    },
    assembly_summary: {
      bucket: {
        all: { cases: 1, top1Acceptable: 0.795, top3MustIncludeCoverage: 0.996, top3SourceBalance: 0.954, evidenceVisible: 1, warningVisible: 0, avgRankedCount: 17.1, avgLockedCount: 1.3, avgPayloadBytes: 100 },
        anchored: { cases: 1, top1Acceptable: 0.954, top3MustIncludeCoverage: 1, top3SourceBalance: 0.944, evidenceVisible: 1, warningVisible: 0, avgRankedCount: 13.1, avgLockedCount: 2.5, avgPayloadBytes: 100 },
        signal_empty: { cases: 0, top1Acceptable: 0.091, top3MustIncludeCoverage: 1, top3SourceBalance: 0.909, evidenceVisible: 0, warningVisible: 1, avgRankedCount: 18.7, avgLockedCount: 0, avgPayloadBytes: 100 },
        unanchored: { cases: 1, top1Acceptable: 0.943, top3MustIncludeCoverage: 0.986, top3SourceBalance: 1, evidenceVisible: 1, warningVisible: 0, avgRankedCount: 23.5, avgLockedCount: 0, avgPayloadBytes: 100 },
      },
      assembly_need: {},
    },
    token_summary: {
      bucket: {
        all: { cases: 1, within5kTo12k: 0, under12k: 1, under5k: 1, avgPackTokensUsed: 1096, avgLockedTokens: 98, avgRankedTokens: 966, avgLockedShare: 0.041 },
        anchored: { cases: 1, within5kTo12k: 0, under12k: 1, under5k: 1, avgPackTokensUsed: 939, avgLockedTokens: 184, avgRankedTokens: 755, avgLockedShare: 0.077 },
        signal_empty: { cases: 0, within5kTo12k: 0, under12k: 1, under5k: 1, avgPackTokensUsed: 1054, avgLockedTokens: 0, avgRankedTokens: 1054, avgLockedShare: 0 },
        unanchored: { cases: 1, within5kTo12k: 0, under12k: 1, under5k: 1, avgPackTokensUsed: 1414, avgLockedTokens: 0, avgRankedTokens: 1302, avgLockedShare: 0 },
      },
      assembly_need: {},
      budget: {},
    },
    fragile_passes: { total: 0, cases: [] },
    ...overrides,
  };
}

describe("compression benchmark", () => {
  it("derives summary rows from eval reports", () => {
    const row = summarizeCompressionRow("compact_4k", 4000, stubReport());
    expect(row.name).toBe("compact_4k");
    expect(row.requestedDefault).toBe(4000);
    expect(row.overallTop1).toBe(0.795);
    expect(row.avgUsed).toBe(1096);
  });

  it("renders a recommended cutoff table", () => {
    const full = summarizeCompressionRow("full", 6000, stubReport());
    const compact = summarizeCompressionRow(
      "compact_4k",
      4000,
      stubReport({
        assembly_summary: {
          ...stubReport().assembly_summary,
          bucket: {
            ...stubReport().assembly_summary.bucket,
            all: { ...stubReport().assembly_summary.bucket.all, top1Acceptable: 0.78, top3SourceBalance: 0.92 },
            anchored: { ...stubReport().assembly_summary.bucket.anchored, top1Acceptable: 0.93 },
            unanchored: { ...stubReport().assembly_summary.bucket.unanchored, top1Acceptable: 0.90 },
          },
        },
        token_summary: {
          ...stubReport().token_summary,
          bucket: {
            ...stubReport().token_summary.bucket,
            all: { ...stubReport().token_summary.bucket.all, avgPackTokensUsed: 880, avgRankedTokens: 760 },
          },
        },
      }),
    );

    const rendered = renderCompressionBenchmark([full, compact]);
    expect(rendered).toContain("Compression benchmark");
    expect(rendered).toContain("compact_4k");
    expect(rendered).toContain("Recommended cutoff");
  });

  it("can override retrieval budgets cleanly", () => {
    const config = withBudgets({ small: 2500, default: 4000, large: 7000 });
    expect(config.retrieval.budgets.default).toBe(4000);
    expect(config.retrieval.budgets.small).toBe(2500);
  });
});
