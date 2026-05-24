#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

export type MetadataShadowDepthSummary = {
  depth: number;
  baselineHits: number;
  candidateHits: number;
  netTargets: number;
  targetGains: number;
  targetLosses: number;
  zeroOverlapTargetGains: number;
  neverGeneratedTargetGains: number;
  generatedBuriedTargetGains: number;
  noiseEntrants: number;
  noiseExits: number;
  noFactNoiseEntrants: number;
};

export type MetadataShadowCandidateReport = {
  name: string;
  targetObservations: number;
  noiseObservations: number;
  unmatchedBaselineTargets: number;
  unmatchedCandidateTargets: number;
  depths: MetadataShadowDepthSummary[];
  topDepth: MetadataShadowDepthSummary;
  gainRepos: Array<{ key: string; count: number }>;
  lossRepos: Array<{ key: string; count: number }>;
  gainChangeTypes: Array<{ key: string; count: number }>;
  lossChangeTypes: Array<{ key: string; count: number }>;
  representativeGains: TargetDeltaExample[];
  representativeLosses: TargetDeltaExample[];
};

export type MetadataShadowReport = {
  depths: number[];
  candidates: MetadataShadowCandidateReport[];
};

export type TargetDeltaExample = {
  repoId: string;
  changeType: string;
  targetFile: string;
  query: string;
  baselineRank: number | null;
  candidateRank: number | null;
  baselineOutcome: string;
  candidateOutcome: string;
  factTokenOverlap: number;
};

type CandidateSpec = {
  name: string;
  path: string;
};

type ParsedArgs = {
  baseline: string;
  candidates: CandidateSpec[];
  depths: number[];
  jsonOut?: string;
};

type TargetRow = {
  kind: "target_file";
  repoId: string;
  changeType: string;
  ticket: string;
  commit: string;
  promptIndex: number;
  query: string;
  targetFile: string;
  candidateRank: number | null;
  outcome: string;
  factTokenOverlap: number;
};

type NoiseRow = {
  kind: "noise_candidate";
  repoId: string;
  commit: string;
  promptIndex: number;
  query: string;
  sourcePath: string;
  rank: number;
  factTokenOverlap: number;
};

export type ObservabilityRow = TargetRow | NoiseRow | { kind: string };

type ParsedObservability = {
  targets: Map<string, TargetRow>;
  noise: Map<string, NoiseRow>;
};

export function buildMetadataShadowReport(args: {
  baselineRows: readonly ObservabilityRow[];
  candidates: readonly { name: string; rows: readonly ObservabilityRow[] }[];
  depths: readonly number[];
}): MetadataShadowReport {
  const depths = normalizeDepths(args.depths);
  const baseline = indexObservabilityRows(args.baselineRows);
  const candidates = args.candidates
    .map((candidate) =>
      summarizeCandidate({
        name: candidate.name,
        baseline,
        candidate: indexObservabilityRows(candidate.rows),
        depths,
      }),
    )
    .sort(compareCandidateReports);
  return { depths, candidates };
}

