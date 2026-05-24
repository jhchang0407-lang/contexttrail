import { describe, expect, it } from "vitest";
import { runDocumentWorkflowPanel } from "./document-workflow-panel.js";

describe("document workflow panel runner", () => {
  it("aggregates the full document-workflow panel", async () => {
    const panel = await runDocumentWorkflowPanel(["node", "document-workflow-panel"]);

    expect(panel.panelName).toBe("document_workflow_panel");
    expect(panel.fixtureReports).toHaveLength(6);
    expect(panel.aggregate.fixtureName).toBe("document_workflow_panel");
    expect(panel.aggregate.importedSources).toBe(64);
    expect(panel.aggregate.summary.workflows).toBe(30);
    expect(panel.aggregate.summary.fields).toBe(208);
    expect(panel.aggregate.summary.byArchetype.employee_lifecycle_operations?.total).toBe(10);
    expect(panel.aggregate.summary.byArchetype.vendor_onboarding_compliance?.total).toBe(12);
  });

  it("skips fixtures without a matching split for split-only panels", async () => {
    const panel = await runDocumentWorkflowPanel(["node", "document-workflow-panel", "--split=holdout"]);

    expect(panel.splitFilter).toBe("holdout");
    expect(panel.fixtureReports.map((report) => report.fixtureName)).toEqual([
      "insurance_claim_document_workflows",
      "contract_policy_review_workflows",
      "numeric_reconciliation_workflows",
      "relationship_history_workflows",
      "employee_operations_workflows",
      "vendor_onboarding_compliance_workflows",
    ]);
    expect(panel.aggregate.summary.workflows).toBe(6);
    expect(panel.aggregate.summary.bySplit.holdout?.total).toBe(21);
  });
});
