/**
 * Real-corpus retrieval eval — parallel to runFixtureRetrievalEval, but
 * runs against snapshotted external repos (Ralph, Prisma, ...) under
 * `tests/fixtures/real-corpus/<repo>/`.
 *
 * External repos have no ContextTrail Cards yet, so the seed YAML is a
 * subset of EvalCase: Card-bearing fields (expected_locked,
 * expected_evidence_covers_locked) are dropped. The harness evaluates
 * document-surface truth.
 *
 * Anchored from week-7 plan:
 *   docs/plan/week-7-baseline-and-experiments-2026-05.md (Phase 1.2.5).
 */
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { createHandlers } from "../mcp/handlers.js";
import { loadRealCorpusImportGlobs } from "./real-corpus-config.js";
import { closeDb, openDb } from "../store/db.js";
import {
	ANCHOR_SOURCES,
	ASSEMBLY_NEEDS,
	ASSEMBLY_STAGES,
	EXPECTATION_KINDS,
	FACT_FINDING_CAPABILITIES,
	QUERY_INTENTS,
	type AnchorSource,
	type AssemblyNeed,
	type AssemblyStage,
	type ExpectationKind,
	type FactFindingCapability,
	type QueryIntent,
} from "./types.js";
import { evaluateChunkCorrectness } from "../readiness/chunk-correctness.js";
import {
	PACK_READINESS_STATES,
	type PackReadinessState,
} from "../readiness/eval-readiness.js";
import { orchestratePackReadiness } from "../readiness/orchestrator.js";
import type { TaskNeed } from "../readiness/task-need.js";
import type { PackReadinessReasonCode } from "../readiness/pack-verifier.js";
import type { SourceChunkCandidate } from "../readiness/chunk-selector.js";
import { listCurrentChunksCanonical } from "../store/read-model.js";
import type { RecoveryPlan } from "../readiness/recovery-plan.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const REAL_CORPUS_ROOT = resolve(REPO_ROOT, "tests", "fixtures", "real-corpus");

/**
 * Legacy alias kept for backward compatibility with eval baselines that
 * imported the constant directly. Prefer `loadRealCorpusImportGlobs(repo)`
 * (THO-135) so per-repo overrides take effect.
 */
export const REAL_CORPUS_IMPORT_GLOBS = [
	"*.md",
	"docs/**/*.md",
	"packages/**/*.md",
];

export type RealCorpusEvalCase = {
	id: string;
	task: string;
	query_intent: QueryIntent;
	assembly_need: AssemblyNeed;
	expectation_kind: ExpectationKind;
	capabilities: FactFindingCapability[];
	anchor_source?: AnchorSource;
	minimal_sufficient_stage?: AssemblyStage;
	files?: string[];
	symbols?: string[];
	routes?: string[];
	budget?: "small" | "default" | "large";
	expected_query_mode: "anchored" | "signal_empty" | "unanchored";
	expected_warning_kinds?: string[];
	expected_signal_empty_warning: boolean;
	expected_top_source: string;
	acceptable_top_sources?: string[];
	must_include_sources: string[];
	/** PRD-0015 Slice 1: optional heading substrings the top-1 chunk's
	 *  drift should contain. When set, enables chunk-correctness
	 *  scoring for the case. Omit (or leave empty) to leave the case
	 *  unscored on chunk correctness. Matched case-insensitively against
	 *  the drift (which already contains source path + heading
	 *  path). */
	expected_chunk_headings?: string[];
	notes: string;
};

