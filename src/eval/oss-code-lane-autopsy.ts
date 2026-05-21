#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  AgentCompletionCandidateRecallDepth,
  AgentCompletionPromptVariantRow,
} from "./agent-completion-probe.js";
import {
  parseOssCodeLaneManifest,
  runOssCodeLaneGeneralizationEval,
  type OssCodeLaneGeneralizationReport,
} from "./oss-code-lane-generalization.js";

export type OssCodeLaneAutopsyPrimaryCause =
  | "top3_hit"
  | "ranked_below_top3"
  | "body_only"
  | "candidate_buried_top10"
  | "candidate_buried_top30"
  | "candidate_buried_top100"
  | "candidate_generation_miss";

export type OssCodeLaneAutopsyModifier =
  | "support_role_candidate"
  | "large_target_set"
  | "weak_prompt_identity"
  | "many_decoys_in_top3";

export type OssCodeLaneAutopsyDepth =
  | "top3"
  | "ranked_pack"
  | "body_only"
  | "recall_10"
  | "recall_30"
  | "recall_100"
  | "missing_at_100";

export type ClassifyOssCodeLanePromptMissArgs = {
  query: string;
  changedFiles: string[];
  topThreeCodeFiles: string[];
  rankedCodeChangedFiles: string[];
  supportClusterChangedFiles: string[];
  mentionedFiles: string[];
  candidateRecall?: AgentCompletionCandidateRecallDepth[];
};

export type OssCodeLanePromptMissClassification = {
  primaryCause: OssCodeLaneAutopsyPrimaryCause;
  modifiers: OssCodeLaneAutopsyModifier[];
  firstUsefulDepth: OssCodeLaneAutopsyDepth;
  queryTargetTokenOverlap: number;
};

export type OssCodeLaneAutopsyMiss = OssCodeLanePromptMissClassification & {
  repoId: string;
  repoName: string;
  language: string;
  projectShape: string;
  changeType: string;
  ticket: string;
  commit: string;
  query: string;
  changedFiles: string[];
  topThreeCodeFiles: string[];
  rankedCodeChangedFiles: string[];
  supportClusterChangedFiles: string[];
};

export type OssCodeLaneAutopsyReport = {
  promptCount: number;
  missedPromptCount: number;
  misses: OssCodeLaneAutopsyMiss[];
};

export function classifyOssCodeLanePromptMiss(
  args: ClassifyOssCodeLanePromptMissArgs,
): OssCodeLanePromptMissClassification {
  const modifiers: OssCodeLaneAutopsyModifier[] = [];
  const queryTargetTokenOverlap = queryTargetIdentityOverlap({
    query: args.query,
    changedFiles: args.changedFiles,
  });

  if (args.supportClusterChangedFiles.length > 0) {
    modifiers.push("support_role_candidate");
  }
  if (args.changedFiles.length >= 4) {
    modifiers.push("large_target_set");
  }
  if (queryTargetTokenOverlap === 0) {
    modifiers.push("weak_prompt_identity");
  }
  if (args.topThreeCodeFiles.length >= 3) {
    const topThreeChanged = new Set(args.changedFiles);
    const decoys = args.topThreeCodeFiles.filter((file) => !topThreeChanged.has(file));
    if (decoys.length >= 3) modifiers.push("many_decoys_in_top3");
  }

  if (args.rankedCodeChangedFiles.length > 0) {
    return {
      primaryCause: "ranked_below_top3",
      modifiers,
      firstUsefulDepth: "ranked_pack",
      queryTargetTokenOverlap,
    };
  }

  if (args.changedFiles.some((file) => args.mentionedFiles.includes(file))) {
    return {
      primaryCause: "body_only",
      modifiers,
      firstUsefulDepth: "body_only",
      queryTargetTokenOverlap,
    };
  }

  const firstRecall = firstUsefulRecallDepth(args.candidateRecall ?? []);
  if (firstRecall === 10) {
    return {
      primaryCause: "candidate_buried_top10",
      modifiers,
      firstUsefulDepth: "recall_10",
      queryTargetTokenOverlap,
    };
  }
  if (firstRecall === 30) {
    return {
      primaryCause: "candidate_buried_top30",
      modifiers,
      firstUsefulDepth: "recall_30",
      queryTargetTokenOverlap,
    };
  }
  if (firstRecall !== undefined) {
    return {
      primaryCause: "candidate_buried_top100",
      modifiers,
      firstUsefulDepth: "recall_100",
      queryTargetTokenOverlap,
    };
  }

  return {
    primaryCause: "candidate_generation_miss",
    modifiers,
    firstUsefulDepth: "missing_at_100",
    queryTargetTokenOverlap,
  };
}

