import { describe, expect, it } from "vitest";
import { runDocumentWorkflowHybridPanel } from "./document-workflow-hybrid-panel.js";

describe("document workflow public hybrid panel runner", () => {
  it("runs generated workflows against public source documents", async () => {
    const panel = await runDocumentWorkflowHybridPanel(["node", "document-workflow-hybrid-panel"]);

    expect(panel.panelName).toBe("document_workflow_hybrid_panel");
    expect(panel.fixtureReports).toHaveLength(2);
    expect(panel.aggregate.fixtureName).toBe("document_workflow_hybrid_panel");
    expect(panel.aggregate.importedSources).toBe(22);
    expect(panel.aggregate.summary.workflows).toBe(8);
    expect(panel.aggregate.summary.fields).toBe(72);
    expect(panel.aggregate.summary.requiredSlots).toBe(22);
    expect(panel.aggregate.summary.requiredSlotsSatisfied).toBe(20);
    expect(panel.aggregate.summary.sectionRecallTotal).toBe(76);
    expect(panel.aggregate.summary.sectionRecallHits).toBe(74);
    expect(panel.aggregate.summary.searchedScopeTotal).toBe(15);
    expect(panel.aggregate.summary.abstentionTotal).toBe(9);
    expect(panel.aggregate.summary.citationValidityTotal).toBe(63);
    expect(panel.aggregate.summary.citationAuthorityTotal).toBe(72);
    expect(panel.aggregate.summary.computedAccuracyTotal).toBe(3);
    expect(panel.aggregate.summary.computedGroundingHits).toBe(2);
    expect(panel.aggregate.summary.computedGroundingTotal).toBe(3);
    expect(panel.aggregate.summary.judgmentAccuracyTotal).toBe(1);
    expect(panel.aggregate.summary.reviewExplanationTotal).toBe(9);
    expect(panel.aggregate.summary.decoyRejectedCitationTotal).toBe(5);
  });

  it("supports split filtering for public hybrid workflows", async () => {
    const panel = await runDocumentWorkflowHybridPanel([
      "node",
      "document-workflow-hybrid-panel",
      "--split=stress",
    ]);

    expect(panel.splitFilter).toBe("stress");
    expect(panel.fixtureReports).toHaveLength(2);
    expect(panel.aggregate.summary.workflows).toBe(5);
    expect(panel.aggregate.summary.fields).toBe(46);
    expect(panel.aggregate.summary.abstentionTotal).toBe(7);
    expect(panel.aggregate.summary.computedAccuracyTotal).toBe(3);
    expect(panel.aggregate.summary.computedGroundingHits).toBe(2);
    expect(panel.aggregate.summary.computedGroundingTotal).toBe(3);
  });
});
