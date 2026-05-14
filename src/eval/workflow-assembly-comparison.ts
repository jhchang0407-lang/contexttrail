import { runRealWorkflowEval, type RealWorkflowReport } from "./real-workflow-probe.js";
import { withCodeSourceIndexOverride } from "./agent-completion-probe.js";

export type PairedWorkflowAssemblyComparison = {
  budgetTokensOverride?: number;
  workflowServed: {
    old: { served: number; total: number };
    new: { served: number; total: number };
  };
  workflowChunks: {
    old: { covered: number; total: number };
    new: { covered: number; total: number };
  };
  oldReport: RealWorkflowReport;
  newReport: RealWorkflowReport;
};

export type PairedWorkflowAssemblyComparisonOptions = {
  budgetTokensOverride?: number;
  runEval?: (options: {
    budgetTokens?: number;
    codeSourceIndexEnabled?: boolean;
  }) => Promise<RealWorkflowReport>;
};

export function comparePairedWorkflowAssemblyReports(args: {
  oldReport: RealWorkflowReport;
  newReport: RealWorkflowReport;
  budgetTokensOverride?: number;
}): PairedWorkflowAssemblyComparison {
  return {
    budgetTokensOverride: args.budgetTokensOverride,
    workflowServed: {
      old: {
        served: args.oldReport.summary.ticketsServedTraversed,
        total: args.oldReport.summary.tickets,
      },
      new: {
        served: args.newReport.summary.ticketsServedTraversed,
        total: args.newReport.summary.tickets,
      },
    },
    workflowChunks: {
      old: {
        covered: args.oldReport.summary.chunkTraversedHits,
        total: args.oldReport.summary.chunkTotal,
      },
      new: {
        covered: args.newReport.summary.chunkTraversedHits,
        total: args.newReport.summary.chunkTotal,
      },
    },
    oldReport: args.oldReport,
    newReport: args.newReport,
  };
}

export async function runPairedWorkflowAssemblyComparison(
  options: PairedWorkflowAssemblyComparisonOptions = {},
): Promise<PairedWorkflowAssemblyComparison> {
  const runEval =
    options.runEval ??
    (async (evalOptions: {
      budgetTokens?: number;
      codeSourceIndexEnabled?: boolean;
    }) =>
      withCodeSourceIndexOverride(evalOptions.codeSourceIndexEnabled, () =>
        runRealWorkflowEval({ budgetTokens: evalOptions.budgetTokens }),
      ));

  const oldReport = await runEval({
    budgetTokens: options.budgetTokensOverride,
    codeSourceIndexEnabled: false,
  });
  const newReport = await runEval({
    budgetTokens: options.budgetTokensOverride,
    codeSourceIndexEnabled: true,
  });
  return comparePairedWorkflowAssemblyReports({
    oldReport,
    newReport,
    budgetTokensOverride: options.budgetTokensOverride,
  });
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function renderPairedWorkflowAssemblyComparison(
  comparison: PairedWorkflowAssemblyComparison,
): string {
  const lines: string[] = [];
  lines.push("========== PAIRED WORKFLOW-ASSEMBLY COMPARISON ==========");
  lines.push(
    comparison.budgetTokensOverride === undefined
      ? "Same workflow fixture, default budget, old file-card path vs new chunk-first code lane."
      : `Same workflow fixture, budget ${comparison.budgetTokensOverride}, old file-card path vs new chunk-first code lane.`,
  );
  lines.push("");
  lines.push("Summary:");
  lines.push(
    `  Tickets fully served     Old (file-card): ${comparison.workflowServed.old.served}/${comparison.workflowServed.old.total} (${pct(comparison.workflowServed.old.served, comparison.workflowServed.old.total)})`,
  );
  lines.push(
    `                            New (chunk-first): ${comparison.workflowServed.new.served}/${comparison.workflowServed.new.total} (${pct(comparison.workflowServed.new.served, comparison.workflowServed.new.total)})`,
  );
  lines.push(
    `  Required chunks         Old (file-card): ${comparison.workflowChunks.old.covered}/${comparison.workflowChunks.old.total} (${pct(comparison.workflowChunks.old.covered, comparison.workflowChunks.old.total)})`,
  );
  lines.push(
    `                            New (chunk-first): ${comparison.workflowChunks.new.covered}/${comparison.workflowChunks.new.total} (${pct(comparison.workflowChunks.new.covered, comparison.workflowChunks.new.total)})`,
  );
  return `${lines.join("\n")}\n`;
}
