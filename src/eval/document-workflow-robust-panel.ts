#!/usr/bin/env node
/**
 * Promotion-facing document-workflow robustness panel.
 *
 * The smaller authored and public-hybrid panels are useful diagnostics. This
 * runner combines them and enables reference-output scoring by default so an
 * engine change is judged against breadth, citation authority, abstention,
 * computed grounding, and judgment grounding in one place.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessDocumentWorkflowBreadth,
  renderDocumentWorkflowBreadthAssessment,
  type DocumentWorkflowBreadthAssessment,
} from "./document-workflow-breadth.js";
import { DOCUMENT_WORKFLOW_HYBRID_FIXTURES } from "./document-workflow-hybrid-panel.js";
import { DOCUMENT_WORKFLOW_PANEL_FIXTURES } from "./document-workflow-panel.js";
import {
  loadDocumentWorkflowFixture,
  parseDocumentWorkflowArgs,
  renderDocumentWorkflowReport,
  runDocumentWorkflowEval,
  summarizeDocumentWorkflow,
  type DocumentWorkflowReport,
} from "./document-workflow-probe.js";
import { buildReferenceOutputs } from "./document-workflow-reference-outputs.js";

export const DOCUMENT_WORKFLOW_ROBUST_FIXTURES = [
  ...DOCUMENT_WORKFLOW_PANEL_FIXTURES,
  ...DOCUMENT_WORKFLOW_HYBRID_FIXTURES,
] as const;

type DocumentWorkflowRobustPanelReport = {
  panelName: string;
  splitFilter?: DocumentWorkflowReport["splitFilter"];
  fixtureReports: DocumentWorkflowReport[];
  aggregate: DocumentWorkflowReport;
  breadth: DocumentWorkflowBreadthAssessment;
};

function fixtureTraceDir(traceRoot: string, fixturePath: string): string {
  return join(traceRoot, basename(dirname(fixturePath)));
}

export async function runDocumentWorkflowRobustPanel(
  argv = process.argv,
): Promise<DocumentWorkflowRobustPanelReport> {
  const args = parseDocumentWorkflowArgs(argv);
  const traceRoot = args.traceDir ? resolve(args.traceDir) : undefined;
  const fixtureReports: DocumentWorkflowReport[] = [];

  for (const fixturePath of DOCUMENT_WORKFLOW_ROBUST_FIXTURES) {
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
    throw new Error(`No robust document workflow fixtures contain split '${args.split}'`);
  }

  const cases = fixtureReports.flatMap((report) => report.cases);
  const failureAnalyses = fixtureReports.flatMap((report) => report.failureAnalyses);
  const importedSources = fixtureReports.reduce((sum, report) => sum + report.importedSources, 0);
  const aggregate: DocumentWorkflowReport = {
    fixturePath: DOCUMENT_WORKFLOW_ROBUST_FIXTURES.join(", "),
    fixtureName: "document_workflow_robust_panel",
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
  const panelReport: DocumentWorkflowRobustPanelReport = {
    panelName: "document_workflow_robust_panel",
    ...(args.split ? { splitFilter: args.split } : {}),
    fixtureReports,
    aggregate,
    breadth: assessDocumentWorkflowBreadth(aggregate),
  };

  if (traceRoot) {
    mkdirSync(traceRoot, { recursive: true });
    writeFileSync(join(traceRoot, "panel-summary.json"), `${JSON.stringify(panelReport, null, 2)}\n`);
  }
  return panelReport;
}

async function main(): Promise<void> {
  const args = parseDocumentWorkflowArgs(process.argv);
  const panel = await runDocumentWorkflowRobustPanel(process.argv);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(panel, null, 2)}\n`);
    return;
  }
  const fixtureNames = panel.fixtureReports.map((report) => report.fixtureName).join(", ");
  process.stdout.write(`Robust fixtures: ${fixtureNames}\n\n`);
  if (args.traceDir) process.stdout.write(`Trace root: ${resolve(args.traceDir)}\n\n`);
  process.stdout.write(renderDocumentWorkflowReport(panel.aggregate));
  process.stdout.write("\n");
  process.stdout.write(renderDocumentWorkflowBreadthAssessment(panel.breadth));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