export function renderMetadataShadowReport(report: MetadataShadowReport): string {
  const lines: string[] = [];
  lines.push("# Metadata Shadow Evaluation");
  lines.push("");
  lines.push(`Depths: ${report.depths.join(", ")}`);
  lines.push("");
  lines.push("## Ranking");
  lines.push("| candidate | top-depth net | gains | losses | zero-overlap gains | buried gains | noise entrants | repo spread |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const candidate of report.candidates) {
    const top = candidate.topDepth;
    lines.push(tableRow([
      candidate.name,
      top.netTargets,
      top.targetGains,
      top.targetLosses,
      top.zeroOverlapTargetGains,
      top.neverGeneratedTargetGains + top.generatedBuriedTargetGains,
      top.noiseEntrants,
      candidate.gainRepos.length,
    ]));
  }

  for (const candidate of report.candidates) {
    lines.push("");
    lines.push(`## ${candidate.name}`);
    lines.push("");
    lines.push(`Target observations: ${candidate.targetObservations}`);
    if (
      candidate.unmatchedBaselineTargets > 0 ||
      candidate.unmatchedCandidateTargets > 0
    ) {
      lines.push(
        `Unmatched target rows: baseline_only=${candidate.unmatchedBaselineTargets}, candidate_only=${candidate.unmatchedCandidateTargets}`,
      );
    }
    lines.push("");
    lines.push("| depth | baseline hits | candidate hits | net | gains | losses | zero-overlap gains | never-generated gains | generated-buried gains | noise entrants | no-fact noise entrants | noise exits |");
    lines.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const depth of candidate.depths) {
      lines.push(tableRow([
        depth.depth,
        depth.baselineHits,
        depth.candidateHits,
        depth.netTargets,
        depth.targetGains,
        depth.targetLosses,
        depth.zeroOverlapTargetGains,
        depth.neverGeneratedTargetGains,
        depth.generatedBuriedTargetGains,
        depth.noiseEntrants,
        depth.noFactNoiseEntrants,
        depth.noiseExits,
      ]));
    }
    lines.push("");
    lines.push(`Gain repos: ${formatCounts(candidate.gainRepos)}`);
    lines.push(`Loss repos: ${formatCounts(candidate.lossRepos)}`);
    lines.push(`Gain change types: ${formatCounts(candidate.gainChangeTypes)}`);
    lines.push(`Loss change types: ${formatCounts(candidate.lossChangeTypes)}`);
    lines.push("");
    lines.push("Representative gains:");
    for (const gain of candidate.representativeGains) {
      lines.push(`- ${renderExample(gain)}`);
    }
    if (candidate.representativeGains.length === 0) lines.push("- none");
    lines.push("");
    lines.push("Representative losses:");
    for (const loss of candidate.representativeLosses) {
      lines.push(`- ${renderExample(loss)}`);
    }
    if (candidate.representativeLosses.length === 0) lines.push("- none");
  }

  return lines.join("\n");
}

function summarizeCandidate(args: {
  name: string;
  baseline: ParsedObservability;
  candidate: ParsedObservability;
  depths: readonly number[];
}): MetadataShadowCandidateReport {
  const targetKeys = unionKeys(args.baseline.targets, args.candidate.targets);
  const noiseKeys = unionKeys(args.baseline.noise, args.candidate.noise);
  const depths = args.depths.map((depth) =>
    summarizeDepth({
      depth,
      targetKeys,
      noiseKeys,
      baseline: args.baseline,
      candidate: args.candidate,
    }),
  );
  const topDepth = depths.at(-1);
  if (!topDepth) throw new Error("at least one depth is required");
  const topDeltas = targetDeltasAtDepth({
    depth: topDepth.depth,
    targetKeys,
    baseline: args.baseline,
    candidate: args.candidate,
  });

  return {
    name: args.name,
    targetObservations: targetKeys.length,
    noiseObservations: noiseKeys.length,
    unmatchedBaselineTargets: targetKeys.filter((key) =>
      !args.candidate.targets.has(key),
    ).length,
    unmatchedCandidateTargets: targetKeys.filter((key) =>
      !args.baseline.targets.has(key),
    ).length,
    depths,
    topDepth,
    gainRepos: topCounts(topDeltas.gains, (row) => row.repoId, 8),
    lossRepos: topCounts(topDeltas.losses, (row) => row.repoId, 8),
    gainChangeTypes: topCounts(topDeltas.gains, (row) => row.changeType, 8),
    lossChangeTypes: topCounts(topDeltas.losses, (row) => row.changeType, 8),
    representativeGains: examplesForDeltas({
      rows: topDeltas.gains,
      oppositeRows: args.baseline.targets,
      direction: "gain",
    }),
    representativeLosses: examplesForDeltas({
      rows: topDeltas.losses,
      oppositeRows: args.candidate.targets,
      direction: "loss",
    }),
  };
}