export type RealCorpusObservation = {
	id: string;
	notes: string;
	query_intent: QueryIntent;
	assembly_need: AssemblyNeed;
	expectation_kind: ExpectationKind;
	capabilities: FactFindingCapability[];
	expected_query_mode: RealCorpusEvalCase["expected_query_mode"];
	actual_query_mode: RealCorpusEvalCase["expected_query_mode"];
	queryModeOk: boolean;
	signalEmptyWarningOk: boolean;
	expectedWarningsOk: boolean;
	missingWarningKinds: string[];
	rankedUseful: boolean;
	top1Acceptable: boolean;
	agentAnswerPass: boolean;
	expectedTopSource: string;
	acceptableTopSources: string[];
	mustIncludeSources: string[];
	top3: {
		id: string;
		kind: "chunk" | "card";
		contexttrail: string;
		score: number;
		source_path?: string;
	}[];
	/** Optional wider slate used as the unassisted/manual-search proxy. */
	top5?: {
		id: string;
		kind: "chunk" | "card";
		contexttrail: string;
		score: number;
		source_path?: string;
	}[];
	rankedCount: number;
	packTokensUsed: number;
	/** Token mass of the raw ranked slate before pack shaping. */
	rankedTokensUsed: number;
	/** Manual-search proxy: token mass of the imported corpus in this repo. */
	manualCorpusTokensUsed?: number;
	/** Competent manual lookup proxy: token mass of the gold source file(s). */
	manualTargetedTokensUsed?: number;
	/** Product-facing decision object returned by retrieve_context_pack. */
	recovery_plan?: RecoveryPlan;
	payloadBytes: number;
	warnings: string[];
	/** ADR-0019 Phase C1: corpus-coverage state of the resulting top-1. */
	coverage_confidence: "confident" | "uncertain" | "empty";
	/** True when actual coverage_confidence agrees with the seed's
	 *  expected_signal_empty_warning. Empty queries should report empty;
	 *  confident queries should not. */
	coverageHonest: boolean;
	/** PRD-0015 Slice 1: did the engine pick the right chunk inside the
	 *  selected source? Null when the case declares no chunk expectation
	 *  (chunk correctness is unscored for that case). */
	chunkCorrect: boolean | null;
	/** PRD-0015 Slice 1: internal pack-readiness state derived from
	 *  retrieval signals. Internal-only diagnostic; not yet promoted to
	 *  the public MCP contract. */
	pack_readiness: PackReadinessState;
	/** PRD-0015 Slice 5: readiness orchestrator output. Surfaces extracted
	 *  task needs, satisfied vs missing needs, and stable reason codes so
	 *  reports can explain *why* a pack was labeled partial / needs_anchors.
	 *  Optional so legacy callers and tests do not need to populate it. */
	readiness_diagnostics?: {
		needs: TaskNeed[];
		satisfiedNeeds: TaskNeed[];
		missingNeeds: TaskNeed[];
		reasonCodes: PackReadinessReasonCode[];
	};
	/** PRD-0016 P16.1 / THO-159: split answer-bearing retrieval quality from
	 *  signal-empty honesty. answer-bearing cases have an expected source
	 *  to find; signal-empty cases are scored only on coverage honesty.
	 *  These fields are null on signal-empty cases so signal-empty
	 *  honesty cannot bleed into answer top-1/top-3 metrics. */
	isAnswerBearing: boolean;
	/** Did the first ranked chunk's source match an acceptable top source?
	 *  Null when the case is not answer-bearing (signal-empty). */
	answerTop1Hit: boolean | null;
	/** Did any of the first three ranked chunks match? Null on signal-empty. */
	answerTop3Hit: boolean | null;
	/** 1/(1-based rank of first matching ranked chunk in the full ranked
	 *  list); 0 when the source is absent from the ranked list; null on
	 *  signal-empty. Aggregated to mean reciprocal rank in the summary. */
	answerReciprocalRank: number | null;
	/** Stable reason code describing the case outcome. "none" for a clean
	 *  pass; other values let reports point at the actual failure mode
	 *  (recall, ordering, signal-empty honesty, query mode, pack shape). */
	failureClass: RealCorpusFailureClass;
};

/** PRD-0016 P16.1 / THO-159: stable per-case classification used in
 *  reports and per-cohort cohort tracking. The classifier prioritizes
 *  ranking failures (which PRD-0016 targets) over surrounding wire
 *  issues so accepted slices have a clear cohort to move. */
export const REAL_CORPUS_FAILURE_CLASSES = [
	"none",
	"answer_recall_miss",
	"answer_ordering_miss",
	"signal_empty_dishonest",
	"query_mode_miss",
	"pack_shape_miss",
] as const;
export type RealCorpusFailureClass =
	(typeof REAL_CORPUS_FAILURE_CLASSES)[number];

export type RealCorpusReport = {
	repo: string;
	fixture: string;
	cases: number;
	observations: RealCorpusObservation[];
	summary: RealCorpusSummary;
};

export type RealCorpusSummary = {
	cases: number;
	rankedUseful: number;
	top1Acceptable: number;
	queryModeCorrect: number;
	signalEmptyHonest: number;
	coverageHonest: number;
	agentAnswer: number;
	avgPayloadBytes: number;
	byIntent: Record<string, RealCorpusSummaryRow>;
	/** PRD-0015 Slice 1: chunk-correctness counts. Only cases that declared
	 *  `expected_chunk_headings` contribute. */
	chunkScored: number;
	chunkCorrect: number;
	/** PRD-0015 Slice 1: histogram of internal pack-readiness states. */
	byReadiness: Record<PackReadinessState, number>;
	/** PRD-0016 P16.1 / THO-159: answer-bearing retrieval cohort. */
	answerBearingCases: number;
	/** Number of answer-bearing cases whose first ranked chunk matches an
	 *  acceptable top source. */
	answerTop1: number;
	/** Number of answer-bearing cases whose top-3 contains an acceptable
	 *  top source. */
	answerTop3: number;
	/** Mean reciprocal rank averaged over answer-bearing cases (0 when
	 *  there are no answer-bearing cases). Per-case reciprocal rank is
	 *  taken over the full ranked list, not just top-3, so MRR rewards
	 *  near-misses. */
	answerMrr: number;
	/** Number of answer-bearing cases where the source is not present in
	 *  the top-3 (this PRD's "true top-3 misses" recall cohort). */
	trueTop3Misses: number;
	/** Number of answer-bearing cases where the source appears in the
	 *  top-3 but is not the top-1 (PRD-0016 ordering cohort). */
	top3HitTop1Miss: number;
	/** Signal-empty cohort. */
	signalEmptyCases: number;
	/** Number of signal-empty cases that admit empty/uncertain. */
	signalEmptyCoverageHonest: number;
	/** Per-failure-class histogram so reports can attribute regressions /
	 *  improvements to a named cohort. */
	byFailureClass: Record<RealCorpusFailureClass, number>;
};

