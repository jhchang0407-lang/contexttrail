#!/usr/bin/env node
/**
 * Public-document hybrid workflow panel.
 *
 * This panel mixes real public source language with deliberately messy office
 * packets. It is intentionally separate from the synthetic document-workflow
 * panel so engine changes can be checked against both clean public references
 * and the rough artifacts agents see in real business folders.
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
import { buildReferenceOutputs } from "./document-workflow-reference-outputs.js";

export const DOCUMENT_WORKFLOW_HYBRID_FIXTURES = [
  "tests/fixtures/document-workflows/public-hybrid-policy/workflows.yaml",
  "tests/fixtures/document-workflows/messy-office-packets/workflows.yaml",
] as const;

type DocumentWorkflowHybridPanelReport = {
  panelName: string;
  splitFilter?: DocumentWorkflowReport["splitFilter"];
  fixtureReports: DocumentWorkflowReport[];
  aggregate: DocumentWorkflowReport;
};

function fixtureTraceDir(traceRoot: string, fixturePath: string): string {
  return join(traceRoot, basename(dirname(fixturePath)));
}

export async function runDocumentWorkflowHybridPanel(
  argv = process.argv,
): Promise<DocumentWorkflowHybridPanelReport> {
  const args = parseDocumentWorkflowArgs(argv);
  const traceRoot = args.traceDir ? resolve(args.traceDir) : undefined;
  const fixtureReports: DocumentWorkflowReport[] = [];

  for (const fixturePath of DOCUMENT_WORKFLOW_HYBRID_FIXTURES) {
    if (args.split) {
      const fixture = loadDocumentWorkflowFixture(fixturePath);
      if (!fixture.workflows.some((workflow) => workflow.split === args.split)) continue;
    }
    fixtureReports.push(await runDocumentWorkflowEval({
      fixturePath,
      outputPath: args.outputPath,
      outputs: args.outputPath ? undefined : buildReferenceOutputs([fixturePath]),
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
    throw new Error(`No public hybrid workflow fixtures contain split '${args.split}'`);
  }

  const cases = fixtureReports.flatMap((report) => report.cases);
  const failureAnalyses = fixtureReports.flatMap((report) => report.failureAnalyses);
  const importedSources = fixtureReports.reduce((sum, report) => sum + report.importedSources, 0);
  const aggregate: DocumentWorkflowReport = {
    fixturePath: DOCUMENT_WORKFLOW_HYBRID_FIXTURES.join(", "),
    fixtureName: "document_workflow_hybrid_panel",
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
  const panelReport: DocumentWorkflowHybridPanelReport = {
    panelName: "document_workflow_hybrid_panel",
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
  const panel = await runDocumentWorkflowHybridPanel(process.argv);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(panel, null, 2)}\n`);
    return;
  }
  const fixtureNames = panel.fixtureReports.map((report) => report.fixtureName).join(", ");
  process.stdout.write(`Public hybrid fixtures: ${fixtureNames}\n\n`);
  if (args.traceDir) process.stdout.write(`Trace root: ${resolve(args.traceDir)}\n\n`);
  process.stdout.write(renderDocumentWorkflowReport(panel.aggregate));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
