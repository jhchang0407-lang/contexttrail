#!/usr/bin/env node
/**
 * Shadow eval for clarification gates.
 *
 * This does not change retrieval. It asks: if the engine declined to answer
 * low-signal requests and asked for clarification, how many true no-signal
 * cases would it catch and how many answer-bearing cases would it withhold?
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { closeDb, openDb } from "../store/db.js";
import { loadConfig } from "../config/load.js";
import { retrieve, type RetrievalResult } from "../retrieve/retrieve.js";
import { presentContextPack, type PresentedContextPack } from "../mcp/presenter.js";
import { listSourcesCanonical } from "../store/read-model.js";
import { listSourceProfiles } from "../store/source-profiles.js";
import {
  buildCorpusSupportIndex,
  CLARIFICATION_GATE_NAMES,
  decideClarificationGate,
  scoreTaskCorpusSupport,
  type ClarificationDecision,
  type ClarificationGateName,
  type CorpusSupportIndex,
  type CorpusSupportScore,
} from "../retrieve/clarification-gates.js";

export {
  buildCorpusSupportIndex,
  CLARIFICATION_GATE_NAMES,
  decideClarificationGate,
  scoreTaskCorpusSupport,
  type ClarificationDecision,
  type ClarificationGateName,
  type CorpusSupportIndex,
  type CorpusSupportScore,
};
import {
  classifyRealCorpusOutcome,
  createRealCorpusLab,
  loadRealCorpusEvalSet,
  realCorpusRoot,
  type RealCorpusEvalCase,
} from "./real-corpus-fixture.js";

type RankedEntry = PresentedContextPack["ranked"][number];

type ClarificationCaseResult = {
  repo: string;
  id: string;
  gate: ClarificationGateName;
  clarify: boolean;
  reason: string;
  isSignalEmptySeed: boolean;
  isAnswerBearing: boolean;
  answerTop1Hit: boolean | null;
  answerTop3Hit: boolean | null;
  topSource: string | null;
};

type ClarificationGateSummary = {
  gate: ClarificationGateName;
  cases: number;
  clarified: number;
  signalEmptyCases: number;
  signalEmptyClarified: number;
  signalEmptyMissed: number;
  answerBearingCases: number;
  answerBearingClarified: number;
  answerBearingAnswered: number;
  answerTop1IfAnswered: number;
  answerTop3IfAnswered: number;
  top1MissesRemaining: number;
  top1MissesConvertedToClarification: number;
  top1HitsWithheld: number;
  safeSuccess: number;
  examples: {
    clarifiedSignalEmpty: string[];
    withheldTop1Hit: string[];
    clarifiedTop1Miss: string[];
    residualTop1Miss: string[];
  };
};

export type ClarificationGateReport = {
  repos: string[];
  cases: number;
  gates: ClarificationGateSummary[];
};

type ClarificationGateOptions = {
  repos?: string[];
  gates?: ClarificationGateName[];
  examplesLimit?: number;
  json?: boolean;
};

const DEFAULT_EXAMPLES_LIMIT = 10;

export async function runClarificationGateShadowEval(
  opts: ClarificationGateOptions = {},
): Promise<ClarificationGateReport> {
  const repos = opts.repos ?? discoverRepos();
  const gates = opts.gates ?? [...CLARIFICATION_GATE_NAMES];
  const examplesLimit = opts.examplesLimit ?? DEFAULT_EXAMPLES_LIMIT;
  const byGate = new Map<ClarificationGateName, ClarificationCaseResult[]>(
    gates.map((gate) => [gate, []]),
  );

  for (const repo of repos) {
    const cases = loadRealCorpusEvalSet(repo);
    const lab = createRealCorpusLab(repo);
    try {
      lab.importCorpus();
      const db = openDb(join(lab.cwd, ".contexttrail", "cache", "contexttrail.db"));
      try {
        const config = loadConfig(lab.cwd);
        const requestedBudgetByName = config.retrieval.budgets;
        const hasSources = listSourcesCanonical(db).length > 0;
        const corpusSupport = buildCorpusSupportIndex(listSourceProfiles(db));

        for (const entry of cases) {
          const result = retrieve(
            db,
            {
              task: entry.task,
              query_anchors: {
                files: entry.files ?? [],
                symbols: entry.symbols ?? [],
                routes: entry.routes ?? [],
              },
              budget: entry.budget ?? "default",
              expected_locked: [],
              explain: true,
            },
            config,
          );
          const response = presentContextPack({
            query: entry.task,
            result,
            requested_budget: requestedBudgetByName[entry.budget ?? "default"],
            has_sources: hasSources,
            explain: true,
            min_final_score: config.retrieval.min_final_score,
          });
          const outcome = classifyRealCorpusOutcome({
            expectation_kind: entry.expectation_kind,
            expected_query_mode: entry.expected_query_mode,
            expected_signal_empty_warning: entry.expected_signal_empty_warning,
            expected_top_source: entry.expected_top_source,
            acceptableTopSources: entry.acceptable_top_sources ?? [
              entry.expected_top_source,
            ],
            mustIncludeSources: entry.must_include_sources,
            actual_query_mode: response.query_mode,
            coverage_confidence: response.coverage_confidence,
            ranked: response.ranked.map((ranked) => ({
              kind: ranked.kind,
              contexttrail: ranked.contexttrail,
            })),
          });
          const isSignalEmptySeed = isExpectedSignalEmpty(entry);
          const topSource = firstChunkSource(response.ranked, result);

          for (const gate of gates) {
            const decision = decideClarificationGate(gate, response, result, {
              task: entry.task,
              corpusSupport,
              hasCallerAnchors:
                (entry.files?.length ?? 0) > 0 ||
                (entry.symbols?.length ?? 0) > 0 ||
                (entry.routes?.length ?? 0) > 0,
            });
            byGate.get(gate)!.push({
              repo,
              id: entry.id,
              gate,
              clarify: decision.clarify,
              reason: decision.reason,
              isSignalEmptySeed,
              isAnswerBearing: outcome.isAnswerBearing,
              answerTop1Hit: outcome.answerTop1Hit,
              answerTop3Hit: outcome.answerTop3Hit,
              topSource,
            });
          }
        }
      } finally {
        closeDb(db);
      }
    } finally {
      lab.cleanup();
    }
  }

  return {
    repos,
    cases: [...byGate.values()][0]?.length ?? 0,
    gates: gates.map((gate) =>
      summarizeGate(gate, byGate.get(gate) ?? [], examplesLimit),
    ),
  };
}

function summarizeGate(
  gate: ClarificationGateName,
  results: ClarificationCaseResult[],
  examplesLimit: number,
): ClarificationGateSummary {
  const signalEmpty = results.filter((result) => result.isSignalEmptySeed);
  const answerBearing = results.filter((result) => result.isAnswerBearing);
  const answered = answerBearing.filter((result) => !result.clarify);
  const top1MissConverted = answerBearing.filter(
    (result) => result.clarify && result.answerTop1Hit === false,
  );
  const residualTop1Miss = answerBearing.filter(
    (result) => !result.clarify && result.answerTop1Hit === false,
  );
  const withheldTop1Hit = answerBearing.filter(
    (result) => result.clarify && result.answerTop1Hit === true,
  );
  const signalEmptyClarified = signalEmpty.filter((result) => result.clarify);
  const answerTop1IfAnswered = answered.filter(
    (result) => result.answerTop1Hit === true,
  ).length;
  const answerTop3IfAnswered = answered.filter(
    (result) => result.answerTop3Hit === true,
  ).length;

  return {
    gate,
    cases: results.length,
    clarified: results.filter((result) => result.clarify).length,
    signalEmptyCases: signalEmpty.length,
    signalEmptyClarified: signalEmptyClarified.length,
    signalEmptyMissed: signalEmpty.length - signalEmptyClarified.length,
    answerBearingCases: answerBearing.length,
    answerBearingClarified: answerBearing.length - answered.length,
    answerBearingAnswered: answered.length,
    answerTop1IfAnswered,
    answerTop3IfAnswered,
    top1MissesRemaining: residualTop1Miss.length,
    top1MissesConvertedToClarification: top1MissConverted.length,
    top1HitsWithheld: withheldTop1Hit.length,
    safeSuccess: signalEmptyClarified.length + answerTop1IfAnswered,
    examples: {
      clarifiedSignalEmpty: signalEmptyClarified
        .slice(0, examplesLimit)
        .map(formatExample),
      withheldTop1Hit: withheldTop1Hit.slice(0, examplesLimit).map(formatExample),
      clarifiedTop1Miss: top1MissConverted
        .slice(0, examplesLimit)
        .map(formatExample),
      residualTop1Miss: residualTop1Miss
        .slice(0, examplesLimit)
        .map(formatExample),
    },
  };
}

export function renderClarificationGateReport(
  report: ClarificationGateReport,
): string {
  const lines: string[] = [];
  lines.push("Clarification gate shadow eval");
  lines.push(`  repos: ${report.repos.join(", ")}`);
  lines.push(`  cases: ${report.cases}`);
  lines.push("");
  lines.push(
    "Gate                         clarify no-sig caught/missed answer clarified answered top1/answered top3/answered miss→clarify residual_miss withheld_top1 safe_success",
  );
  lines.push("─".repeat(150));
  for (const gate of report.gates) {
    const top1Answered =
      gate.answerBearingAnswered === 0
        ? "0/0"
        : `${gate.answerTop1IfAnswered}/${gate.answerBearingAnswered}`;
    const top3Answered =
      gate.answerBearingAnswered === 0
        ? "0/0"
        : `${gate.answerTop3IfAnswered}/${gate.answerBearingAnswered}`;
    lines.push(
      [
        gate.gate.padEnd(28),
        String(gate.clarified).padStart(7),
        `${gate.signalEmptyClarified}/${gate.signalEmptyMissed}`.padStart(14),
        String(gate.answerBearingClarified).padStart(16),
        top1Answered.padStart(13),
        top3Answered.padStart(13),
        String(gate.top1MissesConvertedToClarification).padStart(13),
        String(gate.top1MissesRemaining).padStart(13),
        String(gate.top1HitsWithheld).padStart(13),
        `${gate.safeSuccess}/${gate.cases}`.padStart(13),
      ].join(" "),
    );
  }
  lines.push("");
  for (const gate of report.gates) {
    if (gate.gate === "none") continue;
    lines.push(`## ${gate.gate}`);
    if (gate.examples.clarifiedTop1Miss.length > 0) {
      lines.push("  top-1 misses converted to clarification:");
      for (const example of gate.examples.clarifiedTop1Miss) {
        lines.push(`    - ${example}`);
      }
    }
    if (gate.examples.withheldTop1Hit.length > 0) {
      lines.push("  answer-bearing top-1 hits withheld:");
      for (const example of gate.examples.withheldTop1Hit) {
        lines.push(`    - ${example}`);
      }
    }
    if (gate.examples.residualTop1Miss.length > 0) {
      lines.push("  residual top-1 misses:");
      for (const example of gate.examples.residualTop1Miss) {
        lines.push(`    - ${example}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function isExpectedSignalEmpty(entry: RealCorpusEvalCase): boolean {
  return (
    entry.expectation_kind === "signal_empty" ||
    entry.expected_query_mode === "signal_empty" ||
    entry.expected_signal_empty_warning
  );
}

function firstChunkSource(
  ranked: RankedEntry[],
  result: RetrievalResult,
): string | null {
  for (const entry of ranked) {
    if (entry.kind !== "chunk") continue;
    const source = result.chunksByVersionId.get(entry.id)?.source_path;
    if (source) return source;
  }
  return null;
}

function formatExample(result: ClarificationCaseResult): string {
  return [
    `${result.repo}/${result.id}`,
    `top=${result.topSource ?? "none"}`,
    `reason=${result.reason}`,
  ].join(" | ");
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
      // Skip YAML files without a matching docs directory.
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
  const gateArg = valueAfter(args, "--gate");
  const json = args.includes("--json");
  const gates = gateArg
    ? gateArg.split(",").map((gate) => {
        if (!CLARIFICATION_GATE_NAMES.includes(gate as ClarificationGateName)) {
          throw new Error(
            `Unknown gate '${gate}'. Known: ${CLARIFICATION_GATE_NAMES.join(", ")}`,
          );
        }
        return gate as ClarificationGateName;
      })
    : undefined;
  const report = await runClarificationGateShadowEval({
    repos: repo ? [repo] : undefined,
    gates,
    json,
  });
  process.stdout.write(
    json ? JSON.stringify(report, null, 2) + "\n" : renderClarificationGateReport(report) + "\n",
  );
}

if (
  process.argv[1]?.endsWith("clarification-gate-shadow.js") ||
  process.argv[1]?.endsWith("clarification-gate-shadow.ts")
) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
