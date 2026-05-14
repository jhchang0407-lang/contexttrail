#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRIMARY_CODE_LANE_VALIDATION_REPO,
  RALPH_CODE_LANE_VALIDATION_REPO,
} from "./code-lane-validation-repos.js";
import {
  renderCrossRepoCodeLaneComparison,
  runCrossRepoCodeLaneComparison,
} from "./cross-repo-code-lane-comparison.js";
import type { PairedCodeLaneComparison } from "./code-lane-comparison.js";
import type { AgentTaskSuccessVerdict } from "./task-success.js";
import { runPrimaryTaskSuccessEval } from "./task-success-eval.js";
import {
  renderPairedWorkflowAssemblyComparison,
  runPairedWorkflowAssemblyComparison,
  type PairedWorkflowAssemblyComparison,
} from "./workflow-assembly-comparison.js";

export const PRD0042_PROMOTION_GATE_NAMES = [
  "primary_file_coverage_floor",
  "primary_code_chunk_usefulness_non_regression",
  "cross_repo_validation_present",
  "workflow_assembly_no_regression",
  "downstream_task_success_measured",
  "downstream_task_success_non_regression",
  "token_accounting_and_pack_honesty",
] as const;

export type Prd0042PromotionGateName =
  (typeof PRD0042_PROMOTION_GATE_NAMES)[number];

export type Prd0042PromotionGateResult = {
  name: Prd0042PromotionGateName;
  pass: boolean;
  baseline: string;
  current: string;
  detail: string;
};

export type Prd0042PromotionRecommendation =
  | "keep_shadow_mode"
  | "eligible_for_human_review";

export type Prd0042PromotionVerdict = {
  pass: boolean;
  failed_gates: Prd0042PromotionGateName[];
  gates: Prd0042PromotionGateResult[];
  recommendation: Prd0042PromotionRecommendation;
  evidence: {
    primaryCodeLane: PairedCodeLaneComparison;
    crossRepoRepoCount: number;
    workflowAssembly?: PairedWorkflowAssemblyComparison;
    downstreamTaskSuccess?: {
      oldVerdicts: AgentTaskSuccessVerdict[];
      newVerdicts: AgentTaskSuccessVerdict[];
    };
    honesty?: {
      coverageConfidenceHonest: boolean;
      packReadinessHonest: boolean;
      queryModeHonest: boolean;
    };
  };
};

export type EvaluatePrd0042PromotionVerdictArgs = {
  primaryCodeLane: PairedCodeLaneComparison;
  crossRepoRepoCount: number;
  workflowAssembly?: PairedWorkflowAssemblyComparison;
  downstreamTaskSuccess?: {
    oldVerdicts: AgentTaskSuccessVerdict[];
    newVerdicts: AgentTaskSuccessVerdict[];
  };
  honesty?: {
    coverageConfidenceHonest: boolean;
    packReadinessHonest: boolean;
    queryModeHonest: boolean;
  };
};

function summarizeTaskSuccess(verdicts: AgentTaskSuccessVerdict[]) {
  return {
    cases: verdicts.length,
    reachedRightFiles: verdicts.filter((verdict) => verdict.reachedRightFiles)
      .length,
    acceptableChange: verdicts.filter((verdict) => verdict.acceptableChange)
      .length,
  };
}

function fileCoverageRate(args: {
  mentioned: number;
  total: number;
}): number {
  if (args.total <= 0) return 0;
  return args.mentioned / args.total;
}

