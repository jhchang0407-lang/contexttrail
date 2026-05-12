#!/usr/bin/env node
/**
 * Critical-source diagnosis workbench.
 *
 * Runs the existing Slice 0 capture stack and renders a short, action-oriented
 * report for the current real corpus. This is eval-only: it changes neither
 * retrieval nor presentation. The point is locality: one command should tell us
 * whether the remaining misses live in candidate generation, source selection,
 * display, query-mode, or unsupported honesty.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { realCorpusRoot } from "./real-corpus-fixture.js";
import { runSlice0CapturePerRepo } from "./slice0/runner.js";
import {
  aggregateSlice0Report,
  type Slice0Report,
} from "./slice0/report.js";
import { ORACLE_DIAGNOSTIC_LAYERS } from "./slice0/oracle-report.js";
import { PAIRWISE_LOSS_STAGES } from "./slice0/source-owner-pairs.js";
import { FAILURE_LAYERS } from "./slice0/failure-layer.js";

export type CriticalSourceDiagnosisOptions = {
  repos?: string[];
  json?: boolean;
};

export async function runCriticalSourceDiagnosis(
  opts: CriticalSourceDiagnosisOptions = {},
): Promise<Slice0Report> {
  const repos = opts.repos ?? discoverRepos();
  const captures = [];
  for (const repo of repos) {
    captures.push(await runSlice0CapturePerRepo(repo));
  }
  return aggregateSlice0Report({
    captures,
    synthetic_regression: false,
    generated_at: new Date().toISOString(),
  });
}

export function renderCriticalSourceDiagnosis(report: Slice0Report): string {
  const lines: string[] = [];
  const metrics = report.metrics;
  const oracle = report.oracle_failure_report;
  const pairwise = report.source_owner_pairwise;
  const top1Misses = oracle?.top1_misses ?? [];
  const answerable = report.answerable_cases;
  const top1 = Math.round(metrics.actual_top_source_top1_acceptable_rate * answerable);
  const top3 = Math.round(metrics.actual_top_source_top3_acceptable_rate * answerable);

  lines.push("Critical-source diagnosis");
  lines.push(`  repos: ${report.repos.join(", ")}`);
  lines.push(`  cases: ${report.case_count} (answerable=${answerable}, unsupported=${report.unsupported_cases})`);
  lines.push(`  answer top-1: ${top1}/${answerable}`);
  lines.push(`  answer top-3: ${top3}/${answerable}`);
  lines.push(`  top-1 misses: ${top1Misses.length}`);
  lines.push("");

  if (report.failure_layer_counts) {
    lines.push("Critical-source failure layers");
    lines.push("Layer                 cases");
    lines.push("─".repeat(27));
    for (const layer of FAILURE_LAYERS) {
      const count = report.failure_layer_counts[layer] ?? 0;
      if (count === 0 && layer !== "none") continue;
      lines.push(`${layer.padEnd(21)} ${String(count).padStart(5)}`);
    }
    lines.push("");
  }

  if (oracle) {
    lines.push("Top-1 miss decomposition");
    lines.push("Layer                                      cases");
    lines.push("─".repeat(56));
    for (const layer of ORACLE_DIAGNOSTIC_LAYERS) {
      const count = oracle.counts[layer] ?? 0;
      if (count === 0 && layer !== "top1_pass") continue;
      lines.push(`${layer.padEnd(42)} ${String(count).padStart(5)}`);
    }
    lines.push("");
    lines.push("Reachability");
    lines.push(`  expected source candidate@5:  ${oracle.reachability.expected_at_5}/${oracle.reachability.answerable_cases}`);
    lines.push(`  expected source candidate@10: ${oracle.reachability.expected_at_10}/${oracle.reachability.answerable_cases}`);
    lines.push(`  expected source candidate@20: ${oracle.reachability.expected_at_20}/${oracle.reachability.answerable_cases}`);
    lines.push(`  expected source candidate@50: ${oracle.reachability.expected_at_50}/${oracle.reachability.answerable_cases}`);
    lines.push("");
    if (top1Misses.length > 0) {
      lines.push("Top-1 miss cases");
      lines.push("Case                                           layer                                  exp_rank sel_rank applied top3");
      lines.push("─".repeat(116));
      for (const miss of top1Misses) {
        const caseId = `${miss.repo}/${miss.id}`;
        const top3Sources =
          miss.displayed_top3_sources.length > 0
            ? miss.displayed_top3_sources.join(",")
            : "—";
        lines.push(
          [
            caseId.padEnd(46),
            miss.layer.padEnd(38),
            String(miss.expected_source_rank ?? "—").padStart(8),
            String(miss.source_selection_owner_rank ?? "—").padStart(8),
            String(miss.source_selection_applied ?? "—").padStart(7),
            truncate(top3Sources, 40),
          ].join(" "),
        );
      }
      lines.push("");
    }
  }

  if (pairwise && pairwise.total > 0) {
    lines.push("Owner-vs-competitor probes");
    lines.push(`  passing: ${pairwise.passed}/${pairwise.total}`);
    lines.push("Stage                              cases");
    lines.push("─".repeat(43));
    for (const stage of PAIRWISE_LOSS_STAGES) {
      const count = pairwise.stage_counts[stage] ?? 0;
      if (count === 0 && stage !== "none") continue;
      lines.push(`${stage.padEnd(34)} ${String(count).padStart(5)}`);
    }
    lines.push("");
    for (const result of pairwise.results) {
      if (result.passed) continue;
      const r = result.ranks;
      lines.push(
        `  - ${result.repo}/${result.case_id}: ${result.first_loss_stage} ` +
          `(owner c/card/sel/display=${rankQuad(
            r.candidate_owner,
            r.source_card_owner,
            r.source_selection_owner,
            r.displayed_owner,
          )}; competitor=${rankQuad(
            r.candidate_competitor,
            r.source_card_competitor,
            r.source_selection_competitor,
            r.displayed_competitor,
          )})`,
      );
    }
    lines.push("");
  }

  lines.push("Read");
  lines.push(diagnosisRead(report));
  return lines.join("\n");
}

function diagnosisRead(report: Slice0Report): string {
  const oracle = report.oracle_failure_report;
  if (!oracle) return "  No oracle decomposition was available.";
  const topMisses = oracle.top1_misses.length;
  const queryMode = oracle.counts.query_mode_mismatch ?? 0;
  const candidate = oracle.counts.candidate_generation ?? 0;
  const selectionMiss = oracle.counts.source_selection_missed_owner ?? 0;
  const selectionUnapplied =
    oracle.counts.source_selection_identified_unapplied ?? 0;
  const answerOnly = oracle.counts.answer_only_top1_miss ?? 0;
  const parts = [
    `  ${topMisses} answer-bearing top-1 misses remain.`,
    `Query-mode mismatch accounts for ${queryMode}; candidate generation accounts for ${candidate}.`,
    `Source selection identifies-but-does-not-apply ${selectionUnapplied}, misses the owner ${selectionMiss}, and answer-only misses are ${answerOnly}.`,
  ];
  if (candidate > 0) {
    parts.push("The next structural leverage is still candidate/evidence generation, not another broad selector.");
  } else if (selectionMiss + selectionUnapplied > queryMode) {
    parts.push("The next structural leverage is a narrower selection policy with a stricter proof rule.");
  } else {
    parts.push("The next structural leverage is query-mode/anchor recognition and an explicit clarification Module.");
  }
  return parts.join(" ");
}

function rankQuad(
  a: number | null,
  b: number | null,
  c: number | null,
  d: number | null,
): string {
  return [a, b, c, d].map((rank) => rank ?? "—").join("/");
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  return value.slice(0, Math.max(0, width - 1)) + "…";
}

function discoverRepos(): string[] {
  const root = realCorpusRoot();
  const repos: string[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".yaml")) continue;
    if (name.endsWith(".config.yaml")) continue;
    const repo = name.replace(/\.yaml$/, "");
    try {
      if (statSync(join(root, repo)).isDirectory()) repos.push(repo);
    } catch {
      // Skip YAML files without a matching corpus directory.
    }
  }
  return repos.sort();
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repo = valueAfter(args, "--repo");
  const json = args.includes("--json");
  const report = await runCriticalSourceDiagnosis({
    repos: repo ? [repo] : undefined,
    json,
  });
  process.stdout.write(
    json
      ? JSON.stringify(report, null, 2) + "\n"
      : renderCriticalSourceDiagnosis(report) + "\n",
  );
}

if (
  process.argv[1]?.endsWith("critical-source-diagnosis.js") ||
  process.argv[1]?.endsWith("critical-source-diagnosis.ts")
) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
