#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  compareEvalReports,
  evaluateGates,
  renderEvalReport,
  renderEvalReportWithBaseline,
  runFixtureRetrievalEval,
} from "./retrieval-fixture.js";
import type { EvalReport } from "./types.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const baselineOut = valueAfter("--baseline-out");
const compareBaseline = valueAfter("--compare-baseline");

function valueAfter(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function normalizeBaseline(raw: string): EvalReport {
  const parsed = JSON.parse(raw) as EvalReport & { report?: EvalReport };
  if ("report" in parsed && parsed.report) return parsed.report;
  return parsed;
}

const report = await runFixtureRetrievalEval();
const gates = evaluateGates(report);
const baselineReport = compareBaseline ? normalizeBaseline(readFileSync(compareBaseline, "utf8")) : undefined;
const comparison = baselineReport ? compareEvalReports(report, baselineReport) : undefined;

if (json) {
  process.stdout.write(JSON.stringify({ ...report, gates, baseline_comparison: comparison }, null, 2) + "\n");
} else {
  process.stdout.write(baselineReport ? renderEvalReportWithBaseline(report, baselineReport) : renderEvalReport(report));
}

if (baselineOut) {
  mkdirSync(dirname(baselineOut), { recursive: true });
  writeFileSync(
    baselineOut,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        report,
        gates,
      },
      null,
      2,
    ) + "\n",
  );
}

if (!gates.every((gate) => gate.pass)) {
  process.exit(1);
}