export function buildOssCodeLaneAutopsyReport(
  report: OssCodeLaneGeneralizationReport,
): OssCodeLaneAutopsyReport {
  const misses: OssCodeLaneAutopsyMiss[] = [];
  let promptCount = 0;

  for (const repo of report.repos) {
    const changeTypeByCase = new Map(
      repo.repo.agentCompletionCases.map((testCase) => [
        `${testCase.ticket}:${testCase.commit_sha}`,
        testCase.changeType,
      ]),
    );
    for (const row of repo.comparison.newSummary.rows) {
      const changedFiles = row.targetSourceFiles ?? row.changedFiles;
      if (changedFiles.length === 0) continue;
      for (const variant of row.promptVariants ?? []) {
        promptCount += 1;
        if (variant.topThreeCodeUseful) continue;
        misses.push({
          repoId: repo.repo.id,
          repoName: repo.repo.name,
          language: repo.repo.primaryLanguage,
          projectShape: repo.repo.projectShape,
          changeType:
            changeTypeByCase.get(`${row.ticket}:${row.commit}`) ?? "unknown",
          ticket: row.ticket,
          commit: row.commit,
          query: variant.query,
          changedFiles,
          topThreeCodeFiles: variant.topThreeCodeFiles,
          rankedCodeChangedFiles: variant.rankedCodeChangedFiles,
          supportClusterChangedFiles: variant.supportClusterChangedFiles,
          ...classifyVariant(variant, changedFiles),
        });
      }
    }
  }

  return {
    promptCount,
    missedPromptCount: misses.length,
    misses,
  };
}

