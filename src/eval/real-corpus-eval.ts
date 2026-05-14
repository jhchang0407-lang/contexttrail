#!/usr/bin/env node
/**
 * Entrypoint for the real-corpus retrieval eval.
 *
 * Usage:
 *   node dist/eval/real-corpus-eval.js                          # all repos
 *   node dist/eval/real-corpus-eval.js --repo ralph             # one repo
 *   node dist/eval/real-corpus-eval.js --baseline-out path.json # freeze baseline
 *   node dist/eval/real-corpus-eval.js --json                   # raw JSON
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	realCorpusRoot,
	renderRealCorpusReport,
	runRealCorpusRetrievalEval,
	summarizeRealCorpus,
	type RealCorpusReport,
} from "./real-corpus-fixture.js";
import { runSlice0CapturePerRepo } from "./slice0/runner.js";
import {
	aggregateSlice0Report,
	renderSlice0Markdown,
	serializeSlice0Report,
} from "./slice0/report.js";
import { summarizeCeilingProbeOutcome } from "./slice0/outcome.js";
import { runFixtureRetrievalEval } from "./retrieval-fixture.js";
import { evaluateGates } from "./report.js";
import {
	evaluatePrd0016Gates,
	renderPrd0016Verdict,
	type Prd0016InputSummary,
} from "./prd0016-gates.js";
import { runFixtureRetrievalEval as runFixtureForGates } from "./retrieval-fixture.js";
import { evaluateGates as evaluateSyntheticGates } from "./report.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const ceilingProbes = args.includes("--ceiling-probes");
const baselineOut = valueAfter("--baseline-out");
const repoFilter = valueAfter("--repo");
const reportOut = valueAfter("--report-out");

function valueAfter(flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
}

function aggregatePrd0016Summary(
	reports: RealCorpusReport[],
): Prd0016InputSummary {
	let answer_top_1 = 0;
	let answer_top_3 = 0;
	let answer_bearing_cases = 0;
	let true_top_3_misses = 0;
	let top_3_hit_top_1_miss = 0;
	let signal_empty_coverage_honest = 0;
	let signal_empty_cases = 0;
	let combined_coverage_honest = 0;
	let total_cases = 0;
	let agent_answer = 0;
	let query_mode_correct = 0;
	let chunk_correct = 0;
	let chunk_scored = 0;
	let bytesSum = 0;
	for (const r of reports) {
		const docOnly = summarizeRealCorpus(
			r.observations.filter((obs) => (obs.eval_surface ?? "docs") === "docs"),
		);
		answer_top_1 += docOnly.answerTop1;
		answer_top_3 += docOnly.answerTop3;
		answer_bearing_cases += docOnly.answerBearingCases;
		true_top_3_misses += docOnly.trueTop3Misses;
		top_3_hit_top_1_miss += docOnly.top3HitTop1Miss;
		signal_empty_coverage_honest += docOnly.signalEmptyCoverageHonest;
		signal_empty_cases += docOnly.signalEmptyCases;
		combined_coverage_honest += docOnly.coverageHonest;
		total_cases += docOnly.cases;
		agent_answer += docOnly.agentAnswer;
		query_mode_correct += docOnly.queryModeCorrect;
		chunk_correct += docOnly.chunkCorrect;
		chunk_scored += docOnly.chunkScored;
		bytesSum += docOnly.avgPayloadBytes * docOnly.cases;
	}
	return {
		answer_top_1,
		answer_top_3,
		answer_bearing_cases,
		true_top_3_misses,
		top_3_hit_top_1_miss,
		signal_empty_coverage_honest,
		signal_empty_cases,
		combined_coverage_honest,
		total_cases,
		agent_answer,
		query_mode_correct,
		chunk_correct,
		chunk_scored,
		avg_payload_bytes:
			total_cases === 0 ? 0 : Math.round(bytesSum / total_cases),
		synthetic_regression: false,
	};
}

function discoverRepos(): string[] {
	const root = realCorpusRoot();
	const repos: string[] = [];
	for (const name of readdirSync(root)) {
		if (!name.endsWith(".yaml")) continue;
		// THO-135: skip per-repo override sidecars like `zod.config.yaml`.
		if (name.endsWith(".config.yaml")) continue;
		const repo = name.replace(/\.yaml$/, "");
		const docsPath = join(root, repo);
		try {
			if (statSync(docsPath).isDirectory()) repos.push(repo);
		} catch {
			// no matching docs dir — skip
		}
	}
	return repos.sort();
}

const repos = repoFilter ? [repoFilter] : discoverRepos();
if (repos.length === 0) {
	process.stderr.write(
		`No real-corpus repos found under ${realCorpusRoot()}.\n`,
	);
	process.exit(2);
}

if (ceilingProbes) {
	// PRD-0010 / Slice 0: capture pre-pack scored candidates and emit a
	// ceiling-probe report instead of the production-shape baseline. This
	// path is measurement-only and does not change MCP/CLI contracts.
	const captures = [];
	for (const repo of repos) {
		captures.push(await runSlice0CapturePerRepo(repo));
	}

	// Synthetic fixture is the hard regression gate. A pass has no positive
	// ship power, but a fail forces branch decision `stop_fix_regression`.
	const synthetic = await runFixtureRetrievalEval();
	const gates = evaluateGates(synthetic);
	const failedGates = gates.filter((g) => !g.pass).map((g) => g.name);
	const synthetic_regression = failedGates.length > 0;

	const report = aggregateSlice0Report({
		captures,
		synthetic_regression,
		synthetic_failed_gates: failedGates,
		generated_at: new Date().toISOString(),
	});

	if (json) {
		process.stdout.write(serializeSlice0Report(report));
	} else {
		process.stdout.write(renderSlice0Markdown(report));
	}

	if (reportOut) {
		const jsonPath = reportOut.endsWith(".json")
			? reportOut
			: `${reportOut}.json`;
		const mdPath = reportOut.endsWith(".json")
			? reportOut.replace(/\.json$/, ".md")
			: `${reportOut}.md`;
		mkdirSync(dirname(jsonPath), { recursive: true });
		writeFileSync(jsonPath, serializeSlice0Report(report));
		writeFileSync(mdPath, renderSlice0Markdown(report));
		process.stderr.write(`slice 0 report written: ${jsonPath} and ${mdPath}\n`);
	}

	// PRD-0013 V2.5.1 / THO-134: holdout gates are the ship verdict; combined
	// gates are context. summarizeCeilingProbeOutcome renders both and the
	// false-confident-unsupported and synthetic-regression checks in one pass.
	const outcome = summarizeCeilingProbeOutcome(report);
	for (const err of outcome.errors) {
		process.stderr.write(`ERROR: ${err}\n`);
	}
	if (outcome.exit_code !== 0) process.exit(outcome.exit_code);
} else {
	const reports: RealCorpusReport[] = [];
	for (const repo of repos) {
		const report = await runRealCorpusRetrievalEval({ repo });
		reports.push(report);
	}

	if (json) {
		process.stdout.write(
			JSON.stringify(
				{ reports, generated_at: new Date().toISOString() },
				null,
				2,
			) + "\n",
		);
	} else {
		for (const report of reports) {
			process.stdout.write(renderRealCorpusReport(report));
			process.stdout.write("\n");
		}

		// PRD-0016 P16.8 / THO-166: emit a release verdict when running
		// against the full repo set. Skipped when --repo narrows the run
		// because the PRD's gate values are computed against the
		// canonical 148-case combined corpus.
		if (!repoFilter) {
			const aggregated = aggregatePrd0016Summary(reports);
			const synth = await runFixtureForGates();
			const failedSynthGates = evaluateSyntheticGates(synth)
				.filter((g) => !g.pass)
				.map((g) => g.name);
			aggregated.synthetic_regression = failedSynthGates.length > 0;
			const baseline: Prd0016InputSummary = {
				answer_top_1: 105,
				answer_top_3: 118,
				answer_bearing_cases: 122,
				true_top_3_misses: 4,
				top_3_hit_top_1_miss: 13,
				signal_empty_coverage_honest: 26,
				signal_empty_cases: 26,
				combined_coverage_honest: 148,
				total_cases: 148,
				agent_answer: 147,
				query_mode_correct: 107,
				chunk_correct: 3,
				chunk_scored: 3,
				avg_payload_bytes: aggregated.avg_payload_bytes,
				synthetic_regression: false,
			};
			const verdict = evaluatePrd0016Gates({ baseline, current: aggregated });
			process.stdout.write(renderPrd0016Verdict(verdict));
		}
	}

	if (baselineOut) {
		mkdirSync(dirname(baselineOut), { recursive: true });
		writeFileSync(
			baselineOut,
			JSON.stringify(
				{
					generated_at: new Date().toISOString(),
					reports,
				},
				null,
				2,
			),
		);
		process.stderr.write(`baseline written: ${baselineOut}\n`);
	}
}