export type RealCorpusSummaryRow = {
	cases: number;
	rankedUseful: number;
	top1Acceptable: number;
	queryModeCorrect: number;
};

export type RealCorpusOptions = {
	repo: string;
	/** Override each case's declared budget for eval-only second-pass runs. */
	budgetOverride?: "small" | "default" | "large";
	/** Eval-only query rewrite map used to test recovery follow-up searches. */
	taskOverridesById?: Record<string, string>;
};

/** PRD-0016 P16.1 / THO-159: pure classifier inputs, kept independent of
 *  the live retrieval pipeline so the answer-bearing/failure-class
 *  decision is unit-testable without spinning up handlers. */
export type RealCorpusClassifierInput = {
	expectation_kind: RealCorpusEvalCase["expectation_kind"];
	expected_query_mode: RealCorpusEvalCase["expected_query_mode"];
	expected_signal_empty_warning: boolean;
	expected_top_source: string;
	acceptableTopSources: string[];
	mustIncludeSources: string[];
	actual_query_mode: RealCorpusEvalCase["expected_query_mode"];
	coverage_confidence: "confident" | "uncertain" | "empty";
	ranked: {
		kind: "chunk" | "card";
		contexttrail: string;
		source_path?: string;
	}[];
};

export type RealCorpusClassifierOutcome = {
	isAnswerBearing: boolean;
	answerTop1Hit: boolean | null;
	answerTop3Hit: boolean | null;
	answerReciprocalRank: number | null;
	failureClass: RealCorpusFailureClass;
};

function isSignalEmptySeed(input: {
	expectation_kind: RealCorpusEvalCase["expectation_kind"];
	expected_query_mode: RealCorpusEvalCase["expected_query_mode"];
	expected_signal_empty_warning: boolean;
}): boolean {
	return (
		input.expectation_kind === "signal_empty" ||
		input.expected_query_mode === "signal_empty" ||
		input.expected_signal_empty_warning === true
	);
}

function rankOfFirstMatch(
	ranked: {
		kind: "chunk" | "card";
		contexttrail: string;
		source_path?: string;
	}[],
	acceptable: string[],
): number {
	let position = 0;
	for (const entry of ranked) {
		if (entry.kind !== "chunk") continue;
		position += 1;
		if (acceptable.includes(sourceFromRankedEntry(entry))) {
			return position;
		}
	}
	return 0;
}

export function sourceFromContextTrail(contexttrail: string): string {
	const sourceMatch = /^Source:\s+([^>]+?)(?:\s+>|$)/.exec(contexttrail);
	return sourceMatch?.[1]?.trim() ?? "";
}

function sourceFromRankedEntry(entry: {
	contexttrail: string;
	source_path?: string;
}): string {
	return entry.source_path?.trim() || sourceFromContextTrail(entry.contexttrail);
}

/**
 * PRD-0016 P16.1 / THO-159: classify a single real-corpus observation
 * along the answer-bearing axis (top-1, top-3, MRR, recall vs ordering)
 * and produce a stable failure-class reason code that downstream
 * reports/cohorts can use.
 *
 * Ranking failures take priority over surrounding wire issues
 * (query-mode, pack-shape) because PRD-0016 is targeting top-1/top-3
 * precision; the surrounding flags remain visible on the observation
 * for accurate per-cohort reporting.
 */
export function classifyRealCorpusOutcome(
	input: RealCorpusClassifierInput,
): RealCorpusClassifierOutcome {
	const isAnswerBearing = !isSignalEmptySeed(input);
	const acceptable =
		input.acceptableTopSources.length > 0
			? input.acceptableTopSources
			: input.expected_top_source
				? [input.expected_top_source]
				: [];

	if (!isAnswerBearing) {
		let failureClass: RealCorpusFailureClass = "none";
		const reportedHonest =
			input.coverage_confidence === "empty" ||
			input.coverage_confidence === "uncertain";
		if (!reportedHonest) failureClass = "signal_empty_dishonest";
		else if (input.actual_query_mode !== input.expected_query_mode)
			failureClass = "query_mode_miss";
		return {
			isAnswerBearing: false,
			answerTop1Hit: null,
			answerTop3Hit: null,
			answerReciprocalRank: null,
			failureClass,
		};
	}

	const rank =
		acceptable.length > 0 ? rankOfFirstMatch(input.ranked, acceptable) : 0;
	const top1Hit = acceptable.length > 0 ? rank === 1 : null;
	const top3Hit = acceptable.length > 0 ? rank >= 1 && rank <= 3 : null;
	const reciprocalRank =
		acceptable.length > 0 ? (rank === 0 ? 0 : 1 / rank) : null;

	let failureClass: RealCorpusFailureClass = "none";
	if (acceptable.length > 0) {
		if (top3Hit === false) failureClass = "answer_recall_miss";
		else if (top1Hit === false) failureClass = "answer_ordering_miss";
	}
	if (failureClass === "none" && input.actual_query_mode !== input.expected_query_mode) {
		failureClass = "query_mode_miss";
	}
	const missingRequiredDocSource =
		input.mustIncludeSources.length > 0 &&
		!input.mustIncludeSources.every((source) =>
			input.ranked.some(
				(r) => r.kind === "chunk" && sourceFromRankedEntry(r) === source,
			),
		);
	if (failureClass === "none" && missingRequiredDocSource) {
		failureClass = "pack_shape_miss";
	}

	return {
		isAnswerBearing: true,
		answerTop1Hit: top1Hit,
		answerTop3Hit: top3Hit,
		answerReciprocalRank: reciprocalRank,
		failureClass,
	};
}

