import { describe, expect, it } from "vitest";
import { runDocumentWorkflowRobustMutations } from "./document-workflow-robust-mutations.js";
import { DOCUMENT_WORKFLOW_ROBUST_FIXTURES } from "./document-workflow-robust-panel.js";

describe("document workflow robust mutation runner", () => {
  it("runs minimal-query pressure across the combined promotion surface", async () => {
    const panel = await runDocumentWorkflowRobustMutations([
      "node",
      "document-workflow-robust-mutations",
      "--mutation=minimal_task_queries",
    ]);

    expect(panel.panelName).toBe("document_workflow_robust_mutation_panel");
    expect(panel.mutations).toHaveLength(1);
    expect(panel.mutations[0]?.mutation).toBe("minimal_task_queries");
    expect(panel.mutations[0]?.fixtureReports).toHaveLength(DOCUMENT_WORKFLOW_ROBUST_FIXTURES.length);
    expect(panel.mutations[0]?.aggregate.summary.workflows).toBeGreaterThanOrEqual(50);
    expect(panel.mutations[0]?.aggregate.summary.sectionRecallTotal).toBeGreaterThanOrEqual(390);
    expect(panel.mutations[0]?.aggregate.summary.citationAuthorityTotal).toBeGreaterThanOrEqual(380);
    expect(panel.mutations[0]?.breadth.passed).toBe(true);
  });

  it("adds generated corpus noise across every robust fixture", async () => {
    const panel = await runDocumentWorkflowRobustMutations([
      "node",
      "document-workflow-robust-mutations",
      "--mutation=corpus_noise",
    ]);

    const mutation = panel.mutations[0];
    expect(mutation?.aggregate.importedSources).toBeGreaterThanOrEqual(120);
    expect(mutation?.aggregate.summary.slotEvidenceTotal).toBeGreaterThanOrEqual(390);
    expect(mutation?.aggregate.summary.fieldAccuracyTotal).toBeGreaterThanOrEqual(330);
    expect(mutation?.aggregate.summary.overBudgetSlots).toBeLessThanOrEqual(49);
    expect(mutation?.aggregate.summary.generatedNoiseTokenTotal).toBeGreaterThan(0);
    expect(mutation?.aggregate.summary.excludedOrStaleTokenTotal).toBeGreaterThan(0);
    expect(mutation?.breadth.passed).toBe(true);
  });
});
