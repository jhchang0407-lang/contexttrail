#!/usr/bin/env node
/**
 * Mutation pressure runner for public-document hybrid workflow evals.
 *
 * This mirrors the synthetic document-workflow mutation runner but uses the
 * public hybrid fixture set and deterministic reference outputs so retrieval
 * misses, citation scoring, abstention, and authority handling are observed
 * under noisy query and corpus conditions.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { DOCUMENT_WORKFLOW_HYBRID_FIXTURES } from "./document-workflow-hybrid-panel.js";
import {
  DOCUMENT_WORKFLOW_MUTATIONS,
  applyDocumentWorkflowMutation,
  type DocumentWorkflowMutation,
} from "./document-workflow-mutations.js";
import {
  loadDocumentWorkflowFixture,
  parseDocumentWorkflowArgs,
  renderDocumentWorkflowReport,
  runDocumentWorkflowEval,
  summarizeDocumentWorkflow,
  type DocumentWorkflowFixture,
  type DocumentWorkflowReport,
} from "./document-workflow-probe.js";
import { buildReferenceOutputs } from "./document-workflow-reference-outputs.js";

type DocumentWorkflowHybridMutationReport = {
  mutation: DocumentWorkflowMutation;
  fixtureReports: DocumentWorkflowReport[];
  aggregate: DocumentWorkflowReport;
};

type DocumentWorkflowHybridMutationPanelReport = {
  panelName: string;
  mutations: DocumentWorkflowHybridMutationReport[];
};

function mutationFromArg(value: string): DocumentWorkflowMutation {
  if (!DOCUMENT_WORKFLOW_MUTATIONS.includes(value as DocumentWorkflowMutation)) {
    throw new Error(`--mutation must be one of ${DOCUMENT_WORKFLOW_MUTATIONS.join(", ")}`);
  }
  return value as DocumentWorkflowMutation;
}

function mutationArgs(argv: string[]): DocumentWorkflowMutation[] {
  const requested = argv
    .map((arg) => /^--mutation=(.+)$/.exec(arg)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(mutationFromArg);
  return requested.length > 0 ? requested : [...DOCUMENT_WORKFLOW_MUTATIONS];
}

function writeHybridCorpusNoise(fixtureRoot: string, fixture: DocumentWorkflowFixture): void {
  const terms = fixture.workflows
    .flatMap((workflow) => [
      workflow.title,
      workflow.prompt,
      ...workflow.task_variants,
      ...workflow.challenge_tags,
      ...workflow.fields.map((field) => field.label),
    ])
    .join(" ");
  const body = [
    "---",
    'source_url: "generated://public-hybrid-mutation-noise"',
    'source_type: "generated_noise"',
    "public_source: false",
    "---",
    "",
    "# Public Document Search Export",
    "",
    "## Non-Authoritative Blended Snippets",
    "",
    "This generated mutation document is intentionally non-authoritative.",
    "It blends public-document keywords across FMLA, NFIP, FAR, and SEC tasks",
    "to test whether retrieval can resist broad but unsupported corpus clutter.",
    "",
    terms,
    "",
  ].join("\n");
  mkdirSync(join(fixtureRoot, "corpus"), { recursive: true });
  writeFileSync(join(fixtureRoot, "corpus", "zz-public-hybrid-mutation-noise.md"), body);
}

function prepareMutatedFixture(args: {
  fixturePath: string;
  mutation: DocumentWorkflowMutation;
}): string {
  const sourceRoot = dirname(resolve(args.fixturePath));
  const tempRoot = mkdtempSync(join(tmpdir(), `contexttrail-public-hybrid-${args.mutation}-`));
  cpSync(sourceRoot, tempRoot, { recursive: true });
  const fixturePath = join(tempRoot, "workflows.yaml");
  const fixture = loadDocumentWorkflowFixture(fixturePath);
  const mutated = applyDocumentWorkflowMutation(fixture, args.mutation);
  writeFileSync(fixturePath, YAML.stringify(mutated));
  if (args.mutation === "corpus_noise") writeHybridCorpusNoise(tempRoot, fixture);
  return fixturePath;
}

async function runHybridMutation(args: {
  mutation: DocumentWorkflowMutation;
  split?: DocumentWorkflowReport["splitFilter"];
  topK?: number;
  candidatePoolK?: number;
  sourceSweepK?: number;
  crossSlotK?: number;
  absenceVerifierK?: number;
  ruleApplicationK?: number;
  expectedPlaceK?: number;
  aliasStatusK?: number;
  sourceLocalCompletionK?: number;
  nearMissK?: number;
  rejectedLimit?: number;
  traceRoot?: string;
}): Promise<DocumentWorkflowHybridMutationReport> {
  const fixtureReports: DocumentWorkflowReport[] = [];
  const tempFixturePaths: string[] = [];
  try {
    for (const fixturePath of DOCUMENT_WORKFLOW_HYBRID_FIXTURES) {
      if (args.split) {
        const fixture = loadDocumentWorkflowFixture(fixturePath);
        if (!fixture.workflows.some((workflow) => workflow.split === args.split)) continue;
      }
      const mutatedFixturePath = prepareMutatedFixture({ fixturePath, mutation: args.mutation });
      tempFixturePaths.push(dirname(mutatedFixturePath));
      const traceDir = args.traceRoot
        ? join(args.traceRoot, args.mutation, basename(dirname(fixturePath)))
        : undefined;
      fixtureReports.push(await runDocumentWorkflowEval({
        fixturePath: mutatedFixturePath,
        outputs: buildReferenceOutputs([mutatedFixturePath]),
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
        traceDir,
      }));
    }
    if (fixtureReports.length === 0) {
      throw new Error(`No public hybrid workflow fixtures contain split '${args.split}'`);
    }
    const cases = fixtureReports.flatMap((report) => report.cases);
    const failureAnalyses = fixtureReports.flatMap((report) => report.failureAnalyses);
    const importedSources = fixtureReports.reduce((sum, report) => sum + report.importedSources, 0);
    return {
      mutation: args.mutation,
      fixtureReports,
      aggregate: {
        fixturePath: DOCUMENT_WORKFLOW_HYBRID_FIXTURES.join(", "),
        fixtureName: `document_workflow_hybrid_panel_${args.mutation}`,
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
      },
    };
  } finally {
    for (const root of tempFixturePaths) rmSync(root, { recursive: true, force: true });
  }
}

export async function runDocumentWorkflowHybridMutations(
  argv = process.argv,
): Promise<DocumentWorkflowHybridMutationPanelReport> {
  const args = parseDocumentWorkflowArgs(argv);
  const traceRoot = args.traceDir ? resolve(args.traceDir) : undefined;
  const mutations: DocumentWorkflowHybridMutationReport[] = [];
  for (const mutation of mutationArgs(argv)) {
    mutations.push(await runHybridMutation({
      mutation,
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
      traceRoot,
    }));
  }
  if (traceRoot) {
    mkdirSync(traceRoot, { recursive: true });
    writeFileSync(join(traceRoot, "mutation-panel-summary.json"), `${JSON.stringify({ mutations }, null, 2)}\n`);
  }
  return {
    panelName: "document_workflow_hybrid_mutation_panel",
    mutations,
  };
}

async function main(): Promise<void> {
  const args = parseDocumentWorkflowArgs(process.argv);
  const report = await runDocumentWorkflowHybridMutations(process.argv);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  for (const mutation of report.mutations) {
    process.stdout.write(`Public hybrid mutation: ${mutation.mutation}\n\n`);
    process.stdout.write(renderDocumentWorkflowReport(mutation.aggregate));
    process.stdout.write("\n");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
