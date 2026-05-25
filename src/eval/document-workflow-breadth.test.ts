import { describe, expect, it } from "vitest";
import { assessDocumentWorkflowBreadth } from "./document-workflow-breadth.js";
import { runDocumentWorkflowHybridPanel } from "./document-workflow-hybrid-panel.js";
import { runDocumentWorkflowRobustPanel } from "./document-workflow-robust-panel.js";

describe("document workflow breadth confidence", () => {
  it("keeps the public hybrid lane exploratory because it is intentionally small", async () => {
    const panel = await runDocumentWorkflowHybridPanel(["node", "document-workflow-hybrid-panel"]);
    const breadth = assessDocumentWorkflowBreadth(panel.aggregate);

    expect(breadth.level).toBe("exploratory");
    expect(breadth.passed).toBe(false);
    expect(breadth.failedGates.map((gate) => gate.id)).toContain("minWorkflows");
    expect(breadth.failedGates.map((gate) => gate.id)).toContain("minFields");
  });

  it("marks the combined robust panel as the promotion candidate surface", async () => {
    const panel = await runDocumentWorkflowRobustPanel(["node", "document-workflow-robust-panel"]);

    expect(panel.breadth.level).toBe("promotion_candidate");
    expect(panel.breadth.passed).toBe(true);
    expect(panel.breadth.failedGates).toEqual([]);
  });
});
