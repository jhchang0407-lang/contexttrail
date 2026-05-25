import { describe, expect, it } from "vitest";
import { runDocumentWorkflowHybridMutations } from "./document-workflow-hybrid-mutations.js";

describe("document workflow public hybrid mutation runner", () => {
  it("runs minimal-query pressure with output and abstention scoring enabled", async () => {
    const panel = await runDocumentWorkflowHybridMutations([
      "node",
      "document-workflow-hybrid-mutations",
      "--mutation=minimal_task_queries",
    ]);

    expect(panel.panelName).toBe("document_workflow_hybrid_mutation_panel");
    expect(panel.mutations).toHaveLength(1);
    expect(panel.mutations[0]?.mutation).toBe("minimal_task_queries");
    expect(panel.mutations[0]?.aggregate.summary.workflows).toBe(8);
    expect(panel.mutations[0]?.aggregate.summary.fields).toBe(72);
    expect(panel.mutations[0]?.aggregate.summary.sectionRecallTotal).toBe(76);
    expect(panel.mutations[0]?.aggregate.summary.abstentionTotal).toBe(9);
    expect(panel.mutations[0]?.aggregate.summary.citationAuthorityTotal).toBe(72);
    expect(panel.mutations[0]?.aggregate.summary.searchedScopeTotal).toBe(15);
    expect(panel.mutations[0]?.aggregate.summary.computedAccuracyTotal).toBe(3);
    expect(panel.mutations[0]?.aggregate.summary.computedGroundingTotal).toBe(3);
  });

  it("adds corpus noise for the public hybrid fixture", async () => {
    const panel = await runDocumentWorkflowHybridMutations([
      "node",
      "document-workflow-hybrid-mutations",
      "--mutation=corpus_noise",
    ]);

    const mutation = panel.mutations[0];
    expect(mutation?.aggregate.importedSources).toBe(24);
    expect(mutation?.aggregate.summary.slotEvidenceTotal).toBe(76);
    expect(mutation?.aggregate.summary.fieldAccuracyTotal).toBe(63);
    expect(mutation?.aggregate.summary.computedGroundingHits).toBe(2);
    expect(mutation?.aggregate.summary.computedGroundingTotal).toBe(3);
  });
});
