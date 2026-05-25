import { describe, expect, it } from "vitest";
import { runDocumentWorkflowHybridPanel } from "./document-workflow-hybrid-panel.js";

describe("document workflow public hybrid panel runner", () => {
  it("runs generated workflows against public source documents", async () => {
    const panel = await runDocumentWorkflowHybridPanel(["node", "document-workflow-hybrid-panel"]);

    expect(panel.panelName).toBe("document_workflow_hybrid_panel");
    expect(panel.fixtureReports).toHaveLength(1);
    expect(panel.aggregate.fixtureName).toBe("document_workflow_hybrid_panel");
    expect(panel.aggregate.importedSources).toBe(4);
    expect(panel.aggregate.summary.workflows).toBe(3);
    expect(panel.aggregate.summary.fields).toBe(26);
    expect(panel.aggregate.summary.requiredSlots).toBe(8);
    expect(panel.aggregate.summary.sectionRecallTotal).toBe(26);
    expect(panel.aggregate.summary.sectionRecallHits).toBeGreaterThan(0);
  });

  it("supports split filtering for public hybrid workflows", async () => {
    const panel = await runDocumentWorkflowHybridPanel([
      "node",
      "document-workflow-hybrid-panel",
      "--split=stress",
    ]);

    expect(panel.splitFilter).toBe("stress");
    expect(panel.fixtureReports).toHaveLength(1);
    expect(panel.aggregate.summary.workflows).toBe(1);
    expect(panel.aggregate.summary.fields).toBe(10);
  });
});
