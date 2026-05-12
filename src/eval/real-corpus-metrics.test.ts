/**
 * THO-159 (PRD-0016 / P16.1): split answer-bearing retrieval metrics from
 * signal-empty honesty.
 *
 * The current real-corpus summary mixes two unrelated success notions
 * inside top1Acceptable: an answer-bearing top-1 hit and a signal-empty
 * case that admits empty/uncertain. PRD-0016 needs them reported
 * separately so future precision work targets the actual ranking
 * problem rather than optimizing a mixed metric.
 *
 * These tests pin the new surface:
 *   - summary.answerBearingCases / answerTop1 / answerTop3 / answerMrr
 *   - summary.signalEmptyCases / signalEmptyCoverageHonest
 *   - summary.trueTop3Misses / top3HitTop1Miss
 *   - observation.isAnswerBearing / answerTop1Hit / answerTop3Hit /
 *     answerReciprocalRank / failureClass
 */
import { describe, expect, it } from "vitest";
import {
  classifyRealCorpusOutcome,
  summarizeRealCorpus,
  type RealCorpusObservation,
} from "./real-corpus-fixture.js";

function obs(overrides: Partial<RealCorpusObservation>): RealCorpusObservation {
  // Default observation: an answer-bearing exact_symbol case, top-1 hit.
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
    isAnswerBearing: true,
    answerTop1Hit: true,
    answerTop3Hit: true,
    answerReciprocalRank: 1,
    failureClass: "none",
    ...overrides,
  };
}

describe("summarizeRealCorpus — answer-bearing vs signal-empty metrics", () => {
  it("matches acceptable sources by exact parsed source path, not substring", () => {
    const outcome = classifyRealCorpusOutcome({
      expectation_kind: "deterministic",
      expected_query_mode: "anchored",
      expected_signal_empty_warning: false,
      expected_top_source: "packages/zod/README.md",
      acceptableTopSources: ["packages/zod/README.md", "README.md"],
      mustIncludeSources: [],
      actual_query_mode: "anchored",
      coverage_confidence: "confident",
      ranked: [
        {
          kind: "chunk",
          contexttrail: "Source: packages/docs-v3/README.md > Section: Introduction > Part: 1/1",
        },
        {
          kind: "chunk",
          contexttrail: "Source: packages/zod/README.md > Section: What is Zod? > Part: 1/1",
        },
      ],
    });

    expect(outcome.answerTop1Hit).toBe(false);
    expect(outcome.answerTop3Hit).toBe(true);
    expect(outcome.answerReciprocalRank).toBe(1 / 2);
    expect(outcome.failureClass).toBe("answer_ordering_miss");
  });

  it("splits answer-bearing cases from signal-empty cases", () => {
    const summary = summarizeRealCorpus([
      obs({ id: "ans1", isAnswerBearing: true }),
      obs({ id: "ans2", isAnswerBearing: true }),
      obs({
        id: "se1",
        isAnswerBearing: false,
        answerTop1Hit: null,
        answerTop3Hit: null,
        answerReciprocalRank: null,
        expectation_kind: "signal_empty",
        expected_query_mode: "signal_empty",
        coverage_confidence: "empty",
        coverageHonest: true,
      }),
    ]);
    expect(summary.answerBearingCases).toBe(2);
    expect(summary.signalEmptyCases).toBe(1);
  });

  it("counts answerTop1 only when an answer-bearing case actually puts the right source first", () => {
    const summary = summarizeRealCorpus([
      obs({ id: "hit", isAnswerBearing: true, answerTop1Hit: true, answerTop3Hit: true }),
      obs({
        id: "ord-miss",
        isAnswerBearing: true,
        answerTop1Hit: false,
        answerTop3Hit: true,
        answerReciprocalRank: 1 / 2,
        failureClass: "answer_ordering_miss",
      }),
      obs({
        id: "recall-miss",
        isAnswerBearing: true,
        answerTop1Hit: false,
        answerTop3Hit: false,
        answerReciprocalRank: 0,
        failureClass: "answer_recall_miss",
      }),
    ]);
    expect(summary.answerTop1).toBe(1);
    expect(summary.answerTop3).toBe(2);
    expect(summary.trueTop3Misses).toBe(1);
    expect(summary.top3HitTop1Miss).toBe(1);
  });

  it("does not let signal-empty honesty inflate answerTop1 (THO-159 acceptance)", () => {
    // Two signal-empty cases, both honestly empty, but neither is
    // answer-bearing. answerTop1 must remain 0.
    const summary = summarizeRealCorpus([
      obs({
        id: "se1",
        isAnswerBearing: false,
        answerTop1Hit: null,
        answerTop3Hit: null,
        answerReciprocalRank: null,
        expectation_kind: "signal_empty",
        expected_query_mode: "signal_empty",
        coverage_confidence: "empty",
        coverageHonest: true,
        // The legacy mixed metric still flips on for honest empties:
        top1Acceptable: true,
      }),
      obs({
        id: "se2",
        isAnswerBearing: false,
        answerTop1Hit: null,
        answerTop3Hit: null,
        answerReciprocalRank: null,
        expectation_kind: "signal_empty",
        expected_query_mode: "signal_empty",
        coverage_confidence: "uncertain",
        coverageHonest: true,
        top1Acceptable: true,
      }),
    ]);
    expect(summary.answerBearingCases).toBe(0);
    expect(summary.answerTop1).toBe(0);
    expect(summary.answerTop3).toBe(0);
    expect(summary.signalEmptyCases).toBe(2);
    expect(summary.signalEmptyCoverageHonest).toBe(2);
    // Legacy mixed metric is preserved for backward compatibility.
    expect(summary.top1Acceptable).toBe(2);
  });

  it("computes answer MRR over answer-bearing cases only", () => {
    const summary = summarizeRealCorpus([
      obs({ id: "rank1", isAnswerBearing: true, answerReciprocalRank: 1 }),
      obs({ id: "rank2", isAnswerBearing: true, answerTop1Hit: false, answerReciprocalRank: 1 / 2 }),
      obs({
        id: "miss",
        isAnswerBearing: true,
        answerTop1Hit: false,
        answerTop3Hit: false,
        answerReciprocalRank: 0,
      }),
      obs({
        id: "se",
        isAnswerBearing: false,
        answerTop1Hit: null,
        answerTop3Hit: null,
        answerReciprocalRank: null,
        coverageHonest: true,
      }),
    ]);
    // Mean of {1, 0.5, 0} = 0.5; signal-empty case must not dilute.
    expect(summary.answerMrr).toBeCloseTo(0.5, 6);
  });

  it("counts signalEmptyCoverageHonest separately from coverageHonest (which spans all cases)", () => {
    const summary = summarizeRealCorpus([
      obs({ id: "ans-honest", isAnswerBearing: true, coverageHonest: true }),
      obs({
        id: "se-honest",
        isAnswerBearing: false,
        answerTop1Hit: null,
        answerTop3Hit: null,
        answerReciprocalRank: null,
        expectation_kind: "signal_empty",
        coverage_confidence: "empty",
        coverageHonest: true,
      }),
      obs({
        id: "se-dishonest",
        isAnswerBearing: false,
        answerTop1Hit: null,
        answerTop3Hit: null,
        answerReciprocalRank: null,
        expectation_kind: "signal_empty",
        coverage_confidence: "confident",
        coverageHonest: false,
        failureClass: "signal_empty_dishonest",
      }),
    ]);
    expect(summary.signalEmptyCases).toBe(2);
    expect(summary.signalEmptyCoverageHonest).toBe(1);
    expect(summary.coverageHonest).toBe(2);
  });

  it("preserves existing legacy fields (rankedUseful, top1Acceptable, coverageHonest, agentAnswer)", () => {
    const summary = summarizeRealCorpus([
      obs({ id: "a" }),
      obs({
        id: "b",
        isAnswerBearing: true,
        answerTop1Hit: false,
        answerTop3Hit: false,
        answerReciprocalRank: 0,
        rankedUseful: false,
        top1Acceptable: false,
        agentAnswerPass: false,
        coverageHonest: false,
        failureClass: "answer_recall_miss",
      }),
    ]);
    expect(summary.cases).toBe(2);
    expect(summary.rankedUseful).toBe(1);
    expect(summary.top1Acceptable).toBe(1);
    expect(summary.coverageHonest).toBe(1);
    expect(summary.agentAnswer).toBe(1);
  });
});

