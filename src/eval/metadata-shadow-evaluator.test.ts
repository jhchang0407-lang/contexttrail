import { describe, expect, it } from "vitest";
import {
  buildMetadataShadowReport,
  renderMetadataShadowReport,
  type ObservabilityRow,
} from "./metadata-shadow-evaluator.js";

describe("metadata shadow evaluator", () => {
  it("reports target gains, losses, and noise movement by depth", () => {
    const baseline: ObservabilityRow[] = [
      target({ file: "src/a.ts", rank: null, outcome: "never_generated", fact: 0 }),
      target({ file: "src/b.ts", rank: 90, outcome: "candidate_top100_hit", fact: 2 }),
      noise({ file: "src/noise-old.ts", rank: 20, fact: 0 }),
    ];
    const candidate: ObservabilityRow[] = [
      target({ file: "src/a.ts", rank: 12, outcome: "candidate_top30_hit", fact: 0 }),
      target({ file: "src/b.ts", rank: null, outcome: "generated_buried", fact: 2 }),
      noise({ file: "src/noise-new.ts", rank: 9, fact: 0 }),
    ];

    const report = buildMetadataShadowReport({
      baselineRows: baseline,
      candidates: [{ name: "candidate", rows: candidate }],
      depths: [10, 30, 100],
    });
    const candidateReport = report.candidates[0]!;

    expect(candidateReport.depths.find((depth) => depth.depth === 30))
      .toMatchObject({
        baselineHits: 0,
        candidateHits: 1,
        netTargets: 1,
        targetGains: 1,
        zeroOverlapTargetGains: 1,
        neverGeneratedTargetGains: 1,
        noiseEntrants: 1,
        noFactNoiseEntrants: 1,
        noiseExits: 1,
      });
    expect(candidateReport.topDepth).toMatchObject({
      baselineHits: 1,
      candidateHits: 1,
      netTargets: 0,
      targetGains: 1,
      targetLosses: 1,
    });
    expect(renderMetadataShadowReport(report)).toContain("candidate");
  });
});

function target(args: {
  file: string;
  rank: number | null;
  outcome: string;
  fact: number;
}): ObservabilityRow {
  return {
    kind: "target_file",
    repoId: "repo",
    changeType: "runtime",
    ticket: "ticket",
    commit: "abc",
    promptIndex: 0,
    query: "change runtime",
    targetFile: args.file,
    candidateRank: args.rank,
    outcome: args.outcome,
    factTokenOverlap: args.fact,
  };
}

function noise(args: {
  file: string;
  rank: number;
  fact: number;
}): ObservabilityRow {
  return {
    kind: "noise_candidate",
    repoId: "repo",
    commit: "abc",
    promptIndex: 0,
    query: "change runtime",
    sourcePath: args.file,
    rank: args.rank,
    factTokenOverlap: args.fact,
  };
}
