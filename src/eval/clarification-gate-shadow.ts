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
import type { SourceProfile } from "../types/source-profile.js";
import {
  DEFAULT_STOP_WORDS,
  tokenize as tokenizeRetrievalText,
} from "../retrieve/tokenize.js";
import {
  classifyRealCorpusOutcome,
  createRealCorpusLab,
  loadRealCorpusEvalSet,
  realCorpusRoot,
  type RealCorpusEvalCase,
} from "./real-corpus-fixture.js";

export const CLARIFICATION_GATE_NAMES = [
  "none",
  "signal_empty_mode",
  "uncertain_or_empty",
  "unsupported_or_signal_empty",
  "conservative_low_signal",
  "foreign_profile_support",
] as const;
export type ClarificationGateName = (typeof CLARIFICATION_GATE_NAMES)[number];

export type ClarificationDecision = {
  clarify: boolean;
  reason: string;
  support?: CorpusSupportScore;
};

export type CorpusSupportIndex = {
  profile_count: number;
  tokens: Set<string>;
  document_frequency: Map<string, number>;
  generic_document_frequency_cutoff: number;
};

export type CorpusSupportScore = {
  considered_tokens: string[];
  supported_tokens: string[];
  unsupported_tokens: string[];
  ignored_corpus_generic_tokens: string[];
  support_ratio: number;
};

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

export function decideClarificationGate(
  gate: ClarificationGateName,
  response: Pick<
    PresentedContextPack,
    "query_mode" | "coverage_confidence" | "warnings" | "ranked"
  >,
  result: Pick<RetrievalResult, "top_source_coverage">,
  opts: {
    task?: string;
    corpusSupport?: CorpusSupportIndex;
    hasCallerAnchors?: boolean;
  } = {},
): ClarificationDecision {
  if (gate === "none") return { clarify: false, reason: "baseline" };

  if (gate === "signal_empty_mode") {
    return {
      clarify: response.query_mode === "signal_empty",
      reason:
        response.query_mode === "signal_empty"
          ? "query_mode_signal_empty"
          : "query_mode_has_signal",
    };
  }

  if (gate === "uncertain_or_empty") {
    return {
      clarify: response.coverage_confidence !== "confident",
      reason:
        response.coverage_confidence !== "confident"
          ? `coverage_${response.coverage_confidence}`
          : "coverage_confident",
    };
  }

  const topCoverageDecision = result.top_source_coverage?.decision;
  if (gate === "unsupported_or_signal_empty") {
    const unsupported =
      topCoverageDecision === "unsupported" ||
      topCoverageDecision === "needs_anchors";
    const signalEmpty = response.query_mode === "signal_empty";
    return {
      clarify: unsupported || signalEmpty,
      reason: unsupported
        ? `top_source_${topCoverageDecision}`
        : signalEmpty
          ? "query_mode_signal_empty"
          : "supported_signal",
    };
  }

  const anchorWarning = response.warnings.some(
    (warning) => warning.kind === "anchors_unrecognized",
  );
  if (gate === "conservative_low_signal") {
    const clarify =
      response.query_mode === "signal_empty" ||
      topCoverageDecision === "unsupported" ||
      topCoverageDecision === "needs_anchors" ||
      (response.coverage_confidence === "empty" && response.ranked.length === 0) ||
      (anchorWarning && response.coverage_confidence !== "confident");
    return {
      clarify,
      reason: clarify ? "conservative_low_signal" : "has_enough_signal",
    };
  }

  if (gate === "foreign_profile_support") {
    const support = scoreTaskCorpusSupport(opts.task ?? "", opts.corpusSupport);
    if (opts.hasCallerAnchors) {
      return {
        clarify: false,
        reason: "caller_anchor_outside_gate_scope",
        support,
      };
    }
    if (!opts.corpusSupport || opts.corpusSupport.profile_count === 0) {
      return {
        clarify: false,
        reason: "no_corpus_support_index",
        support,
      };
    }
    if (support.considered_tokens.length === 0) {
      return {
        clarify: false,
        reason: "no_domain_tokens",
        support,
      };
    }

    const topCoverageDecision = result.top_source_coverage?.decision;
    const weakSupport =
      support.considered_tokens.length >= 2 && support.support_ratio <= 0.25;
    const noSupport = support.supported_tokens.length === 0;
    const lowResultConfidence =
      response.coverage_confidence !== "confident" ||
      topCoverageDecision === "unsupported" ||
      topCoverageDecision === "needs_anchors";
    const clarify = noSupport || (weakSupport && lowResultConfidence);
    return {
      clarify,
      reason: clarify
        ? noSupport
          ? "no_profile_domain_support"
          : "weak_profile_domain_support"
        : "profile_domain_supported",
      support,
    };
  }

  return assertNever(gate);
}

