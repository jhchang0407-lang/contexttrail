import { createHandlers } from "../mcp/handlers.js";
import type { ContextTrailConfig } from "../config/defaults.js";
import { EVAL_SET, validateEvalSet } from "./corpus.js";
import { createEvalFixtureLab } from "./lab.js";
import { summarize, summarizeAssembly, summarizeFragilePasses, summarizeTokens } from "./report.js";
import type { EvalObservation, EvalReport } from "./types.js";

export { EVAL_SET, validateEvalSet } from "./corpus.js";
export { EXPECTED_EVAL_CASES } from "./corpus.js";
export {
  compareEvalReports,
  evaluateGates,
  rate,
  renderEvalReport,
  renderEvalReportWithBaseline,
  summarize,
  summarizeAssembly,
  summarizeTokens,
} from "./report.js";
export type {
  EvalCase,
  EvalGate,
  EvalObservation,
  EvalReport,
  EvalSummary,
  EvalSummaryRow,
  FragilePassSummary,
} from "./types.js";

export type FixtureEvalOptions = {
  configOverride?: ContextTrailConfig;
};

function sourceInRankedTop(ranked: { kind: "chunk" | "card" | "code"; contexttrail: string }[], source: string): boolean {
  return ranked.slice(0, 3).some((entry) => entry.kind === "chunk" && entry.contexttrail.includes(source));
}

function sourceIncluded(ranked: { kind: "chunk" | "card" | "code"; contexttrail: string }[], source: string): boolean {
  return ranked.some((entry) => entry.kind === "chunk" && entry.contexttrail.includes(source));
}

function sourceFromContextTrail(contexttrail: string): string | undefined {
  const match = contexttrail.match(/^Source: (.+?) > Section:/);
  return match?.[1];
}

const ASSEMBLY_STAGE_ORDER = [
  "not_applicable",
  "primary_only",
  "parent",
  "siblings",
  "source_sibling",
  "linked_neighbor",
] as const;

function assemblyStageIndex(stage: string): number {
  const index = ASSEMBLY_STAGE_ORDER.indexOf(stage as (typeof ASSEMBLY_STAGE_ORDER)[number]);
  if (index === -1) {
    throw new Error(`Unknown assembly stage '${stage}'`);
  }
  return index;
}

export function compareAssemblyStage(
  actual: string,
  expected: string,
): number {
  return assemblyStageIndex(actual) - assemblyStageIndex(expected);
}

