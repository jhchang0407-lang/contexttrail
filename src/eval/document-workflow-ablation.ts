#!/usr/bin/env node
/**
 * Context-pack sufficiency runner for document workflows.
 *
 * This is the observation layer for "smallest sufficient context": it scores
 * the same retrieved workflow through several ablated pack variants and reports
 * how many tokens can be removed before baseline quality metrics regress.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENT_WORKFLOW_ROBUST_FIXTURES } from "./document-workflow-robust-panel.js";
import {
  buildDocumentWorkflowAblationReport,
  DOCUMENT_WORKFLOW_ABLATION_VARIANTS,
  loadDocumentWorkflowFixture,
  parseDocumentWorkflowArgs,
  runDocumentWorkflowEval,
  summarizeDocumentWorkflow,
  type DocumentWorkflowAblationReport,
  type DocumentWorkflowAblationVariant,
  type DocumentWorkflowReport,
} from "./document-workflow-probe.js";
import { buildReferenceOutputs } from "./document-workflow-reference-outputs.js";

export type DocumentWorkflowAblationPanelReport = {
  panelName: string;
  splitFilter?: DocumentWorkflowReport["splitFilter"];
  fixtureReports: DocumentWorkflowReport[];
  aggregate: DocumentWorkflowReport;
  ablations: DocumentWorkflowAblationReport[];
  smallestPassingVariant?: DocumentWorkflowAblationVariant;
};

function fixtureTraceDir(traceRoot: string, fixturePath: string): string {
  return join(traceRoot, basename(dirname(fixturePath)));
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, index) => Math.max(...rows.map((row) => row[index]!.length)));
  return rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ")).join("\n");
}

function qualityStatus(ablation: DocumentWorkflowAblationReport): string {
  if (ablation.passedBaselineQuality) return "pass";
  return `${ablation.qualityLosses.length} losses`;
}

function lossSummary(ablation: DocumentWorkflowAblationReport): string {
  if (ablation.qualityLosses.length === 0) return "none";
  return ablation.qualityLosses
    .map((loss) => `${loss.metric} ${loss.ablated}/${loss.baseline}`)
    .join("; ");
}

export function renderDocumentWorkflowAblationPanel(report: DocumentWorkflowAblationPanelReport): string {
  const baseline = report.aggregate.summary;
  const lines: string[] = [];
  lines.push("Document workflow ablation eval");
  lines.push("");
  lines.push(`Fixtures: ${report.fixtureReports.map((fixture) => fixture.fixtureName).join(", ")}`);
  if (report.splitFilter) lines.push(`Split: ${report.splitFilter}`);
  lines.push(
    `${baseline.workflows} workflows, ${baseline.slots} slots, ${baseline.fields} fields, baseline retrieved ${baseline.retrievedTokenTotal} tokens`,
  );
  lines.push("");
  lines.push(table([
    [
      "Variant",
      "Retrieved",
      "Reduction",
      "Required",
      "Useful",
      "Redundant",
      "Excluded/stale",
      "Quality",
    ],
    ...report.ablations.map((ablation) => [
      ablation.variant,
      String(ablation.retrievedTokens),
      pct(ablation.tokenReductionPct),
      String(ablation.summary.requiredEvidenceTokenTotal + ablation.summary.searchedScopeTokenTotal),
      String(ablation.summary.usefulSupportingTokenTotal),
      String(ablation.summary.redundantSupportingTokenTotal),
      String(ablation.summary.excludedOrStaleTokenTotal),
      qualityStatus(ablation),
    ]),
  ]));
  const smallest = report.smallestPassingVariant
    ? report.ablations.find((ablation) => ablation.variant === report.smallestPassingVariant)
    : undefined;
  lines.push("");
  lines.push(
    smallest
      ? `Smallest passing variant: ${smallest.variant} at ${smallest.retrievedTokens} tokens (${pct(smallest.tokenReductionPct)} reduction).`
      : "Smallest passing variant: none.",
  );
  lines.push("");
  lines.push("Quality losses");
  for (const ablation of report.ablations) {
    lines.push(`- ${ablation.variant}: ${lossSummary(ablation)}`);
  }
  return `${lines.join("\n")}\n`;
}

function ablationFixturePaths(argv: string[]): string[] {
  const args = parseDocumentWorkflowArgs(argv);
  return args.fixturePath ? [args.fixturePath] : [...DOCUMENT_WORKFLOW_ROBUST_FIXTURES];
}

export async function runDocumentWorkflowAblationPanel(
  argv = process.argv,
): Promise<DocumentWorkflowAblationPanelReport> {
  const args = parseDocumentWorkflowArgs(argv);
  const traceRoot = args.traceDir ? resolve(args.traceDir) : undefined;
  const fixturePaths = ablationFixturePaths(argv);
  const fixtureReports: DocumentWorkflowReport[] = [];
  for (const fixturePath of fixturePaths) {
    if (args.split) {
      const fixture = loadDocumentWorkflowFixture(fixturePath);
      if (!fixture.workflows.some((workflow) => workflow.split === args.split)) continue;
    }
    fixtureReports.push(await runDocumentWorkflowEval({
      fixturePath,
      outputPath: args.outputPath,
      outputs: args.outputPath ? undefined : buildReferenceOutputs([fixturePath]),
      ablationVariants: [...DOCUMENT_WORKFLOW_ABLATION_VARIANTS],
      split: args.split,
      topK: args.topK,
      candidatePoolK: args.candidatePoolK,
      sourceSweepK: args.sourceSweepK,
      crossSlotK: args.crossSlotK,
      absenceVerifierK: args.absenceVerifierK,
      ruleApplicationK: args.ruleApplicationK,
      expectedPlaceK: args.expectedPlaceK,
      aliasStatusK: args.aliasStatusK,
      sourceLocalCompletionK: args.sourceLocalCompletionK,
      nearMissK: args.nearMissK,
      rejectedLimit: args.rejectedLimit,
      traceDir: traceRoot ? fixtureTraceDir(traceRoot, fixturePath) : undefined,
    }));
  }
  if (fixtureReports.length === 0) {
    throw new Error(`No document workflow fixtures contain split '${args.split}'`);
  }
  const cases = fixtureReports.flatMap((report) => report.cases);
  const failureAnalyses = fixtureReports.flatMap((report) => report.failureAnalyses);
  const importedSources = fixtureReports.reduce((sum, report) => sum + report.importedSources, 0);
  const aggregate: DocumentWorkflowReport = {
    fixturePath: fixturePaths.join(", "),
    fixtureName: args.fixturePath ? fixtureReports[0]!.fixtureName : "document_workflow_ablation_panel",
    topK: args.topK ?? 5,
    candidatePoolK: Math.max(args.topK ?? 5, args.candidatePoolK ?? 12),
    sourceSweepK: args.sourceSweepK ?? 2,
    crossSlotK: args.crossSlotK ?? 2,
    absenceVerifierK: args.absenceVerifierK ?? 1,
    ruleApplicationK: args.ruleApplicationK ?? 1,
    expectedPlaceK: args.expectedPlaceK ?? 2,
    aliasStatusK: args.aliasStatusK ?? 1,
    sourceLocalCompletionK: args.sourceLocalCompletionK ?? 1,
    nearMissK: args.nearMissK ?? 1,
    importedSources,
    ...(args.split ? { splitFilter: args.split } : {}),
    cases,
    failureAnalyses,
    summary: summarizeDocumentWorkflow({ importedSources, cases }),
  };
  const ablations = DOCUMENT_WORKFLOW_ABLATION_VARIANTS.map((variant) =>
    buildDocumentWorkflowAblationReport({
      variant,
      importedSources,
      baselineSummary: aggregate.summary,
      cases: fixtureReports.flatMap((report) =>
        report.ablations?.find((ablation) => ablation.variant === variant)?.cases ?? []
      ),
    })
  );
  const smallestPassingVariant = [...ablations]
    .filter((ablation) => ablation.passedBaselineQuality)
    .sort((a, b) => a.retrievedTokens - b.retrievedTokens)[0]?.variant;
  const panelReport: DocumentWorkflowAblationPanelReport = {
    panelName: "document_workflow_ablation_panel",
    ...(args.split ? { splitFilter: args.split } : {}),
    fixtureReports,
    aggregate,
    ablations,
    ...(smallestPassingVariant ? { smallestPassingVariant } : {}),
  };
  if (traceRoot) {
    mkdirSync(traceRoot, { recursive: true });
    writeFileSync(join(traceRoot, "ablation-panel-summary.json"), `${JSON.stringify(panelReport, null, 2)}\n`);
  }
  return panelReport;
}

async function main(): Promise<void> {
  const args = parseDocumentWorkflowArgs(process.argv);
  const panel = await runDocumentWorkflowAblationPanel(process.argv);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(panel, null, 2)}\n`);
    return;
  }
  if (args.traceDir) process.stdout.write(`Trace root: ${resolve(args.traceDir)}\n\n`);
  process.stdout.write(renderDocumentWorkflowAblationPanel(panel));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