const FOREIGN_SUPPORT_EXTRA_STOP_WORDS = new Set([
  "what",
  "why",
  "how",
  "when",
  "where",
  "which",
  "who",
  "doc",
  "docs",
  "documentation",
  "guide",
  "guides",
  "overview",
  "reference",
  "references",
  "use",
  "uses",
  "using",
  "setup",
  "set",
  "configure",
  "configuration",
  "config",
  "add",
  "build",
  "create",
  "make",
  "run",
  "runs",
  "running",
  "work",
  "works",
  "working",
  "handle",
  "handling",
  "implement",
  "implementation",
  "integrate",
  "integration",
  "deploy",
  "deployment",
  "migrate",
  "migration",
  "database",
  "file",
  "files",
  "project",
  "projects",
  "app",
  "apps",
  "application",
  "mode",
  "api",
  "server",
  "client",
  "backend",
  "endpoint",
  "via",
  "call",
  "function",
  "functions",
  "other",
  "part",
  "directly",
  "component",
  "components",
  "command",
  "line",
  "state",
]);

const FOREIGN_SUPPORT_STOP_WORDS = new Set([
  ...DEFAULT_STOP_WORDS,
  ...FOREIGN_SUPPORT_EXTRA_STOP_WORDS,
]);

export function buildCorpusSupportIndex(
  profiles: SourceProfile[],
): CorpusSupportIndex {
  const tokens = new Set<string>();
  const documentFrequency = new Map<string, number>();
  for (const profile of profiles) {
    const profileTokens = new Set(profileSupportTokens(profile));
    for (const token of profileTokens) {
      tokens.add(token);
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  return {
    profile_count: profiles.length,
    tokens,
    document_frequency: documentFrequency,
    generic_document_frequency_cutoff: Math.max(
      3,
      Math.ceil(profiles.length * 0.25),
    ),
  };
}

export function scoreTaskCorpusSupport(
  task: string,
  corpusSupport?: CorpusSupportIndex,
): CorpusSupportScore {
  const considered = dedupePreserveOrder(
    tokenizeRetrievalText(task, {
      stopWords: FOREIGN_SUPPORT_STOP_WORDS,
      stem: true,
    }),
  );
  const domainTokens = corpusSupport
    ? considered.filter((token) => !isCorpusGenericToken(token, corpusSupport))
    : considered;
  const ignoredCorpusGeneric = corpusSupport
    ? considered.filter((token) => isCorpusGenericToken(token, corpusSupport))
    : [];
  const supported = corpusSupport
    ? domainTokens.filter((token) => corpusSupport.tokens.has(token))
    : [];
  const unsupported = corpusSupport
    ? domainTokens.filter((token) => !corpusSupport.tokens.has(token))
    : domainTokens;
  return {
    considered_tokens: domainTokens,
    supported_tokens: supported,
    unsupported_tokens: unsupported,
    ignored_corpus_generic_tokens: ignoredCorpusGeneric,
    support_ratio:
      domainTokens.length === 0 ? 1 : supported.length / domainTokens.length,
  };
}

function isCorpusGenericToken(
  token: string,
  corpusSupport: CorpusSupportIndex,
): boolean {
  return (
    (corpusSupport.document_frequency.get(token) ?? 0) >=
    corpusSupport.generic_document_frequency_cutoff
  );
}

function profileSupportTokens(profile: SourceProfile): string[] {
  const parts: string[] = [
    profile.source_path,
    profile.title,
    profile.h1 ?? "",
    profile.nav_label ?? "",
    profile.package_segment ?? "",
    profile.version_segment ?? "",
    ...profile.aliases.map((alias) => alias.value),
    ...profile.heading_outline.map((heading) => heading.text),
    ...(profile.heading_aliases ?? []).map((alias) => alias.surface),
  ];
  return parts.flatMap((part) =>
    tokenizeRetrievalText(part, {
      stopWords: FOREIGN_SUPPORT_STOP_WORDS,
      stem: true,
    }),
  );
}

function dedupePreserveOrder<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
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

function assertNever(value: never): never {
  throw new Error(`Unhandled clarification gate: ${String(value)}`);
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