export function realCorpusRoot(): string {
	return REAL_CORPUS_ROOT;
}

export function realCorpusFixturePath(repo: string): string {
	return join(REAL_CORPUS_ROOT, `${repo}.yaml`);
}

export function realCorpusDocsPath(repo: string): string {
	return join(REAL_CORPUS_ROOT, repo);
}

export function loadRealCorpusEvalSet(repo: string): RealCorpusEvalCase[] {
	const path = realCorpusFixturePath(repo);
	const raw = readFileSync(path, "utf8");
	const parsed = YAML.parse(raw) as RealCorpusEvalCase[];
	validateRealCorpusEvalSet(parsed, repo);
	return parsed;
}

export function validateRealCorpusEvalSet(
	cases: RealCorpusEvalCase[],
	repo: string,
): void {
	for (const entry of cases) {
		const missing = [
			entry.query_intent === undefined ? "query_intent" : undefined,
			entry.assembly_need === undefined ? "assembly_need" : undefined,
			entry.expectation_kind === undefined ? "expectation_kind" : undefined,
			entry.capabilities === undefined ? "capabilities" : undefined,
		].filter((field): field is string => field !== undefined);
		if (missing.length > 0) {
			throw new Error(
				`Real-corpus '${repo}' case '${entry.id}' is missing ${missing.join(", ")}`,
			);
		}
		if (!QUERY_INTENTS.includes(entry.query_intent)) {
			throw new Error(
				`Real-corpus '${repo}' case '${entry.id}' has unknown query_intent '${entry.query_intent}'`,
			);
		}
		if (!ASSEMBLY_NEEDS.includes(entry.assembly_need)) {
			throw new Error(
				`Real-corpus '${repo}' case '${entry.id}' has unknown assembly_need '${entry.assembly_need}'`,
			);
		}
		if (!EXPECTATION_KINDS.includes(entry.expectation_kind)) {
			throw new Error(
				`Real-corpus '${repo}' case '${entry.id}' has unknown expectation_kind '${entry.expectation_kind}'`,
			);
		}
		if (
			entry.anchor_source !== undefined &&
			!ANCHOR_SOURCES.includes(entry.anchor_source)
		) {
			throw new Error(
				`Real-corpus '${repo}' case '${entry.id}' has unknown anchor_source '${entry.anchor_source}'`,
			);
		}
		if (
			entry.minimal_sufficient_stage !== undefined &&
			!ASSEMBLY_STAGES.includes(entry.minimal_sufficient_stage)
		) {
			throw new Error(
				`Real-corpus '${repo}' case '${entry.id}' has unknown minimal_sufficient_stage '${entry.minimal_sufficient_stage}'`,
			);
		}
		if (entry.capabilities.length === 0) {
			throw new Error(
				`Real-corpus '${repo}' case '${entry.id}' must include at least one capability`,
			);
		}
		for (const capability of entry.capabilities) {
			if (!FACT_FINDING_CAPABILITIES.includes(capability)) {
				throw new Error(
					`Real-corpus '${repo}' case '${entry.id}' has unknown capability '${capability}'`,
				);
			}
		}
	}
}

export type RealCorpusLab = {
	cwd: string;
	importCorpus: () => void;
	cleanup: () => void;
};

