#!/usr/bin/env node
import {
  PRIMARY_CODE_LANE_VALIDATION_REPO,
  RALPH_CODE_LANE_VALIDATION_REPO,
  type CodeLaneValidationRepo,
} from "./code-lane-validation-repos.js";
import {
  renderExpandedPromptPanelReport,
  runExpandedPromptPanelEval,
  type ExpandedPromptPanelSummary,
} from "./code-lane-expanded-prompt-panel.js";
import {
  wilsonLowerBound,
  type OssCodeLaneGeneralizationMetric,
} from "./oss-code-lane-generalization.js";

export type CrossRepoExpandedPromptReadinessPolicy = {
  confidence: number;
  minRepos: number;
  minCases: number;
  minPromptVariants: number;
};

export type CrossRepoExpandedPromptRepoSummary = {
  repo: Pick<CodeLaneValidationRepo, "id" | "name" | "repoRoot" | "minimumTaskPanel">;
  caseCount: number;
  summary: ExpandedPromptPanelSummary;
};

export type CrossRepoExpandedPromptPanelSummary = {
  policy: CrossRepoExpandedPromptReadinessPolicy;
  repoCount: number;
  caseCount: number;
  basePromptCount: number;
  expandedPromptCount: number;
  promptTop3: OssCodeLaneGeneralizationMetric;
  promptRanked: OssCodeLaneGeneralizationMetric;
  ticketsTop3Robust: OssCodeLaneGeneralizationMetric;
  failedBreadthGates: Array<"repo_count" | "case_count" | "prompt_variant_count">;
  repos: CrossRepoExpandedPromptRepoSummary[];
};

export type RunCrossRepoExpandedPromptPanelOptions = {
  repos?: readonly CodeLaneValidationRepo[];
  targetPromptVariantsPerCase?: number;
  policy?: Partial<CrossRepoExpandedPromptReadinessPolicy>;
};

const DEFAULT_POLICY: CrossRepoExpandedPromptReadinessPolicy = {
  confidence: 0.99,
  minRepos: 30,
  minCases: 600,
  minPromptVariants: 2000,
};

export async function runCrossRepoExpandedPromptPanel(
  options: RunCrossRepoExpandedPromptPanelOptions = {},
): Promise<CrossRepoExpandedPromptPanelSummary> {
  const policy = { ...DEFAULT_POLICY, ...options.policy };
  const repos = options.repos ?? defaultValidationRepos(process.cwd());
  const repoSummaries: CrossRepoExpandedPromptRepoSummary[] = [];
  for (const repo of repos) {
    repoSummaries.push({
      repo: {
        id: repo.id,
        name: repo.name,
        repoRoot: repo.repoRoot,
        minimumTaskPanel: repo.minimumTaskPanel,
      },
      caseCount: repo.agentCompletionCases.length,
      summary: await runExpandedPromptPanelEval({
        repoRoot: repo.repoRoot,
        cases: repo.agentCompletionCases,
        targetPromptVariantsPerCase: options.targetPromptVariantsPerCase,
        confidence: policy.confidence,
      }),
    });
  }
  return summarizeCrossRepoExpandedPromptPanel({
    repos: repoSummaries,
    policy,
  });
}