describe("summarizeRealCorpus — failure class histogram", () => {
  it("aggregates per-case failureClass into byFailureClass", () => {
    const summary = summarizeRealCorpus([
      obs({ id: "ok", failureClass: "none" }),
      obs({ id: "ok2", failureClass: "none" }),
      obs({
        id: "recall",
        isAnswerBearing: true,
        answerTop1Hit: false,
        answerTop3Hit: false,
        answerReciprocalRank: 0,
        failureClass: "answer_recall_miss",
      }),
      obs({
        id: "order",
        isAnswerBearing: true,
        answerTop1Hit: false,
        answerTop3Hit: true,
        answerReciprocalRank: 1 / 2,
        failureClass: "answer_ordering_miss",
      }),
      obs({
        id: "qm",
        actual_query_mode: "unanchored",
        queryModeOk: false,
        failureClass: "query_mode_miss",
      }),
      obs({
        id: "se-bad",
        isAnswerBearing: false,
        answerTop1Hit: null,
        answerTop3Hit: null,
        answerReciprocalRank: null,
        coverageHonest: false,
        failureClass: "signal_empty_dishonest",
      }),
      obs({ id: "pack", agentAnswerPass: false, failureClass: "pack_shape_miss" }),
    ]);

    expect(summary.byFailureClass).toEqual({
      none: 2,
      answer_recall_miss: 1,
      answer_ordering_miss: 1,
      query_mode_miss: 1,
      signal_empty_dishonest: 1,
      pack_shape_miss: 1,
    });
  });
});