function summarizeDepth(args: {
  depth: number;
  targetKeys: readonly string[];
  noiseKeys: readonly string[];
  baseline: ParsedObservability;
  candidate: ParsedObservability;
}): MetadataShadowDepthSummary {
  const targetDeltas = targetDeltasAtDepth(args);
  let baselineHits = 0;
  let candidateHits = 0;
  for (const key of args.targetKeys) {
    if (targetHitAtDepth(args.baseline.targets.get(key), args.depth)) baselineHits++;
    if (targetHitAtDepth(args.candidate.targets.get(key), args.depth)) candidateHits++;
  }

  let noiseEntrants = 0;
  let noiseExits = 0;
  let noFactNoiseEntrants = 0;
  for (const key of args.noiseKeys) {
    const baselineHit = noiseHitAtDepth(args.baseline.noise.get(key), args.depth);
    const candidateRow = args.candidate.noise.get(key);
    const candidateHit = noiseHitAtDepth(candidateRow, args.depth);
    if (!baselineHit && candidateHit) {
      noiseEntrants++;
      if ((candidateRow?.factTokenOverlap ?? 0) === 0) noFactNoiseEntrants++;
    }
    if (baselineHit && !candidateHit) noiseExits++;
  }

  return {
    depth: args.depth,
    baselineHits,
    candidateHits,
    netTargets: candidateHits - baselineHits,
    targetGains: targetDeltas.gains.length,
    targetLosses: targetDeltas.losses.length,
    zeroOverlapTargetGains: targetDeltas.gains.filter((row) =>
      row.factTokenOverlap === 0,
    ).length,
    neverGeneratedTargetGains: targetDeltas.gains.filter((row) =>
      (args.baseline.targets.get(targetKey(row))?.outcome ?? "") === "never_generated",
    ).length,
    generatedBuriedTargetGains: targetDeltas.gains.filter((row) =>
      (args.baseline.targets.get(targetKey(row))?.outcome ?? "") === "generated_buried",
    ).length,
    noiseEntrants,
    noiseExits,
    noFactNoiseEntrants,
  };
}

function targetDeltasAtDepth(args: {
  depth: number;
  targetKeys: readonly string[];
  baseline: ParsedObservability;
  candidate: ParsedObservability;
}): { gains: TargetRow[]; losses: TargetRow[] } {
  const gains: TargetRow[] = [];
  const losses: TargetRow[] = [];
  for (const key of args.targetKeys) {
    const baselineRow = args.baseline.targets.get(key);
    const candidateRow = args.candidate.targets.get(key);
    const baselineHit = targetHitAtDepth(baselineRow, args.depth);
    const candidateHit = targetHitAtDepth(candidateRow, args.depth);
    if (!baselineHit && candidateHit && candidateRow) gains.push(candidateRow);
    if (baselineHit && !candidateHit && baselineRow) losses.push(baselineRow);
  }
  return { gains, losses };
}

function examplesForDeltas(args: {
  rows: readonly TargetRow[];
  oppositeRows: ReadonlyMap<string, TargetRow>;
  direction: "gain" | "loss";
}): TargetDeltaExample[] {
  return [...args.rows]
    .sort(
      (a, b) =>
        a.repoId.localeCompare(b.repoId) ||
        a.targetFile.localeCompare(b.targetFile),
    )
    .slice(0, 12)
    .map((row) => {
      const opposite = args.oppositeRows.get(targetKey(row));
      const baselineRow = args.direction === "gain" ? opposite : row;
      const candidateRow = args.direction === "gain" ? row : opposite;
      return {
        repoId: row.repoId,
        changeType: row.changeType,
        targetFile: row.targetFile,
        query: row.query,
        baselineRank: baselineRow?.candidateRank ?? null,
        candidateRank: candidateRow?.candidateRank ?? null,
        baselineOutcome: baselineRow?.outcome ?? "missing_row",
        candidateOutcome: candidateRow?.outcome ?? "missing_row",
        factTokenOverlap: row.factTokenOverlap,
      };
    });
}

function indexObservabilityRows(
  rows: readonly ObservabilityRow[],
): ParsedObservability {
  const targets = new Map<string, TargetRow>();
  const noise = new Map<string, NoiseRow>();
  for (const row of rows) {
    if (isTargetRow(row)) targets.set(targetKey(row), row);
    if (isNoiseRow(row)) noise.set(noiseKey(row), row);
  }
  return { targets, noise };
}

function loadObservabilityRows(path: string): ObservabilityRow[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => parseJsonLine(path, line, index + 1));
}

function parseJsonLine(path: string, line: string, lineNumber: number): ObservabilityRow {
  try {
    return JSON.parse(line) as ObservabilityRow;
  } catch (error) {
    throw new Error(`${path}:${lineNumber}: invalid JSONL row: ${String(error)}`);
  }
}

function isTargetRow(row: ObservabilityRow): row is TargetRow {
  return row.kind === "target_file";
}

function isNoiseRow(row: ObservabilityRow): row is NoiseRow {
  return row.kind === "noise_candidate";
}

function targetHitAtDepth(row: TargetRow | undefined, depth: number): boolean {
  return row?.candidateRank !== null &&
    row?.candidateRank !== undefined &&
    row.candidateRank <= depth;
}

function noiseHitAtDepth(row: NoiseRow | undefined, depth: number): boolean {
  return row !== undefined && row.rank <= depth;
}

function targetKey(row: TargetRow): string {
  return [
    row.repoId,
    row.commit,
    row.promptIndex,
    row.targetFile,
  ].join("\0");
}

