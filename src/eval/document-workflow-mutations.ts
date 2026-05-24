#!/usr/bin/env node
/**
 * Mutation pressure runner for document-workflow evals.
 *
 * The normal panel tests the authored fixture. This runner clones each fixture
 * into a temporary packet and perturbs queries or corpus clutter, then reruns
 * the same gold requirements. It is intentionally small and deterministic:
 * the goal is to catch brittle methods that only win on perfect slot queries
 * or uncluttered fixture packets.
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
import {
  DOCUMENT_WORKFLOW_PANEL_FIXTURES,
} from "./document-workflow-panel.js";
import {
  loadDocumentWorkflowFixture,
  parseDocumentWorkflowArgs,
  renderDocumentWorkflowReport,
  runDocumentWorkflowEval,
  summarizeDocumentWorkflow,
  type ContextSlot,
  type DocumentWorkflowCase,
  type DocumentWorkflowFixture,
  type DocumentWorkflowReport,
} from "./document-workflow-probe.js";

export const DOCUMENT_WORKFLOW_MUTATIONS = [
  "broad_task_queries",
  "minimal_task_queries",
  "corpus_noise",
] as const;
export type DocumentWorkflowMutation = (typeof DOCUMENT_WORKFLOW_MUTATIONS)[number];

type DocumentWorkflowMutationReport = {
  mutation: DocumentWorkflowMutation;
  fixtureReports: DocumentWorkflowReport[];
  aggregate: DocumentWorkflowReport;
};

type DocumentWorkflowMutationPanelReport = {
  panelName: string;
  mutations: DocumentWorkflowMutationReport[];
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

function cloneFixture(fixture: DocumentWorkflowFixture): DocumentWorkflowFixture {
  return JSON.parse(JSON.stringify(fixture)) as DocumentWorkflowFixture;
}

function broadTaskQueries(workflow: DocumentWorkflowCase, slot: ContextSlot): string[] {
  return [
    `${workflow.prompt} ${slot.purpose}`.trim(),
    ...(workflow.task_variants[0] ? [workflow.task_variants[0]] : []),
  ];
}

function minimalTaskQueries(workflow: DocumentWorkflowCase): string[] {
  return [workflow.task_variants[0] ?? workflow.prompt];
}

export function applyDocumentWorkflowMutation(
  fixture: DocumentWorkflowFixture,
  mutation: DocumentWorkflowMutation,
): DocumentWorkflowFixture {
  const mutated = cloneFixture(fixture);
  if (mutation === "broad_task_queries") {
    mutated.workflows = mutated.workflows.map((workflow) => ({
      ...workflow,
      slots: workflow.slots.map((slot) => ({
        ...slot,
        queries: broadTaskQueries(workflow, slot),
      })),
    }));
  }
  if (mutation === "minimal_task_queries") {
    mutated.workflows = mutated.workflows.map((workflow) => ({
      ...workflow,
      slots: workflow.slots.map((slot) => ({
        ...slot,
        queries: minimalTaskQueries(workflow),
      })),
    }));
  }
  return mutated;
}

function writeCorpusNoise(fixtureRoot: string, fixture: DocumentWorkflowFixture): void {
  const terms = fixture.workflows
    .flatMap((workflow) => [
      workflow.title,
      workflow.prompt,
      ...workflow.task_variants,
      ...workflow.challenge_tags,
    ])
    .join(" ");
  const body = [
    "# Archived Search Export",
    "",
    "## Non-Authoritative Notes",
    "",
    "This generated mutation document is intentionally non-authoritative.",
    "It repeats workflow-like language to test whether retrieval resists broad",
    "but unsupported corpus clutter.",
    "",
    terms,
    "",
  ].join("\n");
  mkdirSync(join(fixtureRoot, "corpus"), { recursive: true });
  writeFileSync(join(fixtureRoot, "corpus", "zz-mutation-noise.md"), body);
}

function prepareMutatedFixture(args: {
  fixturePath: string;
  mutation: DocumentWorkflowMutation;
}): string {
  const sourceRoot = dirname(resolve(args.fixturePath));
  const tempRoot = mkdtempSync(join(tmpdir(), `contexttrail-${args.mutation}-`));
  cpSync(sourceRoot, tempRoot, { recursive: true });
  const fixturePath = join(tempRoot, "workflows.yaml");
  const fixture = loadDocumentWorkflowFixture(fixturePath);
  const mutated = applyDocumentWorkflowMutation(fixture, args.mutation);
  writeFileSync(fixturePath, YAML.stringify(mutated));
  if (args.mutation === "corpus_noise") writeCorpusNoise(tempRoot, fixture);
  return fixturePath;
}

async function runMutation(args: {
  mutation: DocumentWorkflowMutation;
  split?: DocumentWorkflowReport["splitFilter"];
  topK?: number;
  candidatePoolK?: number;
  rejectedLimit?: number;
  traceRoot?: string;
}): Promise<DocumentWorkflowMutationReport> {
  const fixtureReports: DocumentWorkflowReport[] = [];
  const tempFixturePaths: string[] = [];
  try {
    for (const fixturePath of DOCUMENT_WORKFLOW_PANEL_FIXTURES) {
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
        split: args.split,
        topK: args.topK,
        candidatePoolK: args.candidatePoolK,
        rejectedLimit: args.rejectedLimit,
        traceDir,
      }));
    }
    if (fixtureReports.length === 0) {
      throw new Error(`No document workflow fixtures contain split '${args.split}'`);
    }
    const cases = fixtureReports.flatMap((report) => report.cases);
    const failureAnalyses = fixtureReports.flatMap((report) => report.failureAnalyses);
    const importedSources = fixtureReports.reduce((sum, report) => sum + report.importedSources, 0);
    return {
      mutation: args.mutation,
      fixtureReports,
      aggregate: {
        fixturePath: DOCUMENT_WORKFLOW_PANEL_FIXTURES.join(", "),
        fixtureName: `document_workflow_panel_${args.mutation}`,
        topK: args.topK ?? 5,
        candidatePoolK: Math.max(args.topK ?? 5, args.candidatePoolK ?? 12),
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

export async function runDocumentWorkflowMutations(argv = process.argv): Promise<DocumentWorkflowMutationPanelReport> {
  const args = parseDocumentWorkflowArgs(argv);
  const traceRoot = args.traceDir ? resolve(args.traceDir) : undefined;
  const mutations: DocumentWorkflowMutationReport[] = [];
  for (const mutation of mutationArgs(argv)) {
    mutations.push(await runMutation({
      mutation,
      split: args.split,
      topK: args.topK,
      candidatePoolK: args.candidatePoolK,
      rejectedLimit: args.rejectedLimit,
      traceRoot,
    }));
  }
  if (traceRoot) {
    mkdirSync(traceRoot, { recursive: true });
    writeFileSync(join(traceRoot, "mutation-panel-summary.json"), `${JSON.stringify({ mutations }, null, 2)}\n`);
  }
  return {
    panelName: "document_workflow_mutation_panel",
    mutations,
  };
}

async function main(): Promise<void> {
  const args = parseDocumentWorkflowArgs(process.argv);
  const report = await runDocumentWorkflowMutations(process.argv);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  for (const mutation of report.mutations) {
    process.stdout.write(`Mutation: ${mutation.mutation}\n\n`);
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
