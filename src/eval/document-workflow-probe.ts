#!/usr/bin/env node
/**
 * Document-workflow eval harness.
 *
 * This is intentionally workflow-shaped rather than retrieval-only:
 * a fixture declares operational tasks, field-level gold values, source
 * evidence, and missing/conflicting fields that should go to review. The
 * runner can score retrieval evidence by itself, and can also score a saved
 * workflow output file for field accuracy, citation validity, abstention, and
 * review load.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { loadConfig } from "../config/load.js";
import { retrieve, type RetrievalRequest } from "../retrieve/retrieve.js";
import { closeDb, openDb } from "../store/db.js";
import {
  listCurrentChunksCanonical,
  listSourcesCanonical,
} from "../store/read-model.js";
import type { DocChunk } from "../types/chunk.js";

export const DOCUMENT_FIELD_STATUSES = [
  "answerable",
  "missing",
  "conflicting",
] as const;
export type DocumentFieldStatus = (typeof DOCUMENT_FIELD_STATUSES)[number];

export const DOCUMENT_OUTPUT_STATUSES = [
  "answered",
  "missing_evidence",
  "conflict",
  "needs_review",
] as const;
export type DocumentOutputStatus = (typeof DOCUMENT_OUTPUT_STATUSES)[number];

export type DocumentEvidenceRequirement = {
  source: string;
  heading_path: string[];
  required_text: string;
  rationale?: string;
};

export const CONTEXT_SLOT_ROLES = [
  "identity",
  "current_state",
  "history",
  "rules",
  "constraints",
  "evidence",
  "exceptions",
  "risks",
  "commitments",
  "missing_context",
] as const;
export type ContextSlotRole = (typeof CONTEXT_SLOT_ROLES)[number];

export const CONTEXT_SLOT_KINDS = [
  "evidence",
  "missing_check",
  "contradiction_check",
  "scope_check",
] as const;
export type ContextSlotKind = (typeof CONTEXT_SLOT_KINDS)[number];

export const WORK_ARCHETYPES = [
  "case_evidence_adjudication",
  "contract_policy_obligation_review",
  "numeric_transaction_reconciliation",
  "relationship_history_synthesis",
  "employee_lifecycle_operations",
  "vendor_onboarding_compliance",
] as const;
export type WorkArchetype = (typeof WORK_ARCHETYPES)[number];

export const DOCUMENT_WORKFLOW_SPLITS = [
  "dev",
  "holdout",
  "stress",
] as const;
export type DocumentWorkflowSplit = (typeof DOCUMENT_WORKFLOW_SPLITS)[number];

export const ENGINE_FAILURE_MODES = [
  "wrong_scope",
  "shallow_relevance",
  "missing_synthesis",
  "override_failure",
  "absence_hallucination",
  "false_completeness",
  "budget_collapse",
  "citation_weakness",
  "numeric_text_split",
  "natural_task_wording_failure",
] as const;
export type EngineFailureMode = (typeof ENGINE_FAILURE_MODES)[number];

export type ContextSlotFilters = Record<string, string | string[]>;

export type ContextSlot = {
  id: string;
  slot_kind: ContextSlotKind;
  role: ContextSlotRole;
  purpose: string;
  required: boolean;
  queries: string[];
  fields: string[];
  failure_modes: EngineFailureMode[];
  max_tokens?: number;
  filters?: ContextSlotFilters;
};

export type DocumentWorkflowFieldGold = {
  id: string;
  label: string;
  expected_status: DocumentFieldStatus;
  expected_value?: string | null;
  evidence?: DocumentEvidenceRequirement[];
  searched_scope?: DocumentEvidenceRequirement[];
  unsearched_scope?: string[];
  review_reason?: string;
};

export type DocumentWorkflowCase = {
  id: string;
  title: string;
  archetype: WorkArchetype;
  split: DocumentWorkflowSplit;
  difficulty: number;
  challenge_tags: string[];
  failure_modes: EngineFailureMode[];
  task_variants: string[];
  decoy_sources: string[];
  prompt: string;
  slots: ContextSlot[];
  fields: DocumentWorkflowFieldGold[];
};

export type DocumentWorkflowFixture = {
  fixture_name: string;
  corpus_globs: string[];
  workflows: DocumentWorkflowCase[];
};

export type DocumentCitation = {
  source: string;
  heading_path?: string[];
  quote?: string;
};

export type DocumentWorkflowFieldOutput = {
  field_id: string;
  status: DocumentOutputStatus;
  value?: string | null;
  citations?: DocumentCitation[];
};

export type DocumentWorkflowOutput = {
  workflow_id: string;
  fields: DocumentWorkflowFieldOutput[];
};

export type RetrievedDocumentSection = {
  source: string;
  heading_path: string[];
  text: string;
  tokens?: number;
};

export type DocumentWorkflowSlotScore = {
  id: string;
  slotKind: ContextSlotKind;
  role: ContextSlotRole;
  purpose: string;
  required: boolean;
  failureModes: EngineFailureMode[];
  maxTokens?: number;
  queryCount: number;
  fieldIds: string[];
  retrievedSources: string[];
  decoySourcesRetrieved: string[];
  retrievedTokens: number;
  evidenceTotal: number;
  evidenceRetrieved: number;
  missingEvidence: DocumentEvidenceRequirement[];
  searchedScopeTotal: number;
  searchedScopeRetrieved: number;
  missingSearchedScope: DocumentEvidenceRequirement[];
  sectionRecallPass: boolean;
  searchedScopePass: boolean;
  requiredSatisfied: boolean;
  overBudget: boolean;
};

export type DocumentWorkflowFieldScore = {
  id: string;
  label: string;
  expectedStatus: DocumentFieldStatus;
  outputStatus?: DocumentOutputStatus;
  expectedValue?: string | null;
  actualValue?: string | null;
  evidenceTotal: number;
  evidenceRetrieved: number;
  missingEvidence: DocumentEvidenceRequirement[];
  searchedScopeTotal: number;
  searchedScopeRetrieved: number;
  missingSearchedScope: DocumentEvidenceRequirement[];
  sectionRecallPass: boolean;
  searchedScopePass: boolean;
  fieldAccuracy: boolean | null;
  citationValid: boolean | null;
  abstentionCorrect: boolean | null;
  reviewExpected: boolean;
  reviewed: boolean;
};

export type DocumentWorkflowCaseResult = {
  id: string;
  title: string;
  archetype: WorkArchetype;
  split: DocumentWorkflowSplit;
  difficulty: number;
  challengeTags: string[];
  failureModes: EngineFailureMode[];
  taskVariantCount: number;
  decoySources: string[];
  decoySourcesRetrieved: string[];
  queryCount: number;
  slotCount: number;
  fieldCount: number;
  retrievedSources: string[];
  slots: DocumentWorkflowSlotScore[];
  fields: DocumentWorkflowFieldScore[];
};

export type DocumentWorkflowBucketSummary = {
  total: number;
  satisfied: number;
  evidenceHits: number;
  evidenceTotal: number;
  searchedScopeHits: number;
  searchedScopeTotal: number;
};

export type DocumentWorkflowSummary = {
  workflows: number;
  taskVariants: number;
  slots: number;
  requiredSlots: number;
  requiredSlotsSatisfied: number;
  overBudgetSlots: number;
  fields: number;
  queries: number;
  importedSources: number;
  decoySourceHits: number;
  slotEvidenceHits: number;
  slotEvidenceTotal: number;
  searchedScopeHits: number;
  searchedScopeTotal: number;
  sectionRecallHits: number;
  sectionRecallTotal: number;
  fieldAccuracyHits: number;
  fieldAccuracyTotal: number;
  citationValidityHits: number;
  citationValidityTotal: number;
  abstentionHits: number;
  abstentionTotal: number;
  reviewFields: number;
  reviewExpectedFields: number;
  reviewTruePositives: number;
  reviewPrecision: number | null;
  reviewRecall: number | null;
  byFailureMode: Partial<Record<EngineFailureMode, DocumentWorkflowBucketSummary>>;
  byDifficulty: Record<string, DocumentWorkflowBucketSummary>;
  byArchetype: Partial<Record<WorkArchetype, DocumentWorkflowBucketSummary>>;
  bySplit: Partial<Record<DocumentWorkflowSplit, DocumentWorkflowBucketSummary>>;
};

export type DocumentWorkflowReport = {
  fixturePath: string;
  fixtureName: string;
  topK: number;
  candidatePoolK: number;
  sourceSweepK: number;
  importedSources: number;
  splitFilter?: DocumentWorkflowSplit;
  outputPath?: string;
  traceDir?: string;
  summary: DocumentWorkflowSummary;
  cases: DocumentWorkflowCaseResult[];
  failureAnalyses: DocumentWorkflowFailureAnalysis[];
};

export type DocumentRetrievalCandidateTrace = {
  rank: number;
  source: string;
  heading_path: string[];
  token_count: number;
  final_score: number;
  packing_score: number;
  bm25_norm: number;
  heading_match: number;
  selected: boolean;
  rejection_reason?: string;
  omitted_reason?: string;
  matched_fields: string[];
  excerpt: string;
};

export type DocumentWorkflowQueryTrace = {
  query: string;
  query_mode: string;
  candidate_count: number;
  eligible_count: number;
  safety_net_engaged: boolean;
  selected_candidates: DocumentRetrievalCandidateTrace[];
  swept_candidates: DocumentRetrievalCandidateTrace[];
  rejected_candidates: DocumentRetrievalCandidateTrace[];
};

export type DocumentWorkflowSlotTrace = {
  slot_id: string;
  slot_kind: ContextSlotKind;
  role: ContextSlotRole;
  purpose: string;
  required: boolean;
  failure_modes: EngineFailureMode[];
  fields: string[];
  max_tokens?: number;
  retrieved_tokens: number;
  evidence_total: number;
  evidence_retrieved: number;
  searched_scope_total: number;
  searched_scope_retrieved: number;
  selected_evidence: DocumentEvidenceRequirement[];
  missing_evidence: DocumentEvidenceRequirement[];
  missing_searched_scope: DocumentEvidenceRequirement[];
  decoy_sources_retrieved: string[];
  queries: DocumentWorkflowQueryTrace[];
};

export type DocumentWorkflowEvalTrace = {
  workflow_id: string;
  title: string;
  archetype: WorkArchetype;
  split: DocumentWorkflowSplit;
  difficulty: number;
  challenge_tags: string[];
  failure_modes: EngineFailureMode[];
  task: string;
  task_variants: string[];
  decoy_sources: string[];
  retrieved_sources: string[];
  decoy_sources_retrieved: string[];
  slots: DocumentWorkflowSlotTrace[];
  score: DocumentWorkflowCaseResult;
  failure_analysis?: DocumentWorkflowFailureAnalysis;
};

export const DOCUMENT_MISS_CAUSES = [
  "source_not_imported",
  "section_not_imported",
  "section_imported_text_mismatch",
  "rejected_in_slot",
  "retrieved_in_other_slot",
  "right_source_wrong_section",
  "decoy_pressure",
  "not_retrieved_by_slot",
] as const;
export type DocumentMissCause = (typeof DOCUMENT_MISS_CAUSES)[number];

export type DocumentMissDiagnosis = {
  slot_id: string;
  slot_kind: ContextSlotKind;
  role: ContextSlotRole;
  requirement_kind: "evidence" | "searched_scope";
  source: string;
  heading_path: string[];
  required_text: string;
  likely_cause: DocumentMissCause;
  explanation: string;
  rejected_candidates: DocumentRetrievalCandidateTrace[];
  other_slot_hits: {
    slot_id: string;
    source: string;
    heading_path: string[];
    rank: number;
  }[];
  same_source_selected: DocumentRetrievalCandidateTrace[];
  decoy_candidates: DocumentRetrievalCandidateTrace[];
};

export type DocumentWorkflowFailureAnalysis = {
  workflow_id: string;
  title: string;
  miss_count: number;
  by_cause: Partial<Record<DocumentMissCause, number>>;
  decoy_sources_retrieved: string[];
  diagnoses: DocumentMissDiagnosis[];
};

export type DocumentWorkflowEvalOptions = {
  fixturePath?: string;
  outputPath?: string;
  traceDir?: string;
  split?: DocumentWorkflowSplit;
  topK?: number;
  candidatePoolK?: number;
  sourceSweepK?: number;
  rejectedLimit?: number;
};

type DocumentWorkflowCliArgs = {
  json: boolean;
  fixturePath?: string;
  outputPath?: string;
  traceDir?: string;
  split?: DocumentWorkflowSplit;
  topK?: number;
  candidatePoolK?: number;
  sourceSweepK?: number;
  rejectedLimit?: number;
};

const DEFAULT_FIXTURE = "tests/fixtures/document-workflows/insurance-claim/workflows.yaml";
const DEFAULT_TOP_K = 5;
const DEFAULT_CANDIDATE_POOL_K = 12;
const DEFAULT_SOURCE_SWEEP_K = 2;

function defaultFixturePath(): string {
  return process.env.DOCUMENT_WORKFLOW_FIXTURE ?? join(process.cwd(), DEFAULT_FIXTURE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((part) => typeof part === "string" && part.length > 0)
  ) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return value;
}

function requireStatus(value: unknown, label: string): DocumentFieldStatus {
  if (!DOCUMENT_FIELD_STATUSES.includes(value as DocumentFieldStatus)) {
    throw new Error(`${label} must be one of ${DOCUMENT_FIELD_STATUSES.join(", ")}`);
  }
  return value as DocumentFieldStatus;
}

function requireSlotRole(value: unknown, label: string): ContextSlotRole {
  if (!CONTEXT_SLOT_ROLES.includes(value as ContextSlotRole)) {
    throw new Error(`${label} must be one of ${CONTEXT_SLOT_ROLES.join(", ")}`);
  }
  return value as ContextSlotRole;
}

function requireSlotKind(value: unknown, label: string): ContextSlotKind {
  if (!CONTEXT_SLOT_KINDS.includes(value as ContextSlotKind)) {
    throw new Error(`${label} must be one of ${CONTEXT_SLOT_KINDS.join(", ")}`);
  }
  return value as ContextSlotKind;
}

function requireWorkArchetype(value: unknown, label: string): WorkArchetype {
  if (!WORK_ARCHETYPES.includes(value as WorkArchetype)) {
    throw new Error(`${label} must be one of ${WORK_ARCHETYPES.join(", ")}`);
  }
  return value as WorkArchetype;
}

function requireWorkflowSplit(value: unknown, label: string): DocumentWorkflowSplit {
  if (!DOCUMENT_WORKFLOW_SPLITS.includes(value as DocumentWorkflowSplit)) {
    throw new Error(`${label} must be one of ${DOCUMENT_WORKFLOW_SPLITS.join(", ")}`);
  }
  return value as DocumentWorkflowSplit;
}

function requireFailureMode(value: unknown, label: string): EngineFailureMode {
  if (!ENGINE_FAILURE_MODES.includes(value as EngineFailureMode)) {
    throw new Error(`${label} must be one of ${ENGINE_FAILURE_MODES.join(", ")}`);
  }
  return value as EngineFailureMode;
}

function requireOutputStatus(value: unknown, label: string): DocumentOutputStatus {
  if (!DOCUMENT_OUTPUT_STATUSES.includes(value as DocumentOutputStatus)) {
    throw new Error(`${label} must be one of ${DOCUMENT_OUTPUT_STATUSES.join(", ")}`);
  }
  return value as DocumentOutputStatus;
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  return requireStringArray(value, label);
}

function optionalFailureModes(value: unknown, label: string): EngineFailureMode[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => requireFailureMode(entry, `${label}[${index}]`));
}

function validateEvidence(value: unknown, label: string): DocumentEvidenceRequirement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${label}[${index}] must be an object`);
    return {
      source: requireString(entry.source, `${label}[${index}].source`),
      heading_path: requireStringArray(entry.heading_path, `${label}[${index}].heading_path`),
      required_text: requireString(entry.required_text, `${label}[${index}].required_text`),
      ...(typeof entry.rationale === "string" ? { rationale: entry.rationale } : {}),
    };
  });
}

function validateField(value: unknown, label: string): DocumentWorkflowFieldGold {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const expectedStatus = requireStatus(value.expected_status, `${label}.expected_status`);
  const evidence = validateEvidence(value.evidence, `${label}.evidence`);
  const searchedScope = validateEvidence(value.searched_scope, `${label}.searched_scope`);
  const expectedValue =
    value.expected_value === undefined || value.expected_value === null
      ? undefined
      : requireString(value.expected_value, `${label}.expected_value`);
  if (expectedStatus === "answerable" && expectedValue === undefined) {
    throw new Error(`${label}.expected_value is required for answerable fields`);
  }
  if (expectedStatus === "answerable" && evidence.length === 0) {
    throw new Error(`${label}.evidence is required for answerable fields`);
  }
  return {
    id: requireString(value.id, `${label}.id`),
    label: requireString(value.label, `${label}.label`),
    expected_status: expectedStatus,
    ...(expectedValue !== undefined ? { expected_value: expectedValue } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(searchedScope.length > 0 ? { searched_scope: searchedScope } : {}),
    ...(value.unsearched_scope !== undefined
      ? { unsearched_scope: requireStringArray(value.unsearched_scope, `${label}.unsearched_scope`) }
      : {}),
    ...(typeof value.review_reason === "string" ? { review_reason: value.review_reason } : {}),
  };
}

function validatePositiveInt(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function validateDifficulty(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error(`${label} must be an integer from 1 to 6`);
  }
  return value;
}

function validateFilters(value: unknown, label: string): ContextSlotFilters | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const out: ContextSlotFilters = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      out[key] = entry;
      continue;
    }
    if (Array.isArray(entry) && entry.every((part) => typeof part === "string" && part.length > 0)) {
      out[key] = entry;
      continue;
    }
    throw new Error(`${label}.${key} must be a string or string array`);
  }
  return out;
}

function validateSlot(value: unknown, label: string): ContextSlot {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (typeof value.required !== "boolean") {
    throw new Error(`${label}.required must be a boolean`);
  }
  const maxTokens = validatePositiveInt(value.max_tokens, `${label}.max_tokens`);
  const filters = validateFilters(value.filters, `${label}.filters`);
  return {
    id: requireString(value.id, `${label}.id`),
    slot_kind: value.slot_kind === undefined
      ? "evidence"
      : requireSlotKind(value.slot_kind, `${label}.slot_kind`),
    role: requireSlotRole(value.role, `${label}.role`),
    purpose: requireString(value.purpose, `${label}.purpose`),
    required: value.required,
    queries: requireStringArray(value.queries, `${label}.queries`),
    fields: requireStringArray(value.fields, `${label}.fields`),
    failure_modes: optionalFailureModes(value.failure_modes, `${label}.failure_modes`),
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(filters !== undefined ? { filters } : {}),
  };
}

function validateWorkflow(value: unknown, label: string): DocumentWorkflowCase {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    throw new Error(`${label}.fields must be a non-empty array`);
  }
  const fields = value.fields.map((field, index) => validateField(field, `${label}.fields[${index}]`));
  const fieldIds = new Set<string>();
  for (const field of fields) {
    if (fieldIds.has(field.id)) throw new Error(`${label}.fields contains duplicate id '${field.id}'`);
    fieldIds.add(field.id);
  }
  const slots = Array.isArray(value.slots)
    ? value.slots.map((slot, index) => validateSlot(slot, `${label}.slots[${index}]`))
    : [
        {
          id: "workflow_context",
          slot_kind: "evidence" as const,
          role: "evidence" as const,
          purpose: "Legacy workflow-level context queries.",
          required: true,
          queries: requireStringArray(value.queries, `${label}.queries`),
          fields: fields.map((field) => field.id),
          failure_modes: [],
        },
      ];
  const slotIds = new Set<string>();
  const coveredFields = new Set<string>();
  for (const slot of slots) {
    if (slotIds.has(slot.id)) throw new Error(`${label}.slots contains duplicate id '${slot.id}'`);
    slotIds.add(slot.id);
    for (const fieldId of slot.fields) {
      if (!fieldIds.has(fieldId)) {
        throw new Error(`${label}.slots.${slot.id} references unknown field '${fieldId}'`);
      }
      coveredFields.add(fieldId);
    }
  }
  const uncoveredFields = fields.filter((field) => !coveredFields.has(field.id));
  if (uncoveredFields.length > 0) {
    throw new Error(`${label}.slots must cover every field (${uncoveredFields.map((field) => field.id).join(", ")})`);
  }
  return {
    id: requireString(value.id, `${label}.id`),
    title: requireString(value.title, `${label}.title`),
    archetype: value.archetype === undefined
      ? "case_evidence_adjudication"
      : requireWorkArchetype(value.archetype, `${label}.archetype`),
    split: value.split === undefined
      ? "dev"
      : requireWorkflowSplit(value.split, `${label}.split`),
    difficulty: value.difficulty === undefined
      ? 1
      : validateDifficulty(value.difficulty, `${label}.difficulty`),
    challenge_tags: optionalStringArray(value.challenge_tags, `${label}.challenge_tags`),
    failure_modes: optionalFailureModes(value.failure_modes, `${label}.failure_modes`),
    task_variants: optionalStringArray(value.task_variants, `${label}.task_variants`),
    decoy_sources: optionalStringArray(value.decoy_sources, `${label}.decoy_sources`),
    prompt: requireString(value.prompt, `${label}.prompt`),
    slots,
    fields,
  };
}

export function loadDocumentWorkflowFixture(
  fixturePath = defaultFixturePath(),
): DocumentWorkflowFixture {
  const parsed = YAML.parse(readFileSync(fixturePath, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Document workflow fixture must be an object: ${fixturePath}`);
  if (!Array.isArray(parsed.workflows) || parsed.workflows.length === 0) {
    throw new Error(`Document workflow fixture must include workflows: ${fixturePath}`);
  }
  return {
    fixture_name: requireString(parsed.fixture_name, "fixture_name"),
    corpus_globs: requireStringArray(parsed.corpus_globs, "corpus_globs"),
    workflows: parsed.workflows.map((workflow, index) => validateWorkflow(workflow, `workflows[${index}]`)),
  };
}

function validateCitation(value: unknown, label: string): DocumentCitation {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return {
    source: requireString(value.source, `${label}.source`),
    ...(value.heading_path !== undefined
      ? { heading_path: requireStringArray(value.heading_path, `${label}.heading_path`) }
      : {}),
    ...(typeof value.quote === "string" ? { quote: value.quote } : {}),
  };
}

function validateOutputField(value: unknown, label: string): DocumentWorkflowFieldOutput {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const citations =
    value.citations === undefined
      ? undefined
      : Array.isArray(value.citations)
        ? value.citations.map((citation, index) => validateCitation(citation, `${label}.citations[${index}]`))
        : (() => {
            throw new Error(`${label}.citations must be an array`);
          })();
  return {
    field_id: requireString(value.field_id, `${label}.field_id`),
    status: requireOutputStatus(value.status, `${label}.status`),
    ...(value.value === undefined || value.value === null
      ? value.value === null
        ? { value: null }
        : {}
      : { value: requireString(value.value, `${label}.value`) }),
    ...(citations !== undefined ? { citations } : {}),
  };
}

function validateWorkflowOutput(value: unknown, label: string): DocumentWorkflowOutput {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!Array.isArray(value.fields)) throw new Error(`${label}.fields must be an array`);
  return {
    workflow_id: requireString(value.workflow_id, `${label}.workflow_id`),
    fields: value.fields.map((field, index) => validateOutputField(field, `${label}.fields[${index}]`)),
  };
}

export function loadDocumentWorkflowOutputs(outputPath: string): DocumentWorkflowOutput[] {
  const raw = readFileSync(outputPath, "utf8");
  const parsed = outputPath.endsWith(".json") ? JSON.parse(raw) as unknown : YAML.parse(raw) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.workflows)
      ? parsed.workflows
      : null;
  if (!rows) throw new Error(`Document workflow outputs must be an array or { workflows: [...] }: ${outputPath}`);
  return rows.map((row, index) => validateWorkflowOutput(row, `outputs[${index}]`));
}

function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const sp = join(src, name);
    const dp = join(dst, name);
    if (statSync(sp).isDirectory()) copyDirSync(sp, dp);
    else copyFileSync(sp, dp);
  }
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedIncludes(haystack: string, needle: string): boolean {
  return normalizeText(haystack).includes(normalizeText(needle));
}

function headingPathEquals(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((part, index) => part === b[index]);
}

function sectionSatisfiesRequirement(
  section: RetrievedDocumentSection,
  requirement: DocumentEvidenceRequirement,
): boolean {
  return (
    section.source === requirement.source &&
    headingPathEquals(section.heading_path, requirement.heading_path) &&
    normalizedIncludes(section.text, requirement.required_text)
  );
}

function citationSatisfiesRequirement(
  citation: DocumentCitation,
  requirement: DocumentEvidenceRequirement,
): boolean {
  if (citation.source !== requirement.source) return false;
  if (!headingPathEquals(citation.heading_path, requirement.heading_path)) return false;
  return citation.quote !== undefined && normalizedIncludes(citation.quote, requirement.required_text);
}

function isReviewStatus(status: DocumentOutputStatus): boolean {
  return status === "missing_evidence" || status === "conflict" || status === "needs_review";
}

function abstentionMatches(status: DocumentOutputStatus, expected: DocumentFieldStatus): boolean {
  if (expected === "conflicting") return status === "conflict" || status === "needs_review";
  if (expected === "missing") return status === "missing_evidence" || status === "needs_review";
  return false;
}

function fieldEvidenceForSlot(
  fields: DocumentWorkflowFieldGold[],
  slot: ContextSlot,
): DocumentEvidenceRequirement[] {
  const fieldIds = new Set(slot.fields);
  return fields
    .filter((field) => fieldIds.has(field.id))
    .flatMap((field) => field.evidence ?? []);
}

function fieldSearchedScopeForSlot(
  fields: DocumentWorkflowFieldGold[],
  slot: ContextSlot,
): DocumentEvidenceRequirement[] {
  const fieldIds = new Set(slot.fields);
  return fields
    .filter((field) => fieldIds.has(field.id))
    .flatMap((field) => field.searched_scope ?? []);
}

function scoreContextSlot(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  retrievedSections: RetrievedDocumentSection[];
  decoySources: string[];
}): DocumentWorkflowSlotScore {
  const evidence = fieldEvidenceForSlot(args.fields, args.slot);
  const missingEvidence = evidence.filter(
    (requirement) => !args.retrievedSections.some((section) => sectionSatisfiesRequirement(section, requirement)),
  );
  const searchedScope = fieldSearchedScopeForSlot(args.fields, args.slot);
  const missingSearchedScope = searchedScope.filter(
    (requirement) => !args.retrievedSections.some((section) => sectionSatisfiesRequirement(section, requirement)),
  );
  const evidenceRetrieved = evidence.length - missingEvidence.length;
  const searchedScopeRetrieved = searchedScope.length - missingSearchedScope.length;
  const retrievedTokens = args.retrievedSections.reduce((sum, section) => sum + (section.tokens ?? 0), 0);
  const overBudget = args.slot.max_tokens !== undefined && retrievedTokens > args.slot.max_tokens;
  const sectionRecallPass = missingEvidence.length === 0;
  const searchedScopePass = missingSearchedScope.length === 0;
  const decoySourcesRetrieved = unique(
    args.retrievedSections
      .map((section) => section.source)
      .filter((source) => args.decoySources.includes(source)),
  );
  return {
    id: args.slot.id,
    slotKind: args.slot.slot_kind,
    role: args.slot.role,
    purpose: args.slot.purpose,
    required: args.slot.required,
    failureModes: args.slot.failure_modes,
    maxTokens: args.slot.max_tokens,
    queryCount: args.slot.queries.length,
    fieldIds: args.slot.fields,
    retrievedSources: unique(args.retrievedSections.map((section) => section.source)),
    decoySourcesRetrieved,
    retrievedTokens,
    evidenceTotal: evidence.length,
    evidenceRetrieved,
    missingEvidence,
    searchedScopeTotal: searchedScope.length,
    searchedScopeRetrieved,
    missingSearchedScope,
    sectionRecallPass,
    searchedScopePass,
    requiredSatisfied: !args.slot.required || (sectionRecallPass && searchedScopePass),
    overBudget,
  };
}

export function scoreDocumentWorkflowCase(args: {
  workflow: DocumentWorkflowCase;
  retrievedSections: RetrievedDocumentSection[];
  slotSections?: { slotId: string; retrievedSections: RetrievedDocumentSection[] }[];
  output?: DocumentWorkflowOutput;
}): DocumentWorkflowCaseResult {
  const slotSectionsById = new Map(
    (args.slotSections ?? args.workflow.slots.map((slot) => ({
      slotId: slot.id,
      retrievedSections: args.retrievedSections,
    }))).map((entry) => [entry.slotId, entry.retrievedSections]),
  );
  const slots = args.workflow.slots.map((slot) => scoreContextSlot({
    slot,
    fields: args.workflow.fields,
    retrievedSections: slotSectionsById.get(slot.id) ?? [],
    decoySources: args.workflow.decoy_sources,
  }));
  const outputByField = new Map(
    (args.output?.fields ?? []).map((field) => [field.field_id, field]),
  );
  const fields = args.workflow.fields.map((field): DocumentWorkflowFieldScore => {
    const evidence = field.evidence ?? [];
    const missingEvidence = evidence.filter(
      (requirement) => !args.retrievedSections.some((section) => sectionSatisfiesRequirement(section, requirement)),
    );
    const searchedScope = field.searched_scope ?? [];
    const missingSearchedScope = searchedScope.filter(
      (requirement) => !args.retrievedSections.some((section) => sectionSatisfiesRequirement(section, requirement)),
    );
    const output = outputByField.get(field.id);
    const evidenceRetrieved = evidence.length - missingEvidence.length;
    const searchedScopeRetrieved = searchedScope.length - missingSearchedScope.length;
    const evidenceMissing = missingEvidence.length > 0;
    const searchedScopeMissing = missingSearchedScope.length > 0;
    const reviewExpected = field.expected_status !== "answerable" || evidenceMissing || searchedScopeMissing;
    const reviewed = output === undefined ? reviewExpected : isReviewStatus(output.status);
    const fieldAccuracy =
      output === undefined || field.expected_status !== "answerable"
        ? null
        : output.status === "answered" &&
          normalizeText(output.value) === normalizeText(field.expected_value);
    const citationValid =
      output === undefined ||
      field.expected_status !== "answerable" ||
      output.status !== "answered"
        ? null
        : evidence.every((requirement) =>
            args.retrievedSections.some((section) => sectionSatisfiesRequirement(section, requirement)) &&
            (output.citations ?? []).some((citation) => citationSatisfiesRequirement(citation, requirement)),
          );
    const abstentionCorrect =
      output === undefined || field.expected_status === "answerable"
        ? null
        : abstentionMatches(output.status, field.expected_status);

    return {
      id: field.id,
      label: field.label,
      expectedStatus: field.expected_status,
      outputStatus: output?.status,
      expectedValue: field.expected_value,
      actualValue: output?.value,
      evidenceTotal: evidence.length,
      evidenceRetrieved,
      missingEvidence,
      searchedScopeTotal: searchedScope.length,
      searchedScopeRetrieved,
      missingSearchedScope,
      sectionRecallPass: missingEvidence.length === 0,
      searchedScopePass: missingSearchedScope.length === 0,
      fieldAccuracy,
      citationValid,
      abstentionCorrect,
      reviewExpected,
      reviewed,
    };
  });
  const retrievedSources = unique(args.retrievedSections.map((section) => section.source));
  const decoySourcesRetrieved = retrievedSources.filter((source) => args.workflow.decoy_sources.includes(source));
  return {
    id: args.workflow.id,
    title: args.workflow.title,
    archetype: args.workflow.archetype,
    split: args.workflow.split,
    difficulty: args.workflow.difficulty,
    challengeTags: args.workflow.challenge_tags,
    failureModes: unique([
      ...args.workflow.failure_modes,
      ...args.workflow.slots.flatMap((slot) => slot.failure_modes),
    ]) as EngineFailureMode[],
    taskVariantCount: args.workflow.task_variants.length,
    decoySources: args.workflow.decoy_sources,
    decoySourcesRetrieved,
    queryCount: args.workflow.slots.reduce((sum, slot) => sum + slot.queries.length, 0),
    slotCount: args.workflow.slots.length,
    fieldCount: fields.length,
    retrievedSources,
    slots,
    fields,
  };
}

function unique(values: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function summarizeDocumentWorkflow(args: {
  importedSources: number;
  cases: DocumentWorkflowCaseResult[];
}): DocumentWorkflowSummary {
  const fields = args.cases.flatMap((row) => row.fields);
  const slots = args.cases.flatMap((row) => row.slots);
  const countTruthy = (values: (boolean | null)[]) => values.filter((value) => value === true).length;
  const countScored = (values: (boolean | null)[]) => values.filter((value) => value !== null).length;
  const fieldAccuracyValues = fields.map((field) => field.fieldAccuracy);
  const citationValues = fields.map((field) => field.citationValid);
  const abstentionValues = fields.map((field) => field.abstentionCorrect);
  const reviewFields = fields.filter((field) => field.reviewed).length;
  const reviewExpectedFields = fields.filter((field) => field.reviewExpected).length;
  const reviewTruePositives = fields.filter((field) => field.reviewed && field.reviewExpected).length;
  const emptyBucket = (): DocumentWorkflowBucketSummary => ({
    total: 0,
    satisfied: 0,
    evidenceHits: 0,
    evidenceTotal: 0,
    searchedScopeHits: 0,
    searchedScopeTotal: 0,
  });
  const addSlotToBucket = (bucket: DocumentWorkflowBucketSummary, slot: DocumentWorkflowSlotScore): void => {
    bucket.total += 1;
    if (slot.sectionRecallPass && slot.searchedScopePass && !slot.overBudget) bucket.satisfied += 1;
    bucket.evidenceHits += slot.evidenceRetrieved;
    bucket.evidenceTotal += slot.evidenceTotal;
    bucket.searchedScopeHits += slot.searchedScopeRetrieved;
    bucket.searchedScopeTotal += slot.searchedScopeTotal;
  };
  const byFailureMode: Partial<Record<EngineFailureMode, DocumentWorkflowBucketSummary>> = {};
  const byDifficulty: Record<string, DocumentWorkflowBucketSummary> = {};
  const byArchetype: Partial<Record<WorkArchetype, DocumentWorkflowBucketSummary>> = {};
  const bySplit: Partial<Record<DocumentWorkflowSplit, DocumentWorkflowBucketSummary>> = {};
  for (const row of args.cases) {
    const difficultyKey = String(row.difficulty);
    byDifficulty[difficultyKey] ??= emptyBucket();
    byArchetype[row.archetype] ??= emptyBucket();
    bySplit[row.split] ??= emptyBucket();
    for (const slot of row.slots) {
      addSlotToBucket(byDifficulty[difficultyKey]!, slot);
      addSlotToBucket(byArchetype[row.archetype]!, slot);
      addSlotToBucket(bySplit[row.split]!, slot);
      for (const mode of slot.failureModes) {
        byFailureMode[mode] ??= emptyBucket();
        addSlotToBucket(byFailureMode[mode]!, slot);
      }
    }
  }
  return {
    workflows: args.cases.length,
    taskVariants: args.cases.reduce((sum, row) => sum + row.taskVariantCount, 0),
    slots: slots.length,
    requiredSlots: slots.filter((slot) => slot.required).length,
    requiredSlotsSatisfied: slots.filter((slot) => slot.required && slot.requiredSatisfied).length,
    overBudgetSlots: slots.filter((slot) => slot.overBudget).length,
    fields: fields.length,
    queries: args.cases.reduce((sum, row) => sum + row.queryCount, 0),
    importedSources: args.importedSources,
    decoySourceHits: args.cases.reduce((sum, row) => sum + row.decoySourcesRetrieved.length, 0),
    slotEvidenceHits: slots.reduce((sum, slot) => sum + slot.evidenceRetrieved, 0),
    slotEvidenceTotal: slots.reduce((sum, slot) => sum + slot.evidenceTotal, 0),
    searchedScopeHits: slots.reduce((sum, slot) => sum + slot.searchedScopeRetrieved, 0),
    searchedScopeTotal: slots.reduce((sum, slot) => sum + slot.searchedScopeTotal, 0),
    sectionRecallHits: fields.reduce((sum, field) => sum + field.evidenceRetrieved, 0),
    sectionRecallTotal: fields.reduce((sum, field) => sum + field.evidenceTotal, 0),
    fieldAccuracyHits: countTruthy(fieldAccuracyValues),
    fieldAccuracyTotal: countScored(fieldAccuracyValues),
    citationValidityHits: countTruthy(citationValues),
    citationValidityTotal: countScored(citationValues),
    abstentionHits: countTruthy(abstentionValues),
    abstentionTotal: countScored(abstentionValues),
    reviewFields,
    reviewExpectedFields,
    reviewTruePositives,
    reviewPrecision: reviewFields === 0 ? null : reviewTruePositives / reviewFields,
    reviewRecall: reviewExpectedFields === 0 ? null : reviewTruePositives / reviewExpectedFields,
    byFailureMode,
    byDifficulty,
    byArchetype,
    bySplit,
  };
}

function sectionKey(section: RetrievedDocumentSection): string {
  return JSON.stringify([section.source, section.heading_path]);
}

function shortExcerpt(text: string, max = 260): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3)}...`;
}

function matchedFieldsForSection(
  fields: DocumentWorkflowFieldGold[],
  slot: ContextSlot,
  section: RetrievedDocumentSection,
): string[] {
  const slotFields = new Set(slot.fields);
  const matches: string[] = [];
  for (const field of fields) {
    if (!slotFields.has(field.id)) continue;
    const requirements = [
      ...(field.evidence ?? []),
      ...(field.searched_scope ?? []),
    ];
    if (requirements.some((requirement) => sectionSatisfiesRequirement(section, requirement))) {
      matches.push(field.id);
    }
  }
  return matches;
}

function traceToSection(
  trace: { version_id: string; token_count: number },
  chunksById: Map<string, RetrievedDocumentSection>,
): RetrievedDocumentSection | null {
  const section = chunksById.get(trace.version_id);
  if (!section) return null;
  return {
    ...section,
    tokens: section.tokens ?? trace.token_count,
  };
}

function candidateTrace(args: {
  rank: number;
  trace: {
    version_id: string;
    token_count: number;
    final_score: number;
    packing_score: number;
    bm25_norm: number;
    heading_match: number;
    omitted_reason?: string;
    reason?: string;
  };
  section: RetrievedDocumentSection;
  selected: boolean;
  rejectionReason?: string;
  fields: DocumentWorkflowFieldGold[];
  slot: ContextSlot;
}): DocumentRetrievalCandidateTrace {
  return {
    rank: args.rank,
    source: args.section.source,
    heading_path: args.section.heading_path,
    token_count: args.trace.token_count,
    final_score: args.trace.final_score,
    packing_score: args.trace.packing_score,
    bm25_norm: args.trace.bm25_norm,
    heading_match: args.trace.heading_match,
    selected: args.selected,
    ...(args.rejectionReason || args.trace.reason
      ? { rejection_reason: args.rejectionReason ?? args.trace.reason }
      : {}),
    ...(args.trace.omitted_reason ? { omitted_reason: args.trace.omitted_reason } : {}),
    matched_fields: matchedFieldsForSection(args.fields, args.slot, args.section),
    excerpt: shortExcerpt(args.section.text),
  };
}

type EvalDocCandidateTrace = {
  version_id: string;
  token_count: number;
  final_score: number;
  packing_score: number;
  bm25_norm: number;
  heading_match: number;
  omitted_reason?: string;
  reason?: string;
};

type WeightedTerm = {
  term: string;
  weight: number;
};

const TOKEN_RE = /[a-z0-9]+/g;
const TOKEN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

const ROLE_HINT_TERMS: Record<ContextSlotRole, string[]> = {
  identity: [
    "account",
    "agreement",
    "claim",
    "company",
    "employee",
    "header",
    "identity",
    "id",
    "master",
    "number",
    "profile",
    "record",
    "vendor",
  ],
  current_state: [
    "approval",
    "current",
    "hold",
    "open",
    "pending",
    "request",
    "status",
    "summary",
  ],
  history: [
    "call",
    "conversation",
    "email",
    "history",
    "ledger",
    "notes",
    "prior",
    "thread",
  ],
  rules: [
    "clause",
    "coverage",
    "eligibility",
    "instruction",
    "policy",
    "requirement",
    "rule",
    "terms",
  ],
  constraints: [
    "approval",
    "before",
    "cap",
    "ceiling",
    "constraint",
    "guardrail",
    "limit",
    "must",
    "required",
  ],
  evidence: [
    "amount",
    "entry",
    "evidence",
    "fact",
    "invoice",
    "ledger",
    "note",
    "payment",
  ],
  exceptions: [
    "exception",
    "exclusion",
    "hold",
    "override",
    "variance",
  ],
  risks: [
    "blocker",
    "concern",
    "exception",
    "issue",
    "open",
    "risk",
    "ticket",
  ],
  commitments: [
    "action",
    "commitment",
    "due",
    "follow",
    "next",
    "promised",
    "send",
  ],
  missing_context: [
    "absent",
    "gap",
    "missing",
    "no",
    "not",
    "open",
    "pending",
    "unconfirmed",
  ],
};

const SLOT_KIND_HINT_TERMS: Record<ContextSlotKind, string[]> = {
  evidence: ["evidence", "fact", "support"],
  missing_check: ["absent", "gap", "missing", "no", "not", "pending", "unconfirmed"],
  contradiction_check: ["conflict", "contradiction", "different", "dispute", "override"],
  scope_check: ["header", "identity", "scope", "subject"],
};

function tokenizeForSlotText(value: string): string[] {
  const matches = value.toLowerCase().match(TOKEN_RE) ?? [];
  return matches.filter((token) => {
    if (TOKEN_STOPWORDS.has(token)) return false;
    return token.length > 1 || /\d/.test(token);
  });
}

function addWeightedTerms(out: Map<string, number>, value: string, weight: number): void {
  for (const term of tokenizeForSlotText(value)) {
    out.set(term, Math.max(out.get(term) ?? 0, weight));
  }
}

function buildSlotExpansionTerms(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
}): WeightedTerm[] {
  const terms = new Map<string, number>();
  const slotFieldIds = new Set(args.slot.fields);
  addWeightedTerms(terms, args.slot.purpose, 2.4);
  addWeightedTerms(terms, args.slot.role, 1.6);
  addWeightedTerms(terms, args.slot.slot_kind, 1.4);
  for (const query of args.slot.queries) addWeightedTerms(terms, query, 1.1);
  for (const value of Object.values(args.slot.filters ?? {})) {
    if (Array.isArray(value)) {
      for (const part of value) addWeightedTerms(terms, part, 2.6);
    } else {
      addWeightedTerms(terms, value, 2.6);
    }
  }
  for (const field of args.fields) {
    if (!slotFieldIds.has(field.id)) continue;
    addWeightedTerms(terms, field.id, 2.8);
    addWeightedTerms(terms, field.label, 3.0);
  }
  for (const hint of ROLE_HINT_TERMS[args.slot.role]) addWeightedTerms(terms, hint, 1.3);
  for (const hint of SLOT_KIND_HINT_TERMS[args.slot.slot_kind]) addWeightedTerms(terms, hint, 1.2);
  return [...terms.entries()].map(([term, weight]) => ({ term, weight }));
}

function tokenSet(value: string): Set<string> {
  return new Set(tokenizeForSlotText(value));
}

function countWeightedOverlap(terms: WeightedTerm[], tokens: Set<string>): number {
  let score = 0;
  for (const term of terms) {
    if (tokens.has(term.term)) score += term.weight;
  }
  return score;
}

function phraseCoverageBoost(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  haystack: string;
}): number {
  const normalizedHaystack = normalizeText(args.haystack);
  const slotFieldIds = new Set(args.slot.fields);
  let boost = 0;
  for (const field of args.fields) {
    if (!slotFieldIds.has(field.id)) continue;
    const normalizedLabel = normalizeText(field.label);
    if (normalizedLabel.length > 2 && normalizedHaystack.includes(normalizedLabel)) {
      boost += 0.32;
    }
  }
  return boost;
}

function slotCandidateExpansionScore(args: {
  trace: EvalDocCandidateTrace;
  section: RetrievedDocumentSection;
  terms: WeightedTerm[];
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
}): number {
  const headingText = `${args.section.source} ${args.section.heading_path.join(" ")}`;
  const headingTokens = tokenSet(headingText);
  const bodyTokens = tokenSet(args.section.text);
  const headingOverlap = countWeightedOverlap(args.terms, headingTokens);
  const bodyOverlap = countWeightedOverlap(args.terms, bodyTokens);
  const overlapScale = Math.sqrt(Math.max(1, args.terms.length));
  const slotFit = ((headingOverlap * 0.18) + (bodyOverlap * 0.07)) / overlapScale;
  const phraseBoost = phraseCoverageBoost({
    slot: args.slot,
    fields: args.fields,
    haystack: `${headingText} ${args.section.text}`,
  });
  return (args.trace.final_score * 0.72) + (args.trace.packing_score * 0.28) + slotFit + phraseBoost;
}

function rerankSlotCandidatePool(args: {
  traces: EvalDocCandidateTrace[];
  sectionsByVersionId: Map<string, RetrievedDocumentSection>;
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
}): EvalDocCandidateTrace[] {
  const terms = buildSlotExpansionTerms({
    slot: args.slot,
    fields: args.fields,
  });
  return args.traces
    .map((trace, index) => {
      const section = traceToSection(trace, args.sectionsByVersionId);
      return {
        trace,
        index,
        score: section
          ? slotCandidateExpansionScore({
              trace,
              section,
              terms,
              slot: args.slot,
              fields: args.fields,
            })
          : Number.NEGATIVE_INFINITY,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((entry) => entry.trace);
}

function sectionFromChunk(chunk: DocChunk): RetrievedDocumentSection {
  return {
    source: chunk.source_path,
    heading_path: chunk.heading_path,
    text: chunk.body,
    tokens: chunk.token_count,
  };
}

function buildSourceSweepTraces(args: {
  selectedTraces: EvalDocCandidateTrace[];
  chunksById: Map<string, DocChunk>;
  importedChunks: DocChunk[];
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  sourceSweepK: number;
}): EvalDocCandidateTrace[] {
  if (args.sourceSweepK <= 0 || args.selectedTraces.length === 0) return [];
  const selectedIds = new Set(args.selectedTraces.map((trace) => trace.version_id));
  const selectedSources = new Set(
    args.selectedTraces.flatMap((trace) => {
      const chunk = args.chunksById.get(trace.version_id);
      return chunk ? [chunk.source_path] : [];
    }),
  );
  if (selectedSources.size === 0) return [];

  const terms = buildSlotExpansionTerms({
    slot: args.slot,
    fields: args.fields,
  });
  return args.importedChunks
    .filter((chunk) => selectedSources.has(chunk.source_path) && !selectedIds.has(chunk.version_id))
    .map((chunk, index) => {
      const section = sectionFromChunk(chunk);
      const trace: EvalDocCandidateTrace = {
        version_id: chunk.version_id,
        token_count: chunk.token_count,
        final_score: 0,
        packing_score: 0,
        bm25_norm: 0,
        heading_match: 0,
      };
      const score = slotCandidateExpansionScore({
        trace,
        section,
        terms,
        slot: args.slot,
        fields: args.fields,
      });
      return { chunk, index, score };
    })
    .filter((entry) => entry.score >= 0.18)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.chunk.token_count !== b.chunk.token_count) return a.chunk.token_count - b.chunk.token_count;
      return a.index - b.index;
    })
    .slice(0, args.sourceSweepK)
    .map((entry) => {
      const final_score = entry.score;
      return {
        version_id: entry.chunk.version_id,
        token_count: entry.chunk.token_count,
        final_score,
        packing_score:
          entry.chunk.token_count > 0
            ? final_score / Math.sqrt(entry.chunk.token_count)
            : final_score,
        bm25_norm: 0,
        heading_match: 0,
      };
    });
}

function selectedEvidenceForSlot(
  fields: DocumentWorkflowFieldGold[],
  slot: ContextSlot,
  retrievedSections: RetrievedDocumentSection[],
): DocumentEvidenceRequirement[] {
  return fieldEvidenceForSlot(fields, slot)
    .filter((requirement) =>
      retrievedSections.some((section) => sectionSatisfiesRequirement(section, requirement)),
    );
}

function buildTracePackMarkdown(trace: DocumentWorkflowEvalTrace): string {
  const lines: string[] = [];
  lines.push(`# Context Pack Trace: ${trace.title}`);
  lines.push("");
  lines.push(`Task: ${trace.task}`);
  if (trace.task_variants.length > 0) {
    lines.push("");
    lines.push("Task variants:");
    for (const variant of trace.task_variants) lines.push(`- ${variant}`);
  }
  lines.push("");
  lines.push("## Slots");
  for (const slot of trace.slots) {
    lines.push("");
    lines.push(`### ${slot.slot_id}`);
    lines.push(`Kind: ${slot.slot_kind}; role: ${slot.role}; required: ${slot.required ? "yes" : "no"}`);
    lines.push(`Retrieved tokens: ${slot.retrieved_tokens}`);
    if (slot.decoy_sources_retrieved.length > 0) {
      lines.push(`Decoys retrieved: ${slot.decoy_sources_retrieved.join(", ")}`);
    }
    lines.push("");
    lines.push("Selected evidence:");
    if (slot.selected_evidence.length === 0) {
      lines.push("- none");
    } else {
      for (const evidence of slot.selected_evidence) {
        lines.push(`- ${evidence.source} > ${evidence.heading_path.join(" > ")}`);
      }
    }
    if (slot.missing_evidence.length > 0 || slot.missing_searched_scope.length > 0) {
      lines.push("");
      lines.push("Missing:");
      for (const evidence of slot.missing_evidence) {
        lines.push(`- evidence: ${evidence.source} > ${evidence.heading_path.join(" > ")}`);
      }
      for (const evidence of slot.missing_searched_scope) {
        lines.push(`- searched scope: ${evidence.source} > ${evidence.heading_path.join(" > ")}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function allSlotCandidates(slot: DocumentWorkflowSlotTrace): DocumentRetrievalCandidateTrace[] {
  return slot.queries.flatMap((query) => [
    ...query.selected_candidates,
    ...query.rejected_candidates,
  ]);
}

function selectedSlotCandidates(slot: DocumentWorkflowSlotTrace): DocumentRetrievalCandidateTrace[] {
  return slot.queries.flatMap((query) => query.selected_candidates);
}

function sameSectionCandidate(
  candidate: DocumentRetrievalCandidateTrace,
  requirement: DocumentEvidenceRequirement,
): boolean {
  return (
    candidate.source === requirement.source &&
    headingPathEquals(candidate.heading_path, requirement.heading_path)
  );
}

function buildMissDiagnosis(args: {
  trace: DocumentWorkflowEvalTrace;
  slot: DocumentWorkflowSlotTrace;
  requirement: DocumentEvidenceRequirement;
  requirementKind: "evidence" | "searched_scope";
  importedSections: RetrievedDocumentSection[];
}): DocumentMissDiagnosis {
  const importedSources = new Set(args.importedSections.map((section) => section.source));
  const importedSameSource = args.importedSections.filter((section) => section.source === args.requirement.source);
  const importedSameSection = importedSameSource.filter((section) =>
    headingPathEquals(section.heading_path, args.requirement.heading_path),
  );
  const importedExact = importedSameSection.some((section) =>
    normalizedIncludes(section.text, args.requirement.required_text),
  );
  const slotCandidates = allSlotCandidates(args.slot);
  const selectedCandidates = selectedSlotCandidates(args.slot);
  const rejectedExact = slotCandidates
    .filter((candidate) => !candidate.selected && sameSectionCandidate(candidate, args.requirement))
    .slice(0, 5);
  const otherSlotHits = args.trace.slots
    .filter((slot) => slot.slot_id !== args.slot.slot_id)
    .flatMap((slot) =>
      selectedSlotCandidates(slot)
        .filter((candidate) => sameSectionCandidate(candidate, args.requirement))
        .map((candidate) => ({
          slot_id: slot.slot_id,
          source: candidate.source,
          heading_path: candidate.heading_path,
          rank: candidate.rank,
        })),
    )
    .slice(0, 5);
  const sameSourceSelected = selectedCandidates
    .filter(
      (candidate) =>
        candidate.source === args.requirement.source &&
        !headingPathEquals(candidate.heading_path, args.requirement.heading_path),
    )
    .slice(0, 5);
  const decoyCandidates = selectedCandidates
    .filter((candidate) => args.trace.decoy_sources.includes(candidate.source))
    .slice(0, 5);

  let likelyCause: DocumentMissCause;
  let explanation: string;
  if (!importedSources.has(args.requirement.source)) {
    likelyCause = "source_not_imported";
    explanation = "The required source is not present in the imported fixture corpus.";
  } else if (importedSameSection.length === 0) {
    likelyCause = "section_not_imported";
    explanation = "The source is imported, but no imported chunk has the required heading path.";
  } else if (!importedExact) {
    likelyCause = "section_imported_text_mismatch";
    explanation = "The required heading is imported, but no chunk under that heading contains the required text.";
  } else if (rejectedExact.length > 0) {
    likelyCause = "rejected_in_slot";
    explanation = "The exact required section appeared in this slot's candidate set but was rejected or outside the evaluated top-k.";
  } else if (otherSlotHits.length > 0) {
    likelyCause = "retrieved_in_other_slot";
    explanation = "The exact required section was selected elsewhere in the workflow, but not by the slot that needed it.";
  } else if (sameSourceSelected.length > 0) {
    likelyCause = "right_source_wrong_section";
    explanation = "This slot selected the right source document, but a different section from the one required.";
  } else if (decoyCandidates.length > 0) {
    likelyCause = "decoy_pressure";
    explanation = "This slot selected one or more declared decoy sources while missing the required section.";
  } else {
    likelyCause = "not_retrieved_by_slot";
    explanation = "The required section exists in the corpus, but this slot did not retrieve it in selected or rejected candidates.";
  }

  return {
    slot_id: args.slot.slot_id,
    slot_kind: args.slot.slot_kind,
    role: args.slot.role,
    requirement_kind: args.requirementKind,
    source: args.requirement.source,
    heading_path: args.requirement.heading_path,
    required_text: args.requirement.required_text,
    likely_cause: likelyCause,
    explanation,
    rejected_candidates: rejectedExact,
    other_slot_hits: otherSlotHits,
    same_source_selected: sameSourceSelected,
    decoy_candidates: decoyCandidates,
  };
}

function buildWorkflowFailureAnalysis(args: {
  workflowTrace: DocumentWorkflowEvalTrace;
  importedSections: RetrievedDocumentSection[];
}): DocumentWorkflowFailureAnalysis {
  const diagnoses = args.workflowTrace.slots.flatMap((slot) => [
    ...slot.missing_evidence.map((requirement) =>
      buildMissDiagnosis({
        trace: args.workflowTrace,
        slot,
        requirement,
        requirementKind: "evidence" as const,
        importedSections: args.importedSections,
      }),
    ),
    ...slot.missing_searched_scope.map((requirement) =>
      buildMissDiagnosis({
        trace: args.workflowTrace,
        slot,
        requirement,
        requirementKind: "searched_scope" as const,
        importedSections: args.importedSections,
      }),
    ),
  ]);
  const byCause: Partial<Record<DocumentMissCause, number>> = {};
  for (const diagnosis of diagnoses) {
    byCause[diagnosis.likely_cause] = (byCause[diagnosis.likely_cause] ?? 0) + 1;
  }
  return {
    workflow_id: args.workflowTrace.workflow_id,
    title: args.workflowTrace.title,
    miss_count: diagnoses.length,
    by_cause: byCause,
    decoy_sources_retrieved: args.workflowTrace.decoy_sources_retrieved,
    diagnoses,
  };
}

function renderFailureAnalysisMarkdown(analysis: DocumentWorkflowFailureAnalysis): string {
  const lines: string[] = [];
  lines.push(`# Failure Analysis: ${analysis.title}`);
  lines.push("");
  lines.push(`Workflow: ${analysis.workflow_id}`);
  lines.push(`Misses diagnosed: ${analysis.miss_count}`);
  if (analysis.decoy_sources_retrieved.length > 0) {
    lines.push(`Decoys retrieved: ${analysis.decoy_sources_retrieved.join(", ")}`);
  }
  lines.push("");
  lines.push("## Cause Summary");
  const causeRows = Object.entries(analysis.by_cause).sort(([a], [b]) => a.localeCompare(b));
  if (causeRows.length === 0) {
    lines.push("- no misses");
  } else {
    for (const [cause, count] of causeRows) lines.push(`- ${cause}: ${count}`);
  }
  for (const diagnosis of analysis.diagnoses) {
    lines.push("");
    lines.push(`## ${diagnosis.slot_id} / ${diagnosis.requirement_kind}`);
    lines.push("");
    lines.push(`Required: ${diagnosis.source} > ${diagnosis.heading_path.join(" > ")}`);
    lines.push(`Likely cause: ${diagnosis.likely_cause}`);
    lines.push(`Why: ${diagnosis.explanation}`);
    lines.push(`Required text: ${diagnosis.required_text}`);
    if (diagnosis.rejected_candidates.length > 0) {
      lines.push("");
      lines.push("Rejected exact candidates:");
      for (const candidate of diagnosis.rejected_candidates) {
        lines.push(
          `- rank ${candidate.rank}; ${candidate.rejection_reason ?? candidate.omitted_reason ?? "rejected"}; score ${candidate.final_score.toFixed(3)}`,
        );
      }
    }
    if (diagnosis.other_slot_hits.length > 0) {
      lines.push("");
      lines.push("Selected in other slots:");
      for (const hit of diagnosis.other_slot_hits) {
        lines.push(`- ${hit.slot_id}, rank ${hit.rank}`);
      }
    }
    if (diagnosis.same_source_selected.length > 0) {
      lines.push("");
      lines.push("Same source selected in this slot:");
      for (const candidate of diagnosis.same_source_selected) {
        lines.push(`- rank ${candidate.rank}: ${candidate.heading_path.join(" > ")}`);
      }
    }
    if (diagnosis.decoy_candidates.length > 0) {
      lines.push("");
      lines.push("Decoy candidates selected in this slot:");
      for (const candidate of diagnosis.decoy_candidates) {
        lines.push(`- rank ${candidate.rank}: ${candidate.source} > ${candidate.heading_path.join(" > ")}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function writeWorkflowTraceArtifacts(args: {
  traceDir: string;
  workflowTrace: DocumentWorkflowEvalTrace;
}): void {
  const workflowDir = join(args.traceDir, "workflows", args.workflowTrace.workflow_id);
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    join(workflowDir, "retrieval-trace.json"),
    `${JSON.stringify(args.workflowTrace, null, 2)}\n`,
  );
  writeFileSync(
    join(workflowDir, "score.json"),
    `${JSON.stringify(args.workflowTrace.score, null, 2)}\n`,
  );
  writeFileSync(
    join(workflowDir, "assembled-pack.md"),
    buildTracePackMarkdown(args.workflowTrace),
  );
  if (args.workflowTrace.failure_analysis) {
    writeFileSync(
      join(workflowDir, "failure-analysis.json"),
      `${JSON.stringify(args.workflowTrace.failure_analysis, null, 2)}\n`,
    );
    writeFileSync(
      join(workflowDir, "failure-analysis.md"),
      renderFailureAnalysisMarkdown(args.workflowTrace.failure_analysis),
    );
  }
}

export async function runDocumentWorkflowEval(
  opts: DocumentWorkflowEvalOptions = {},
): Promise<DocumentWorkflowReport> {
  const fixturePath = resolve(opts.fixturePath ?? defaultFixturePath());
  const fixture = loadDocumentWorkflowFixture(fixturePath);
  const fixtureRoot = dirname(fixturePath);
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const candidatePoolK = Math.max(
    topK,
    opts.candidatePoolK ?? DEFAULT_CANDIDATE_POOL_K,
  );
  const sourceSweepK = opts.sourceSweepK ?? DEFAULT_SOURCE_SWEEP_K;
  const rejectedLimit = opts.rejectedLimit ?? 5;
  const traceDir = opts.traceDir ? resolve(opts.traceDir) : undefined;
  const outputsByWorkflow = new Map(
    opts.outputPath
      ? loadDocumentWorkflowOutputs(resolve(opts.outputPath)).map((output) => [output.workflow_id, output])
      : [],
  );
  const cwd = mkdtempSync(join(tmpdir(), "contexttrail-document-workflow-"));

  try {
    init(cwd);
    copyDirSync(fixtureRoot, cwd);
    runImport(cwd, fixture.corpus_globs);
    const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
    try {
      const config = loadConfig(cwd);
      const importedSources = new Set(listSourcesCanonical(db).map((source) => source.source_path));
      const importedChunks = listCurrentChunksCanonical(db);
      const chunksById = new Map(importedChunks.map((chunk) => [chunk.version_id, chunk]));
      const sectionsByVersionId = new Map(
        importedChunks.map((chunk) => [
          chunk.version_id,
          {
            source: chunk.source_path,
            heading_path: chunk.heading_path,
            text: chunk.body,
            tokens: chunk.token_count,
          } satisfies RetrievedDocumentSection,
        ]),
      );
      const importedSections = [...sectionsByVersionId.values()];
      const cases: DocumentWorkflowCaseResult[] = [];
      const failureAnalyses: DocumentWorkflowFailureAnalysis[] = [];
      const workflows = opts.split
        ? fixture.workflows.filter((workflow) => workflow.split === opts.split)
        : fixture.workflows;
      if (workflows.length === 0) {
        throw new Error(`No workflows match split '${opts.split}' in ${fixturePath}`);
      }

      for (const workflow of workflows) {
        const workflowSectionsByKey = new Map<string, RetrievedDocumentSection>();
        const slotSections: { slotId: string; retrievedSections: RetrievedDocumentSection[] }[] = [];
        const slotTraceInputs: {
          slot: ContextSlot;
          retrievedSections: RetrievedDocumentSection[];
          queries: DocumentWorkflowQueryTrace[];
        }[] = [];
        for (const slot of workflow.slots) {
          const slotSectionsByKey = new Map<string, RetrievedDocumentSection>();
          const queryTraces: DocumentWorkflowQueryTrace[] = [];
          for (const query of slot.queries) {
            const request: RetrievalRequest = {
              task: query,
              query_anchors: { files: [], symbols: [], routes: [] },
              budget: "default",
              expected_locked: [],
              explain: false,
            };
            const result = retrieve(db, request, config);
            const includedDocTraces = result.pack.included
              .filter((trace) => trace.kind === "doc_chunk");
            const budgetOmittedDocTraces = result.pack.omitted
              .filter((trace) => trace.kind === "doc_chunk" && trace.omitted_reason === "budget");
            const candidatePool = [...includedDocTraces, ...budgetOmittedDocTraces]
              .slice(0, candidatePoolK);
            const rankedCandidatePool = rerankSlotCandidatePool({
              traces: candidatePool,
              sectionsByVersionId,
              slot,
              fields: workflow.fields,
            });
            const selectedDocTraces = rankedCandidatePool.slice(0, topK);
            const sweptDocTraces = buildSourceSweepTraces({
              selectedTraces: selectedDocTraces,
              chunksById,
              importedChunks,
              slot,
              fields: workflow.fields,
              sourceSweepK,
            });
            const selectedIds = new Set(
              [...selectedDocTraces, ...sweptDocTraces].map((trace) => trace.version_id),
            );
            for (const trace of [...selectedDocTraces, ...sweptDocTraces]) {
              const chunk = chunksById.get(trace.version_id);
              if (!chunk) continue;
              const section = sectionFromChunk(chunk);
              slotSectionsByKey.set(sectionKey(section), section);
              workflowSectionsByKey.set(sectionKey(section), section);
            }
            const selectedCandidates = selectedDocTraces
              .map((trace, index) => {
                const section = traceToSection(trace, sectionsByVersionId);
                if (!section) return null;
                return candidateTrace({
                  rank: index + 1,
                  trace,
                  section,
                  selected: true,
                  fields: workflow.fields,
                  slot,
                });
              })
              .filter((entry): entry is DocumentRetrievalCandidateTrace => entry !== null);
            const sweptCandidates = sweptDocTraces
              .map((trace, index) => {
                const section = traceToSection(trace, sectionsByVersionId);
                if (!section) return null;
                return candidateTrace({
                  rank: topK + index + 1,
                  trace,
                  section,
                  selected: true,
                  fields: workflow.fields,
                  slot,
                });
              })
              .filter((entry): entry is DocumentRetrievalCandidateTrace => entry !== null);
            const rejectedFromCandidatePool = rankedCandidatePool
              .filter((trace) => !selectedIds.has(trace.version_id))
              .map((trace, index) => {
                const section = traceToSection(trace, sectionsByVersionId);
                if (!section) return null;
                return candidateTrace({
                  rank: topK + index + 1,
                  trace,
                  section,
                  selected: false,
                  rejectionReason: "candidate_expansion_not_selected",
                  fields: workflow.fields,
                  slot,
                });
              })
              .filter((entry): entry is DocumentRetrievalCandidateTrace => entry !== null);
            const candidatePoolIds = new Set(candidatePool.map((trace) => trace.version_id));
            const rejectedOutsideCandidatePool = [...includedDocTraces, ...budgetOmittedDocTraces]
              .filter((trace) => !candidatePoolIds.has(trace.version_id))
              .map((trace, index) => {
                const section = traceToSection(trace, sectionsByVersionId);
                if (!section) return null;
                return candidateTrace({
                  rank: candidatePoolK + index + 1,
                  trace,
                  section,
                  selected: false,
                  rejectionReason: "outside_candidate_expansion_pool",
                  fields: workflow.fields,
                  slot,
                });
              })
              .filter((entry): entry is DocumentRetrievalCandidateTrace => entry !== null);
            const rejectedFromOmitted = result.pack.omitted
              .filter((trace) => trace.kind === "doc_chunk" && trace.omitted_reason !== "budget")
              .map((trace, index) => {
                const section = traceToSection(trace, sectionsByVersionId);
                if (!section) return null;
                return candidateTrace({
                  rank: includedDocTraces.length + index + 1,
                  trace,
                  section,
                  selected: false,
                  fields: workflow.fields,
                  slot,
                });
              })
              .filter((entry): entry is DocumentRetrievalCandidateTrace => entry !== null);
            queryTraces.push({
              query,
              query_mode: result.query_mode,
              candidate_count: result.candidate_count,
              eligible_count: result.eligible_count,
              safety_net_engaged: result.pack.safety_net_engaged,
              selected_candidates: selectedCandidates,
              swept_candidates: sweptCandidates,
              rejected_candidates: [
                ...rejectedFromCandidatePool,
                ...rejectedOutsideCandidatePool,
                ...rejectedFromOmitted,
              ].slice(0, rejectedLimit),
            });
          }
          const retrievedSections = [...slotSectionsByKey.values()];
          slotSections.push({
            slotId: slot.id,
            retrievedSections,
          });
          slotTraceInputs.push({
            slot,
            retrievedSections,
            queries: queryTraces,
          });
        }
        const caseResult = scoreDocumentWorkflowCase({
          workflow,
          retrievedSections: [...workflowSectionsByKey.values()],
          slotSections,
          output: outputsByWorkflow.get(workflow.id),
        });
        cases.push(caseResult);
        const slotScoresById = new Map(caseResult.slots.map((slot) => [slot.id, slot]));
        const workflowTraceWithoutAnalysis: DocumentWorkflowEvalTrace = {
          workflow_id: workflow.id,
          title: workflow.title,
          archetype: workflow.archetype,
          split: workflow.split,
          difficulty: workflow.difficulty,
          challenge_tags: workflow.challenge_tags,
          failure_modes: caseResult.failureModes,
          task: workflow.prompt,
          task_variants: workflow.task_variants,
          decoy_sources: workflow.decoy_sources,
          retrieved_sources: caseResult.retrievedSources,
          decoy_sources_retrieved: caseResult.decoySourcesRetrieved,
          slots: slotTraceInputs.map((entry) => {
            const score = slotScoresById.get(entry.slot.id)!;
            return {
              slot_id: entry.slot.id,
              slot_kind: entry.slot.slot_kind,
              role: entry.slot.role,
              purpose: entry.slot.purpose,
              required: entry.slot.required,
              failure_modes: entry.slot.failure_modes,
              fields: entry.slot.fields,
              ...(entry.slot.max_tokens !== undefined ? { max_tokens: entry.slot.max_tokens } : {}),
              retrieved_tokens: score.retrievedTokens,
              evidence_total: score.evidenceTotal,
              evidence_retrieved: score.evidenceRetrieved,
              searched_scope_total: score.searchedScopeTotal,
              searched_scope_retrieved: score.searchedScopeRetrieved,
              selected_evidence: selectedEvidenceForSlot(workflow.fields, entry.slot, entry.retrievedSections),
              missing_evidence: score.missingEvidence,
              missing_searched_scope: score.missingSearchedScope,
              decoy_sources_retrieved: score.decoySourcesRetrieved,
              queries: entry.queries,
            };
          }),
          score: caseResult,
        };
        const failureAnalysis = buildWorkflowFailureAnalysis({
          workflowTrace: workflowTraceWithoutAnalysis,
          importedSections,
        });
        failureAnalyses.push(failureAnalysis);
        const workflowTrace: DocumentWorkflowEvalTrace = {
          ...workflowTraceWithoutAnalysis,
          failure_analysis: failureAnalysis,
        };
        if (traceDir) writeWorkflowTraceArtifacts({ traceDir, workflowTrace });
      }

      const report: DocumentWorkflowReport = {
        fixturePath,
        fixtureName: fixture.fixture_name,
        topK,
        candidatePoolK,
        sourceSweepK,
        importedSources: importedSources.size,
        ...(opts.split ? { splitFilter: opts.split } : {}),
        ...(opts.outputPath ? { outputPath: resolve(opts.outputPath) } : {}),
        ...(traceDir ? { traceDir } : {}),
        cases,
        failureAnalyses,
        summary: summarizeDocumentWorkflow({ importedSources: importedSources.size, cases }),
      };
      if (traceDir) {
        mkdirSync(traceDir, { recursive: true });
        writeFileSync(join(traceDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
      }
      return report;
    } finally {
      closeDb(db);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "not scored" : `${((n / d) * 100).toFixed(1)}%`;
}

function maybePct(value: number | null): string {
  return value === null ? "not scored" : `${(value * 100).toFixed(1)}%`;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, index) => Math.max(...rows.map((row) => row[index]!.length)));
  return rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ")).join("\n");
}

export function renderDocumentWorkflowReport(report: DocumentWorkflowReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push("Document workflow eval");
  lines.push("");
  lines.push(`Fixture: ${report.fixturePath}`);
  lines.push(`Fixture name: ${report.fixtureName}`);
  lines.push(`Imported sources: ${s.importedSources}`);
  if (report.splitFilter) lines.push(`Split: ${report.splitFilter}`);
  lines.push(
    `${s.workflows} workflows, ${s.taskVariants} task variants, ${s.slots} slots, ${s.fields} fields, ${s.queries} queries, top-${report.topK} per query from candidate pool ${report.candidatePoolK}, source sweep ${report.sourceSweepK}`,
  );
  if (report.outputPath) lines.push(`Workflow output: ${report.outputPath}`);
  if (report.traceDir) lines.push(`Trace dir: ${report.traceDir}`);
  lines.push("");
  lines.push(table([
    ["Metric", "Result"],
    [
      "Slot evidence recall",
      `${s.slotEvidenceHits}/${s.slotEvidenceTotal} (${pct(s.slotEvidenceHits, s.slotEvidenceTotal)})`,
    ],
    [
      "Required slots satisfied",
      `${s.requiredSlotsSatisfied}/${s.requiredSlots} (${pct(s.requiredSlotsSatisfied, s.requiredSlots)})`,
    ],
    [
      "Evidence section recall",
      `${s.sectionRecallHits}/${s.sectionRecallTotal} (${pct(s.sectionRecallHits, s.sectionRecallTotal)})`,
    ],
    [
      "Searched-scope coverage",
      `${s.searchedScopeHits}/${s.searchedScopeTotal} (${pct(s.searchedScopeHits, s.searchedScopeTotal)})`,
    ],
    [
      "Field accuracy",
      `${s.fieldAccuracyHits}/${s.fieldAccuracyTotal} (${pct(s.fieldAccuracyHits, s.fieldAccuracyTotal)})`,
    ],
    [
      "Citation validity",
      `${s.citationValidityHits}/${s.citationValidityTotal} (${pct(s.citationValidityHits, s.citationValidityTotal)})`,
    ],
    [
      "Abstention quality",
      `${s.abstentionHits}/${s.abstentionTotal} (${pct(s.abstentionHits, s.abstentionTotal)})`,
    ],
    [
      "Human review load",
      `${s.reviewFields}/${s.fields} fields; precision ${maybePct(s.reviewPrecision)}, recall ${maybePct(s.reviewRecall)}`,
    ],
    [
      "Slot budget",
      `${s.overBudgetSlots}/${s.slots} over budget`,
    ],
    [
      "Decoy retrieval",
      `${s.decoySourceHits} decoy source hits`,
    ],
  ]));

  const failureRows = Object.entries(s.byFailureMode)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mode, row]) => [
      mode,
      `${row!.satisfied}/${row!.total} slots; evidence ${row!.evidenceHits}/${row!.evidenceTotal}; scope ${row!.searchedScopeHits}/${row!.searchedScopeTotal}`,
    ]);
  if (failureRows.length > 0) {
    lines.push("");
    lines.push("Failure-mode pressure");
    lines.push(table([["Mode", "Result"], ...failureRows]));
  }

  const archetypeRows = Object.entries(s.byArchetype)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([archetype, row]) => [
      archetype,
      `${row!.satisfied}/${row!.total} slots; evidence ${row!.evidenceHits}/${row!.evidenceTotal}; scope ${row!.searchedScopeHits}/${row!.searchedScopeTotal}`,
    ]);
  if (archetypeRows.length > 0) {
    lines.push("");
    lines.push("Archetype pressure");
    lines.push(table([["Archetype", "Result"], ...archetypeRows]));
  }

  const splitRows = DOCUMENT_WORKFLOW_SPLITS
    .filter((split) => s.bySplit[split] !== undefined)
    .map((split) => {
      const row = s.bySplit[split]!;
      return [
        split,
        `${row.satisfied}/${row.total} slots; evidence ${row.evidenceHits}/${row.evidenceTotal}; scope ${row.searchedScopeHits}/${row.searchedScopeTotal}`,
      ];
    });
  if (splitRows.length > 0) {
    lines.push("");
    lines.push("Split pressure");
    lines.push(table([["Split", "Result"], ...splitRows]));
  }

  const difficultyRows = Object.entries(s.byDifficulty)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([difficulty, row]) => [
      `L${difficulty}`,
      `${row.satisfied}/${row.total} slots; evidence ${row.evidenceHits}/${row.evidenceTotal}; scope ${row.searchedScopeHits}/${row.searchedScopeTotal}`,
    ]);
  if (difficultyRows.length > 0) {
    lines.push("");
    lines.push("Difficulty pressure");
    lines.push(table([["Difficulty", "Result"], ...difficultyRows]));
  }

  const missCauseCounts: Partial<Record<DocumentMissCause, number>> = {};
  for (const analysis of report.failureAnalyses) {
    for (const diagnosis of analysis.diagnoses) {
      missCauseCounts[diagnosis.likely_cause] = (missCauseCounts[diagnosis.likely_cause] ?? 0) + 1;
    }
  }
  const missCauseRows = DOCUMENT_MISS_CAUSES
    .filter((cause) => (missCauseCounts[cause] ?? 0) > 0)
    .map((cause) => [cause, String(missCauseCounts[cause])]);
  if (missCauseRows.length > 0) {
    lines.push("");
    lines.push("Miss diagnosis");
    lines.push(table([["Likely cause", "Count"], ...missCauseRows]));
    if (report.traceDir) lines.push(`Details: ${report.traceDir}/workflows/<workflow_id>/failure-analysis.md`);
  }

  const missedSlots = report.cases.flatMap((row) =>
    row.slots
      .filter((slot) => slot.missingEvidence.length > 0)
      .map((slot) => ({ workflow: row, slot })),
  );
  lines.push("");
  lines.push(`Slot misses: ${missedSlots.length}`);
  for (const miss of missedSlots) {
    lines.push(`  ${miss.workflow.id} / ${miss.slot.id}  ${miss.slot.slotKind}/${miss.slot.role}`);
    for (const evidence of miss.slot.missingEvidence) {
      lines.push(`    ${evidence.source} > ${evidence.heading_path.join(" > ")}`);
    }
  }

  const missedSearchedScope = report.cases.flatMap((row) =>
    row.slots
      .filter((slot) => slot.missingSearchedScope.length > 0)
      .map((slot) => ({ workflow: row, slot })),
  );
  lines.push("");
  lines.push(`Searched-scope misses: ${missedSearchedScope.length}`);
  for (const miss of missedSearchedScope) {
    lines.push(`  ${miss.workflow.id} / ${miss.slot.id}  ${miss.slot.slotKind}/${miss.slot.role}`);
    for (const evidence of miss.slot.missingSearchedScope) {
      lines.push(`    ${evidence.source} > ${evidence.heading_path.join(" > ")}`);
    }
  }

  const missedFields = report.cases.flatMap((row) =>
    row.fields
      .filter((field) => field.missingEvidence.length > 0)
      .map((field) => ({ workflow: row, field })),
  );
  lines.push("");
  lines.push(`Evidence misses: ${missedFields.length}`);
  for (const miss of missedFields) {
    lines.push(`  ${miss.workflow.id} / ${miss.field.id}  ${miss.field.label}`);
    for (const evidence of miss.field.missingEvidence) {
      lines.push(`    ${evidence.source} > ${evidence.heading_path.join(" > ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function parseDocumentWorkflowArgs(argv: string[]): DocumentWorkflowCliArgs {
  const out: DocumentWorkflowCliArgs = { json: argv.includes("--json") };
  for (const arg of argv) {
    const fixture = /^--fixture=(.+)$/.exec(arg);
    if (fixture) {
      out.fixturePath = fixture[1]!;
      continue;
    }
    const output = /^--output=(.+)$/.exec(arg);
    if (output) {
      out.outputPath = output[1]!;
      continue;
    }
    const traceDir = /^--trace-dir=(.+)$/.exec(arg);
    if (traceDir) {
      out.traceDir = traceDir[1]!;
      continue;
    }
    const split = /^--split=(.+)$/.exec(arg);
    if (split) {
      out.split = requireWorkflowSplit(split[1]!, "--split");
      continue;
    }
    const topK = /^--top-k=(\d+)$/.exec(arg);
    if (topK) {
      const parsed = Number.parseInt(topK[1]!, 10);
      if (Number.isFinite(parsed) && parsed > 0) out.topK = parsed;
    }
    const candidatePoolK = /^--candidate-pool-k=(\d+)$/.exec(arg);
    if (candidatePoolK) {
      const parsed = Number.parseInt(candidatePoolK[1]!, 10);
      if (Number.isFinite(parsed) && parsed > 0) out.candidatePoolK = parsed;
    }
    const sourceSweepK = /^--source-sweep-k=(\d+)$/.exec(arg);
    if (sourceSweepK) {
      const parsed = Number.parseInt(sourceSweepK[1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.sourceSweepK = parsed;
    }
    const rejectedLimit = /^--rejected-limit=(\d+)$/.exec(arg);
    if (rejectedLimit) {
      const parsed = Number.parseInt(rejectedLimit[1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.rejectedLimit = parsed;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseDocumentWorkflowArgs(process.argv);
  const report = await runDocumentWorkflowEval({
    fixturePath: args.fixturePath,
    outputPath: args.outputPath,
    traceDir: args.traceDir,
    split: args.split,
    topK: args.topK,
    candidatePoolK: args.candidatePoolK,
    sourceSweepK: args.sourceSweepK,
    rejectedLimit: args.rejectedLimit,
  });
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderDocumentWorkflowReport(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