function noiseKey(row: NoiseRow): string {
  return [
    row.repoId,
    row.commit,
    row.promptIndex,
    row.sourcePath,
  ].join("\0");
}

function unionKeys<K, V>(
  left: ReadonlyMap<K, V>,
  right: ReadonlyMap<K, V>,
): K[] {
  return [...new Set([...left.keys(), ...right.keys()])];
}

function topCounts<T>(
  rows: readonly T[],
  keyFn: (row: T) => string,
  limit: number,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function compareCandidateReports(
  left: MetadataShadowCandidateReport,
  right: MetadataShadowCandidateReport,
): number {
  return right.topDepth.netTargets - left.topDepth.netTargets ||
    right.topDepth.zeroOverlapTargetGains - left.topDepth.zeroOverlapTargetGains ||
    left.topDepth.noFactNoiseEntrants - right.topDepth.noFactNoiseEntrants ||
    left.name.localeCompare(right.name);
}

function normalizeDepths(depths: readonly number[]): number[] {
  const normalized = [...new Set(depths)]
    .filter((depth) => Number.isInteger(depth) && depth > 0)
    .sort((a, b) => a - b);
  if (normalized.length === 0) {
    throw new Error("at least one positive integer depth is required");
  }
  return normalized;
}

function formatCounts(counts: readonly { key: string; count: number }[]): string {
  if (counts.length === 0) return "none";
  return counts.map((count) => `${count.key}=${count.count}`).join(", ");
}

function tableRow(cells: readonly (string | number)[]): string {
  return `| ${cells.join(" | ")} |`;
}

function renderExample(example: TargetDeltaExample): string {
  return [
    `${example.repoId}:${example.targetFile}`,
    `rank ${example.baselineRank ?? "-"} -> ${example.candidateRank ?? "-"}`,
    `${example.baselineOutcome} -> ${example.candidateOutcome}`,
    `fact_overlap=${example.factTokenOverlap}`,
    `query="${shorten(example.query, 72)}"`,
  ].join(" | ");
}

function shorten(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let baseline: string | undefined;
  const candidates: CandidateSpec[] = [];
  let depths = [10, 30, 100];
  let jsonOut: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--baseline=")) {
      baseline = arg.slice("--baseline=".length);
    } else if (arg.startsWith("--candidate=")) {
      candidates.push(parseCandidateArg(arg.slice("--candidate=".length)));
    } else if (arg.startsWith("--depths=")) {
      depths = arg.slice("--depths=".length)
        .split(",")
        .map((part) => Number.parseInt(part, 10));
    } else if (arg.startsWith("--json-out=")) {
      jsonOut = arg.slice("--json-out=".length);
    } else if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!baseline) throw new Error("--baseline is required");
  if (candidates.length === 0) throw new Error("at least one --candidate is required");
  return {
    baseline,
    candidates,
    depths: normalizeDepths(depths),
    ...(jsonOut ? { jsonOut } : {}),
  };
}

function parseCandidateArg(raw: string): CandidateSpec {
  const separator = raw.indexOf(":");
  if (separator <= 0) {
    return { name: basename(raw).replace(/\.jsonl$/i, ""), path: raw };
  }
  return {
    name: raw.slice(0, separator),
    path: raw.slice(separator + 1),
  };
}

function printUsageAndExit(code: number): never {
  console.log([
    "Usage:",
    "  node dist/eval/metadata-shadow-evaluator.js \\",
    "    --baseline=.contexttrail/evals/baseline.jsonl \\",
    "    --candidate=role:.contexttrail/evals/role.jsonl \\",
    "    --candidate=package:.contexttrail/evals/package.jsonl \\",
    "    --depths=10,30,100",
    "",
    "Compares target/noise movement between OSS code-lane observability JSONL files.",
  ].join("\n"));
  process.exit(code);
}

function runCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const report = buildMetadataShadowReport({
    baselineRows: loadObservabilityRows(args.baseline),
    candidates: args.candidates.map((candidate) => ({
      name: candidate.name,
      rows: loadObservabilityRows(candidate.path),
    })),
    depths: args.depths,
  });
  if (args.jsonOut) {
    writeFileSync(args.jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(renderMetadataShadowReport(report));
}

if (
  process.argv[1]?.endsWith("metadata-shadow-evaluator.js") ||
  process.argv[1]?.endsWith("metadata-shadow-evaluator.ts")
) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