export function renderOssCodeLaneAutopsyReport(
  report: OssCodeLaneAutopsyReport,
): string {
  const lines: string[] = [];
  lines.push("# OSS Code-Lane Causal Autopsy");
  lines.push("");
  lines.push(`Prompt variants: ${report.promptCount}`);
  lines.push(
    `Top-3 misses: ${report.missedPromptCount} (${pct(report.missedPromptCount, report.promptCount)})`,
  );
  lines.push("");
  lines.push("## Primary Causes");
  for (const [cause, count] of countBy(report.misses, (miss) => miss.primaryCause)) {
    lines.push(`- ${cause}: ${count} (${pct(count, report.missedPromptCount)})`);
  }
  lines.push("");
  lines.push("## Modifiers");
  for (const [modifier, count] of countModifiers(report.misses)) {
    lines.push(`- ${modifier}: ${count} (${pct(count, report.missedPromptCount)})`);
  }
  lines.push("");
  lines.push("## Causes By Change Type");
  for (const [changeType, misses] of groupBy(report.misses, (miss) => miss.changeType)) {
    lines.push(`- ${changeType}: ${misses.length} misses`);
    for (const [cause, count] of countBy(misses, (miss) => miss.primaryCause).slice(0, 4)) {
      lines.push(`  - ${cause}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Causes By Repo");
  for (const [repoName, misses] of groupBy(report.misses, (miss) => miss.repoName)) {
    lines.push(`- ${repoName}: ${misses.length} misses`);
    for (const [cause, count] of countBy(misses, (miss) => miss.primaryCause).slice(0, 3)) {
      lines.push(`  - ${cause}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Representative Misses");
  for (const miss of representativeMisses(report.misses, 16)) {
    lines.push(
      `- ${miss.repoName} / ${miss.changeType}: ${miss.primaryCause} [${miss.modifiers.join(", ") || "no modifiers"}]`,
    );
    lines.push(`  - query: ${miss.query}`);
    lines.push(`  - target: ${joinLimited(miss.changedFiles, 4)}`);
    lines.push(`  - top3: ${joinLimited(miss.topThreeCodeFiles, 4)}`);
  }
  return `${lines.join("\n")}\n`;
}

function classifyVariant(
  variant: AgentCompletionPromptVariantRow,
  changedFiles: string[],
): OssCodeLanePromptMissClassification {
  return classifyOssCodeLanePromptMiss({
    query: variant.query,
    changedFiles,
    topThreeCodeFiles: variant.topThreeCodeFiles,
    rankedCodeChangedFiles: variant.rankedCodeChangedFiles,
    supportClusterChangedFiles: variant.supportClusterChangedFiles,
    mentionedFiles: variant.mentionedFiles,
    candidateRecall: variant.candidateRecall,
  });
}

function firstUsefulRecallDepth(
  recall: readonly AgentCompletionCandidateRecallDepth[],
): number | undefined {
  return recall
    .filter((item) => item.useful)
    .sort((a, b) => a.depth - b.depth)[0]?.depth;
}

function queryTargetIdentityOverlap(args: {
  query: string;
  changedFiles: readonly string[];
}): number {
  const queryTokens = identityTokens(args.query);
  const targetTokens = new Set(args.changedFiles.flatMap((file) => [...identityTokens(file)]));
  let overlap = 0;
  for (const token of targetTokens) {
    if (queryTokens.has(token)) overlap += 1;
  }
  return overlap;
}

function identityTokens(text: string): Set<string> {
  return new Set(
    text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
      .filter((token) => !IDENTITY_STOPWORDS.has(token)),
  );
}

const IDENTITY_STOPWORDS = new Set([
  "src",
  "lib",
  "mod",
  "index",
  "test",
  "tests",
  "source",
  "implementation",
  "fix",
  "feat",
  "refactor",
  "perf",
  "docs",
  "chore",
]);

function countBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function countModifiers(
  misses: readonly OssCodeLaneAutopsyMiss[],
): Array<[OssCodeLaneAutopsyModifier, number]> {
  const counts = new Map<OssCodeLaneAutopsyModifier, number>();
  for (const miss of misses) {
    for (const modifier of miss.modifiers) {
      counts.set(modifier, (counts.get(modifier) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    const current = groups.get(value) ?? [];
    current.push(item);
    groups.set(value, current);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function representativeMisses(
  misses: readonly OssCodeLaneAutopsyMiss[],
  limit: number,
): OssCodeLaneAutopsyMiss[] {
  const seen = new Set<string>();
  const out: OssCodeLaneAutopsyMiss[] = [];
  for (const miss of misses) {
    const key = `${miss.primaryCause}:${miss.changeType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(miss);
    if (out.length >= limit) return out;
  }
  for (const miss of misses) {
    if (out.includes(miss)) continue;
    out.push(miss);
    if (out.length >= limit) return out;
  }
  return out;
}

function joinLimited(values: readonly string[], limit: number): string {
  if (values.length <= limit) return values.join(", ") || "(none)";
  return `${values.slice(0, limit).join(", ")} (+${values.length - limit} more)`;
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.0%";
  return `${(numerator / denominator * 100).toFixed(1)}%`;
}

function manifestPathFromArgs(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.startsWith("--manifest="))?.replace("--manifest=", "");
}

function numberArg(argv: readonly string[], name: string): number | undefined {
  const raw = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return undefined;
  const value = Number(raw.replace(`--${name}=`, ""));
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const manifestPath = manifestPathFromArgs(argv) ?? process.env.OSS_CODE_LANE_MANIFEST;
  if (!manifestPath) {
    throw new Error(
      "OSS code-lane autopsy requires --manifest=/path/to/manifest.json or OSS_CODE_LANE_MANIFEST.",
    );
  }
  const parsed = parseOssCodeLaneManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  const evalReport = await runOssCodeLaneGeneralizationEval({
    repos: parsed.repos,
    policy: parsed.policy,
    targetPromptVariantsPerCase:
      numberArg(argv, "target-prompts-per-case") ??
      (process.env.OSS_CODE_LANE_PROMPTS_PER_CASE
        ? Number(process.env.OSS_CODE_LANE_PROMPTS_PER_CASE)
        : undefined),
  });
  process.stdout.write(
    renderOssCodeLaneAutopsyReport(buildOssCodeLaneAutopsyReport(evalReport)),
  );
  process.exitCode = evalReport.verdict.pass ? 0 : 1;
}

if (
  process.argv[1]?.endsWith("oss-code-lane-autopsy.js") ||
  process.argv[1]?.endsWith("oss-code-lane-autopsy.ts") ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
) {
  void main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
