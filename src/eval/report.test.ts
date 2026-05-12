import { describe, expect, it } from "vitest";
import { EXPECTED_EVAL_CASES } from "./corpus.js";
import { compareEvalReports, evaluateGates, renderEvalReport, renderEvalReportWithBaseline, summarize, summarizeAssembly, summarizeTokens } from "./report.js";
import type { EvalObservation, EvalReport } from "./types.js";

function observation(overrides: Partial<EvalObservation> = {}): EvalObservation {
  return {
    id: "case-1",
    notes: "note",
    query_intent: "exact_symbol",
    assembly_need: "local_semantics",
    expectation_kind: "deterministic",
    capabilities: ["anchor_recognition"],
    fragile: false,
    acceptableTopSources: ["docs/payments/refunds.md"],
    expected_query_mode: "anchored",
    actual_query_mode: "anchored",
    baselineRankedUseful: true,
    lockedOk: true,
    queryModeOk: true,
    forbiddenLockedOk: true,
    forbiddenTopOk: true,
    expectedWarningsOk: true,
    missingWarningKinds: [],
    signalEmptyWarningOk: true,
    rankedUseful: true,
    agentAnswerPass: true,
    omittedUseful: true,
    evidenceOk: true,
    explainPresent: true,
    queryCompilationMode: "anchored",
    queryCompilationAnchorCount: 1,
    providedAnchorCount: 1,
    chunkExplainHasDocRole: true,
    expectedLocked: [],
    actualLocked: [],
    forbiddenLocked: [],
    forbiddenLockedHits: [],
    forbiddenTopSubstrings: [],
    forbiddenTopHits: [],
    expectedTopSource: "docs/payments/refunds.md",
    mustIncludeSources: [],
    top3: [],
    top1Acceptable: true,
    top3MustIncludeCoverage: 1,
    top3SourceBalance: 1,
    top3UniqueChunkSources: 1,
    evidenceVisible: false,
    warningVisible: false,
    rankedCount: 1,
    lockedCount: 0,
    assemblyStageExpected: "parent",
    assemblyStageActual: "parent",
    assemblyStageOk: true,
    underExpanded: false,
    overExpanded: false,
    budgetPreset: "default",
    packTokensUsed: 6000,
    lockedTokens: 0,
    rankedTokens: 6000,
    tokenBand: "within_5k_12k",
    payloadBytes: 100,
    omittedTotal: 0,
    warnings: [],
    lockFailures: [],
    ...overrides,
  };
}

describe("retrieval eval report", () => {
  it("summarizes fact-finding quality by taxonomy groups", () => {
    const summary = summarize([
      observation(),
      observation({
        id: "case-2",
        lockedOk: false,
        rankedUseful: false,
        agentAnswerPass: false,
        payloadBytes: 300,
      }),
    ]);

    expect(summary.query_intent.exact_symbol.locked).toBe(0.5);
    expect(summary.capability.anchor_recognition.rankedUseful).toBe(0.5);
    expect(summary.assembly_need.local_semantics.avgPayloadBytes).toBe(200);
    expect(summarizeTokens([observation()]).bucket.all.within5kTo12k).toBe(1);
  });

  it("summarizes structural assembly stages separately from assembly_need", () => {
    const assembly = summarizeAssembly([
      observation(),
      observation({
        id: "case-2",
        assemblyStageExpected: "siblings",
        assemblyStageActual: "linked_neighbor",
        assemblyStageOk: false,
        overExpanded: true,
      }),
    ]);

    expect(assembly.stage.parent.cases).toBe(1);
    expect(assembly.stage.siblings.cases).toBe(1);
    expect(assembly.stage.siblings.stageAccuracy).toBe(0);
    expect(assembly.stage.siblings.overExpansionRate).toBe(1);
  });

  it("renders gates and fragile passes from the report interface", () => {
    const rows = Array.from({ length: EXPECTED_EVAL_CASES }, (_, index) =>
      observation({
        id: `case-${index + 1}`,
        fragile: index === 0,
      }),
    );
    const report: EvalReport = {
      fixture: "tests/fixtures/eval-set.yaml",
      cases: rows.length,
      observations: rows,
      summary: summarize(rows),
      assembly_summary: summarizeAssembly(rows),
      token_summary: summarizeTokens(rows),
      fragile_passes: {
        total: 1,
        cases: [{ id: "case-1", notes: "note" }],
      },
    };

    expect(evaluateGates(report).every((gate) => gate.pass)).toBe(true);
    expect(renderEvalReport(report)).toContain("Fragile passes");
    expect(renderEvalReport(report)).toContain("Context assembly");
    expect(renderEvalReport(report)).toContain("Assembly stage");
  });

  it("suppresses row-level soft misses when the aggregate gate still passes", () => {
    const observations = [
      observation({
        id: "soft-miss",
        forbiddenTopOk: false,
        forbiddenTopHits: ["docs/general/"],
      }),
      ...Array.from({ length: 19 }, (_, index) =>
        observation({
          id: `pass-${index}`,
        }),
      ),
    ];

    const report: EvalReport = {
      fixture: "fixture",
      cases: observations.length,
      observations,
      summary: summarize(observations),
      assembly_summary: summarizeAssembly(observations),
      token_summary: summarizeTokens(observations),
      fragile_passes: { total: 0, cases: [] },
    };

    const rendered = renderEvalReport(report);
    expect(rendered).not.toContain("Misses:");
    expect(evaluateGates(report).find((gate) => gate.name === "forbidden in top-3")?.pass).toBe(true);
  });

  it("renders baseline deltas for retrieval and assembly", () => {
    const currentRows = [observation(), observation({ id: "case-2", top1Acceptable: false, top3SourceBalance: 0.5 })];
    const baselineRows = [observation({ payloadBytes: 80 }), observation({ id: "case-2", rankedUseful: false, top1Acceptable: false, top3SourceBalance: 0.25 })];
    const current: EvalReport = {
      fixture: "tests/fixtures/eval-set.yaml",
      cases: currentRows.length,
      observations: currentRows,
      summary: summarize(currentRows),
      assembly_summary: summarizeAssembly(currentRows),
      token_summary: summarizeTokens(currentRows),
      fragile_passes: { total: 0, cases: [] },
    };
    const baseline: EvalReport = {
      fixture: "tests/fixtures/eval-set.yaml",
      cases: baselineRows.length,
      observations: baselineRows,
      summary: summarize(baselineRows),
      assembly_summary: summarizeAssembly(baselineRows),
      token_summary: summarizeTokens(baselineRows),
      fragile_passes: { total: 0, cases: [] },
    };

    expect(compareEvalReports(current, baseline).retrieval_bucket.all.rankedUsefulDelta).toBe(0.5);
    expect(renderEvalReportWithBaseline(current, baseline)).toContain("Baseline comparison");
    expect(renderEvalReport(current)).toContain("Context size");
  });
});
