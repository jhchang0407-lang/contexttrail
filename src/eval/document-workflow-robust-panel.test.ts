import { describe, expect, it } from "vitest";
import { DOCUMENT_WORKFLOW_ROBUST_FIXTURES, runDocumentWorkflowRobustPanel } from "./document-workflow-robust-panel.js";

describe("document workflow robust panel runner", () => {
  it("aggregates authored, public, and messy document workflow fixtures", async () => {
    const panel = await runDocumentWorkflowRobustPanel(["node", "document-workflow-robust-panel"]);

    expect(panel.panelName).toBe("document_workflow_robust_panel");
    expect(panel.fixtureReports).toHaveLength(DOCUMENT_WORKFLOW_ROBUST_FIXTURES.length);
    expect(panel.aggregate.fixtureName).toBe("document_workflow_robust_panel");
    expect(panel.aggregate.importedSources).toBeGreaterThanOrEqual(110);
    expect(panel.aggregate.summary.workflows).toBeGreaterThanOrEqual(50);
    expect(panel.aggregate.summary.fields).toBeGreaterThanOrEqual(380);
    expect(panel.aggregate.summary.requiredSlots).toBeGreaterThanOrEqual(160);
    expect(panel.aggregate.summary.sectionRecallTotal).toBeGreaterThanOrEqual(390);
    expect(panel.aggregate.summary.computedGroundingTotal).toBeGreaterThanOrEqual(8);
    expect(panel.aggregate.summary.judgmentGroundingTotal).toBeGreaterThanOrEqual(8);
    expect(panel.aggregate.summary.retrievedTokenTotal).toBeGreaterThan(
      panel.aggregate.summary.requiredEvidenceTokenTotal,
    );
    expect(panel.aggregate.summary.requiredEvidenceTokenTotal).toBeGreaterThan(0);
    expect(panel.breadth.passed).toBe(true);
  });

  it("supports holdout-only robustness checks", async () => {
    const panel = await runDocumentWorkflowRobustPanel([
      "node",
      "document-workflow-robust-panel",
      "--split=holdout",
    ]);

    expect(panel.splitFilter).toBe("holdout");
    expect(panel.aggregate.summary.workflows).toBeGreaterThanOrEqual(11);
    expect(panel.aggregate.summary.bySplit.holdout?.total).toBeGreaterThanOrEqual(38);
  });
});