export async function runFixtureRetrievalEval(options?: FixtureEvalOptions): Promise<EvalReport> {
  validateEvalSet(EVAL_SET);
  const lab = createEvalFixtureLab();
  try {
    lab.importCorpus();
    const handlers = createHandlers({ cwd: lab.cwd, config: options?.configOverride });
    const observations: EvalObservation[] = [];

    for (const entry of EVAL_SET) {
      const response = await handlers.retrieve_context_pack({
        task: entry.task,
        files: entry.files,
        symbols: entry.symbols,
        routes: entry.routes,
        budget: entry.budget,
        expected_locked: entry.expected_locked,
        explain: true,
      });

      const providedAnchorCount =
        (entry.files?.length ?? 0) + (entry.symbols?.length ?? 0) + (entry.routes?.length ?? 0);
      const lockedIds = response.locked.map((locked) => locked.id);
      const lockedOk = entry.expected_locked.every((id) => lockedIds.includes(id));
      const queryModeOk = response.query_mode === entry.expected_query_mode;
      const forbiddenLocked = entry.forbidden_locked ?? [];
      const forbiddenLockedHits = forbiddenLocked.filter((id) => lockedIds.includes(id));
      const forbiddenLockedOk = forbiddenLockedHits.length === 0;
      const forbiddenTopSubstrings = entry.forbidden_in_top_3 ?? [];
      const top3Entries = response.ranked.slice(0, 3);
      const top3ChunkSources = top3Entries
        .filter((entry) => entry.kind === "chunk")
        .map((entry) => sourceFromContextTrail(entry.contexttrail))
        .filter((source): source is string => source !== undefined);
      const top3UniqueChunkSources = new Set(top3ChunkSources).size;
      const forbiddenTopHits = forbiddenTopSubstrings.filter((substring) =>
        top3Entries.some((entry) => entry.kind === "chunk" && entry.contexttrail.includes(substring)),
      );
      const forbiddenTopOk = forbiddenTopHits.length === 0;
      const expectedWarningKinds = entry.expected_warning_kinds ?? [];
      const responseWarningKinds = response.warnings.map((w) => w.kind);
      const missingWarningKinds = expectedWarningKinds.filter((k) => !responseWarningKinds.includes(k as typeof responseWarningKinds[number]));
      const expectedWarningsOk = missingWarningKinds.length === 0;
      const hasSignalEmptyWarning = response.warnings.some((warning) => warning.kind === "anchors_unrecognized");
      // Cases that expect `no_matches` are vague-query tests where empty ranked
      // is the *expected* outcome — rankedUseful is vacuously true. The engine's
      // actual emission of no_matches is gated separately via expected_warnings.
      const expectsNoMatches = expectedWarningKinds.includes("no_matches");
      const acceptableTopSources = entry.acceptable_top_sources ?? [entry.expected_top_source];
      const rankedUseful = expectsNoMatches
        ? true
        : acceptableTopSources.some((source) => sourceInRankedTop(response.ranked, source));
      const agentAnswerPass =
        entry.must_include_sources.length === 0 ||
        entry.must_include_sources.every((source) => sourceIncluded(response.ranked, source));
      const omittedUseful = response.omitted.total === 0 || response.omitted.top.length > 0;
      const evidenceOk = (entry.expected_evidence_covers_locked ?? []).every((id) => {
        const evidence = response.locked.find((locked) => locked.id === id);
        return evidence?.lock_reason === "evidence_covers_locked" && (evidence.derived_from?.length ?? 0) > 0;
      });
      const top1Acceptable =
        top3Entries[0]?.kind === "chunk" &&
        acceptableTopSources.some((source) => top3Entries[0]!.contexttrail.includes(source));
      const top3MustIncludeHits = entry.must_include_sources.filter((source) =>
        top3Entries.some((ranked) => ranked.kind === "chunk" && ranked.contexttrail.includes(source)),
      );
      const top3MustIncludeCoverage =
        entry.must_include_sources.length === 0
          ? 1
          : top3MustIncludeHits.length / entry.must_include_sources.length;
      const top3SourceBalance =
        top3ChunkSources.length <= 1 ? 1 : top3UniqueChunkSources / top3ChunkSources.length;
      const evidenceVisible =
        response.locked.some((locked) => locked.card_type === "evidence") ||
        response.ranked.some((ranked) => ranked.kind === "card" && ranked.contexttrail.includes("(evidence)"));
      const budgetPreset = entry.budget ?? "default";
      const lockedTokens = response.locked.reduce((sum, locked) => sum + locked.tokens, 0);
      const rankedTokens = response.ranked.reduce((sum, ranked) => sum + ranked.tokens, 0);
      const packTokensUsed = response.budget.used;
      const tokenBand =
        packTokensUsed < 5000 ? "under_5k" : packTokensUsed <= 12000 ? "within_5k_12k" : "over_12k";
      const chunkExplainTraces =
        response.explain?.per_chunk.filter((trace) => !/^[CSE]\d{3,}$/.test(trace.id)) ?? [];
      const assemblyStageExpected = entry.minimal_sufficient_stage ?? "not_applicable";
      const assemblyStageActual = response.assembly_stage_reached;
      const assemblyStageDelta = compareAssemblyStage(assemblyStageActual, assemblyStageExpected);
      const assemblyStageTracked = entry.minimal_sufficient_stage !== undefined;
      const assemblyStageOk = assemblyStageTracked ? assemblyStageDelta === 0 : true;

      observations.push({
        id: entry.id,
        notes: entry.notes,
        query_intent: entry.query_intent!,
        assembly_need: entry.assembly_need!,
        expectation_kind: entry.expectation_kind!,
        capabilities: entry.capabilities!,
        fragile: entry.fragile ?? false,
        acceptableTopSources,
        anchor_source: entry.anchor_source,
        expected_query_mode: entry.expected_query_mode,
        actual_query_mode: response.query_mode,
        baselineRankedUseful: entry.baseline_ranked_useful,
        lockedOk,
        queryModeOk,
        forbiddenLockedOk,
        forbiddenTopOk,
        expectedWarningsOk,
        missingWarningKinds,
        signalEmptyWarningOk: hasSignalEmptyWarning === entry.expected_signal_empty_warning,
        rankedUseful,
        agentAnswerPass,
        omittedUseful,
        evidenceOk,
        explainPresent: response.explain !== undefined,
        queryCompilationMode: response.explain?.query_compilation.query_mode,
        queryCompilationAnchorCount: response.explain?.query_compilation.anchors.length ?? 0,
        providedAnchorCount,
        chunkExplainHasDocRole: chunkExplainTraces.every((trace) => trace.doc_role !== undefined),
        expectedLocked: entry.expected_locked,
        actualLocked: lockedIds,
        forbiddenLocked,
        forbiddenLockedHits,
        forbiddenTopSubstrings,
        forbiddenTopHits,
        expectedTopSource: entry.expected_top_source,
        mustIncludeSources: entry.must_include_sources,
        top3: top3Entries.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          contexttrail: entry.contexttrail,
          score: entry.score,
        })),
        top1Acceptable: Boolean(top1Acceptable),
        top3MustIncludeCoverage,
        top3SourceBalance,
        top3UniqueChunkSources,
        evidenceVisible,
        warningVisible: response.warnings.length > 0,
        rankedCount: response.ranked.length,
        lockedCount: response.locked.length,
        assemblyStageExpected,
        assemblyStageActual,
        assemblyStageOk,
        underExpanded: assemblyStageTracked && assemblyStageDelta < 0,
        overExpanded: assemblyStageTracked && assemblyStageDelta > 0,
        budgetPreset,
        packTokensUsed,
        lockedTokens,
        rankedTokens,
        tokenBand,
        payloadBytes: Buffer.byteLength(JSON.stringify(response)),
        omittedTotal: response.omitted.total,
        warnings: response.warnings.map((warning) => warning.kind),
        lockFailures: response.explain?.lock_failures ?? [],
      });
    }

    return {
      fixture: "tests/fixtures/eval-set.yaml",
      cases: observations.length,
      observations,
      summary: summarize(observations),
      assembly_summary: summarizeAssembly(observations),
      token_summary: summarizeTokens(observations),
      fragile_passes: summarizeFragilePasses(observations),
    };
  } finally {
    lab.cleanup();
  }
}
