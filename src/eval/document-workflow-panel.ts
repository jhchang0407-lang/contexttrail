#!/usr/bin/env node
/**
 * Cross-fixture document-workflow panel runner.
 *
 * This is the promotion-facing entry point: it runs every active document
 * workflow fixture and renders one aggregate report so an engine change has to
 * survive multiple work archetypes, not just the default insurance lane.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDocumentWorkflowFixture,
  parseDocumentWorkflowArgs,
  renderDocumentWorkflowReport,
  runDocumentWorkflowEval,
  summarizeDocumentWorkflow,
  type DocumentWorkflowReport,
} from "./document-workflow-probe.js";

export const DOCUMENT_WORKFLOW_PANEL_FIXTURES = [
  "tests/fixtures/document-workflows/insurance-claim/workflows.yaml",
  "tests/fixtures/document-workflows/contract-policy-review/workflows.yaml",
  "tests/fixtures/document-workflows/numeric-reconciliation/workflows.yaml",
  "tests/fixtures/document-workflows/relationship-history/workflows.yaml",
  "tests/fixtures/document-workflows/employee-operations/workflows.yaml",
  "tests/fixtures/document-workflows/vendor-onboarding-compliance/workflows.yaml",
  "tests/fixtures/document-workflows/business-ops-expansion/workflows.yaml",
] as const;

type DocumentWorkflowPanelReport = {
  panelName: string;
  splitFilter?: DocumentWorkflowReport["splitFilter"];
  fixtureReports: DocumentWorkflowReport[];
  aggregate: DocumentWorkflowReport;
};

function fixtureTraceDir(traceRoot: string, fixturePath: string): string {
  return join(traceRoot, basename(dirname(fixturePath)));
}

export async function runDocumentWorkflowPanel(argv = process.argv): Promise<DocumentWorkflowPanelReport> {
  const args = parseDocumentWorkflowArgs(argv);
  const traceRoot = args.traceDir ? resolve(args.traceDir) : undefined;
  const fixtureReports: DocumentWorkflowReport[] = [];

  for (const fixturePath of DOCUMENT_WORKFLOW_PANEL_FIXTURES) {
    if (args.split) {
      const fixture = loadDocumentWorkflowFixture(fixturePath);
      if (!fixture.workflows.some((workflow) => workflow.split === args.split)) continue;
    }
    fixtureReports.push(await runDocumentWorkflowEval({
      fixturePath,
      outputPath: args.outputPath,
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
    fixturePath: DOCUMENT_WORKFLOW_PANEL_FIXTURES.join(", "),
    fixtureName: "document_workflow_panel",
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
    ...(args.outputPath ? { outputPath: resolve(args.outputPath) } : {}),
    cases,
    failureAnalyses,
    summary: summarizeDocumentWorkflow({ importedSources, cases }),
  };
  const panelReport: DocumentWorkflowPanelReport = {
    panelName: "document_workflow_panel",
    ...(args.split ? { splitFilter: args.split } : {}),
    fixtureReports,
    aggregate,
  };

  if (traceRoot) {
    mkdirSync(traceRoot, { recursive: true });
    writeFileSync(join(traceRoot, "panel-summary.json"), `${JSON.stringify(panelReport, null, 2)}\n`);
  }
  return panelReport;
}

async function main(): Promise<void> {
  const args = parseDocumentWorkflowArgs(process.argv);
  const panel = await runDocumentWorkflowPanel(process.argv);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(panel, null, 2)}\n`);
    return;
  }
  const fixtureNames = panel.fixtureReports.map((report) => report.fixtureName).join(", ");
  process.stdout.write(`Panel fixtures: ${fixtureNames}\n\n`);
  if (args.traceDir) process.stdout.write(`Trace root: ${resolve(args.traceDir)}\n\n`);
  process.stdout.write(renderDocumentWorkflowReport(panel.aggregate));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
