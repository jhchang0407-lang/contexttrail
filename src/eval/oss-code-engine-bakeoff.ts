#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseOssCodeLaneManifest,
  type OssCodeLaneCase,
  type OssCodeLaneValidationRepo,
} from "./oss-code-lane-generalization.js";
import { isOssCodeLaneTargetFile } from "./oss-code-lane-targets.js";
import { expandAgentCompletionPromptPanel } from "./prompt-panel-expansion.js";

export type OssCodeEngineRawCandidate =
  | string
  | {
      path?: string;
      source_path?: string;
      file?: string;
      filepath?: string;
      score?: number;
    };

export type OssCodeEngineCandidate = {
  path: string;
  score?: number;
};

export type OssCodeEngineQueryArgs = {
  queryId: string;
  repo: OssCodeLaneValidationRepo;
  testCase: OssCodeLaneCase;
  promptIndex: number;
  query: string;
};

export type OssCodeEngineAdapter = {
  id: string;
  name: string;
  usesCommitHistory?: boolean;
  retrieve: (
    args: OssCodeEngineQueryArgs,
  ) => Promise<readonly OssCodeEngineRawCandidate[]> | readonly OssCodeEngineRawCandidate[];
};

export type OssCodeEngineQueryRecord = {
  queryId: string;
  repoId: string;
  repoName: string;
  repoRoot: string;
  ticket: string;
  promptIndex: number;
  query: string;
  language: string;
  projectShape: string;
  changeType: string;
};

export type OssCodeEngineBakeoffPolicy = {
  promptTop3Floor: number;
  promptRecall100Floor: number;
  fileRecall100Floor: number;
  allowCommitHistory: boolean;
};

export type OssCodeEngineBakeoffMetric = {
  hits: number;
  total: number;
  rate: number;
};

export type OssCodeEngineCandidateRecallSummary = {
  depths: Array<{
    depth: number;
    promptUseful: number;
    promptCount: number;
    fileHits: number;
    fileTotal: number;
  }>;
};

export type OssCodeEngineBakeoffAggregate = {
  promptTop1: OssCodeEngineBakeoffMetric;
  promptTop3: OssCodeEngineBakeoffMetric;
  ticketsTop3Robust: OssCodeEngineBakeoffMetric;
  candidateRecall: OssCodeEngineCandidateRecallSummary;
};

export type OssCodeEngineBakeoffGateName =
  | "prompt_top3_floor"
  | "prompt_recall100_floor"
  | "file_recall100_floor"
  | "no_target_commit_leakage";

export type OssCodeEngineBakeoffGate = {
  name: OssCodeEngineBakeoffGateName;
  pass: boolean;
  current: string;
  required: string;
  detail: string;
};

export type OssCodeEngineBakeoffVerdict = {
  pass: boolean;
  failedGates: OssCodeEngineBakeoffGateName[];
  gates: OssCodeEngineBakeoffGate[];
};

export type OssCodeEngineBakeoffRow = {
  queryId: string;
  repoId: string;
  repoName: string;
  ticket: string;
  commit: string;
  promptIndex: number;
  query: string;
  targetSourceFiles: string[];
  rankedFiles: string[];
  topOneUseful: boolean;
  topThreeUseful: boolean;
  firstUsefulDepth?: number;
  recall: Array<{
    depth: number;
    useful: boolean;
    fileHits: number;
    fileTotal: number;
  }>;
};

export type OssCodeEngineBakeoffManifestSummary = {
  repoCount: number;
  caseCount: number;
  promptCount: number;
  targetPromptCount: number;
};

export type OssCodeEngineBakeoffReport = {
  engine: {
    id: string;
    name: string;
    usesCommitHistory: boolean;
  };
  policy: OssCodeEngineBakeoffPolicy;
  manifest: OssCodeEngineBakeoffManifestSummary;
  aggregate: OssCodeEngineBakeoffAggregate;
  verdict: OssCodeEngineBakeoffVerdict;
  rows: OssCodeEngineBakeoffRow[];
};

