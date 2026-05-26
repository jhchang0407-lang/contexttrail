import { describe, expect, it } from "vitest";
import {
  buildDefaultDocumentWorkflowConfidenceScenarios,
  evaluateDocumentWorkflowConfidenceScenarios,
  renderDocumentWorkflowConfidenceCalibration,
} from "./document-workflow-confidence-calibration.js";

describe("document workflow confidence calibration", () => {
  it("catches unsafe retrieval states without retrying healthy or truly absent slots", () => {
    const report = evaluateDocumentWorkflowConfidenceScenarios(
      buildDefaultDocumentWorkflowConfidenceScenarios(),
    );

    expect(report.summary.total).toBe(3500);
    expect(report.summary.falseReadyOnUnsafe).toBe(0);
    expect(report.summary.falseRetryOnReady).toBe(0);
    expect(report.summary.badRetrievalCaught).toBe(report.summary.badRetrievalTotal);
    expect(report.summary.trueAbsenceReady).toBe(report.summary.trueAbsenceTotal);
    expect(report.summary.weakAbsenceCaught).toBe(report.summary.weakAbsenceTotal);
    expect(report.summary.sourceUnavailableBlocked).toBe(report.summary.sourceUnavailableTotal);
    expect(report.summary.failedStatisticalGates).toEqual([]);
  });

  it("uses distinct scenario ids across the statistical calibration panel", () => {
    const scenarios = buildDefaultDocumentWorkflowConfidenceScenarios();
    const ids = new Set(scenarios.map((scenario) => scenario.id));

    expect(ids.size).toBe(3500);
  });

  it("renders the dangerous false-ready count first", () => {
    const report = evaluateDocumentWorkflowConfidenceScenarios(
      buildDefaultDocumentWorkflowConfidenceScenarios(),
    );
    const rendered = renderDocumentWorkflowConfidenceCalibration(report);

    expect(rendered).toContain("Dangerous false-ready on unsafe retrieval");
    expect(rendered).toContain("3500 scenarios, 3500 passed");
    expect(rendered).toContain("Statistical confidence");
    expect(rendered).toContain("certified");
    expect(rendered).toContain("0/");
    expect(rendered).toContain("Bad retrieval caught");
    expect(rendered).toContain("Source unavailable blocked");
  });
});
