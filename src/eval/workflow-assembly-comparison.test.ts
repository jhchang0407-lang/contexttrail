import { describe, expect, it } from "vitest";
import {
  comparePairedWorkflowAssemblyReports,
  renderPairedWorkflowAssemblyComparison,
  runPairedWorkflowAssemblyComparison,
} from "./workflow-assembly-comparison.js";
import type { RealWorkflowReport } from "./real-workflow-probe.js";

function makeWorkflowReport(
  lane: "old" | "new",
): RealWorkflowReport {
  const old = lane === "old";
  return {
    repoRoot: "/repo",
    fixturePath: "/repo/tests/fixtures/real-workflows.yaml",
    summary: {
      tickets: 23,
      totalQueries: 46,
      topK: 5,
      linkHops: 2,
      importedSources: 19,
      primaryRawHits: old ? 20 : 21,
      primaryTraversedHits: old ? 22 : 22,
      primaryTotal: 23,
      supportRawHits: old ? 19 : 20,
      supportTraversedHits: old ? 22 : 23,
      supportTotal: 23,
      chunkRawHits: old ? 18 : 20,
      chunkTraversedHits: old ? 21 : 22,
      chunkTotal: 22,
      ticketsServedRaw: old ? 20 : 21,
      ticketsServedTraversed: old ? 21 : 22,
      avgRawSources: old ? 2.1 : 2.2,
      avgLinkPulledSources: old ? 0.7 : 0.8,
    },
    cases: [],
  };
}

describe("comparePairedWorkflowAssemblyReports", () => {
  it("preserves old-vs-new workflow totals side by side", () => {
    const comparison = comparePairedWorkflowAssemblyReports({
      oldReport: makeWorkflowReport("old"),
      newReport: makeWorkflowReport("new"),
      budgetTokensOverride: 8192,
    });

    expect(comparison.budgetTokensOverride).toBe(8192);
    expect(comparison.workflowServed.old).toEqual({ served: 21, total: 23 });
    expect(comparison.workflowServed.new).toEqual({ served: 22, total: 23 });
    expect(comparison.workflowChunks.old).toEqual({ covered: 21, total: 22 });
    expect(comparison.workflowChunks.new).toEqual({ covered: 22, total: 22 });
  });
});

describe("runPairedWorkflowAssemblyComparison", () => {
  it("runs the same workflow fixture with code lane off then on", async () => {
    const calls: Array<{ budgetTokens?: number; codeSourceIndexEnabled?: boolean }> = [];

    const comparison = await runPairedWorkflowAssemblyComparison({
      budgetTokensOverride: 4096,
      runEval: async (options) => {
        calls.push(options);
        return options.codeSourceIndexEnabled
          ? makeWorkflowReport("new")
          : makeWorkflowReport("old");
      },
    });

    expect(calls).toEqual([
      { budgetTokens: 4096, codeSourceIndexEnabled: false },
      { budgetTokens: 4096, codeSourceIndexEnabled: true },
    ]);
    expect(comparison.workflowServed.new.served).toBe(22);
  });
});

describe("renderPairedWorkflowAssemblyComparison", () => {
  it("renders a side-by-side workflow no-regression section", () => {
    const rendered = renderPairedWorkflowAssemblyComparison(
      comparePairedWorkflowAssemblyReports({
        oldReport: makeWorkflowReport("old"),
        newReport: makeWorkflowReport("new"),
      }),
    );

    expect(rendered).toContain("PAIRED WORKFLOW-ASSEMBLY COMPARISON");
    expect(rendered).toContain("Tickets fully served");
    expect(rendered).toContain("Required chunks");
    expect(rendered).toContain("Old (file-card)");
    expect(rendered).toContain("New (chunk-first)");
  });
});
