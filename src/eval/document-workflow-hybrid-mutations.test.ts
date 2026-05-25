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
    expect(panel.mutations[0]?.aggregate.summary.fields).toBe(85);
    expect(panel.mutations[0]?.aggregate.summary.sectionRecallTotal).toBe(109);
    expect(panel.mutations[0]?.aggregate.summary.abstentionTotal).toBe(9);
    expect(panel.mutations[0]?.aggregate.summary.citationAuthorityTotal).toBe(85);
    expect(panel.mutations[0]?.aggregate.summary.searchedScopeTotal).toBe(15);
    expect(panel.mutations[0]?.aggregate.summary.computedAccuracyTotal).toBe(8);
    expect(panel.mutations[0]?.aggregate.summary.computedGroundingTotal).toBe(8);
    expect(panel.mutations[0]?.aggregate.summary.judgmentAccuracyTotal).toBe(9);
    expect(panel.mutations[0]?.aggregate.summary.judgmentGroundingTotal).toBe(9);
  });

  it("adds corpus noise for the public hybrid fixture", async () => {
    const panel = await runDocumentWorkflowHybridMutations([
      "node",
      "document-workflow-hybrid-mutations",
      "--mutation=corpus_noise",
    ]);

    const mutation = panel.mutations[0];
    expect(mutation?.aggregate.importedSources).toBe(24);
    expect(mutation?.aggregate.summary.slotEvidenceTotal).toBe(109);
    expect(mutation?.aggregate.summary.fieldAccuracyTotal).toBe(76);
    expect(mutation?.aggregate.summary.computedGroundingHits).toBe(8);
    expect(mutation?.aggregate.summary.computedGroundingTotal).toBe(8);
    expect(mutation?.aggregate.summary.judgmentGroundingHits).toBe(9);
    expect(mutation?.aggregate.summary.judgmentGroundingTotal).toBe(9);
  });
});