export function createRealCorpusLab(repo: string): RealCorpusLab {
	const cwd = mkdtempSync(join(tmpdir(), `contexttrail-real-corpus-${repo}-`));
	init(cwd);
	copyDirSync(realCorpusDocsPath(repo), cwd, [".contexttrail"]);
	// THO-135: each repo can declare its own globs via `<repo>.config.yaml`.
	const globs = loadRealCorpusImportGlobs({ repo, root: realCorpusRoot() });
	return {
		cwd,
		importCorpus: () => {
			runImport(cwd, globs);
		},
		cleanup: () => {
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}

export async function runRealCorpusRetrievalEval(
	opts: RealCorpusOptions,
): Promise<RealCorpusReport> {
	const { repo } = opts;
	const cases = loadRealCorpusEvalSet(repo);
	const lab = createRealCorpusLab(repo);
	let db: ReturnType<typeof openDb> | undefined;
	try {
		lab.importCorpus();
		const handlers = createHandlers({ cwd: lab.cwd });
		db = openDb(join(lab.cwd, ".contexttrail", "cache", "contexttrail.db"));
		const chunks = listCurrentChunksCanonical(db);
		const manualCorpusTokensUsed = chunks.reduce(
			(sum, chunk) => sum + chunk.token_count,
			0,
		);
		const sourceTokenTotals = new Map<string, number>();
		for (const chunk of chunks) {
			sourceTokenTotals.set(
				chunk.source_path,
				(sourceTokenTotals.get(chunk.source_path) ?? 0) + chunk.token_count,
			);
		}
		const observations: RealCorpusObservation[] = [];

		for (const entry of cases) {
			const task = opts.taskOverridesById?.[entry.id] ?? entry.task;
			const response = await handlers.retrieve_context_pack({
				task,
				files: entry.files,
				symbols: entry.symbols,
				routes: entry.routes,
				budget: opts.budgetOverride ?? entry.budget,
				expected_locked: [],
				explain: true,
			});

			const acceptableTopSources =
				entry.acceptable_top_sources ??
				(entry.expected_top_source ? [entry.expected_top_source] : []);
			const manualTargetedSources = new Set(
				[...acceptableTopSources, ...entry.must_include_sources]
					.map((source) => source.trim())
					.filter((source) => source.length > 0),
			);
			const manualTargetedTokensUsed = [...manualTargetedSources].reduce(
				(sum, source) => sum + (sourceTokenTotals.get(source) ?? 0),
				0,
			);
			const top3Entries = response.ranked.slice(0, 3);
			const top5Entries = response.ranked.slice(0, 5);
			const top3FirstChunk = top3Entries.find(
				(entry) => entry.kind === "chunk",
			);
			const expectedWarningKinds = entry.expected_warning_kinds ?? [];
			const responseWarningKinds = response.warnings.map((w) => w.kind);
			const missingWarningKinds = expectedWarningKinds.filter(
				(k) =>
					!responseWarningKinds.includes(
						k as (typeof responseWarningKinds)[number],
					),
			);
			const expectsNoMatches =
				expectedWarningKinds.includes("no_matches") ||
				entry.expectation_kind === "signal_empty";
			const docRankedUseful = expectsNoMatches
				? response.ranked.length === 0 ||
					acceptableTopSources.some((source) =>
						sourceInRankedTop(response.ranked, source),
					)
				: acceptableTopSources.some((source) =>
						sourceInRankedTop(response.ranked, source),
					);
			// For signal_empty cases the seed has no acceptable_top_sources — there's
			// no "correct" top-1 doc because the corpus has no relevant content. The
			// honest success criterion for these is coverage_confidence honesty (the
			// engine admits empty/uncertain rather than pretending confident). We
			// measure that via coverageHonest below; top1Acceptable for signal_empty
			// mirrors that signal so the threshold metric reflects the real success
			// of the case rather than penalizing it for an unscoreable axis.
			const isSignalEmptyCase =
				entry.expectation_kind === "signal_empty" ||
				entry.expected_signal_empty_warning ||
				entry.expected_query_mode === "signal_empty";
			const docTop1Acceptable = isSignalEmptyCase
				? response.coverage_confidence === "empty" ||
					response.coverage_confidence === "uncertain"
				: top3FirstChunk !== undefined &&
					acceptableTopSources.includes(sourceFromRankedEntry(top3FirstChunk));
			const docAgentAnswerPass =
				entry.must_include_sources.length === 0 ||
				entry.must_include_sources.every((source) =>
					sourceIncluded(response.ranked, source),
				);
			const hasSignalEmptyWarning = response.warnings.some(
				(warning) => warning.kind === "anchors_unrecognized",
			);
			const expectsEmpty =
				entry.expected_signal_empty_warning ||
				entry.expected_query_mode === "signal_empty" ||
				entry.expectation_kind === "signal_empty";
			const reportedEmpty = response.coverage_confidence === "empty";
			const reportedUncertain = response.coverage_confidence === "uncertain";
			// For empty-expected cases: honest if engine reports empty OR
			// uncertain (admits the corpus has weak/no answer). For confident-
			// expected cases: honest if engine doesn't report empty.
			const coverageHonest = expectsEmpty
				? reportedEmpty || reportedUncertain
				: !reportedEmpty;

			const chunkCorrect = docTop1Acceptable
				? evaluateChunkCorrectness(
						entry.expected_chunk_headings,
						top3FirstChunk?.contexttrail,
					)
				: null;
			const warningKinds = response.warnings.map((warning) => warning.kind);

			// Slice 5: feed the readiness-aware orchestrator with the response's
			// ranked chunks (the source-scoped chunk selector reads heading_path
			// / heading_level from each, so we synthesize candidates from the
			// drift fields the response already carries).
			const sourceCandidates: SourceChunkCandidate[] = response.ranked
				.filter((r) => r.kind === "chunk")
				.map((r) => parseRankedChunkContextTrail(r));
			const selectedSourcesFromRanked = uniqueSources(sourceCandidates);
			const orchestrator = orchestratePackReadiness({
				task,
				query_mode: response.query_mode,
				query_intent: entry.query_intent,
				files: entry.files,
				symbols: entry.symbols,
				routes: entry.routes,
				sourceCandidates,
				selectedSources: selectedSourcesFromRanked,
				mustIncludeSources: entry.must_include_sources,
				warnings: warningKinds,
				coverage_confidence: response.coverage_confidence,
				lockedCount: 0,
			});
			const pack_readiness: PackReadinessState = orchestrator.result.state;

			// THO-159: split answer-bearing precision from signal-empty
			// honesty. Failure-class reflects the actual ranking outcome and
			// is the cohort handle PRD-0016 slices target.
			const classification = classifyRealCorpusOutcome({
				expectation_kind: entry.expectation_kind,
				expected_query_mode: entry.expected_query_mode,
				expected_signal_empty_warning: entry.expected_signal_empty_warning,
				expected_top_source: entry.expected_top_source,
				acceptableTopSources,
				mustIncludeSources: entry.must_include_sources,
				actual_query_mode: response.query_mode,
				coverage_confidence: response.coverage_confidence,
				ranked: response.ranked.map((r) => ({
					kind: r.kind,
					contexttrail: r.contexttrail,
					source_path: r.source_path,
				})),
			});
			const rankedUseful = docRankedUseful;
			const top1Acceptable = docTop1Acceptable;
			const agentAnswerPass = docAgentAnswerPass;

			observations.push({
				id: entry.id,
				notes: entry.notes,
				query_intent: entry.query_intent,
				assembly_need: entry.assembly_need,
				expectation_kind: entry.expectation_kind,
				capabilities: entry.capabilities,
				expected_query_mode: entry.expected_query_mode,
				actual_query_mode: response.query_mode,
				queryModeOk: response.query_mode === entry.expected_query_mode,
				signalEmptyWarningOk:
					hasSignalEmptyWarning === entry.expected_signal_empty_warning,
				expectedWarningsOk: missingWarningKinds.length === 0,
				missingWarningKinds,
				rankedUseful,
				top1Acceptable,
				agentAnswerPass,
				expectedTopSource: entry.expected_top_source,
				acceptableTopSources,
				mustIncludeSources: entry.must_include_sources,
				top3: top3Entries.map((entry) => ({
					id: entry.id,
					kind: entry.kind,
					contexttrail: entry.contexttrail,
					score: entry.score,
					source_path: entry.source_path,
				})),
				top5: top5Entries.map((entry) => ({
					id: entry.id,
					kind: entry.kind,
					contexttrail: entry.contexttrail,
					score: entry.score,
					source_path: entry.source_path,
				})),
				rankedCount: response.ranked.length,
				packTokensUsed: response.budget.used,
				rankedTokensUsed: response.ranked.reduce(
					(sum, entry) => sum + entry.tokens,
					0,
				),
				manualCorpusTokensUsed,
				manualTargetedTokensUsed,
				recovery_plan: response.recovery_plan,
				payloadBytes: Buffer.byteLength(JSON.stringify(response)),
				warnings: warningKinds,
				coverage_confidence: response.coverage_confidence,
				coverageHonest,
				chunkCorrect,
				pack_readiness,
				readiness_diagnostics: {
					needs: orchestrator.needs,
					satisfiedNeeds: orchestrator.result.satisfiedNeeds,
					missingNeeds: orchestrator.result.missingNeeds,
					reasonCodes: orchestrator.result.reasonCodes,
				},
				isAnswerBearing: classification.isAnswerBearing,
				answerTop1Hit: classification.answerTop1Hit,
				answerTop3Hit: classification.answerTop3Hit,
				answerReciprocalRank: classification.answerReciprocalRank,
				failureClass: classification.failureClass,
			});
		}

		return {
			repo,
			fixture: realCorpusFixturePath(repo),
			cases: observations.length,
			observations,
			summary: summarizeRealCorpus(observations),
		};
	} finally {
		if (db !== undefined) closeDb(db);
		lab.cleanup();
	}
}

export function summarizeRealCorpus(
	observations: RealCorpusObservation[],
): RealCorpusSummary {
	const total = observations.length;
	const byIntent: Record<string, RealCorpusSummaryRow> = {};
	for (const obs of observations) {
		const row = byIntent[obs.query_intent] ?? {
			cases: 0,
			rankedUseful: 0,
			top1Acceptable: 0,
			queryModeCorrect: 0,
		};
		row.cases += 1;
		if (obs.rankedUseful) row.rankedUseful += 1;
		if (obs.top1Acceptable) row.top1Acceptable += 1;
		if (obs.queryModeOk) row.queryModeCorrect += 1;
		byIntent[obs.query_intent] = row;
	}
	const byReadiness: Record<PackReadinessState, number> = {
		ready: 0,
		partial: 0,
		needs_anchors: 0,
		unsupported: 0,
	};
	for (const state of PACK_READINESS_STATES) byReadiness[state] = 0;
	for (const obs of observations) byReadiness[obs.pack_readiness] += 1;
	const chunkScoredObs = observations.filter((o) => o.chunkCorrect !== null);

	// THO-159: split answer-bearing precision cohort from signal-empty
	// honesty cohort so reports cannot mix them.
	const answerBearing = observations.filter((o) => o.isAnswerBearing);
	const signalEmpty = observations.filter((o) => !o.isAnswerBearing);
	const answerTop1 = answerBearing.filter(
		(o) => o.answerTop1Hit === true,
	).length;
	const answerTop3 = answerBearing.filter(
		(o) => o.answerTop3Hit === true,
	).length;
	const trueTop3Misses = answerBearing.filter(
		(o) => o.answerTop3Hit === false,
	).length;
	const top3HitTop1Miss = answerBearing.filter(
		(o) => o.answerTop3Hit === true && o.answerTop1Hit === false,
	).length;
	const answerMrr =
		answerBearing.length === 0
			? 0
			: answerBearing.reduce(
					(sum, o) => sum + (o.answerReciprocalRank ?? 0),
					0,
				) / answerBearing.length;
	const signalEmptyCoverageHonest = signalEmpty.filter(
		(o) => o.coverageHonest,
	).length;

	const byFailureClass: Record<RealCorpusFailureClass, number> = {
		none: 0,
		answer_recall_miss: 0,
		answer_ordering_miss: 0,
		signal_empty_dishonest: 0,
		query_mode_miss: 0,
		pack_shape_miss: 0,
	};
	for (const obs of observations) byFailureClass[obs.failureClass] += 1;

	return {
		cases: total,
		rankedUseful: observations.filter((o) => o.rankedUseful).length,
		top1Acceptable: observations.filter((o) => o.top1Acceptable).length,
		queryModeCorrect: observations.filter((o) => o.queryModeOk).length,
		signalEmptyHonest: observations.filter((o) => o.signalEmptyWarningOk)
			.length,
		coverageHonest: observations.filter((o) => o.coverageHonest).length,
		agentAnswer: observations.filter((o) => o.agentAnswerPass).length,
		avgPayloadBytes:
			total === 0
				? 0
				: Math.round(
				observations.reduce((sum, o) => sum + o.payloadBytes, 0) / total,
					),
		byIntent,
		chunkScored: chunkScoredObs.length,
		chunkCorrect: chunkScoredObs.filter((o) => o.chunkCorrect === true).length,
		byReadiness,
		answerBearingCases: answerBearing.length,
		answerTop1,
		answerTop3,
		answerMrr,
		trueTop3Misses,
		top3HitTop1Miss,
		signalEmptyCases: signalEmpty.length,
		signalEmptyCoverageHonest,
		byFailureClass,
	};
}

export function renderRealCorpusReport(report: RealCorpusReport): string {
	const { summary } = report;
	const pct = (n: number) =>
		report.cases === 0 ? "—" : `${((n / report.cases) * 100).toFixed(1)}%`;
	const lines: string[] = [];
	lines.push(`Real-corpus eval — ${report.repo}`);
	lines.push(`  cases: ${report.cases}`);
	// THO-159 / PRD-0016 P16.1: lead with the split metrics so it is no
	// longer possible to read top1Acceptable as if signal-empty honesty
	// were a top-1 win.
	const ab = summary.answerBearingCases;
	const se = summary.signalEmptyCases;
	const abPct = (n: number) =>
		ab === 0 ? "—" : `${((n / ab) * 100).toFixed(1)}%`;
	const sePct = (n: number) =>
		se === 0 ? "—" : `${((n / se) * 100).toFixed(1)}%`;
	lines.push(`  Answer-bearing cases: ${ab}`);
	lines.push(
		`    answer top-1:       ${summary.answerTop1}/${ab}  (${abPct(summary.answerTop1)})`,
	);
	lines.push(
		`    answer top-3:       ${summary.answerTop3}/${ab}  (${abPct(summary.answerTop3)})`,
	);
	lines.push(`    answer MRR:         ${summary.answerMrr.toFixed(3)}`);
	lines.push(`    true top-3 misses:  ${summary.trueTop3Misses}`);
	lines.push(`    top-3 hit, top-1 miss: ${summary.top3HitTop1Miss}`);
	lines.push(`  Signal-empty cases:   ${se}`);
	lines.push(
		`    coverage honest:    ${summary.signalEmptyCoverageHonest}/${se}  (${sePct(summary.signalEmptyCoverageHonest)})`,
	);
	lines.push(
		`  Combined coverage honest: ${summary.coverageHonest}/${report.cases}  (${pct(summary.coverageHonest)})`,
	);
	lines.push(
		`  Agent answer pass:    ${summary.agentAnswer}/${report.cases}  (${pct(summary.agentAnswer)})`,
	);
	lines.push(
		`  Query mode correct:   ${summary.queryModeCorrect}/${report.cases}  (${pct(summary.queryModeCorrect)})`,
	);
	lines.push(
		`  Legacy (mixed) ranked useful: ${summary.rankedUseful}/${report.cases}  (${pct(summary.rankedUseful)})`,
	);
	lines.push(
		`  Legacy (mixed) top-1 accept.: ${summary.top1Acceptable}/${report.cases}  (${pct(summary.top1Acceptable)})`,
	);
	lines.push(
		`  signal_empty warning honest:  ${summary.signalEmptyHonest}/${report.cases}  (${pct(summary.signalEmptyHonest)})`,
	);
	lines.push(`  Avg payload bytes:    ${summary.avgPayloadBytes}`);
	if (summary.chunkScored > 0) {
		const chunkPct =
			summary.chunkScored === 0
				? "—"
				: `${((summary.chunkCorrect / summary.chunkScored) * 100).toFixed(1)}%`;
		lines.push(
			`  Chunk correct (scored): ${summary.chunkCorrect}/${summary.chunkScored}  (${chunkPct})`,
		);
	}
	lines.push(
		`  Pack readiness:       ready=${summary.byReadiness.ready}  partial=${summary.byReadiness.partial}  needs_anchors=${summary.byReadiness.needs_anchors}  unsupported=${summary.byReadiness.unsupported}`,
	);
	lines.push("");
	lines.push("By query intent:");
	for (const [intent, row] of Object.entries(summary.byIntent).sort(
		([a], [b]) => a.localeCompare(b),
	)) {
		const intentPct = (n: number) =>
			row.cases === 0 ? "—" : `${((n / row.cases) * 100).toFixed(0)}%`;
		lines.push(
			`  ${intent.padEnd(22)} cases=${row.cases}  ranked=${intentPct(row.rankedUseful)}  top1=${intentPct(row.top1Acceptable)}  mode=${intentPct(row.queryModeCorrect)}`,
		);
	}
	lines.push("");
	lines.push("Failure class histogram:");
	for (const cls of REAL_CORPUS_FAILURE_CLASSES) {
		lines.push(`  ${cls.padEnd(24)} ${summary.byFailureClass[cls]}`);
	}
	const failures = report.observations.filter(
		(obs) => obs.failureClass !== "none",
	);
	if (failures.length > 0) {
		lines.push("");
		lines.push("Failure details:");
		for (const obs of failures) {
			const acceptable = [...obs.acceptableTopSources];
			const top3Sources = obs.top3.map((entry) =>
				sourceFromRankedEntry(entry) || entry.contexttrail || entry.id,
			);
			lines.push(
				`  ${obs.id}  fc=${obs.failureClass}  expected=${obs.expectedTopSource || "(none)"}  acceptable=${acceptable.length === 0 ? "(none)" : acceptable.join(" | ")}  top3=${top3Sources.length === 0 ? "(empty)" : top3Sources.join(" | ")}`,
			);
		}
	}
	lines.push("");
	lines.push("Per-case detail:");
	for (const obs of report.observations) {
		const ansFlag = obs.isAnswerBearing
			? obs.answerTop1Hit
				? "A1✓"
				: obs.answerTop3Hit
					? "A3✓"
					: "A3✗"
			: "SE·";
		const flags = [
			ansFlag,
			obs.queryModeOk ? "QM✓" : `QM✗(${obs.actual_query_mode})`,
			obs.coverageHonest ? "CH✓" : "CH✗",
			obs.chunkCorrect === null ? "CK·" : obs.chunkCorrect ? "CK✓" : "CK✗",
		].join(" ");
		const top1 = obs.top3[0]?.contexttrail ?? "(empty)";
		lines.push(
			`  ${obs.id.padEnd(45)} ${flags}  rd=${obs.pack_readiness}  fc=${obs.failureClass}  top1=${top1}`,
		);
	}
	return lines.join("\n") + "\n";
}

/**
 * Slice 5: synthesize a SourceChunkCandidate from a ranked response
 * entry. The MCP response carries drift (`Source: <path> > Section:
 * <heading_path> > Part: i/n`) and a score; we parse heading_path and
 * chunk_index back out so the source-scoped chunk selector can run on
 * eval-side data without needing direct DocChunk access.
 */
function parseRankedChunkContextTrail(entry: {
	id: string;
	kind: "chunk" | "card";
	contexttrail: string;
	score: number;
}): SourceChunkCandidate {
	const match =
		/^Source:\s*(.*?) > Section:\s*(.*) > Part:\s*(\d+)\/(\d+)$/.exec(
			entry.contexttrail,
		);
	const sourcePart = match?.[1]?.trim() ?? "";
	const sectionPart = match?.[2]?.trim() ?? "";
	const partPart = match ? `${match[3]}/${match[4]}` : "1/1";
	const heading_path = sectionPart.length > 0 ? sectionPart.split(" > ") : [];
	const [chunkIndexRaw, chunkCountRaw] = partPart.split("/");
	const chunk_index = Number.parseInt(chunkIndexRaw ?? "1", 10) || 1;
	const chunk_count = Number.parseInt(chunkCountRaw ?? "1", 10) || 1;
	return {
		id: entry.id,
		source_path: sourcePart,
		heading_path,
		heading_level: Math.max(1, heading_path.length),
		chunk_index,
		chunk_count,
		score: entry.score,
	};
}

function uniqueSources(candidates: SourceChunkCandidate[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const c of candidates) {
		if (c.source_path === "") continue;
		if (seen.has(c.source_path)) continue;
		seen.add(c.source_path);
		out.push(c.source_path);
	}
	return out;
}

function sourceInRankedTop(
	ranked: {
		kind: "chunk" | "card";
		contexttrail: string;
		source_path?: string;
	}[],
	source: string,
): boolean {
	return ranked
		.slice(0, 3)
		.some(
			(entry) =>
				entry.kind === "chunk" &&
				sourceFromContextTrail(entry.contexttrail) === source,
		);
}

function sourceIncluded(
	ranked: {
		kind: "chunk" | "card";
		contexttrail: string;
		source_path?: string;
	}[],
	source: string,
): boolean {
	return ranked.some(
		(entry) =>
			entry.kind === "chunk" &&
				sourceFromContextTrail(entry.contexttrail) === source,
	);
}

function copyDirSync(src: string, dst: string, skip: string[] = []): void {
	mkdirSync(dst, { recursive: true });
	for (const name of readdirSync(src)) {
		if (skip.includes(name)) continue;
		const sp = join(src, name);
		const dp = join(dst, name);
		if (statSync(sp).isDirectory()) copyDirSync(sp, dp, skip);
		else copyFileSync(sp, dp);
	}
}