export type RunOssCodeEngineBakeoffOptions = {
  repos: readonly OssCodeLaneValidationRepo[];
  engine: OssCodeEngineAdapter;
  policy?: Partial<OssCodeEngineBakeoffPolicy>;
  candidateRecallDepths?: readonly number[];
  targetPromptVariantsPerCase?: number;
  resolveTargets?: (
    repo: OssCodeLaneValidationRepo,
    testCase: OssCodeLaneCase,
  ) => readonly string[];
};

export type CreateJsonlCodeEngineAdapterOptions = {
  id: string;
  name: string;
  resultsPath: string;
  usesCommitHistory?: boolean;
};

const DEFAULT_RECALL_DEPTHS = [10, 30, 100] as const;

export const DEFAULT_OSS_CODE_ENGINE_BAKEOFF_POLICY: OssCodeEngineBakeoffPolicy = {
  promptTop3Floor: 0.68,
  promptRecall100Floor: 0.95,
  fileRecall100Floor: 0.6,
  allowCommitHistory: false,
};

export function normalizeOssCodeEngineCandidates(args: {
  repoRoot: string;
  candidates: readonly OssCodeEngineRawCandidate[];
}): OssCodeEngineCandidate[] {
  const out: OssCodeEngineCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of args.candidates) {
    const rawPath = candidatePath(candidate);
    if (!rawPath) continue;
    const path = normalizeCandidatePath(rawPath, args.repoRoot);
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    out.push({
      path,
      score:
        typeof candidate === "string" || typeof candidate.score !== "number"
          ? undefined
          : candidate.score,
    });
  }
  return out;
}

export function makeOssCodeEngineQueryId(args: {
  repoId: string;
  ticket: string;
  commit: string;
  promptIndex: number;
  query: string;
}): string {
  const digest = createHash("sha1")
    .update(
      `${args.repoId}\0${args.ticket}\0${args.commit}\0${args.promptIndex}\0${args.query}`,
    )
    .digest("hex")
    .slice(0, 12);
  return `${args.repoId}:${args.promptIndex}:${digest}`;
}