export function summarizeCrossRepoExpandedPromptPanel(args: {
  repos: readonly CrossRepoExpandedPromptRepoSummary[];
  policy?: CrossRepoExpandedPromptReadinessPolicy;
}): CrossRepoExpandedPromptPanelSummary {
  const policy = args.policy ?? DEFAULT_POLICY;
  const repoCount = args.repos.length;
  const caseCount = args.repos.reduce((sum, repo) => sum + repo.caseCount, 0);
  const basePromptCount = args.repos.reduce(
    (sum, repo) => sum + repo.summary.basePromptCount,
    0,
  );
  const expandedPromptCount = args.repos.reduce(
    (sum, repo) => sum + repo.summary.expandedPromptCount,
    0,
  );
  const promptTop3 = sumMetric(
    args.repos.map((repo) => repo.summary.promptTop3),
    policy.confidence,
  );
  const promptRanked = sumMetric(
    args.repos.map((repo) => repo.summary.promptRanked),
    policy.confidence,
  );
  const ticketsTop3Robust = sumMetric(
    args.repos.map((repo) => repo.summary.ticketsTop3Robust),
    policy.confidence,
  );
  const failedBreadthGates: CrossRepoExpandedPromptPanelSummary["failedBreadthGates"] = [];
  if (repoCount < policy.minRepos) failedBreadthGates.push("repo_count");
  if (caseCount < policy.minCases) failedBreadthGates.push("case_count");
  if (expandedPromptCount < policy.minPromptVariants) {
    failedBreadthGates.push("prompt_variant_count");
  }

  return {
    policy,
    repoCount,
    caseCount,
    basePromptCount,
    expandedPromptCount,
    promptTop3,
    promptRanked,
    ticketsTop3Robust,
    failedBreadthGates,
    repos: [...args.repos],
  };
}

export function renderCrossRepoExpandedPromptPanelReport(
  summary: CrossRepoExpandedPromptPanelSummary,
): string {
  const lines = [
    "========== CROSS-REPO EXPANDED CODE-LANE PROMPT PANEL ==========",
    `Breadth: ${summary.repoCount} repos, ${summary.caseCount} cases, ${summary.expandedPromptCount} prompt variants`,
    `Breadth gates: ${summary.failedBreadthGates.length === 0 ? "PASS" : `FAIL (${summary.failedBreadthGates.join(", ")})`}`,
    `Required for OSS confidence: >=${summary.policy.minRepos} repos, >=${summary.policy.minCases} cases, >=${summary.policy.minPromptVariants} prompt variants`,
    "",
    "Aggregate metrics:",
    `  prompt top-3 useful: ${renderMetric(summary.promptTop3, summary.policy.confidence)}`,
    `  prompt ranked useful: ${renderMetric(summary.promptRanked, summary.policy.confidence)}`,
    `  tickets top-3 robust: ${renderMetric(summary.ticketsTop3Robust, summary.policy.confidence)}`,
    "",
    "Repos:",
  ];
  for (const repo of summary.repos) {
    lines.push(`  ${repo.repo.name} (${repo.repo.id})`);
    lines.push(`    root: ${repo.repo.repoRoot}`);
    lines.push(
      `    prompts: ${repo.summary.expandedPromptCount}, top3=${renderMetric(
        repo.summary.promptTop3,
        summary.policy.confidence,
      )}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function defaultValidationRepos(repoRoot: string): CodeLaneValidationRepo[] {
  return [
    {
      ...PRIMARY_CODE_LANE_VALIDATION_REPO,
      repoRoot,
    },
    RALPH_CODE_LANE_VALIDATION_REPO,
  ];
}

function sumMetric(
  metrics: readonly OssCodeLaneGeneralizationMetric[],
  confidence: number,
): OssCodeLaneGeneralizationMetric {
  const hits = metrics.reduce((sum, metric) => sum + metric.hits, 0);
  const total = metrics.reduce((sum, metric) => sum + metric.total, 0);
  return {
    hits,
    total,
    rate: total === 0 ? 0 : hits / total,
    lowerConfidenceBound: wilsonLowerBound(hits, total, confidence),
  };
}

function renderMetric(
  metric: OssCodeLaneGeneralizationMetric,
  confidence: number,
): string {
  return `${metric.hits}/${metric.total} (${formatRate(
    metric.rate,
  )}, lower${pct(confidence)}=${formatRate(metric.lowerConfidenceBound)})`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const summary = await runCrossRepoExpandedPromptPanel();
  process.stdout.write(renderCrossRepoExpandedPromptPanelReport(summary));
  process.stdout.write("\n");
  for (const repo of summary.repos) {
    process.stdout.write(renderExpandedPromptPanelReport(repo.summary));
  }
}

if (
  process.argv[1]?.endsWith("cross-repo-expanded-prompt-panel.js") ||
  process.argv[1]?.endsWith("cross-repo-expanded-prompt-panel.ts")
) {
  void main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
