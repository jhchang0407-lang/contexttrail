export { QUERY_INTENTS, type QueryIntent } from "../types/query.js";

import type { QueryIntent } from "../types/query.js";

export const ASSEMBLY_NEEDS = [
	"local_semantics",
	"domain_constraints",
	"cross_module_boundary",
	"decision_rationale",
	"debugging_evidence",
	"setup_recovery",
	"none",
] as const;

export const EXPECTATION_KINDS = [
	"deterministic",
	"ambiguous",
	"signal_empty",
] as const;
export const ANCHOR_SOURCES = [
	"card",
	"doc_frontmatter",
	"mixed",
	"none",
] as const;
export const ASSEMBLY_STAGES = [
	"not_applicable",
	"primary_only",
	"parent",
	"siblings",
	"source_sibling",
	"linked_neighbor",
] as const;

export const FACT_FINDING_CAPABILITIES = [
	"anchor_recognition",
	"scope_inference",
	"locked_authority_retrieval",
	"over_lock_prevention",
	"canonical_source_ranking",
	"distractor_resistance",
	"signal_empty_honesty",
	"ambiguity_labeling",
	"explainability",
] as const;

export type AssemblyNeed = (typeof ASSEMBLY_NEEDS)[number];
export type ExpectationKind = (typeof EXPECTATION_KINDS)[number];
export type FactFindingCapability = (typeof FACT_FINDING_CAPABILITIES)[number];
export type AnchorSource = (typeof ANCHOR_SOURCES)[number];
export type AssemblyStage = (typeof ASSEMBLY_STAGES)[number];

export type EvalCase = {
	id: string;
	task: string;
	query_intent?: QueryIntent;
	assembly_need?: AssemblyNeed;
	expectation_kind?: ExpectationKind;
	capabilities?: FactFindingCapability[];
	fragile?: boolean;
	acceptable_top_sources?: string[];
	anchor_source?: AnchorSource;
	minimal_sufficient_stage?: AssemblyStage;
	files?: string[];
	symbols?: string[];
	routes?: string[];
	budget?: "small" | "default" | "large";
	expected_query_mode: "anchored" | "signal_empty" | "unanchored";
	expected_locked: string[];
	forbidden_locked?: string[];
	forbidden_in_top_3?: string[];
	expected_warning_kinds?: string[];
	expected_signal_empty_warning: boolean;
	expected_evidence_covers_locked?: string[];
	expected_top_source: string;
	must_include_sources: string[];
	baseline_ranked_useful: boolean;
	notes: string;
};

export type EvalObservation = {
	id: string;
	notes: string;
	query_intent: QueryIntent;
	assembly_need: AssemblyNeed;
	expectation_kind: ExpectationKind;
	capabilities: FactFindingCapability[];
	fragile: boolean;
	acceptableTopSources: string[];
	anchor_source?: AnchorSource;
	expected_query_mode: EvalCase["expected_query_mode"];
	actual_query_mode: EvalCase["expected_query_mode"];
	baselineRankedUseful: boolean;
	lockedOk: boolean;
	queryModeOk: boolean;
	forbiddenLockedOk: boolean;
	forbiddenTopOk: boolean;
	expectedWarningsOk: boolean;
	missingWarningKinds: string[];
	signalEmptyWarningOk: boolean;
	rankedUseful: boolean;
	agentAnswerPass: boolean;
	omittedUseful: boolean;
	evidenceOk: boolean;
	explainPresent: boolean;
	queryCompilationMode: EvalCase["expected_query_mode"] | undefined;
	queryCompilationAnchorCount: number;
	providedAnchorCount: number;
	chunkExplainHasDocRole: boolean;
	expectedLocked: string[];
	actualLocked: string[];
	forbiddenLocked: string[];
	forbiddenLockedHits: string[];
	forbiddenTopSubstrings: string[];
	forbiddenTopHits: string[];
	expectedTopSource: string;
	mustIncludeSources: string[];
	top3: {
		id: string;
		kind: "chunk" | "card" | "code";
		contexttrail: string;
		score: number;
	}[];
	top1Acceptable: boolean;
	top3MustIncludeCoverage: number;
	top3SourceBalance: number;
	top3UniqueChunkSources: number;
	evidenceVisible: boolean;
	warningVisible: boolean;
	rankedCount: number;
	lockedCount: number;
	assemblyStageExpected: AssemblyStage;
	assemblyStageActual: AssemblyStage;
	assemblyStageOk: boolean;
	underExpanded: boolean;
	overExpanded: boolean;
	budgetPreset: "small" | "default" | "large";
	packTokensUsed: number;
	lockedTokens: number;
	rankedTokens: number;
	tokenBand: "under_5k" | "within_5k_12k" | "over_12k";
	payloadBytes: number;
	omittedTotal: number;
	warnings: string[];
	lockFailures: unknown[];
};

