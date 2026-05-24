import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  applyDocumentWorkflowMutation,
  runDocumentWorkflowMutations,
} from "./document-workflow-mutations.js";
import { loadDocumentWorkflowFixture } from "./document-workflow-probe.js";

describe("document workflow mutation runner", () => {
  it("can replace slot-authored queries with broad task wording", () => {
    const fixture = loadDocumentWorkflowFixture(
      join(process.cwd(), "tests/fixtures/document-workflows/insurance-claim/workflows.yaml"),
    );

    const mutated = applyDocumentWorkflowMutation(fixture, "broad_task_queries");
    const workflow = mutated.workflows.find((row) => row.id === "ale_payment_hold_review")!;
    const slot = workflow.slots.find((row) => row.id === "ale_documentation_rule")!;

    expect(slot.queries[0]).toContain(workflow.prompt);
    expect(slot.queries[0]).toContain(slot.purpose);
    expect(slot.queries[1]).toBe(workflow.task_variants[0]);
  });

  it("runs a holdout mutation panel", async () => {
    const panel = await runDocumentWorkflowMutations([
      "node",
      "document-workflow-mutations",
      "--mutation=minimal_task_queries",
      "--split=holdout",
    ]);

    expect(panel.panelName).toBe("document_workflow_mutation_panel");
    expect(panel.mutations).toHaveLength(1);
    expect(panel.mutations[0]?.mutation).toBe("minimal_task_queries");
    expect(panel.mutations[0]?.aggregate.summary.workflows).toBe(6);
    expect(panel.mutations[0]?.aggregate.summary.bySplit.holdout?.total).toBe(21);
  });
});
