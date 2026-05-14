import {
  renderPairedCodeLaneComparison,
  runPairedCodeLaneComparisonForRepo,
  type PairedCodeLaneComparison,
} from "./code-lane-comparison.js";
import type { CodeLaneValidationRepo } from "./code-lane-validation-repos.js";

export type CrossRepoCodeLaneComparisonRepoResult = {
  repo: Pick<
    CodeLaneValidationRepo,
    "id" | "name" | "repoRoot" | "minimumTaskPanel"
  >;
  comparison: PairedCodeLaneComparison;
};

export type CrossRepoCodeLaneComparisonReport = {
  budgetTokensOverride?: number;
  repos: CrossRepoCodeLaneComparisonRepoResult[];
};

export type CrossRepoCodeLaneComparisonOptions = {
  repos: ReadonlyArray<
    Pick<
      CodeLaneValidationRepo,
      "id" | "name" | "repoRoot" | "minimumTaskPanel" | "agentCompletionCases"
    >
  >;
  budgetTokensOverride?: number;
  runComparison?: (
    repo: CrossRepoCodeLaneComparisonOptions["repos"][number],
    options: { budgetTokensOverride?: number },
  ) => Promise<PairedCodeLaneComparison>;
};

export async function runCrossRepoCodeLaneComparison(
  options: CrossRepoCodeLaneComparisonOptions,
): Promise<CrossRepoCodeLaneComparisonReport> {
  const runComparison =
    options.runComparison ??
    ((repo, comparisonOptions) =>
      runPairedCodeLaneComparisonForRepo({
        repoRoot: repo.repoRoot,
        cases: repo.agentCompletionCases,
        budgetTokensOverride: comparisonOptions.budgetTokensOverride,
      }));

  const repos: CrossRepoCodeLaneComparisonRepoResult[] = [];
  for (const repo of options.repos) {
    repos.push({
      repo: {
        id: repo.id,
        name: repo.name,
        repoRoot: repo.repoRoot,
        minimumTaskPanel: repo.minimumTaskPanel,
      },
      comparison: await runComparison(repo, {
        budgetTokensOverride: options.budgetTokensOverride,
      }),
    });
  }

  return {
    budgetTokensOverride: options.budgetTokensOverride,
    repos,
  };
}

export function renderCrossRepoCodeLaneComparison(
  report: CrossRepoCodeLaneComparisonReport,
): string {
  const lines: string[] = [];
  lines.push("========== CROSS-REPO CODE-LANE COMPARISON ==========");
  lines.push(
    report.budgetTokensOverride === undefined
      ? "Same default budget across every repo section."
      : `Same budget across every repo section: ${report.budgetTokensOverride}`,
  );
  for (const entry of report.repos) {
    lines.push("");
    lines.push(`Repo: ${entry.repo.name}`);
    lines.push(`root: ${entry.repo.repoRoot}`);
    lines.push(`task panel: ${entry.repo.minimumTaskPanel.join(", ")}`);
    lines.push(renderPairedCodeLaneComparison(entry.comparison).trimEnd());
  }
  return `${lines.join("\n")}\n`;
}