export function evaluatePrd0042PromotionVerdict(
  args: EvaluatePrd0042PromotionVerdictArgs,
): Prd0042PromotionVerdict {
  const gates: Prd0042PromotionGateResult[] = [];

  const primaryFileCoveragePass =
    fileCoverageRate(args.primaryCodeLane.fileCoverage.new) >=
    fileCoverageRate(args.primaryCodeLane.fileCoverage.old);
  gates.push({
    name: "primary_file_coverage_floor",
    pass: primaryFileCoveragePass,
    baseline: `${args.primaryCodeLane.fileCoverage.old.mentioned}/${args.primaryCodeLane.fileCoverage.old.total}`,
    current: `${args.primaryCodeLane.fileCoverage.new.mentioned}/${args.primaryCodeLane.fileCoverage.new.total}`,
    detail:
      "new lane must not regress primary file coverage on the paired validation panel",
  });

  const chunkUsefulnessPass =
    args.primaryCodeLane.codeTop1.new.hits >=
      args.primaryCodeLane.codeTop1.old.hits &&
    args.primaryCodeLane.codeRankedUseful.new.hits >=
      args.primaryCodeLane.codeRankedUseful.old.hits;
  gates.push({
    name: "primary_code_chunk_usefulness_non_regression",
    pass: chunkUsefulnessPass,
    baseline: `top1 ${args.primaryCodeLane.codeTop1.old.hits}/${args.primaryCodeLane.codeTop1.old.total}; ranked ${args.primaryCodeLane.codeRankedUseful.old.hits}/${args.primaryCodeLane.codeRankedUseful.old.total}`,
    current: `top1 ${args.primaryCodeLane.codeTop1.new.hits}/${args.primaryCodeLane.codeTop1.new.total}; ranked ${args.primaryCodeLane.codeRankedUseful.new.hits}/${args.primaryCodeLane.codeRankedUseful.new.total}`,
    detail:
      "new lane must not regress chunk usefulness on the primary paired panel",
  });

  gates.push({
    name: "cross_repo_validation_present",
    pass: args.crossRepoRepoCount >= 2,
    baseline: ">=2 repos",
    current: `${args.crossRepoRepoCount} repos`,
    detail:
      "promotion requires a second commit-grounded repo in the paired validation surface",
  });

  const workflowPass =
    args.workflowAssembly !== undefined &&
    args.workflowAssembly.workflowServed.new.served >=
      args.workflowAssembly.workflowServed.old.served;
  gates.push({
    name: "workflow_assembly_no_regression",
    pass: workflowPass,
    baseline:
      args.workflowAssembly === undefined
        ? "old workflow panel unavailable"
        : `${args.workflowAssembly.workflowServed.old.served}/${args.workflowAssembly.workflowServed.old.total}`,
    current:
      args.workflowAssembly === undefined
        ? "not measured"
        : `${args.workflowAssembly.workflowServed.new.served}/${args.workflowAssembly.workflowServed.new.total}`,
    detail:
      "workflow assembly must remain at least as strong under the new lane",
  });

  const downstreamMeasured =
    args.downstreamTaskSuccess !== undefined &&
    args.downstreamTaskSuccess.oldVerdicts.length > 0 &&
    args.downstreamTaskSuccess.newVerdicts.length > 0;
  gates.push({
    name: "downstream_task_success_measured",
    pass: downstreamMeasured,
    baseline:
      args.downstreamTaskSuccess === undefined
        ? "expected old/new task-success verdict sets"
        : `${args.downstreamTaskSuccess.oldVerdicts.length} old verdicts`,
    current:
      args.downstreamTaskSuccess === undefined
        ? "not measured"
        : `${args.downstreamTaskSuccess.newVerdicts.length} new verdicts`,
    detail:
      "promotion cannot proceed without explicit downstream task-success evidence",
  });

  const oldTaskSuccess = args.downstreamTaskSuccess === undefined
    ? undefined
    : summarizeTaskSuccess(args.downstreamTaskSuccess.oldVerdicts);
  const newTaskSuccess = args.downstreamTaskSuccess === undefined
    ? undefined
    : summarizeTaskSuccess(args.downstreamTaskSuccess.newVerdicts);
  const downstreamPass =
    downstreamMeasured &&
    newTaskSuccess!.acceptableChange >= oldTaskSuccess!.acceptableChange &&
    newTaskSuccess!.reachedRightFiles >= oldTaskSuccess!.reachedRightFiles;
  gates.push({
    name: "downstream_task_success_non_regression",
    pass: downstreamPass,
    baseline:
      oldTaskSuccess === undefined
        ? "not measured"
        : `reachable ${oldTaskSuccess.reachedRightFiles}/${oldTaskSuccess.cases}; acceptable ${oldTaskSuccess.acceptableChange}/${oldTaskSuccess.cases}`,
    current:
      newTaskSuccess === undefined
        ? "not measured"
        : `reachable ${newTaskSuccess.reachedRightFiles}/${newTaskSuccess.cases}; acceptable ${newTaskSuccess.acceptableChange}/${newTaskSuccess.cases}`,
    detail:
      "new lane must not regress downstream task-success outcomes once they are measured",
  });

  const honestyPass =
    args.honesty !== undefined &&
    args.honesty.coverageConfidenceHonest &&
    args.honesty.packReadinessHonest &&
    args.honesty.queryModeHonest;
  gates.push({
    name: "token_accounting_and_pack_honesty",
    pass: honestyPass,
    baseline:
      "coverage_confidence=yes, pack_readiness=yes, query_mode=yes",
    current:
      args.honesty === undefined
        ? "not measured"
        : `coverage_confidence=${args.honesty.coverageConfidenceHonest ? "yes" : "no"}, pack_readiness=${args.honesty.packReadinessHonest ? "yes" : "no"}, query_mode=${args.honesty.queryModeHonest ? "yes" : "no"}`,
    detail:
      "promotion requires explicit token/honesty evidence, not only retrieval wins",
  });

  const failed_gates = gates.filter((gate) => !gate.pass).map((gate) => gate.name);
  return {
    pass: failed_gates.length === 0,
    failed_gates,
    gates,
    recommendation:
      failed_gates.length === 0
        ? "eligible_for_human_review"
        : "keep_shadow_mode",
    evidence: {
      primaryCodeLane: args.primaryCodeLane,
      crossRepoRepoCount: args.crossRepoRepoCount,
      workflowAssembly: args.workflowAssembly,
      downstreamTaskSuccess: args.downstreamTaskSuccess,
      honesty: args.honesty,
    },
  };
}

