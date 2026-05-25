import { describe, expect, it } from "vitest";
import { runDocumentWorkflowHybridPanel } from "./document-workflow-hybrid-panel.js";

describe("document workflow public hybrid panel runner", () => {
  it("runs generated workflows against public source documents", async () => {
    const panel = await runDocumentWorkflowHybridPanel(["node", "document-workflow-hybrid-panel"]);

    expect(panel.panelName).toBe("document_workflow_hybrid_panel");
    expect(panel.fixtureReports).toHaveLength(2);
    expect(panel.aggregate.fixtureName).toBe("document_workflow_hybrid_panel");
    expect(panel.aggregate.importedSources).toBe(33);
    expect(panel.aggregate.summary.workflows).toBe(13);
    expect(panel.aggregate.summary.fields).toBe(143);
    expect(panel.aggregate.summary.requiredSlots).toBe(38);
    expect(panel.aggregate.summary.requiredSlotsSatisfied).toBe(37);
    expect(panel.aggregate.summary.sectionRecallTotal).toBe(184);
    expect(panel.aggregate.summary.sectionRecallHits).toBe(184);
    expect(panel.aggregate.summary.searchedScopeTotal).toBe(22);
    expect(panel.aggregate.summary.abstentionTotal).toBe(13);
    expect(panel.aggregate.summary.citationValidityTotal).toBe(130);
    expect(panel.aggregate.summary.citationAuthorityTotal).toBe(143);
    expect(panel.aggregate.summary.computedAccuracyTotal).toBe(12);
    expect(panel.aggregate.summary.computedGroundingHits).toBe(12);
    expect(panel.aggregate.summary.computedGroundingTotal).toBe(12);
    expect(panel.aggregate.summary.judgmentAccuracyTotal).toBe(14);
    expect(panel.aggregate.summary.judgmentGroundingHits).toBe(14);
    expect(panel.aggregate.summary.judgmentGroundingTotal).toBe(14);
    expect(panel.aggregate.summary.reviewExplanationTotal).toBe(13);
    expect(panel.aggregate.summary.decoyRejectedCitationTotal).toBe(7);
  });

  it("supports split filtering for public hybrid workflows", async () => {
    const panel = await runDocumentWorkflowHybridPanel([
      "node",
      "document-workflow-hybrid-panel",
      "--split=stress",
    ]);

    expect(panel.splitFilter).toBe("stress");
    expect(panel.fixtureReports).toHaveLength(2);
    expect(panel.aggregate.summary.workflows).toBe(8);
    expect(panel.aggregate.summary.fields).toBe(89);
    expect(panel.aggregate.summary.abstentionTotal).toBe(9);
    expect(panel.aggregate.summary.computedAccuracyTotal).toBe(9);
    expect(panel.aggregate.summary.computedGroundingHits).toBe(9);
    expect(panel.aggregate.summary.computedGroundingTotal).toBe(9);
    expect(panel.aggregate.summary.judgmentAccuracyTotal).toBe(9);
    expect(panel.aggregate.summary.judgmentGroundingHits).toBe(9);
    expect(panel.aggregate.summary.judgmentGroundingTotal).toBe(9);
  });
});
