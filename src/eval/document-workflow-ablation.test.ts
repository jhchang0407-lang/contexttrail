import { describe, expect, it } from "vitest";
import {
  renderDocumentWorkflowAblationPanel,
  runDocumentWorkflowAblationPanel,
} from "./document-workflow-ablation.js";
import { DOCUMENT_WORKFLOW_ABLATION_VARIANTS } from "./document-workflow-probe.js";

describe("document workflow ablation runner", () => {
  it("scores context-pack sufficiency variants for a fixture", async () => {
    const panel = await runDocumentWorkflowAblationPanel([
      "node",
      "document-workflow-ablation",
      "--fixture=tests/fixtures/document-workflows/insurance-claim/workflows.yaml",
    ]);

    expect(panel.panelName).toBe("document_workflow_ablation_panel");
    expect(panel.fixtureReports).toHaveLength(1);
    expect(panel.ablations.map((ablation) => ablation.variant)).toEqual([...DOCUMENT_WORKFLOW_ABLATION_VARIANTS]);
    expect(panel.aggregate.summary.retrievedTokenTotal).toBeGreaterThan(0);

    const strictRequired = panel.ablations.find((ablation) => ablation.variant === "strict_required");
    expect(strictRequired).toBeDefined();
    expect(strictRequired!.retrievedTokens).toBeLessThan(panel.aggregate.summary.retrievedTokenTotal);
    expect(strictRequired!.tokenReductionPct).toBeGreaterThan(0);
    expect(panel.ablations.some((ablation) => ablation.passedBaselineQuality)).toBe(true);

    const rendered = renderDocumentWorkflowAblationPanel(panel);
    expect(rendered).toContain("Document workflow ablation eval");
    expect(rendered).toContain("strict_required");
    expect(rendered).toContain("Smallest passing variant");
    expect(rendered).toContain("Quality losses");
  });
});
