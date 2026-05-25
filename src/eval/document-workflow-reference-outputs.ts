#!/usr/bin/env node
/**
 * Builds deterministic reference outputs for the document workflow panel.
 *
 * These are not model outputs. They are oracle-style outputs derived from
 * fixture gold so the output scorer has a full-panel upper bound and future
 * model-generated outputs can be compared against a known-good contract.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { DOCUMENT_WORKFLOW_PANEL_FIXTURES } from "./document-workflow-panel.js";
import {
  loadDocumentWorkflowFixture,
  type DocumentEvidenceRequirement,
  type DocumentExcludedCitation,
  type DocumentWorkflowCase,
  type DocumentWorkflowFieldGold,
  type DocumentWorkflowFieldOutput,
  type DocumentWorkflowOutput,
} from "./document-workflow-probe.js";

function citationFromRequirement(requirement: DocumentEvidenceRequirement) {
  return {
    source: requirement.source,
    heading_path: requirement.heading_path,
    quote: requirement.required_text,
  };
}

function excludedDispositionForSource(source: string): DocumentExcludedCitation["disposition"] {
  return /(?:old|older|prior|draft|former|archived|superseded|unrelated)/i.test(source)
    ? "stale_or_wrong_scope"
    : "excluded_non_authoritative";
}

function excludedCitationFromRequirement(
  workflow: DocumentWorkflowCase,
  field: DocumentWorkflowFieldGold,
  requirement: DocumentEvidenceRequirement,
): DocumentExcludedCitation {
  return {
    ...citationFromRequirement(requirement),
    disposition: excludedDispositionForSource(requirement.source),
    reason: field.review_reason ??
      `Declared decoy source for ${workflow.id}; use only to explain why it is not authoritative.`,
  };
}

export function buildReferenceOutputForWorkflow(workflow: DocumentWorkflowCase): DocumentWorkflowOutput {
  return {
    workflow_id: workflow.id,
    fields: workflow.fields.map((field): DocumentWorkflowFieldOutput => {
      if (field.expected_status === "answerable") {
        return {
          field_id: field.id,
          status: "answered",
          value: field.expected_value ?? null,
          citations: (field.evidence ?? []).map(citationFromRequirement),
        };
      }
      const citations = field.expected_status === "missing"
        ? (field.searched_scope ?? [])
            .filter((requirement) => !workflow.decoy_sources.includes(requirement.source))
            .map(citationFromRequirement)
        : (field.evidence ?? []).map(citationFromRequirement);
      const excludedCitations = (field.searched_scope ?? [])
        .filter((requirement) => workflow.decoy_sources.includes(requirement.source))
        .map((requirement) => excludedCitationFromRequirement(workflow, field, requirement));
      return {
        field_id: field.id,
        status: field.expected_status === "conflicting" ? "conflict" : "missing_evidence",
        explanation: field.review_reason ?? `Review required for ${field.label}.`,
        ...(citations.length > 0 ? { citations } : {}),
        ...(excludedCitations.length > 0 ? { excluded_citations: excludedCitations } : {}),
      };
    }),
  };
}

export function buildReferenceOutputs(fixturePaths: readonly string[] = DOCUMENT_WORKFLOW_PANEL_FIXTURES): DocumentWorkflowOutput[] {
  return fixturePaths.flatMap((fixturePath) =>
    loadDocumentWorkflowFixture(fixturePath).workflows.map(buildReferenceOutputForWorkflow),
  );
}

function parseArgs(argv: string[]): { outputPath?: string; json: boolean } {
  const out: { outputPath?: string; json: boolean } = { json: argv.includes("--json") };
  for (const arg of argv) {
    const output = /^--output=(.+)$/.exec(arg);
    if (output) out.outputPath = output[1]!;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const payload = { workflows: buildReferenceOutputs() };
  const rendered = args.json ? `${JSON.stringify(payload, null, 2)}\n` : YAML.stringify(payload);
  if (args.outputPath) {
    writeFileSync(resolve(args.outputPath), rendered);
    return;
  }
  process.stdout.write(rendered);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