export type EvalSummaryRow = {
	cases: number;
	locked: number;
	signalEmptyWarning: number;
	rankedUseful: number;
	agentAnswer: number;
	omittedUseful: number;
	avgPayloadBytes: number;
};

export type EvalSummary = {
	bucket: Record<string, EvalSummaryRow>;
	query_intent: Record<string, EvalSummaryRow>;
	assembly_need: Record<string, EvalSummaryRow>;
	expectation_kind: Record<string, EvalSummaryRow>;
	capability: Record<string, EvalSummaryRow>;
};

export type EvalAssemblySummaryRow = {
	cases: number;
	top1Acceptable: number;
	top3MustIncludeCoverage: number;
	top3SourceBalance: number;
	evidenceVisible: number;
	warningVisible: number;
	avgRankedCount: number;
	avgLockedCount: number;
	avgPayloadBytes: number;
};

export type EvalAssemblySummary = {
	bucket: Record<string, EvalAssemblySummaryRow>;
	assembly_need: Record<string, EvalAssemblySummaryRow>;
	stage: Record<string, EvalAssemblyStageSummaryRow>;
};

export type EvalAssemblyStageSummaryRow = {
	cases: number;
	stageAccuracy: number;
	underExpansionRate: number;
	overExpansionRate: number;
};

export type EvalTokenSummaryRow = {
	cases: number;
	within5kTo12k: number;
	under12k: number;
	under5k: number;
	avgPackTokensUsed: number;
	avgLockedTokens: number;
	avgRankedTokens: number;
	avgLockedShare: number;
};

export type EvalTokenSummary = {
	bucket: Record<string, EvalTokenSummaryRow>;
	assembly_need: Record<string, EvalTokenSummaryRow>;
	budget: Record<string, EvalTokenSummaryRow>;
};

export type FragilePassSummary = {
	total: number;
	cases: { id: string; notes: string }[];
};

export type EvalReport = {
	fixture: string;
	cases: number;
	observations: EvalObservation[];
	summary: EvalSummary;
	assembly_summary: EvalAssemblySummary;
	token_summary: EvalTokenSummary;
	fragile_passes: FragilePassSummary;
};

export type EvalGate = {
	name: string;
	bar: string;
	result: string;
	pass: boolean;
};

export type EvalBaselineDiffRow = {
	casesDelta: number;
	rankedUsefulDelta?: number;
	agentAnswerDelta?: number;
	avgPayloadBytesDelta: number;
	top1AcceptableDelta?: number;
	top3MustIncludeCoverageDelta?: number;
	top3SourceBalanceDelta?: number;
	avgRankedCountDelta?: number;
	avgLockedCountDelta?: number;
};

export type EvalBaselineComparison = {
	casesDelta: number;
	retrieval_bucket: Record<string, EvalBaselineDiffRow>;
	assembly_bucket: Record<string, EvalBaselineDiffRow>;
};
