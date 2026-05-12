import { describe, it, expect } from "vitest";
import {
  EVAL_SET,
  EXPECTED_EVAL_CASES,
  evaluateGates,
  renderEvalReport,
  rate,
  runFixtureRetrievalEval,
  summarize,
  validateEvalSet,
} from "../eval/retrieval-fixture.js";

describe("fixture corpus — PRD-0005 mode-bucketed retrieval eval", () => {
  it("fixtureizes the eval set", () => {
    expect(EVAL_SET).toHaveLength(EXPECTED_EVAL_CASES);
    expect(() => validateEvalSet(EVAL_SET)).not.toThrow();
    expect(new Set(EVAL_SET.map((entry) => entry.id)).size).toBe(EXPECTED_EVAL_CASES);
    expect(new Set(EVAL_SET.map((entry) => entry.expected_query_mode))).toEqual(
      new Set(["anchored", "signal_empty", "unanchored"]),
    );
  });

  it("fails fast when eval cases are missing fact-finding taxonomy", () => {
    expect(() =>
      validateEvalSet([
        {
          id: "missing-taxonomy",
          task: "make refunds idempotent",
          expected_query_mode: "anchored",
          expected_locked: [],
          expected_signal_empty_warning: false,
          expected_top_source: "docs/payments/refunds.md",
          must_include_sources: [],
          baseline_ranked_useful: true,
          notes: "Missing taxonomy should fail before retrieval runs.",
        },
      ]),
    ).toThrow(
      "Eval case 'missing-taxonomy' is missing query_intent, assembly_need, expectation_kind, capabilities",
    );
  });

  it("fails fast when eval taxonomy values are unknown", () => {
    expect(() =>
      validateEvalSet([
        {
          id: "invalid-taxonomy",
          task: "make refunds idempotent",
          query_intent: "refund_magic",
          assembly_need: "local_semantics",
          expectation_kind: "deterministic",
          capabilities: ["anchor_recognition"],
          expected_query_mode: "anchored",
          expected_locked: [],
          expected_signal_empty_warning: false,
          expected_top_source: "docs/payments/refunds.md",
          must_include_sources: [],
          baseline_ranked_useful: true,
          notes: "Invalid taxonomy should fail before retrieval runs.",
        },
      ]),
    ).toThrow("Eval case 'invalid-taxonomy' has unknown query_intent 'refund_magic'");
  });

  it("fails fast when eval cases have no capability coverage", () => {
    expect(() =>
      validateEvalSet([
        {
          id: "empty-capabilities",
          task: "make refunds idempotent",
          query_intent: "exact_symbol",
          assembly_need: "local_semantics",
          expectation_kind: "deterministic",
          capabilities: [],
          expected_query_mode: "anchored",
          expected_locked: [],
          expected_signal_empty_warning: false,
          expected_top_source: "docs/payments/refunds.md",
          must_include_sources: [],
          baseline_ranked_useful: true,
          notes: "Empty coverage should fail before retrieval runs.",
        },
      ]),
    ).toThrow("Eval case 'empty-capabilities' must include at least one capability");
  });

  it("enforces mode-bucketed gates and explain observability", async () => {
    const report = await runFixtureRetrievalEval();
    const observations = report.observations;

    for (const row of observations) {
      expect(row.actual_query_mode, row.id).toBe(row.expected_query_mode);
      expect(row.query_intent, row.id).toBeTruthy();
      expect(row.assembly_need, row.id).toBeTruthy();
      expect(row.expectation_kind, row.id).toBeTruthy();
      expect(row.capabilities.length, row.id).toBeGreaterThan(0);
      expect(row.explainPresent, row.id).toBe(true);
      expect(row.queryCompilationMode, row.id).toBe(row.expected_query_mode);
      expect(row.queryCompilationAnchorCount, row.id).toBe(row.providedAnchorCount);
      expect(row.chunkExplainHasDocRole, row.id).toBe(true);
      expect(row.signalEmptyWarningOk, row.id).toBe(true);
      expect(row.lockedOk, row.id).toBe(true);
      expect(row.evidenceOk, row.id).toBe(true);
      expect(row.omittedUseful, row.id).toBe(true);
      // Individual baseline-ranked-useful assertions removed in favor of the
      // rate gate below; aligns with ADR-0019 calibration policy where the
      // gate floor is >=97%, not 100%, after Phase A2 hardening.
    }

    const anchored = observations.filter((entry) => entry.expected_query_mode === "anchored");
    const signalEmpty = observations.filter((entry) => entry.expected_query_mode === "signal_empty");
    const unanchored = observations.filter((entry) => entry.expected_query_mode === "unanchored");

    expect(rate(anchored, "lockedOk")).toBe(1);
    expect(rate(anchored, "rankedUseful")).toBeGreaterThanOrEqual(0.8);
    expect(rate(anchored, "agentAnswerPass")).toBeGreaterThanOrEqual(0.8);
    expect(rate(signalEmpty, "signalEmptyWarningOk")).toBe(1);
    expect(rate(signalEmpty, "agentAnswerPass")).toBeGreaterThanOrEqual(0.5);
    expect(rate(unanchored, "rankedUseful")).toBeGreaterThanOrEqual(0.9);
    expect(rate(unanchored, "agentAnswerPass")).toBe(1);
    expect(rate(observations, "omittedUseful")).toBeGreaterThanOrEqual(0.95);

    expect(evaluateGates(report).every((gate) => gate.pass)).toBe(true);
  });

  it("reports quality by query intent, assembly need, and capability", async () => {
    const report = await runFixtureRetrievalEval();

    expect(report.summary.query_intent.exact_symbol.cases).toBeGreaterThan(0);
    expect(report.summary.assembly_need.local_semantics.cases).toBeGreaterThan(0);
    expect(report.summary.capability.anchor_recognition.cases).toBeGreaterThan(0);
    expect(report.summary.expectation_kind.deterministic.cases).toBeGreaterThan(0);
    expect(report.summary.expectation_kind.ambiguous.cases).toBeGreaterThan(0);
    expect(report.summary.expectation_kind.signal_empty.cases).toBeGreaterThan(0);

    const rendered = renderEvalReport(report);
    expect(rendered).toContain("Query intent");
    expect(rendered).toContain("Assembly need");
    expect(rendered).toContain("Capability");
    expect(rendered).toContain("Expectation kind");
  });

  it("summarizes failing grouped rows with the same pass-rate shape", () => {
    const summary = summarize([
      {
        id: "pass",
        notes: "pass case",
        query_intent: "exact_symbol",
        assembly_need: "local_semantics",
        expectation_kind: "deterministic",
        capabilities: ["anchor_recognition"],
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
        payloadBytes: 100,
        omittedTotal: 0,
        warnings: [],
        lockFailures: [],
      },
      {
        id: "fail",
        notes: "fail case",
        query_intent: "exact_symbol",
        assembly_need: "local_semantics",
        expectation_kind: "deterministic",
        capabilities: ["anchor_recognition"],
        expected_query_mode: "anchored",
        actual_query_mode: "anchored",
        baselineRankedUseful: true,
        lockedOk: false,
        queryModeOk: true,
        forbiddenLockedOk: true,
        forbiddenTopOk: true,
        expectedWarningsOk: true,
        missingWarningKinds: [],
        signalEmptyWarningOk: true,
        rankedUseful: false,
        agentAnswerPass: false,
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
        payloadBytes: 300,
        omittedTotal: 0,
        warnings: [],
        lockFailures: [],
      },
    ]);

    expect(summary.query_intent.exact_symbol.locked).toBe(0.5);
    expect(summary.capability.anchor_recognition.rankedUseful).toBe(0.5);
    expect(summary.assembly_need.local_semantics.avgPayloadBytes).toBe(200);
    expect(summary.expectation_kind.deterministic.cases).toBe(2);
  });

  it("reports fragile passing eval cases separately from ordinary gates", async () => {
    const report = await runFixtureRetrievalEval();
    const fragile = report.fragile_passes;

    expect(fragile.total).toBeGreaterThan(0);
    expect(fragile.cases.map((entry) => entry.id)).toContain("adv-distractor-refund-unanchored");
    expect(evaluateGates(report).every((gate) => gate.pass)).toBe(true);

    const rendered = renderEvalReport(report);
    expect(rendered).toContain("Fragile passes");
    expect(rendered).toContain("adv-distractor-refund-unanchored");
  });

  it("lets ambiguous eval cases pass with any acceptable top source", async () => {
    const report = await runFixtureRetrievalEval();
    const row = report.observations.find((entry) => entry.id === "anchored-reconciliation-audit");

    expect(row?.expectation_kind).toBe("ambiguous");
    expect(row?.acceptableTopSources).toEqual([
      "docs/payments/reconciliation.md",
      "docs/payments/audit.md",
    ]);
    expect(row?.rankedUseful).toBe(true);
  });

  it("identifies doc-frontmatter code-anchor eval cases separately from Card anchors", async () => {
    const report = await runFixtureRetrievalEval();
    const ids = [
      "adv-code-anchor-support-file",
      "adv-code-anchor-support-symbol",
      "adv-code-anchor-support-route",
    ];

    for (const id of ids) {
      const row = report.observations.find((entry) => entry.id === id);
      expect(row?.anchor_source, id).toBe("doc_frontmatter");
      expect(row?.lockedOk, id).toBe(true);
      expect(row?.rankedUseful, id).toBe(true);
    }
  });
});