export function renderPrd0042PromotionVerdict(
  verdict: Prd0042PromotionVerdict,
): string {
  const lines: string[] = [];
  lines.push(`# PRD-0042 Promotion Verdict`);
  lines.push("");
  lines.push(`Outcome: **${verdict.pass ? "PASS" : "FAIL"}**`);
  lines.push(`Recommendation: \`${verdict.recommendation}\``);
  if (!verdict.pass) {
    lines.push(`Failed gates: ${verdict.failed_gates.join(", ")}`);
  }
  lines.push("");
  lines.push("## Gate Table");
  lines.push("");
  lines.push("| Gate | Baseline | Current | Result | Detail |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const gate of verdict.gates) {
    lines.push(
      `| ${gate.name} | ${gate.baseline} | ${gate.current} | ${gate.pass ? "PASS" : "FAIL"} | ${gate.detail} |`,
    );
  }
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  lines.push("### Old (file-card)");
  lines.push(
    `- file coverage: ${verdict.evidence.primaryCodeLane.fileCoverage.old.mentioned}/${verdict.evidence.primaryCodeLane.fileCoverage.old.total}`,
  );
  lines.push(
    `- code top-1 acceptable: ${verdict.evidence.primaryCodeLane.codeTop1.old.hits}/${verdict.evidence.primaryCodeLane.codeTop1.old.total}`,
  );
  lines.push(
    `- code ranked useful: ${verdict.evidence.primaryCodeLane.codeRankedUseful.old.hits}/${verdict.evidence.primaryCodeLane.codeRankedUseful.old.total}`,
  );
  lines.push("");
  lines.push("### New (chunk-first)");
  lines.push(
    `- file coverage: ${verdict.evidence.primaryCodeLane.fileCoverage.new.mentioned}/${verdict.evidence.primaryCodeLane.fileCoverage.new.total}`,
  );
  lines.push(
    `- code top-1 acceptable: ${verdict.evidence.primaryCodeLane.codeTop1.new.hits}/${verdict.evidence.primaryCodeLane.codeTop1.new.total}`,
  );
  lines.push(
    `- code ranked useful: ${verdict.evidence.primaryCodeLane.codeRankedUseful.new.hits}/${verdict.evidence.primaryCodeLane.codeRankedUseful.new.total}`,
  );
  lines.push("");
  lines.push(`### Cross-repo coverage`);
  lines.push(`- repo count: ${verdict.evidence.crossRepoRepoCount}`);
  lines.push("");
  lines.push("### downstream_task_success");
  if (verdict.evidence.downstreamTaskSuccess === undefined) {
    lines.push("- not measured yet");
  } else {
    const oldSummary = summarizeTaskSuccess(
      verdict.evidence.downstreamTaskSuccess.oldVerdicts,
    );
    const newSummary = summarizeTaskSuccess(
      verdict.evidence.downstreamTaskSuccess.newVerdicts,
    );
    lines.push(
      `- old: reached ${oldSummary.reachedRightFiles}/${oldSummary.cases}, acceptable ${oldSummary.acceptableChange}/${oldSummary.cases}`,
    );
    lines.push(
      `- new: reached ${newSummary.reachedRightFiles}/${newSummary.cases}, acceptable ${newSummary.acceptableChange}/${newSummary.cases}`,
    );
  }
  lines.push("");
  lines.push("### token_accounting_and_pack_honesty");
  if (verdict.evidence.honesty === undefined) {
    lines.push("- not measured yet");
  } else {
    lines.push(
      `- coverage_confidence: ${verdict.evidence.honesty.coverageConfidenceHonest ? "yes" : "no"}`,
    );
    lines.push(
      `- pack_readiness: ${verdict.evidence.honesty.packReadinessHonest ? "yes" : "no"}`,
    );
    lines.push(
      `- query_mode: ${verdict.evidence.honesty.queryModeHonest ? "yes" : "no"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export type Prd0042PromotionReportRun = {
  outPath: string;
  markdown: string;
  verdict: Prd0042PromotionVerdict;
};

function defaultReportDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultPrd0042PromotionVerdictPath(
  repoRoot = process.cwd(),
  reportDate = defaultReportDate(),
): string {
  return join(
    repoRoot,
    "docs",
    "evals",
    "reports",
    `prd-0042-promotion-verdict-${reportDate}.md`,
  );
}

export function composePrd0042PromotionReportMarkdown(args: {
  crossRepoSection: string;
  workflowSection: string;
  verdict: Prd0042PromotionVerdict;
}): string {
  const lines: string[] = [];
  lines.push("# PRD-0042 Promotion Report");
  lines.push("");
  lines.push(
    "This durable report records the current promotion evidence for the chunk-first code lane.",
  );
  lines.push("");
  lines.push(args.crossRepoSection.trimEnd());
  lines.push("");
  lines.push(args.workflowSection.trimEnd());
  lines.push("");
  lines.push(renderPrd0042PromotionVerdict(args.verdict).trimEnd());
  lines.push("");
  return lines.join("\n");
}

export function buildPrd0042ValidationRepos(repoRoot = process.cwd()) {
  return [
    {
      ...PRIMARY_CODE_LANE_VALIDATION_REPO,
      repoRoot,
    },
    RALPH_CODE_LANE_VALIDATION_REPO,
  ] as const;
}

export function getPrimaryCodeLaneComparison(args: {
  report: Awaited<ReturnType<typeof runCrossRepoCodeLaneComparison>>;
  primaryRepoId?: string;
}): PairedCodeLaneComparison {
  const primaryRepoId = args.primaryRepoId ?? PRIMARY_CODE_LANE_VALIDATION_REPO.id;
  const match = args.report.repos.find((entry) => entry.repo.id === primaryRepoId);
  if (!match) {
    throw new Error(
      `Missing primary validation repo '${primaryRepoId}' in cross-repo comparison report`,
    );
  }
  return match.comparison;
}

export async function runAndWritePrd0042PromotionReport(args: {
  repoRoot?: string;
  reportDate?: string;
  budgetTokensOverride?: number;
} = {}): Promise<Prd0042PromotionReportRun> {
  const repoRoot = args.repoRoot ?? process.cwd();
  const crossRepoReport = await runCrossRepoCodeLaneComparison({
    repos: buildPrd0042ValidationRepos(repoRoot),
    budgetTokensOverride: args.budgetTokensOverride,
  });
  const workflowComparison = await runPairedWorkflowAssemblyComparison({
    budgetTokensOverride: args.budgetTokensOverride,
  });
  const oldTaskSuccess = await runPrimaryTaskSuccessEval({
    repoRoot,
    budgetTokensOverride: args.budgetTokensOverride,
    codeSourceIndexEnabled: false,
  });
  const newTaskSuccess = await runPrimaryTaskSuccessEval({
    repoRoot,
    budgetTokensOverride: args.budgetTokensOverride,
    codeSourceIndexEnabled: true,
  });
  const verdict = evaluatePrd0042PromotionVerdict({
    primaryCodeLane: getPrimaryCodeLaneComparison({
      report: crossRepoReport,
    }),
    crossRepoRepoCount: crossRepoReport.repos.length,
    workflowAssembly: workflowComparison,
    downstreamTaskSuccess: {
      oldVerdicts: oldTaskSuccess.verdicts,
      newVerdicts: newTaskSuccess.verdicts,
    },
    honesty: newTaskSuccess.honesty,
  });
  const markdown = composePrd0042PromotionReportMarkdown({
    crossRepoSection: renderCrossRepoCodeLaneComparison(crossRepoReport),
    workflowSection: renderPairedWorkflowAssemblyComparison(workflowComparison),
    verdict,
  });
  const outPath = defaultPrd0042PromotionVerdictPath(
    repoRoot,
    args.reportDate ?? defaultReportDate(),
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, markdown);
  return { outPath, markdown, verdict };
}

async function main(): Promise<void> {
  const report = await runAndWritePrd0042PromotionReport();
  process.stdout.write(report.markdown);
  process.stdout.write(`\nWrote ${report.outPath}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
