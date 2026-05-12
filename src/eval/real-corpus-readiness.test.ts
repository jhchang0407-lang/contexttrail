/**
 * THO-151 (PRD-0015 / 1): real-corpus summary readiness diagnostics.
 *
 * `summarizeRealCorpus` is the eval-side reporting seam. Slice 1 extends
 * it with chunk-correctness counts (only counting cases that declared a
 * chunk expectation) and a readiness-state histogram. Existing summary
 * fields stay intact so retrieval gates continue to be evaluated.
 */
import { describe, it, expect } from "vitest";
import {
  summarizeRealCorpus,
  type RealCorpusObservation,
} from "./real-corpus-fixture.js";

function obs(overrides: Partial<RealCorpusObservation>): RealCorpusObservation {
  return {
    id: "case",
    notes: "",
    query_intent: "exact_symbol",
    assembly_need: "local_semantics",
    expectation_kind: "deterministic",
    capabilities: ["anchor_recognition"],
    expected_query_mode: "anchored",
    actual_query_mode: "anchored",
    queryModeOk: true,
    signalEmptyWarningOk: true,
    expectedWarningsOk: true,
    missingWarningKinds: [],
    rankedUseful: true,
    top1Acceptable: true,
    agentAnswerPass: true,
    expectedTopSource: "docs/x.md",
    acceptableTopSources: ["docs/x.md"],
    mustIncludeSources: ["docs/x.md"],
    top3: [],
    rankedCount: 1,
    packTokensUsed: 100,
    rankedTokensUsed: 100,
    payloadBytes: 1000,
    warnings: [],
    coverage_confidence: "confident",
    coverageHonest: true,
    chunkCorrect: null,
    pack_readiness: "ready",
    ...overrides,
  };
}

describe("summarizeRealCorpus — readiness and chunk-correctness", () => {
  it("counts ready, partial, needs_anchors, unsupported separately", () => {
    const summary = summarizeRealCorpus([
      obs({ id: "a", pack_readiness: "ready" }),
      obs({ id: "b", pack_readiness: "ready" }),
      obs({ id: "c", pack_readiness: "partial" }),
      obs({ id: "d", pack_readiness: "needs_anchors" }),
      obs({ id: "e", pack_readiness: "unsupported" }),
    ]);

    expect(summary.byReadiness).toEqual({
      ready: 2,
      partial: 1,
      needs_anchors: 1,
      unsupported: 1,
    });
  });

  it("only counts cases with a chunk expectation toward chunkCorrect totals", () => {
    const summary = summarizeRealCorpus([
      obs({ id: "no-expectation", chunkCorrect: null }),
      obs({ id: "match", chunkCorrect: true }),
      obs({ id: "miss", chunkCorrect: false }),
    ]);

    expect(summary.chunkScored).toBe(2);
    expect(summary.chunkCorrect).toBe(1);
  });

  it("preserves existing top-line metrics (rankedUseful, top1, coverageHonest, agentAnswer)", () => {
    const summary = summarizeRealCorpus([
      obs({ id: "a", rankedUseful: true, top1Acceptable: true, agentAnswerPass: true, coverageHonest: true }),
      obs({
        id: "b",
        rankedUseful: false,
        top1Acceptable: false,
        agentAnswerPass: false,
        coverageHonest: false,
        pack_readiness: "partial",
      }),
    ]);
    expect(summary.cases).toBe(2);
    expect(summary.rankedUseful).toBe(1);
    expect(summary.top1Acceptable).toBe(1);
    expect(summary.agentAnswer).toBe(1);
    expect(summary.coverageHonest).toBe(1);
  });

  it("carries the orchestrator's needs / missing-needs / reason-codes diagnostics on each observation", () => {
    // Observation now includes the full readiness diagnostics surface so
    // eval reports can show *why* a pack was labeled partial/needs_anchors.
    const o = obs({
      id: "diag",
      pack_readiness: "partial",
      readiness_diagnostics: {
        needs: ["overview_orientation"],
        satisfiedNeeds: [],
        missingNeeds: ["overview_orientation"],
        reasonCodes: ["intro_missing"],
      },
    });
    expect(o.readiness_diagnostics?.missingNeeds).toEqual(["overview_orientation"]);
    expect(o.readiness_diagnostics?.reasonCodes).toContain("intro_missing");
  });
});