export function emitOssCodeEngineQueryJsonl(args: {
  repos: readonly OssCodeLaneValidationRepo[];
  targetPromptVariantsPerCase?: number;
}): string {
  return `${buildOssCodeEngineQueryRecords(args)
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;
}

export function buildOssCodeEngineQueryRecords(args: {
  repos: readonly OssCodeLaneValidationRepo[];
  targetPromptVariantsPerCase?: number;
}): OssCodeEngineQueryRecord[] {
  const records: OssCodeEngineQueryRecord[] = [];
  for (const repo of expandReposForPromptVariants(
    args.repos,
    args.targetPromptVariantsPerCase,
  )) {
    for (const testCase of repo.agentCompletionCases) {
      testCase.queries.forEach((query, promptIndex) => {
        records.push({
          queryId: makeOssCodeEngineQueryId({
            repoId: repo.id,
            ticket: testCase.ticket,
            commit: testCase.commit_sha,
            promptIndex,
            query,
          }),
          repoId: repo.id,
          repoName: repo.name,
          repoRoot: repo.repoRoot,
          ticket: testCase.ticket,
          promptIndex,
          query,
          language: repo.primaryLanguage,
          projectShape: repo.projectShape,
          changeType: testCase.changeType,
        });
      });
    }
  }
  return records;
}

export function createJsonlCodeEngineAdapter(
  options: CreateJsonlCodeEngineAdapterOptions,
): OssCodeEngineAdapter {
  const byQueryId = readJsonlCandidateResults(options.resultsPath);
  return {
    id: options.id,
    name: options.name,
    usesCommitHistory: options.usesCommitHistory ?? false,
    async retrieve(args) {
      return normalizeOssCodeEngineCandidates({
        repoRoot: args.repo.repoRoot,
        candidates: byQueryId.get(args.queryId) ?? [],
      });
    },
  };
}

export async function runOssCodeEngineBakeoff(
  options: RunOssCodeEngineBakeoffOptions,
): Promise<OssCodeEngineBakeoffReport> {
  const policy = {
    ...DEFAULT_OSS_CODE_ENGINE_BAKEOFF_POLICY,
    ...options.policy,
  };
  const depths = normalizeRecallDepths(options.candidateRecallDepths);
  const rows: OssCodeEngineBakeoffRow[] = [];
  const repos = expandReposForPromptVariants(
    options.repos,
    options.targetPromptVariantsPerCase,
  );
  const resolveTargets = options.resolveTargets ?? changedFilesFromGitCommit;
  let promptCount = 0;

  for (const repo of repos) {
    for (const testCase of repo.agentCompletionCases) {
      const changedFiles = [...resolveTargets(repo, testCase)];
      const targetRepoRoot = options.resolveTargets ? undefined : repo.repoRoot;
      const targetSourceFiles = changedFiles.filter((file) =>
        isOssCodeLaneTargetFile({ file, repoRoot: targetRepoRoot }),
      );
      for (const [promptIndex, query] of testCase.queries.entries()) {
        promptCount += 1;
        if (targetSourceFiles.length === 0) continue;
        const queryId = makeOssCodeEngineQueryId({
          repoId: repo.id,
          ticket: testCase.ticket,
          commit: testCase.commit_sha,
          promptIndex,
          query,
        });
        const candidates = normalizeOssCodeEngineCandidates({
          repoRoot: repo.repoRoot,
          candidates: await options.engine.retrieve({
            queryId,
            repo,
            testCase,
            promptIndex,
            query,
          }),
        });
        rows.push(
          scoreOssCodeEngineQuery({
            queryId,
            repo,
            testCase,
            promptIndex,
            query,
            targetSourceFiles,
            rankedFiles: candidates.map((candidate) => candidate.path),
            depths,
          }),
        );
      }
    }
  }

  const manifest: OssCodeEngineBakeoffManifestSummary = {
    repoCount: repos.length,
    caseCount: repos.reduce(
      (sum, repo) => sum + repo.agentCompletionCases.length,
      0,
    ),
    promptCount,
    targetPromptCount: rows.length,
  };
  const aggregate = summarizeOssCodeEngineBakeoff(rows, depths);
  const verdict = evaluateOssCodeEngineBakeoff({
    policy,
    aggregate,
    engineUsesCommitHistory: options.engine.usesCommitHistory ?? false,
  });
  return {
    engine: {
      id: options.engine.id,
      name: options.engine.name,
      usesCommitHistory: options.engine.usesCommitHistory ?? false,
    },
    policy,
    manifest,
    aggregate,
    verdict,
    rows,
  };
}

export function renderOssCodeEngineBakeoffReport(
  report: OssCodeEngineBakeoffReport,
): string {
  const lines: string[] = [];
  lines.push("========== OSS CODE ENGINE BAKEOFF ==========");
  lines.push(`Engine: ${report.engine.name} (${report.engine.id})`);
  lines.push(`Fork recommendation: ${report.verdict.pass ? "PASS" : "FAIL"}`);
  if (!report.verdict.pass) {
    lines.push(`Failed gates: ${report.verdict.failedGates.join(", ")}`);
  }
  lines.push("");
  lines.push("Corpus:");
  lines.push(`  Repos: ${report.manifest.repoCount}`);
  lines.push(`  Cases: ${report.manifest.caseCount}`);
  lines.push(`  Prompts: ${report.manifest.targetPromptCount}/${report.manifest.promptCount} target-bearing`);
  lines.push("");
  lines.push("Aggregate metrics:");
  lines.push(
    `  prompt top-1: ${renderMetric(report.aggregate.promptTop1)}`,
  );
  lines.push(
    `  prompt top-3: ${renderMetric(report.aggregate.promptTop3)}`,
  );
  lines.push(
    `  tickets top-3 robust: ${renderMetric(report.aggregate.ticketsTop3Robust)}`,
  );
  lines.push("");
  lines.push("Candidate recall ceiling:");
  for (const depth of report.aggregate.candidateRecall.depths) {
    lines.push(
      `  recall@${depth.depth}: prompts ${depth.promptUseful}/${depth.promptCount} (${formatRate(depth.promptUseful / Math.max(depth.promptCount, 1))}), files ${depth.fileHits}/${depth.fileTotal} (${formatRate(depth.fileHits / Math.max(depth.fileTotal, 1))})`,
    );
  }
  lines.push("");
  lines.push("Gates:");
  for (const gate of report.verdict.gates) {
    lines.push(
      `  ${gate.pass ? "PASS" : "FAIL"} ${gate.name}: ${gate.current} required ${gate.required} -- ${gate.detail}`,
    );
  }
  const misses = report.rows.filter((row) => !row.topThreeUseful).slice(0, 8);
  if (misses.length > 0) {
    lines.push("");
    lines.push("Representative top-3 misses:");
    for (const row of misses) {
      lines.push(
        `  ${row.repoName} :: ${row.ticket} prompt ${row.promptIndex} firstUseful=${row.firstUsefulDepth ?? "missing"} target=${joinLimited(row.targetSourceFiles, 3)} top3=${joinLimited(row.rankedFiles.slice(0, 3), 3)} query=${row.query}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function scoreOssCodeEngineQuery(args: {
  queryId: string;
  repo: OssCodeLaneValidationRepo;
  testCase: OssCodeLaneCase;
  promptIndex: number;
  query: string;
  targetSourceFiles: readonly string[];
  rankedFiles: readonly string[];
  depths: readonly number[];
}): OssCodeEngineBakeoffRow {
  const targets = new Set(args.targetSourceFiles);
  const recall = args.depths.map((depth) => {
    const visible = new Set(args.rankedFiles.slice(0, depth));
    const fileHits = args.targetSourceFiles.filter((file) =>
      visible.has(file),
    ).length;
    return {
      depth,
      useful: fileHits > 0,
      fileHits,
      fileTotal: args.targetSourceFiles.length,
    };
  });
  const firstUsefulIndex = args.rankedFiles.findIndex((file) =>
    targets.has(file),
  );
  return {
    queryId: args.queryId,
    repoId: args.repo.id,
    repoName: args.repo.name,
    ticket: args.testCase.ticket,
    commit: args.testCase.commit_sha,
    promptIndex: args.promptIndex,
    query: args.query,
    targetSourceFiles: [...args.targetSourceFiles],
    rankedFiles: [...args.rankedFiles],
    topOneUseful: args.rankedFiles.slice(0, 1).some((file) => targets.has(file)),
    topThreeUseful: args.rankedFiles.slice(0, 3).some((file) => targets.has(file)),
    ...(firstUsefulIndex >= 0 ? { firstUsefulDepth: firstUsefulIndex + 1 } : {}),
    recall,
  };
}

function summarizeOssCodeEngineBakeoff(
  rows: readonly OssCodeEngineBakeoffRow[],
  depths: readonly number[],
): OssCodeEngineBakeoffAggregate {
  const caseGroups = groupRowsByTicket(rows);
  return {
    promptTop1: metric(
      rows.filter((row) => row.topOneUseful).length,
      rows.length,
    ),
    promptTop3: metric(
      rows.filter((row) => row.topThreeUseful).length,
      rows.length,
    ),
    ticketsTop3Robust: metric(
      [...caseGroups.values()].filter((caseRows) =>
        caseRows.every((row) => row.topThreeUseful),
      ).length,
      caseGroups.size,
    ),
    candidateRecall: {
      depths: depths.map((depth) => {
        const recalls = rows.flatMap((row) =>
          row.recall.filter((recall) => recall.depth === depth),
        );
        return {
          depth,
          promptUseful: recalls.filter((recall) => recall.useful).length,
          promptCount: recalls.length,
          fileHits: recalls.reduce((sum, recall) => sum + recall.fileHits, 0),
          fileTotal: recalls.reduce((sum, recall) => sum + recall.fileTotal, 0),
        };
      }),
    },
  };
}

function evaluateOssCodeEngineBakeoff(args: {
  policy: OssCodeEngineBakeoffPolicy;
  aggregate: OssCodeEngineBakeoffAggregate;
  engineUsesCommitHistory: boolean;
}): OssCodeEngineBakeoffVerdict {
  const recall100 = args.aggregate.candidateRecall.depths.find(
    (depth) => depth.depth === 100,
  );
  const gates: OssCodeEngineBakeoffGate[] = [
    metricGate(
      "prompt_top3_floor",
      args.aggregate.promptTop3.rate,
      args.policy.promptTop3Floor,
      "top-3 prompt hit rate must clear the migration floor",
    ),
    metricGate(
      "prompt_recall100_floor",
      recall100
        ? recall100.promptUseful / Math.max(recall100.promptCount, 1)
        : undefined,
      args.policy.promptRecall100Floor,
      "candidate recall@100 must be near saturated before we fork",
    ),
    metricGate(
      "file_recall100_floor",
      recall100
        ? recall100.fileHits / Math.max(recall100.fileTotal, 1)
        : undefined,
      args.policy.fileRecall100Floor,
      "file recall@100 must materially beat the current 53.2% baseline",
    ),
    {
      name: "no_target_commit_leakage",
      pass: args.policy.allowCommitHistory || !args.engineUsesCommitHistory,
      current: args.engineUsesCommitHistory
        ? "commit-history-enabled"
        : "commit-history-disabled",
      required: args.policy.allowCommitHistory
        ? "allowed"
        : "commit-history-disabled",
      detail: "eval wrappers must not use target commit history unless explicitly marked",
    },
  ];
  const failedGates = gates
    .filter((gate) => !gate.pass)
    .map((gate) => gate.name);
  return {
    pass: failedGates.length === 0,
    failedGates,
    gates,
  };
}

function readJsonlCandidateResults(
  path: string,
): Map<string, readonly OssCodeEngineRawCandidate[]> {
  const out = new Map<string, readonly OssCodeEngineRawCandidate[]>();
  const raw = readFileSync(path, "utf8");
  for (const [lineIndex, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as {
      queryId?: unknown;
      candidates?: unknown;
    };
    if (typeof parsed.queryId !== "string") {
      throw new Error(`Missing string queryId in ${path}:${lineIndex + 1}`);
    }
    if (!Array.isArray(parsed.candidates)) {
      throw new Error(`Missing candidates array in ${path}:${lineIndex + 1}`);
    }
    out.set(parsed.queryId, parsed.candidates as OssCodeEngineRawCandidate[]);
  }
  return out;
}

function changedFilesFromGitCommit(
  repo: OssCodeLaneValidationRepo,
  testCase: OssCodeLaneCase,
): string[] {
  try {
    return execFileSync(
      "git",
      [
        "show",
        "--pretty=format:",
        "--name-only",
        "--diff-filter=ACMRT",
        testCase.commit_sha,
      ],
      { cwd: repo.repoRoot },
    )
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (err) {
    process.stderr.write(
      `Failed to read changed files for ${repo.name} ${testCase.commit_sha}: ${err}\n`,
    );
    return [];
  }
}

function candidatePath(candidate: OssCodeEngineRawCandidate): string | undefined {
  if (typeof candidate === "string") return candidate;
  return candidate.path ?? candidate.source_path ?? candidate.file ?? candidate.filepath;
}

function normalizeCandidatePath(path: string, repoRoot: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  const normalizedRoot = repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
}

function expandReposForPromptVariants(
  repos: readonly OssCodeLaneValidationRepo[],
  targetPromptVariantsPerCase: number | undefined,
): OssCodeLaneValidationRepo[] {
  if (targetPromptVariantsPerCase === undefined) {
    return repos.map((repo) => ({
      ...repo,
      agentCompletionCases: [...repo.agentCompletionCases],
    }));
  }
  return repos.map((repo) => ({
    ...repo,
    agentCompletionCases: expandAgentCompletionPromptPanel(
      repo.agentCompletionCases,
      { targetPromptVariantsPerCase },
    ),
  }));
}

function normalizeRecallDepths(depths: readonly number[] | undefined): number[] {
  return [...new Set(depths ?? DEFAULT_RECALL_DEPTHS)]
    .filter((depth) => Number.isInteger(depth) && depth > 0)
    .sort((a, b) => a - b);
}

function groupRowsByTicket(
  rows: readonly OssCodeEngineBakeoffRow[],
): Map<string, OssCodeEngineBakeoffRow[]> {
  const out = new Map<string, OssCodeEngineBakeoffRow[]>();
  for (const row of rows) {
    const key = `${row.repoId}:${row.ticket}:${row.commit}`;
    const existing = out.get(key) ?? [];
    existing.push(row);
    out.set(key, existing);
  }
  return out;
}

function metric(hits: number, total: number): OssCodeEngineBakeoffMetric {
  return {
    hits,
    total,
    rate: total === 0 ? 0 : hits / total,
  };
}

function metricGate(
  name: Exclude<OssCodeEngineBakeoffGateName, "no_target_commit_leakage">,
  current: number | undefined,
  required: number,
  detail: string,
): OssCodeEngineBakeoffGate {
  return {
    name,
    pass: current !== undefined && current >= required,
    current: current === undefined ? "missing" : formatRate(current),
    required: formatRate(required),
    detail,
  };
}

function renderMetric(metricValue: OssCodeEngineBakeoffMetric): string {
  return `${metricValue.hits}/${metricValue.total} (${formatRate(metricValue.rate)})`;
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function joinLimited(values: readonly string[], limit: number): string {
  if (values.length <= limit) return values.join(", ") || "(none)";
  return `${values.slice(0, limit).join(", ")} +${values.length - limit} more`;
}

function argValue(argv: readonly string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.replace(`--${name}=`, "");
}

function numberArg(argv: readonly string[], name: string): number | undefined {
  const raw = argValue(argv, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number`);
  return value;
}

function numberListArg(argv: readonly string[], name: string): number[] | undefined {
  const raw = argValue(argv, name);
  if (raw === undefined) return undefined;
  return raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const manifestPath = argValue(argv, "manifest") ?? process.env.OSS_CODE_LANE_MANIFEST;
  if (!manifestPath) {
    throw new Error(
      "OSS code engine bakeoff requires --manifest=/path/to/manifest.json or OSS_CODE_LANE_MANIFEST.",
    );
  }
  const parsed = parseOssCodeLaneManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  const targetPromptVariantsPerCase =
    numberArg(argv, "target-prompts-per-case") ??
    (process.env.OSS_CODE_LANE_PROMPTS_PER_CASE
      ? Number(process.env.OSS_CODE_LANE_PROMPTS_PER_CASE)
      : undefined);
  const emitQueriesPath = argValue(argv, "emit-queries");
  if (emitQueriesPath) {
    writeFileSync(
      emitQueriesPath,
      emitOssCodeEngineQueryJsonl({
        repos: parsed.repos,
        targetPromptVariantsPerCase,
      }),
    );
    process.stdout.write(`Wrote OSS code-engine query panel to ${emitQueriesPath}\n`);
    return;
  }

  const resultsPath = argValue(argv, "results");
  if (!resultsPath) {
    throw new Error(
      "OSS code engine bakeoff requires --results=/path/to/results.jsonl unless --emit-queries is set.",
    );
  }
  const report = await runOssCodeEngineBakeoff({
    repos: parsed.repos,
    targetPromptVariantsPerCase,
    candidateRecallDepths: numberListArg(argv, "candidate-recall-depths"),
    engine: createJsonlCodeEngineAdapter({
      id: argValue(argv, "engine-id") ?? "external-jsonl",
      name: argValue(argv, "engine-name") ?? "External JSONL Engine",
      resultsPath,
      usesCommitHistory: argv.includes("--uses-commit-history"),
    }),
  });
  process.stdout.write(renderOssCodeEngineBakeoffReport(report));
  if (!report.verdict.pass) process.exitCode = 1;
}

if (
  process.argv[1]?.endsWith("oss-code-engine-bakeoff.js") ||
  process.argv[1]?.endsWith("oss-code-engine-bakeoff.ts") ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
) {
  void main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
