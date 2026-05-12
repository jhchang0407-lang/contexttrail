#!/usr/bin/env node
/**
 * Assisted-vs-manual benchmark.
 *
 * Product question:
 *   1. Is the ContextTrail pack materially smaller than manual inspection?
 *   2. Is the top-5 pack good enough for the agent to do the work?
 *   3. When the pack is not confident, does a retry improve the outcome?
 *
 * This benchmark uses the real-corpus panel twice:
 *   - assisted pass: current production-shaped pack
 *   - retry pass: follow-up search task plus a large budget as a second try
 *
 * The benchmark reports two manual proxies:
 *   - targeted manual: the whole gold source file(s) a competent agent would
 *     inspect after repo search, similar to `rg` plus opening the likely file.
 *   - corpus manual: the imported corpus token mass, an upper bound for broad
 *     repo inspection.
 *
 * The oracle gold-source token count remains available as the lower bound
 * floor for answer-bearing cases.
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
	realCorpusRoot,
	runRealCorpusRetrievalEval,
	type RealCorpusFailureClass,
	type RealCorpusObservation,
} from "./real-corpus-fixture.js";
import type { RecoveryAction } from "../readiness/recovery-plan.js";
import {
	estimateOracleGoldTokens,
	recommendRecoveryAction,
} from "./recovery-benchmark.js";
import type { QueryIntent } from "./types.js";

export type AssistedManualBenchmarkRow = {
	repo: string;
	id: string;
	query_intent: QueryIntent;
	isAnswerBearing: boolean;
	failureClass: RealCorpusFailureClass;
	initialAction: RecoveryAction;
	retryAction: RecoveryAction | null;
	coverage_confidence: "confident" | "uncertain" | "empty";
	pack_readiness: "ready" | "partial" | "needs_anchors" | "unsupported";
	initialTop5Hit: boolean | null;
	retryTop5Hit: boolean | null;
	retryImproved: boolean;
	retryRecovered: boolean;
	packTokensUsed: number;
	manualTargetedTokensUsed: number;
	manualCorpusTokensUsed: number;
	oracleGoldTokens: number;
	assistedToManualTargetedRatio: number;
	assistedToManualCorpusRatio: number;
	assistedToOracleRatio: number;
	payloadBytes: number;
};

export type AssistedManualBenchmarkSummary = {
	cases: number;
	answerBearingCases: number;
	signalEmptyCases: number;
	top5Useful: number;
	top5UsefulRate: number;
	safeInitialActions: number;
	unsafeInitialAnswers: number;
	retryAttempts: number;
	retryImproved: number;
	retryRecovered: number;
	signalEmptyHonest: number;
	avgAssistedPackTokens: number;
	avgManualTargetedTokens: number;
	avgManualCorpusTokens: number;
	avgOracleGoldTokens: number;
	avgAssistedToManualTargetedRatio: number;
	avgAssistedToManualCorpusRatio: number;
	avgAssistedToOracleRatio: number;
};

export type AssistedManualBenchmarkReport = {
	repos: string[];
	rows: AssistedManualBenchmarkRow[];
	summary: AssistedManualBenchmarkSummary;
	byRepo: { repo: string; summary: AssistedManualBenchmarkSummary }[];
};

export type AssistedManualBenchmarkOptions = {
	repos?: string[];
};

function topNHit(
	observation: RealCorpusObservation,
	accepted: string[],
	topN: number,
): boolean | null {
	const ranked =
		topN === 5 ? (observation.top5 ?? observation.top3) : observation.top3;
	if (ranked === undefined) return null;
	const set = new Set(accepted);
	return ranked.some(
		(entry) =>
			entry.kind === "chunk" && set.has(sourceFromContextTrail(entry.contexttrail)),
	);
}

function sourceFromContextTrail(contexttrail: string): string {
	const sourceMatch = /^Source:\s+([^>]+?)(?:\s+>|$)/.exec(contexttrail);
	return sourceMatch?.[1]?.trim() ?? "";
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function discoveryRepos(root = realCorpusRoot()): string[] {
	const repos: string[] = [];
	for (const name of readdirSync(root)) {
		if (!name.endsWith(".yaml") || name.endsWith(".config.yaml")) continue;
		const repo = name.replace(/\.yaml$/, "");
		try {
			if (statSync(`${root}/${repo}`).isDirectory()) repos.push(repo);
		} catch {
			// skip
		}
	}
	return repos.sort();
}

function initialActionFor(observation: RealCorpusObservation): RecoveryAction {
	if (observation.recovery_plan) return observation.recovery_plan.action;
	return recommendRecoveryAction({
		query_mode: observation.actual_query_mode,
		coverage_confidence: observation.coverage_confidence,
		pack_readiness: observation.pack_readiness,
	});
}

function summarize(
	rows: AssistedManualBenchmarkRow[],
): AssistedManualBenchmarkSummary {
	const answerBearing = rows.filter((row) => row.isAnswerBearing);
	const signalEmpty = rows.filter((row) => !row.isAnswerBearing);
	const retryAttempts = rows.filter(
		(row) =>
			row.isAnswerBearing &&
			row.initialAction === "retry_with_followup_searches",
	);
	const targetedRows = rows.filter((row) => row.manualTargetedTokensUsed > 0);
	const avgAssistedPackTokens = average(rows.map((row) => row.packTokensUsed));
	const avgManualTargetedTokens = average(
		targetedRows.map((row) => row.manualTargetedTokensUsed),
	);
	const avgManualCorpusTokens = average(
		rows.map((row) => row.manualCorpusTokensUsed),
	);
	const avgOracleGoldTokens = average(rows.map((row) => row.oracleGoldTokens));
	return {
		cases: rows.length,
		answerBearingCases: answerBearing.length,
		signalEmptyCases: signalEmpty.length,
		top5Useful: answerBearing.filter((row) => row.initialTop5Hit === true)
			.length,
		top5UsefulRate:
			answerBearing.length === 0
				? 0
				: answerBearing.filter((row) => row.initialTop5Hit === true).length /
					answerBearing.length,
		safeInitialActions: rows.filter((row) => isSafeInitialAction(row)).length,
		unsafeInitialAnswers: rows.filter((row) => isUnsafeInitialAnswer(row))
			.length,
		retryAttempts: retryAttempts.length,
		retryImproved: retryAttempts.filter((row) => row.retryImproved).length,
		retryRecovered: retryAttempts.filter((row) => row.retryRecovered).length,
		signalEmptyHonest: signalEmpty.filter(
			(row) =>
				row.coverage_confidence === "empty" ||
				row.coverage_confidence === "uncertain",
		).length,
		avgAssistedPackTokens,
		avgManualTargetedTokens,
		avgManualCorpusTokens,
		avgOracleGoldTokens,
		avgAssistedToManualTargetedRatio:
			avgManualTargetedTokens === 0
				? 0
				: avgAssistedPackTokens / avgManualTargetedTokens,
		avgAssistedToManualCorpusRatio:
			avgManualCorpusTokens === 0
				? 0
				: avgAssistedPackTokens / avgManualCorpusTokens,
		avgAssistedToOracleRatio:
			avgOracleGoldTokens === 0
				? 0
				: avgAssistedPackTokens / avgOracleGoldTokens,
	};
}

function isAnswerAction(action: RecoveryAction): boolean {
	return action === "answer" || action === "answer_with_caveat";
}

function isSafeInitialAction(row: AssistedManualBenchmarkRow): boolean {
	if (!isAnswerAction(row.initialAction)) return true;
	if (!row.isAnswerBearing) return false;
	if (row.initialAction === "answer") return row.failureClass === "none";
	return row.initialTop5Hit === true;
}

function isUnsafeInitialAnswer(row: AssistedManualBenchmarkRow): boolean {
	return isAnswerAction(row.initialAction) && !isSafeInitialAction(row);
}

export function summarizeAssistedManualRows(
	rows: AssistedManualBenchmarkRow[],
): AssistedManualBenchmarkSummary {
	return summarize(rows);
}

export function serializeAssistedManualBenchmarkReport(
	report: AssistedManualBenchmarkReport,
): string {
	return (
		JSON.stringify(
			{ generated_at: new Date().toISOString(), ...report },
			null,
			2,
		) + "\n"
	);
}

function pct(n: number, d: number): string {
	return d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`;
}

function ratio(n: number): string {
	return n === 0 ? "-" : `${n.toFixed(2)}x`;
}

function round(n: number): string {
	return String(Math.round(n));
}

function table(rows: string[][]): string {
	const widths = rows[0]!.map((_, i) =>
		Math.max(...rows.map((row) => row[i]!.length)),
	);
	return rows
		.map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  "))
		.join("\n");
}

export async function runAssistedManualBenchmark(
	opts: AssistedManualBenchmarkOptions = {},
): Promise<AssistedManualBenchmarkReport> {
	const repos = opts.repos ?? discoveryRepos();
	const rows: AssistedManualBenchmarkRow[] = [];
	for (const repo of repos) {
		const initial = await runRealCorpusRetrievalEval({ repo });
		const taskOverridesById: Record<string, string> = {};
		for (const observation of initial.observations) {
			const plan = observation.recovery_plan;
			const followUp = plan?.follow_up_searches[0];
			if (plan?.action === "retry_with_followup_searches" && followUp) {
				taskOverridesById[observation.id] = followUp;
			}
		}
		const retry = await runRealCorpusRetrievalEval({
			repo,
			budgetOverride: "large",
			taskOverridesById,
		});
		const retryById = new Map(retry.observations.map((o) => [o.id, o]));

		for (const observation of initial.observations) {
			const retryObservation = retryById.get(observation.id);
			const accepted = observation.acceptableTopSources;
			const initialTop5Hit = topNHit(observation, accepted, 5);
			const retryTop5Hit = retryObservation
				? topNHit(retryObservation, accepted, 5)
				: null;
			const initialAction = initialActionFor(observation);
			const retryAction = retryObservation
				? initialActionFor(retryObservation)
				: null;
			const shouldRetryWithContext =
				initialAction === "retry_with_followup_searches";
			const retryImproved =
				shouldRetryWithContext &&
				initialTop5Hit === false &&
				retryTop5Hit === true;
			const retryRecovered = shouldRetryWithContext && retryAction === "answer";
			const manualTargetedTokensUsed =
				observation.manualTargetedTokensUsed ?? 0;
			const manualCorpusTokensUsed =
				observation.manualCorpusTokensUsed ?? observation.rankedTokensUsed;
			const oracleGoldTokens = estimateOracleGoldTokens(repo, observation);
			rows.push({
				repo,
				id: observation.id,
				query_intent: observation.query_intent,
				isAnswerBearing: observation.isAnswerBearing,
				failureClass: observation.failureClass,
				initialAction,
				retryAction,
				coverage_confidence: observation.coverage_confidence,
				pack_readiness: observation.pack_readiness,
				initialTop5Hit,
				retryTop5Hit,
				retryImproved,
				retryRecovered,
				packTokensUsed: observation.packTokensUsed,
				manualTargetedTokensUsed,
				manualCorpusTokensUsed,
				oracleGoldTokens,
				assistedToManualTargetedRatio:
					manualTargetedTokensUsed === 0
						? 0
						: observation.packTokensUsed / manualTargetedTokensUsed,
				assistedToManualCorpusRatio:
					manualCorpusTokensUsed === 0
						? 0
						: observation.packTokensUsed / manualCorpusTokensUsed,
				assistedToOracleRatio:
					oracleGoldTokens === 0
						? 0
						: observation.packTokensUsed / oracleGoldTokens,
				payloadBytes: observation.payloadBytes,
			});
		}
	}

	return {
		repos,
		rows,
		summary: summarize(rows),
		byRepo: repos.map((repo) => {
			const repoRows = rows.filter((row) => row.repo === repo);
			return { repo, summary: summarize(repoRows) };
		}),
	};
}

function renderSummary(
	summary: AssistedManualBenchmarkSummary,
	cases: number,
): string {
	return table([
		["Metric", "Result"],
		["Answer-bearing cases", `${summary.answerBearingCases}/${cases}`],
		["Signal-empty cases", `${summary.signalEmptyCases}/${cases}`],
		[
			"Top-5 useful",
			`${summary.top5Useful}/${summary.answerBearingCases} (${pct(summary.top5Useful, summary.answerBearingCases)})`,
		],
		[
			"Safe initial actions",
			`${summary.safeInitialActions}/${summary.cases} (${pct(summary.safeInitialActions, summary.cases)})`,
		],
		[
			"Unsafe initial answers",
			`${summary.unsafeInitialAnswers}/${summary.cases} (${pct(summary.unsafeInitialAnswers, summary.cases)})`,
		],
		[
			"Retry attempts",
			`${summary.retryAttempts}/${summary.cases} (${pct(summary.retryAttempts, summary.cases)})`,
		],
		[
			"Retry improved",
			`${summary.retryImproved}/${summary.retryAttempts} (${pct(summary.retryImproved, summary.retryAttempts)})`,
		],
		[
			"Retry recovered",
			`${summary.retryRecovered}/${summary.retryAttempts} (${pct(summary.retryRecovered, summary.retryAttempts)})`,
		],
		[
			"Signal-empty honest",
			`${summary.signalEmptyHonest}/${summary.signalEmptyCases} (${pct(summary.signalEmptyHonest, summary.signalEmptyCases)})`,
		],
		["Avg assisted pack tokens", round(summary.avgAssistedPackTokens)],
		["Avg targeted manual tokens", round(summary.avgManualTargetedTokens)],
		["Avg corpus manual tokens", round(summary.avgManualCorpusTokens)],
		["Avg oracle gold lower bound", round(summary.avgOracleGoldTokens)],
		[
			"Avg assisted/targeted manual ratio",
			ratio(summary.avgAssistedToManualTargetedRatio),
		],
		[
			"Avg assisted/corpus manual ratio",
			ratio(summary.avgAssistedToManualCorpusRatio),
		],
		["Avg assisted/oracle ratio", ratio(summary.avgAssistedToOracleRatio)],
	]);
}

export function renderAssistedManualBenchmarkReport(
	report: AssistedManualBenchmarkReport,
): string {
	const lines: string[] = [];
	lines.push("Assisted-vs-manual benchmark");
	lines.push("");
	lines.push(`Repos: ${report.repos.join(", ") || "(none)"}`);
	lines.push(`Cases: ${report.summary.cases}`);
	lines.push("");
	lines.push(renderSummary(report.summary, report.summary.cases));
	lines.push("");
	lines.push("By repo");
	lines.push(
		table([
			[
				"Repo",
				"Cases",
				"Top-5 useful",
				"Retry improved",
				"Retry recovered",
				"Pack",
				"Manual target",
				"Pack/target",
				"Manual corpus",
				"Pack/corpus",
				"Oracle LB",
				"Pack/oracle",
			],
			...report.byRepo.map(({ repo, summary }) => [
				repo,
				String(summary.cases),
				`${summary.top5Useful}/${summary.answerBearingCases}`,
				`${summary.retryImproved}/${summary.retryAttempts}`,
				`${summary.retryRecovered}/${summary.retryAttempts}`,
				round(summary.avgAssistedPackTokens),
				round(summary.avgManualTargetedTokens),
				ratio(summary.avgAssistedToManualTargetedRatio),
				round(summary.avgManualCorpusTokens),
				ratio(summary.avgAssistedToManualCorpusRatio),
				round(summary.avgOracleGoldTokens),
				ratio(summary.avgAssistedToOracleRatio),
			]),
		]),
	);

	const unsafe = report.rows.filter((row) => isUnsafeInitialAnswer(row));
	lines.push("");
	lines.push(`Unsafe initial answers: ${unsafe.length}`);
	for (const row of unsafe) {
		lines.push(
			`  ${row.repo}/${row.id}  fc=${row.failureClass}  readiness=${row.pack_readiness}  coverage=${row.coverage_confidence}`,
		);
	}

	const retryMisses = report.rows.filter(
		(row) =>
			row.isAnswerBearing &&
			row.initialAction === "retry_with_followup_searches" &&
			row.initialTop5Hit === false &&
			row.retryTop5Hit !== true,
	);
	lines.push("");
	lines.push(`Unrecovered retry top-5 misses: ${retryMisses.length}`);
	for (const row of retryMisses) {
		lines.push(
			`  ${row.repo}/${row.id}  initial=${row.initialAction}  retry=${row.retryAction ?? "n/a"}  top5=${row.initialTop5Hit ?? "n/a"}->${row.retryTop5Hit ?? "n/a"}`,
		);
	}

	return `${lines.join("\n")}\n`;
}

export function writeAssistedManualBenchmarkReport(
	report: AssistedManualBenchmarkReport,
	reportOut: string,
): void {
	const jsonPath = reportOut.endsWith(".json")
		? reportOut
		: `${reportOut}.json`;
	const mdPath = reportOut.endsWith(".json")
		? reportOut.replace(/\.json$/, ".md")
		: `${reportOut}.md`;
	mkdirSync(dirname(jsonPath), { recursive: true });
	writeFileSync(jsonPath, serializeAssistedManualBenchmarkReport(report));
	writeFileSync(mdPath, renderAssistedManualBenchmarkReport(report));
}

function parseRepos(argv: string[]): string[] | undefined {
	const repos: string[] = [];
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i]!;
		if (arg === "--repo" && argv[i + 1]) {
			repos.push(...argv[i + 1]!.split(","));
			i += 1;
			continue;
		}
		if (arg.startsWith("--repo=")) {
			repos.push(...arg.slice("--repo=".length).split(","));
		}
	}
	const cleaned = repos
		.map((repo) => repo.trim())
		.filter((repo) => repo.length > 0);
	return cleaned.length === 0 ? undefined : cleaned;
}

function valueAfter(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index === -1 ? undefined : argv[index + 1];
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const json = argv.includes("--json");
	const reportOut = valueAfter(argv, "--report-out");
	const report = await runAssistedManualBenchmark({ repos: parseRepos(argv) });
	process.stdout.write(
		json
			? serializeAssistedManualBenchmarkReport(report)
			: renderAssistedManualBenchmarkReport(report),
	);
	if (reportOut) {
		writeAssistedManualBenchmarkReport(report, reportOut);
		process.stderr.write(`assisted/manual report written: ${reportOut}\n`);
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	await main().catch((err) => {
		process.stderr.write(
			`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
		);
		process.exit(1);
	});
}
