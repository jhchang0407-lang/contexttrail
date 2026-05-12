#!/usr/bin/env node
/**
 * Offline shadow study for V3 source-selection apply gates.
 *
 * This command intentionally does not change production retrieval. It runs the
 * normal real-corpus pipeline, then replays candidate "apply V3 source order"
 * policies against the already-packed ranked list. The output answers one
 * question before we touch live ranking again:
 *
 *   If policy X had applied source_selection order, which cases would improve
 *   and which would regress?
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { closeDb, openDb } from "../store/db.js";
import { loadConfig } from "../config/load.js";
import { retrieve, type RetrievalResult } from "../retrieve/retrieve.js";
import { presentContextPack, type PresentedContextPack } from "../mcp/presenter.js";
import { listSourcesCanonical } from "../store/read-model.js";
import { shouldApplySourceSelection } from "../retrieve/source-rerank-pipeline.js";
import {
  classifyRealCorpusOutcome,
  createRealCorpusLab,
  loadRealCorpusEvalSet,
  realCorpusRoot,
  summarizeRealCorpus,
  type RealCorpusEvalCase,
  type RealCorpusFailureClass,
  type RealCorpusObservation,
} from "./real-corpus-fixture.js";
import type { AboutnessObservation } from "../retrieve/aboutness.js";
import type {
  SelectedSource,
  SourceSelectionDecision,
} from "../retrieve/source-selection-decision.js";
import { decideSourceEvidencePolicy } from "../retrieve/source-evidence-policy.js";

export const SHADOW_POLICY_NAMES = [
  "production_current",
  "current_reason_gate",
  "v3_all_supported",
  "v3_top3_source",
  "v3_covers_over_non_covers",
  "v3_unique_top3_cover",
  "v3_coverage_lead",
  "evidence_guarded_top3",
  "evidence_top3_source",
  "evidence_ranked_source",
  "oracle_v3_top3_rescue",
  "oracle_v3_ranked_rescue",
] as const;
export type ShadowPolicyName = typeof SHADOW_POLICY_NAMES[number];

type RankedEntry = PresentedContextPack["ranked"][number];

export type ShadowPolicyDecision = {
  apply: boolean;
  reason: string;
  oracle: boolean;
  sourceOrder?: string[];
  selectedTopSource?: string | null;
};

type CaseContext = {
  entry: RealCorpusEvalCase;
  result: RetrievalResult;
  baseline_ranked: RankedEntry[];
  acceptable_sources: string[];
  current_top_source: string | null;
  current_top3_sources: string[];
  current_ranked_sources: string[];
  selection: SourceSelectionDecision | undefined;
  selected_top: SelectedSource | undefined;
  aboutness_by_source: Map<string, AboutnessObservation>;
};

export type ShadowCaseResult = {
  repo: string;
  id: string;
  policy: ShadowPolicyName;
  applied: boolean;
  applyReason: string;
  oracle: boolean;
  baselineTop1Hit: boolean | null;
  shadowTop1Hit: boolean | null;
  baselineTop3Hit: boolean | null;
  shadowTop3Hit: boolean | null;
  baselineFailureClass: RealCorpusFailureClass;
  shadowFailureClass: RealCorpusFailureClass;
  baselineTopSource: string | null;
  shadowTopSource: string | null;
  selectedTopSource: string | null;
  currentQueryMode: RealCorpusEvalCase["expected_query_mode"];
  expectedQueryMode: RealCorpusEvalCase["expected_query_mode"];
};

export type ShadowPolicySummary = {
  policy: ShadowPolicyName;
  oracle: boolean;
  applied: number;
  answerBearingCases: number;
  answerTop1: number;
  answerTop3: number;
  trueTop3Misses: number;
  top3HitTop1Miss: number;
  improvedTop1: number;
  regressedTop1: number;
  netTop1: number;
  queryModeCorrect: number;
  coverageHonest: number;
  agentAnswer: number;
  byFailureClass: Record<RealCorpusFailureClass, number>;
  examples: {
    improved: string[];
    regressed: string[];
    appliedNoChange: string[];
  };
};

export type ShadowEvalReport = {
  repos: string[];
  cases: number;
  baseline: {
    answerBearingCases: number;
    answerTop1: number;
    answerTop3: number;
    trueTop3Misses: number;
    top3HitTop1Miss: number;
    queryModeCorrect: number;
    coverageHonest: number;
    agentAnswer: number;
    byFailureClass: Record<RealCorpusFailureClass, number>;
  };
  policies: ShadowPolicySummary[];
};

type ShadowEvalOptions = {
  repos?: string[];
  policies?: ShadowPolicyName[];
  json?: boolean;
  examplesLimit?: number;
};

const DEFAULT_EXAMPLES_LIMIT = 12;

const POLICY_DESCRIPTIONS: Record<ShadowPolicyName, string> = {
  production_current: "No shadow reorder; current production ranked order.",
  current_reason_gate: "Apply the same reason-code gate production uses, but at display-replay time.",
  v3_all_supported: "Apply every non-fail-closed V3 source-selection order.",
  v3_top3_source: "Apply when V3 top source is already present in displayed top-3.",
  v3_covers_over_non_covers:
    "Apply when V3 top is covers, current displayed top is not covers, and V3 top is in displayed top-3.",
  v3_unique_top3_cover:
    "Apply when V3 top is the only displayed top-3 source labeled covers.",
  v3_coverage_lead:
    "Apply when V3 top is covers and has a >=0.20 aboutness coverage lead over the current top.",
  evidence_guarded_top3:
    "Apply typed evidence-policy order only for a guarded top-3 correction with coverage lead or related unsupported root.",
  evidence_top3_source:
    "Apply typed evidence-policy order when its top source is already present in displayed top-3.",
  evidence_ranked_source:
    "Apply typed evidence-policy order when its top source is anywhere in the displayed ranked pack.",
  oracle_v3_top3_rescue:
    "Oracle ceiling: apply only when V3 top is acceptable, current top-1 misses, and V3 top is in displayed top-3.",
  oracle_v3_ranked_rescue:
    "Oracle ceiling: apply only when V3 top is acceptable, current top-1 misses, and V3 top is anywhere in the ranked pack.",
};

export async function runShadowApplyGateEval(
  opts: ShadowEvalOptions = {},
): Promise<ShadowEvalReport> {
  const repos = opts.repos ?? discoverRepos();
  const policies = opts.policies ?? [...SHADOW_POLICY_NAMES];
  const examplesLimit = opts.examplesLimit ?? DEFAULT_EXAMPLES_LIMIT;
  const baselineObservations: RealCorpusObservation[] = [];
  const byPolicy = new Map<ShadowPolicyName, ShadowCaseResult[]>(
    policies.map((policy) => [policy, []]),
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
          baselineObservations.push(
            observationFromRanked(repo, entry, response, response.ranked),
          );

          const context = buildCaseContext(entry, result, response.ranked);
          for (const policy of policies) {
            const decision = decidePolicy(policy, context);
            const shadowRanked = decision.apply
              ? applySourceOrder(response.ranked, result, decision.sourceOrder)
              : response.ranked;
            const baseline = classifyRanked(entry, response.query_mode, response.coverage_confidence, response.ranked);
            const shadow = classifyRanked(entry, response.query_mode, response.coverage_confidence, shadowRanked);
            byPolicy.get(policy)!.push({
              repo,
              id: entry.id,
              policy,
              applied: decision.apply,
              applyReason: decision.reason,
              oracle: decision.oracle,
              baselineTop1Hit: baseline.answerTop1Hit,
              shadowTop1Hit: shadow.answerTop1Hit,
              baselineTop3Hit: baseline.answerTop3Hit,
              shadowTop3Hit: shadow.answerTop3Hit,
              baselineFailureClass: baseline.failureClass,
              shadowFailureClass: shadow.failureClass,
              baselineTopSource: firstChunkSource(response.ranked, result),
              shadowTopSource: firstChunkSource(shadowRanked, result),
              selectedTopSource:
                decision.selectedTopSource ?? context.selected_top?.source_path ?? null,
              currentQueryMode: response.query_mode,
              expectedQueryMode: entry.expected_query_mode,
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

  const baselineSummary = summarizeRealCorpus(baselineObservations);
  return {
    repos,
    cases: baselineObservations.length,
    baseline: {
      answerBearingCases: baselineSummary.answerBearingCases,
      answerTop1: baselineSummary.answerTop1,
      answerTop3: baselineSummary.answerTop3,
      trueTop3Misses: baselineSummary.trueTop3Misses,
      top3HitTop1Miss: baselineSummary.top3HitTop1Miss,
      queryModeCorrect: baselineSummary.queryModeCorrect,
      coverageHonest: baselineSummary.coverageHonest,
      agentAnswer: baselineSummary.agentAnswer,
      byFailureClass: baselineSummary.byFailureClass,
    },
    policies: policies.map((policy) =>
      summarizePolicy(policy, byPolicy.get(policy) ?? [], baselineSummary.answerBearingCases, baselineSummary, examplesLimit),
    ),
  };
}

function buildCaseContext(
  entry: RealCorpusEvalCase,
  result: RetrievalResult,
  ranked: RankedEntry[],
): CaseContext {
  const selection = result.source_selection;
  const aboutnessBySource = new Map(
    (result.source_aboutness ?? []).map((obs) => [obs.source_path, obs]),
  );
  return {
    entry,
    result,
    baseline_ranked: ranked,
    acceptable_sources: entry.acceptable_top_sources ?? [entry.expected_top_source],
    current_top_source: firstChunkSource(ranked, result),
    current_top3_sources: firstNChunkSources(ranked, result, 3),
    current_ranked_sources: firstNChunkSources(ranked, result, Number.POSITIVE_INFINITY),
    selection,
    selected_top: selection?.selected_sources[0],
    aboutness_by_source: aboutnessBySource,
  };
}

export function decidePolicy(
  policy: ShadowPolicyName,
  context: CaseContext,
): ShadowPolicyDecision {
  if (policy === "production_current") {
    return { apply: false, reason: "baseline", oracle: false };
  }
  if (
    policy === "evidence_guarded_top3" ||
    policy === "evidence_top3_source" ||
    policy === "evidence_ranked_source"
  ) {
    return decideEvidencePolicy(policy, context);
  }
  const selection = context.selection;
  const top = context.selected_top;
  if (!selection || selection.fail_closed || !top) {
    return { apply: false, reason: "no_supported_selection", oracle: false };
  }
  const topInDisplayedTop3 = context.current_top3_sources.includes(top.source_path);
  const topAboutness = context.aboutness_by_source.get(top.source_path);
  const currentAboutness = context.current_top_source
    ? context.aboutness_by_source.get(context.current_top_source)
    : undefined;

  switch (policy) {
    case "current_reason_gate":
      return {
        apply: shouldApplySourceSelection(selection),
        reason: shouldApplySourceSelection(selection) ? "current_reason_gate" : "reason_gate_rejected",
        oracle: false,
      };
    case "v3_all_supported":
      return { apply: true, reason: "all_supported_selection", oracle: false };
    case "v3_top3_source":
      return {
        apply: topInDisplayedTop3,
        reason: topInDisplayedTop3 ? "selected_top_in_displayed_top3" : "selected_top_not_in_displayed_top3",
        oracle: false,
      };
    case "v3_covers_over_non_covers": {
      const apply =
        topInDisplayedTop3 &&
        top.aboutness_label === "covers" &&
        currentAboutness?.label !== "covers";
      return {
        apply,
        reason: apply ? "covers_over_non_covers" : "no_covers_over_non_covers",
        oracle: false,
      };
    }
    case "v3_unique_top3_cover": {
      const coverCount = new Set(
        context.current_top3_sources.filter(
          (source) => context.aboutness_by_source.get(source)?.label === "covers",
        ),
      ).size;
      const apply = topInDisplayedTop3 && top.aboutness_label === "covers" && coverCount === 1;
      return {
        apply,
        reason: apply ? "unique_top3_cover" : "not_unique_top3_cover",
        oracle: false,
      };
    }
    case "v3_coverage_lead": {
      const topCoverage = topAboutness?.combined_token_coverage ?? 0;
      const currentCoverage = currentAboutness?.combined_token_coverage ?? 0;
      const apply =
        topInDisplayedTop3 &&
        top.aboutness_label === "covers" &&
        topCoverage >= currentCoverage + 0.2;
      return {
        apply,
        reason: apply ? "coverage_lead_ge_0_20" : "coverage_lead_insufficient",
        oracle: false,
      };
    }
    case "oracle_v3_top3_rescue": {
      const baseline = classifyRanked(
        context.entry,
        context.result.query_mode,
        "confident",
        context.baseline_ranked,
      );
      const apply =
        topInDisplayedTop3 &&
        baseline.answerTop1Hit === false &&
        context.acceptable_sources.includes(top.source_path);
      return {
        apply,
        reason: apply ? "oracle_selected_top_is_acceptable" : "oracle_rejected",
        oracle: true,
      };
    }
    case "oracle_v3_ranked_rescue": {
      const baseline = classifyRanked(
        context.entry,
        context.result.query_mode,
        "confident",
        context.baseline_ranked,
      );
      const apply =
        context.current_ranked_sources.includes(top.source_path) &&
        baseline.answerTop1Hit === false &&
        context.acceptable_sources.includes(top.source_path);
      return {
        apply,
        reason: apply ? "oracle_selected_top_is_acceptable_ranked" : "oracle_rejected",
        oracle: true,
      };
    }
    default:
      return assertNever(policy);
  }
}

function decideEvidencePolicy(
  policy: Extract<
    ShadowPolicyName,
    "evidence_guarded_top3" | "evidence_top3_source" | "evidence_ranked_source"
  >,
  context: CaseContext,
): ShadowPolicyDecision {
  const cards = context.result.source_cards ?? [];
  const aboutness = context.result.source_aboutness ?? [];
  if (cards.length === 0 || aboutness.length === 0) {
    return { apply: false, reason: "no_source_evidence", oracle: false };
  }
  const decision = decideSourceEvidencePolicy({
    cards,
    aboutness,
    query_intent: context.result.query_intent ?? "broad_domain",
  });
  const top = decision.selected_sources[0];
  if (decision.fail_closed || !top) {
    return {
      apply: false,
      reason: "evidence_policy_fail_closed",
      oracle: false,
      selectedTopSource: null,
    };
  }
  const sourceOrder = decision.selected_sources.map((source) => source.source_path);
  const topInDisplayedTop3 = context.current_top3_sources.includes(top.source_path);
  const topInRanked = context.current_ranked_sources.includes(top.source_path);
  const apply =
    policy === "evidence_guarded_top3"
      ? topInDisplayedTop3 && shouldApplyGuardedEvidenceCorrection(context, top.source_path)
      : policy === "evidence_top3_source"
        ? topInDisplayedTop3
        : topInRanked;

  return {
    apply,
    reason: apply ? policy : "evidence_top_not_in_required_window",
    oracle: false,
    sourceOrder,
    selectedTopSource: top.source_path,
  };
}

function shouldApplyGuardedEvidenceCorrection(
  context: CaseContext,
  selectedTopSource: string,
): boolean {
  const current = context.current_top_source;
  if (!current || current === selectedTopSource) return false;

  const selectedAboutness = context.aboutness_by_source.get(selectedTopSource);
  const currentAboutness = context.aboutness_by_source.get(current);
  if (!selectedAboutness || !currentAboutness) return false;
  if (selectedAboutness.label !== "covers") return false;

  const selectedCard = context.result.source_cards?.find(
    (card) => card.source_path === selectedTopSource,
  );
  const currentCard = context.result.source_cards?.find(
    (card) => card.source_path === current,
  );
  const related =
    isSameParent(selectedTopSource, current) ||
    isStrictAncestorPath(selectedTopSource, current) ||
    isStrictAncestorPath(current, selectedTopSource);

  if (currentAboutness.label === "unsupported") {
    return related;
  }

  const coverageLead =
    selectedAboutness.combined_token_coverage >=
    currentAboutness.combined_token_coverage + 0.2;
  if (!coverageLead) return false;

  const selectedPurpose = selectedCard?.profile_signals?.doc_purpose;
  const currentPurpose = currentCard?.profile_signals?.doc_purpose;
  const selectedHasTrustedPurpose =
    selectedPurpose === "guide" ||
    selectedPurpose === "concept" ||
    selectedPurpose === "readme" ||
    selectedPurpose === "package_readme";
  const currentIsUnknown = currentPurpose === undefined || currentPurpose === "unknown";

  return related || (selectedHasTrustedPurpose && currentIsUnknown);
}

function applySourceOrder(
  ranked: RankedEntry[],
  result: RetrievalResult,
  sourceOrder?: string[],
): RankedEntry[] {
  const rankBySource = new Map<string, number>();
  if (sourceOrder) {
    sourceOrder.forEach((source, index) => {
      rankBySource.set(source, index + 1);
    });
  } else {
    result.source_selection?.selected_sources.forEach((source, index) => {
      rankBySource.set(source.source_path, index + 1);
    });
  }
  if (rankBySource.size === 0) return ranked;
  return [...ranked].sort((a, b) => {
    const aRank = sourceSelectionRank(a, result, rankBySource);
    const bRank = sourceSelectionRank(b, result, rankBySource);
    if (aRank !== bRank) return aRank - bRank;
    return ranked.indexOf(a) - ranked.indexOf(b);
  });
}

function sourceSelectionRank(
  ranked: RankedEntry,
  result: RetrievalResult,
  rankBySource: Map<string, number>,
): number {
  const source = sourceForRanked(ranked, result);
  if (!source) return Number.MAX_SAFE_INTEGER;
  return rankBySource.get(source) ?? Number.MAX_SAFE_INTEGER;
}

function isSameParent(a: string, b: string): boolean {
  return parentDir(a) === parentDir(b);
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function isStrictAncestorPath(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return false;
  const ancestorDir = stripExtension(ancestor);
  return descendant.startsWith(ancestorDir + "/");
}

function stripExtension(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  const lastDot = path.lastIndexOf(".");
  if (lastDot > lastSlash) return path.slice(0, lastDot);
  return path;
}

function summarizePolicy(
  policy: ShadowPolicyName,
  results: ShadowCaseResult[],
  answerBearingCases: number,
  baselineSummary: ReturnType<typeof summarizeRealCorpus>,
  examplesLimit: number,
): ShadowPolicySummary {
  const answerResults = results.filter((result) => result.baselineTop1Hit !== null);
  const answerTop1 = answerResults.filter((result) => result.shadowTop1Hit === true).length;
  const answerTop3 = answerResults.filter((result) => result.shadowTop3Hit === true).length;
  const trueTop3Misses = answerResults.filter((result) => result.shadowTop3Hit === false).length;
  const top3HitTop1Miss = answerResults.filter(
    (result) => result.shadowTop3Hit === true && result.shadowTop1Hit === false,
  ).length;
  const improved = answerResults.filter(
    (result) => result.baselineTop1Hit === false && result.shadowTop1Hit === true,
  );
  const regressed = answerResults.filter(
    (result) => result.baselineTop1Hit === true && result.shadowTop1Hit === false,
  );
  const byFailureClass: Record<RealCorpusFailureClass, number> = {
    none: 0,
    answer_recall_miss: 0,
    answer_ordering_miss: 0,
    signal_empty_dishonest: 0,
    query_mode_miss: 0,
    pack_shape_miss: 0,
  };
  for (const result of results) byFailureClass[result.shadowFailureClass] += 1;
  const appliedNoChange = results.filter(
    (result) =>
      result.applied &&
      result.baselineTop1Hit === result.shadowTop1Hit &&
      result.baselineTop3Hit === result.shadowTop3Hit,
  );
  return {
    policy,
    oracle: results.some((result) => result.oracle),
    applied: results.filter((result) => result.applied).length,
    answerBearingCases,
    answerTop1,
    answerTop3,
    trueTop3Misses,
    top3HitTop1Miss,
    improvedTop1: improved.length,
    regressedTop1: regressed.length,
    netTop1: answerTop1 - baselineSummary.answerTop1,
    queryModeCorrect: baselineSummary.queryModeCorrect,
    coverageHonest: baselineSummary.coverageHonest,
    agentAnswer: baselineSummary.agentAnswer,
    byFailureClass,
    examples: {
      improved: improved.slice(0, examplesLimit).map(formatCaseExample),
      regressed: regressed.slice(0, examplesLimit).map(formatCaseExample),
      appliedNoChange: appliedNoChange.slice(0, examplesLimit).map(formatCaseExample),
    },
  };
}

function observationFromRanked(
  repo: string,
  entry: RealCorpusEvalCase,
  response: PresentedContextPack,
  ranked: RankedEntry[],
): RealCorpusObservation {
  const acceptableTopSources = entry.acceptable_top_sources ?? [entry.expected_top_source];
  const expectedWarningKinds = entry.expected_warning_kinds ?? [];
  const responseWarningKinds = response.warnings.map((w) => w.kind);
  const missingWarningKinds = expectedWarningKinds.filter(
    (kind) => !responseWarningKinds.includes(kind as typeof responseWarningKinds[number]),
  );
  const expectsNoMatches =
    expectedWarningKinds.includes("no_matches") || entry.expectation_kind === "signal_empty";
  const rankedUseful = expectsNoMatches
    ? ranked.length === 0 || acceptableTopSources.some((source) => sourceInRanked(ranked, source))
    : acceptableTopSources.some((source) => sourceInRanked(ranked, source));
  const isSignalEmptyCase =
    entry.expectation_kind === "signal_empty" ||
    entry.expected_signal_empty_warning ||
    entry.expected_query_mode === "signal_empty";
  const firstChunk = ranked.find((r) => r.kind === "chunk");
  const top1Acceptable = isSignalEmptyCase
    ? response.coverage_confidence === "empty" || response.coverage_confidence === "uncertain"
    : firstChunk !== undefined &&
      acceptableTopSources.some((source) => firstChunk.contexttrail.includes(source));
  const agentAnswerPass =
    entry.must_include_sources.length === 0 ||
    entry.must_include_sources.every((source) => sourceInRanked(ranked, source));
  const hasSignalEmptyWarning = response.warnings.some(
    (warning) => warning.kind === "anchors_unrecognized",
  );
  const reportedEmpty = response.coverage_confidence === "empty";
  const reportedUncertain = response.coverage_confidence === "uncertain";
  const coverageHonest = isSignalEmptyCase ? reportedEmpty || reportedUncertain : !reportedEmpty;
  const classification = classifyRanked(
    entry,
    response.query_mode,
    response.coverage_confidence,
    ranked,
  );

  return {
    id: entry.id,
    notes: `${repo}: ${entry.notes}`,
    query_intent: entry.query_intent,
    assembly_need: entry.assembly_need,
    expectation_kind: entry.expectation_kind,
    capabilities: entry.capabilities,
    expected_query_mode: entry.expected_query_mode,
    actual_query_mode: response.query_mode,
    queryModeOk: response.query_mode === entry.expected_query_mode,
    signalEmptyWarningOk: hasSignalEmptyWarning === entry.expected_signal_empty_warning,
    expectedWarningsOk: missingWarningKinds.length === 0,
    missingWarningKinds,
    rankedUseful,
    top1Acceptable,
    agentAnswerPass,
    expectedTopSource: entry.expected_top_source,
    acceptableTopSources,
    mustIncludeSources: entry.must_include_sources,
    top3: ranked.slice(0, 3).map((r) => ({
      id: r.id,
      kind: r.kind,
      contexttrail: r.contexttrail,
      score: r.score,
    })),
    rankedCount: ranked.length,
    packTokensUsed: response.budget.used,
    rankedTokensUsed: ranked.reduce((sum, entry) => sum + entry.tokens, 0),
    payloadBytes: Buffer.byteLength(JSON.stringify(response)),
    warnings: responseWarningKinds,
    coverage_confidence: response.coverage_confidence,
    coverageHonest,
    chunkCorrect: null,
    pack_readiness: response.explain?.pack_readiness?.state ?? "partial",
    isAnswerBearing: classification.isAnswerBearing,
    answerTop1Hit: classification.answerTop1Hit,
    answerTop3Hit: classification.answerTop3Hit,
    answerReciprocalRank: classification.answerReciprocalRank,
    failureClass: classification.failureClass,
  };
}

function classifyRanked(
  entry: RealCorpusEvalCase,
  queryMode: RealCorpusEvalCase["expected_query_mode"],
  coverageConfidence: PresentedContextPack["coverage_confidence"],
  ranked: RankedEntry[],
) {
  return classifyRealCorpusOutcome({
    expectation_kind: entry.expectation_kind,
    expected_query_mode: entry.expected_query_mode,
    expected_signal_empty_warning: entry.expected_signal_empty_warning,
    expected_top_source: entry.expected_top_source,
    acceptableTopSources: entry.acceptable_top_sources ?? [entry.expected_top_source],
    mustIncludeSources: entry.must_include_sources,
    actual_query_mode: queryMode,
    coverage_confidence: coverageConfidence,
    ranked: ranked.map((r) => ({ kind: r.kind, contexttrail: r.contexttrail })),
  });
}

function firstChunkSource(
  ranked: RankedEntry[],
  result: RetrievalResult,
): string | null {
  for (const entry of ranked) {
    const source = sourceForRanked(entry, result);
    if (source) return source;
  }
  return null;
}

function firstNChunkSources(
  ranked: RankedEntry[],
  result: RetrievalResult,
  n: number,
): string[] {
  const out: string[] = [];
  for (const entry of ranked) {
    const source = sourceForRanked(entry, result);
    if (!source) continue;
    out.push(source);
    if (out.length >= n) break;
  }
  return out;
}

function sourceForRanked(
  ranked: RankedEntry,
  result: RetrievalResult,
): string | null {
  if (ranked.kind !== "chunk") return null;
  return result.chunksByVersionId.get(ranked.id)?.source_path ?? null;
}

function sourceInRanked(ranked: RankedEntry[], source: string): boolean {
  return ranked.some((entry) => entry.kind === "chunk" && entry.contexttrail.includes(source));
}

function formatCaseExample(result: ShadowCaseResult): string {
  return [
    `${result.repo}/${result.id}`,
    `${result.baselineTopSource ?? "none"} -> ${result.shadowTopSource ?? "none"}`,
    `selected=${result.selectedTopSource ?? "none"}`,
    `reason=${result.applyReason}`,
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

export function renderShadowEvalReport(report: ShadowEvalReport): string {
  const lines: string[] = [];
  const baseline = report.baseline;
  lines.push("Shadow apply-gate eval");
  lines.push(`  repos: ${report.repos.join(", ")}`);
  lines.push(`  cases: ${report.cases}`);
  lines.push(
    `  baseline answer top-1: ${baseline.answerTop1}/${baseline.answerBearingCases}`,
  );
  lines.push(
    `  baseline answer top-3: ${baseline.answerTop3}/${baseline.answerBearingCases}`,
  );
  lines.push(
    `  baseline misses: true_top3=${baseline.trueTop3Misses}, top3_hit_top1_miss=${baseline.top3HitTop1Miss}`,
  );
  lines.push("");
  lines.push(
    "Policy                     applied top1        Δtop1 top3        true_miss order_miss improved regressed",
  );
  lines.push("─".repeat(106));
  for (const policy of report.policies) {
    const top1 = `${policy.answerTop1}/${policy.answerBearingCases}`;
    const top3 = `${policy.answerTop3}/${policy.answerBearingCases}`;
    const delta = signed(policy.netTop1);
    lines.push(
      [
        policy.policy.padEnd(26),
        String(policy.applied).padStart(7),
        top1.padEnd(11),
        delta.padStart(5),
        top3.padEnd(11),
        String(policy.trueTop3Misses).padStart(9),
        String(policy.top3HitTop1Miss).padStart(10),
        String(policy.improvedTop1).padStart(8),
        String(policy.regressedTop1).padStart(9),
      ].join(" "),
    );
  }
  lines.push("");
  for (const policy of report.policies) {
    if (policy.policy === "production_current") continue;
    lines.push(`## ${policy.policy}${policy.oracle ? " (oracle ceiling)" : ""}`);
    lines.push(POLICY_DESCRIPTIONS[policy.policy]);
    if (policy.examples.improved.length > 0) {
      lines.push("  improved:");
      for (const example of policy.examples.improved) lines.push(`    - ${example}`);
    }
    if (policy.examples.regressed.length > 0) {
      lines.push("  regressed:");
      for (const example of policy.examples.regressed) lines.push(`    - ${example}`);
    }
    if (
      policy.examples.improved.length === 0 &&
      policy.examples.regressed.length === 0
    ) {
      lines.push("  no top-1 movement");
    }
    lines.push("");
  }
  return lines.join("\n");
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled policy: ${String(value)}`);
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repo = valueAfter(args, "--repo");
  const policyArg = valueAfter(args, "--policy");
  const json = args.includes("--json");
  const policies = policyArg
    ? policyArg.split(",").map((p) => {
        if (!SHADOW_POLICY_NAMES.includes(p as ShadowPolicyName)) {
          throw new Error(`Unknown policy '${p}'. Known: ${SHADOW_POLICY_NAMES.join(", ")}`);
        }
        return p as ShadowPolicyName;
      })
    : undefined;
  const report = await runShadowApplyGateEval({
    repos: repo ? [repo] : undefined,
    policies,
    json,
  });
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderShadowEvalReport(report));
    process.stdout.write("\n");
  }
}

if (process.argv[1]?.endsWith("shadow-apply-gates.js") || process.argv[1]?.endsWith("shadow-apply-gates.ts")) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
