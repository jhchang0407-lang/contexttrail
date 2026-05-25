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

export const DOCUMENT_FIELD_VALUE_KINDS = [
  "extracted",
  "computed",
  "judgment",
] as const;
export type DocumentFieldValueKind = (typeof DOCUMENT_FIELD_VALUE_KINDS)[number];

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
  value_kind: DocumentFieldValueKind;
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

export const DOCUMENT_SOURCE_DISPOSITIONS = [
  "authoritative",
  "supporting",
  "contradictory",
  "excluded_non_authoritative",
  "stale_or_wrong_scope",
] as const;
export type DocumentSourceDispositionKind = (typeof DOCUMENT_SOURCE_DISPOSITIONS)[number];

export type DocumentSourceDisposition = {
  source: string;
  heading_path: string[];
  disposition: DocumentSourceDispositionKind;
  reason: string;
};

export type DocumentExcludedCitation = DocumentCitation & {
  disposition?: Extract<DocumentSourceDispositionKind, "contradictory" | "excluded_non_authoritative" | "stale_or_wrong_scope">;
  reason?: string;
};

export type DocumentWorkflowFieldOutput = {
  field_id: string;
  status: DocumentOutputStatus;
  value?: string | null;
  explanation?: string;
  citations?: DocumentCitation[];
  excluded_citations?: DocumentExcludedCitation[];
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
  valueKind: DocumentFieldValueKind;
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
  extractedAccuracy: boolean | null;
  computedAccuracy: boolean | null;
  judgmentAccuracy: boolean | null;
  computedGrounding: boolean | null;
  judgmentGrounding: boolean | null;
  citationValid: boolean | null;
  citationAuthorityValid: boolean | null;
  abstentionCorrect: boolean | null;
  reviewExplanationValid: boolean | null;
  decoyAuthorityCitations: DocumentCitation[];
  decoyRejectedCitations: DocumentExcludedCitation[];
  decoyAuthorityMisuse: boolean | null;
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
  extractedAccuracyHits: number;
  extractedAccuracyTotal: number;
  computedAccuracyHits: number;
  computedAccuracyTotal: number;
  judgmentAccuracyHits: number;
  judgmentAccuracyTotal: number;
  computedGroundingHits: number;
  computedGroundingTotal: number;
  judgmentGroundingHits: number;
  judgmentGroundingTotal: number;
  citationValidityHits: number;
  citationValidityTotal: number;
  citationAuthorityHits: number;
  citationAuthorityTotal: number;
  reviewExplanationHits: number;
  reviewExplanationTotal: number;
  decoyAuthorityMisuses: number;
  decoyAuthorityCitationTotal: number;
  decoyRejectedCitationTotal: number;
  decoyOutputFields: number;
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
  crossSlotK: number;
  absenceVerifierK: number;
  ruleApplicationK: number;
  expectedPlaceK: number;
  aliasStatusK: number;
  sourceLocalCompletionK: number;
  nearMissK: number;
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
  cross_slot_sections: RetrievedDocumentSection[];
  absence_verifier_sections: RetrievedDocumentSection[];
  rule_application_sections: RetrievedDocumentSection[];
  expected_place_sections: RetrievedDocumentSection[];
  alias_status_sections: RetrievedDocumentSection[];
  source_local_completion_sections: RetrievedDocumentSection[];
  near_miss_sections: RetrievedDocumentSection[];
  budget_pruned_sections: RetrievedDocumentSection[];
  source_dispositions: DocumentSourceDisposition[];
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
  outputs?: DocumentWorkflowOutput[];
  traceDir?: string;
  split?: DocumentWorkflowSplit;
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
  crossSlotK?: number;
  absenceVerifierK?: number;
  ruleApplicationK?: number;
  expectedPlaceK?: number;
  aliasStatusK?: number;
  sourceLocalCompletionK?: number;
  nearMissK?: number;
  rejectedLimit?: number;
};

const DEFAULT_FIXTURE = "tests/fixtures/document-workflows/insurance-claim/workflows.yaml";
const DEFAULT_TOP_K = 5;
const DEFAULT_CANDIDATE_POOL_K = 12;
const DEFAULT_SOURCE_SWEEP_K = 2;
const DEFAULT_CROSS_SLOT_K = 2;
const DEFAULT_ABSENCE_VERIFIER_K = 1;
const DEFAULT_RULE_APPLICATION_K = 1;
const DEFAULT_EXPECTED_PLACE_K = 2;
const DEFAULT_ALIAS_STATUS_K = 1;
const DEFAULT_SOURCE_LOCAL_COMPLETION_K = 1;
const DEFAULT_NEAR_MISS_K = 1;

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

function requireFieldValueKind(value: unknown, label: string): DocumentFieldValueKind {
  if (!DOCUMENT_FIELD_VALUE_KINDS.includes(value as DocumentFieldValueKind)) {
    throw new Error(`${label} must be one of ${DOCUMENT_FIELD_VALUE_KINDS.join(", ")}`);
  }
  return value as DocumentFieldValueKind;
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
    value_kind: value.value_kind === undefined
      ? "extracted"
      : requireFieldValueKind(value.value_kind, `${label}.value_kind`),
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

function requireOutputSourceDisposition(value: unknown, label: string): DocumentExcludedCitation["disposition"] {
  if (
    value !== "contradictory" &&
    value !== "excluded_non_authoritative" &&
    value !== "stale_or_wrong_scope"
  ) {
    throw new Error(`${label} must be contradictory, excluded_non_authoritative, or stale_or_wrong_scope`);
  }
  return value;
}

function validateExcludedCitation(value: unknown, label: string): DocumentExcludedCitation {
  const citation = validateCitation(value, label);
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return {
    ...citation,
    ...(value.disposition !== undefined
      ? { disposition: requireOutputSourceDisposition(value.disposition, `${label}.disposition`) }
      : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
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
  const excludedCitations =
    value.excluded_citations === undefined
      ? undefined
      : Array.isArray(value.excluded_citations)
        ? value.excluded_citations.map((citation, index) =>
            validateExcludedCitation(citation, `${label}.excluded_citations[${index}]`),
          )
        : (() => {
            throw new Error(`${label}.excluded_citations must be an array`);
          })();
  return {
    field_id: requireString(value.field_id, `${label}.field_id`),
    status: requireOutputStatus(value.status, `${label}.status`),
    ...(value.value === undefined || value.value === null
      ? value.value === null
        ? { value: null }
        : {}
      : { value: requireString(value.value, `${label}.value`) }),
    ...(typeof value.explanation === "string" ? { explanation: value.explanation } : {}),
    ...(citations !== undefined ? { citations } : {}),
    ...(excludedCitations !== undefined ? { excluded_citations: excludedCitations } : {}),
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

function citationMatchesRetrievedSection(
  citation: DocumentCitation,
  sections: RetrievedDocumentSection[],
): boolean {
  return sections.some((section) =>
    section.source === citation.source &&
    (citation.heading_path === undefined || headingPathEquals(citation.heading_path, section.heading_path)),
  );
}

function citationMatchesAnyRequirement(
  citation: DocumentCitation,
  requirements: DocumentEvidenceRequirement[],
): boolean {
  return requirements.some((requirement) => citationSatisfiesRequirement(citation, requirement));
}

function excludedCitationValid(citation: DocumentExcludedCitation): boolean {
  return (
    citation.disposition === "contradictory" ||
    citation.disposition === "excluded_non_authoritative" ||
    citation.disposition === "stale_or_wrong_scope"
  ) && normalizeText(citation.reason).length > 0;
}

function outputCitationAuthorityValid(args: {
  workflow: DocumentWorkflowCase;
  field: DocumentWorkflowFieldGold;
  output?: DocumentWorkflowFieldOutput;
  retrievedSections: RetrievedDocumentSection[];
}): boolean | null {
  if (args.output === undefined) return null;
  const authorityCitations = args.output.citations ?? [];
  for (const citation of authorityCitations) {
    if (args.workflow.decoy_sources.includes(citation.source)) return false;
    if (!citationMatchesRetrievedSection(citation, args.retrievedSections)) return false;
    const allowedRequirements =
      args.field.expected_status === "missing"
        ? args.field.searched_scope ?? []
        : args.field.evidence ?? [];
    if (allowedRequirements.length > 0 && !citationMatchesAnyRequirement(citation, allowedRequirements)) {
      return false;
    }
  }
  return (args.output.excluded_citations ?? []).every(excludedCitationValid);
}

function explanationMatchesReviewReason(explanation: string | undefined, field: DocumentWorkflowFieldGold): boolean {
  const normalizedExplanation = normalizeText(explanation);
  if (normalizedExplanation.length === 0) return false;
  const reviewReason = normalizeText(field.review_reason);
  if (reviewReason.length === 0) return normalizedExplanation.length >= 20;
  if (normalizedExplanation.includes(reviewReason)) return true;
  const reviewTokens = unique(tokenizeForSlotText(reviewReason))
    .filter((token) => !TOKEN_STOPWORDS.has(token));
  if (reviewTokens.length === 0) return false;
  const explanationTokens = tokenSet(normalizedExplanation);
  const overlap = reviewTokens.filter((token) => explanationTokens.has(token)).length;
  const required = Math.min(5, Math.max(2, Math.ceil(reviewTokens.length * 0.3)));
  return overlap >= required;
}

function isReviewStatus(status: DocumentOutputStatus): boolean {
  return status === "missing_evidence" || status === "conflict" || status === "needs_review";
}

function abstentionMatches(status: DocumentOutputStatus, expected: DocumentFieldStatus): boolean {
  if (expected === "conflicting") return status === "conflict" || status === "needs_review";
  if (expected === "missing") return status === "missing_evidence" || status === "needs_review";
  return false;
}

function fieldValueKind(field: DocumentWorkflowFieldGold): DocumentFieldValueKind {
  return field.value_kind ?? "extracted";
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
    const decoyAuthorityCitations = (output?.citations ?? [])
      .filter((citation) => args.workflow.decoy_sources.includes(citation.source));
    const decoyRejectedCitations = (output?.excluded_citations ?? [])
      .filter((citation) => args.workflow.decoy_sources.includes(citation.source));
    const decoyAuthorityMisuse = output === undefined ? null : decoyAuthorityCitations.length > 0;
    const citationAuthorityValid = outputCitationAuthorityValid({
      workflow: args.workflow,
      field,
      output,
      retrievedSections: args.retrievedSections,
    });
    const reviewExpected = field.expected_status !== "answerable" || evidenceMissing || searchedScopeMissing;
    const reviewed = output === undefined ? reviewExpected : isReviewStatus(output.status);
    const fieldAccuracy =
      output === undefined || field.expected_status !== "answerable"
        ? null
        : output.status === "answered" &&
          normalizeText(output.value) === normalizeText(field.expected_value);
    const valueKind = fieldValueKind(field);
    const extractedAccuracy = valueKind === "extracted" ? fieldAccuracy : null;
    const computedAccuracy = valueKind === "computed" ? fieldAccuracy : null;
    const judgmentAccuracy = valueKind === "judgment" ? fieldAccuracy : null;
    const citationValid =
      output === undefined ||
      field.expected_status !== "answerable" ||
      output.status !== "answered"
        ? null
        : citationAuthorityValid === true &&
          evidence.every((requirement) =>
            args.retrievedSections.some((section) => sectionSatisfiesRequirement(section, requirement)) &&
            (output.citations ?? []).some((citation) => citationSatisfiesRequirement(citation, requirement)),
          );
    const computedGrounding = valueKind === "computed" ? citationValid : null;
    const judgmentGrounding = valueKind === "judgment" ? citationValid : null;
    const abstentionCorrect =
      output === undefined || field.expected_status === "answerable"
        ? null
        : citationAuthorityValid === true && abstentionMatches(output.status, field.expected_status);
    const reviewExplanationValid =
      output === undefined || field.expected_status === "answerable"
        ? null
        : citationAuthorityValid === true &&
          abstentionMatches(output.status, field.expected_status) &&
          explanationMatchesReviewReason(output.explanation, field);

    return {
      id: field.id,
      label: field.label,
      expectedStatus: field.expected_status,
      valueKind,
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
      extractedAccuracy,
      computedAccuracy,
      judgmentAccuracy,
      computedGrounding,
      judgmentGrounding,
      citationValid,
      citationAuthorityValid,
      abstentionCorrect,
      reviewExplanationValid,
      decoyAuthorityCitations,
      decoyRejectedCitations,
      decoyAuthorityMisuse,
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
  const extractedAccuracyValues = fields.map((field) => field.extractedAccuracy);
  const computedAccuracyValues = fields.map((field) => field.computedAccuracy);
  const judgmentAccuracyValues = fields.map((field) => field.judgmentAccuracy);
  const computedGroundingValues = fields.map((field) => field.computedGrounding);
  const judgmentGroundingValues = fields.map((field) => field.judgmentGrounding);
  const citationValues = fields.map((field) => field.citationValid);
  const citationAuthorityValues = fields.map((field) => field.citationAuthorityValid);
  const abstentionValues = fields.map((field) => field.abstentionCorrect);
  const reviewExplanationValues = fields.map((field) => field.reviewExplanationValid);
  const outputFields = fields.filter((field) => field.outputStatus !== undefined);
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
    extractedAccuracyHits: countTruthy(extractedAccuracyValues),
    extractedAccuracyTotal: countScored(extractedAccuracyValues),
    computedAccuracyHits: countTruthy(computedAccuracyValues),
    computedAccuracyTotal: countScored(computedAccuracyValues),
    judgmentAccuracyHits: countTruthy(judgmentAccuracyValues),
    judgmentAccuracyTotal: countScored(judgmentAccuracyValues),
    computedGroundingHits: countTruthy(computedGroundingValues),
    computedGroundingTotal: countScored(computedGroundingValues),
    judgmentGroundingHits: countTruthy(judgmentGroundingValues),
    judgmentGroundingTotal: countScored(judgmentGroundingValues),
    citationValidityHits: countTruthy(citationValues),
    citationValidityTotal: countScored(citationValues),
    citationAuthorityHits: countTruthy(citationAuthorityValues),
    citationAuthorityTotal: countScored(citationAuthorityValues),
    reviewExplanationHits: countTruthy(reviewExplanationValues),
    reviewExplanationTotal: countScored(reviewExplanationValues),
    decoyAuthorityMisuses: fields.filter((field) => field.decoyAuthorityMisuse === true).length,
    decoyAuthorityCitationTotal: fields.reduce((sum, field) => sum + field.decoyAuthorityCitations.length, 0),
    decoyRejectedCitationTotal: fields.reduce((sum, field) => sum + field.decoyRejectedCitations.length, 0),
    decoyOutputFields: outputFields.length,
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

const STALE_OR_NONCURRENT_TERMS = new Set([
  "archived",
  "draft",
  "expired",
  "former",
  "legacy",
  "non",
  "old",
  "older",
  "prior",
  "retired",
  "stale",
  "superseded",
  "terminated",
  "unrelated",
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

function weightedTermsFromText(value: string, baseWeight: number): WeightedTerm[] {
  const out = new Map<string, number>();
  for (const term of tokenizeForSlotText(value)) {
    const digitBoost = /\d/.test(term) ? 2.2 : 1;
    const lengthBoost = term.length >= 5 ? 1.15 : 1;
    out.set(term, Math.max(out.get(term) ?? 0, baseWeight * digitBoost * lengthBoost));
  }
  return [...out.entries()].map(([term, weight]) => ({ term, weight }));
}

const FIELD_COVERAGE_STOPWORDS = new Set([
  ...TOKEN_STOPWORDS,
  "field",
  "kind",
  "rule",
  "value",
]);

function acronymSet(value: string): Set<string> {
  const tokens = tokenizeForSlotText(value)
    .filter((token) => !TOKEN_STOPWORDS.has(token) && !/\d/.test(token));
  const acronyms = new Set<string>();
  for (let start = 0; start < tokens.length; start += 1) {
    for (let length = 2; length <= 5 && start + length <= tokens.length; length += 1) {
      const phrase = tokens.slice(start, start + length);
      if (phrase.some((token) => token.length < 3)) continue;
      const acronym = phrase.map((token) => token.slice(0, 1)).join("");
      if (acronym.length >= 2 && acronym.length <= 5) acronyms.add(acronym);
    }
  }
  return acronyms;
}

function explicitAcronymTerms(value: string): string[] {
  const matches = value.match(/\b[A-Z][A-Z0-9-]{1,6}\b/g) ?? [];
  return matches
    .map((match) => match.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((match) => match.length >= 2 && match.length <= 6);
}

function slotAcronymTerms(slot: ContextSlot, fields: DocumentWorkflowFieldGold[]): string[] {
  const slotFieldIds = new Set(slot.fields);
  return unique([
    slot.purpose,
    ...slot.queries,
    ...fields
      .filter((field) => slotFieldIds.has(field.id))
      .flatMap((field) => [field.id, field.label]),
  ].flatMap(explicitAcronymTerms));
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

const ALIAS_STATUS_HEADING_TERMS = [
  "coverage",
  "controls",
  "identity",
  "result",
  "screening",
  "status",
  "summary",
];

function aliasStatusHeadingScore(section: RetrievedDocumentSection): number {
  const headingTokens = tokenSet(section.heading_path.join(" "));
  let score = 0;
  for (const term of ALIAS_STATUS_HEADING_TERMS) {
    if (headingTokens.has(term)) score += 1;
  }
  return score;
}

function fieldCoverageScore(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  section: RetrievedDocumentSection;
}): number {
  const slotFieldIds = new Set(args.slot.fields);
  const haystack = `${args.section.source} ${args.section.heading_path.join(" ")} ${args.section.text}`;
  const haystackTokens = tokenSet(haystack);
  const haystackAcronyms = acronymSet(haystack);
  let score = 0;
  for (const field of args.fields) {
    if (!slotFieldIds.has(field.id)) continue;
    const normalizedLabel = normalizeText(field.label);
    if (normalizedLabel.length > 2 && normalizedIncludes(haystack, normalizedLabel)) {
      score += 0.34;
    }
    const fieldTokens = unique(tokenizeForSlotText(`${field.id} ${field.label}`))
      .filter((token) => !FIELD_COVERAGE_STOPWORDS.has(token));
    if (fieldTokens.length < 2) continue;
    const covered = fieldTokens.filter((token) => haystackTokens.has(token) || haystackAcronyms.has(token));
    if (covered.length >= Math.min(2, fieldTokens.length)) score += 0.38;
    if (covered.length === fieldTokens.length) score += 0.22;
  }
  const slotAcronyms = slotAcronymTerms(args.slot, args.fields);
  const acronymHits = slotAcronyms.filter((term) => haystackAcronyms.has(term)).length;
  score += Math.min(0.44, acronymHits * 0.22);
  return score;
}

function slotHasDerivedFields(slot: ContextSlot, fields: DocumentWorkflowFieldGold[]): boolean {
  const slotFieldIds = new Set(slot.fields);
  return fields.some((field) =>
    slotFieldIds.has(field.id) &&
    (fieldValueKind(field) === "computed" || fieldValueKind(field) === "judgment")
  );
}

const DERIVED_INPUT_TERMS = [
  "amount",
  "approved",
  "approval",
  "backordered",
  "blocked",
  "callback",
  "ceiling",
  "completed",
  "count",
  "date",
  "deadline",
  "discount",
  "due",
  "eligible",
  "hours",
  "issue",
  "limit",
  "missing",
  "notice",
  "open",
  "pending",
  "quantity",
  "received",
  "review",
  "risk",
  "status",
  "threshold",
  "total",
  "units",
];

function derivedInputSignalScore(section: RetrievedDocumentSection): number {
  const haystack = `${section.source} ${section.heading_path.join(" ")} ${section.text}`;
  const tokens = tokenSet(haystack);
  let score = 0;
  for (const term of DERIVED_INPUT_TERMS) {
    if (tokens.has(term)) score += 0.14;
  }
  if (/\$[\d,]+(?:\.\d+)?/.test(haystack)) score += 0.45;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(haystack)) score += 0.35;
  if (/\b\d+(?:\.\d+)?%/.test(haystack)) score += 0.28;
  if (/\|.+\|/.test(haystack)) score += 0.32;
  if (/\b(?:not|no|open|pending|missing|blocked|hold)\b/i.test(haystack)) score += 0.35;
  return Math.min(score, 1.7);
}

function buildAliasStatusSections(args: {
  rankedCandidatePool: EvalDocCandidateTrace[];
  selectedIds: Set<string>;
  chunksById: Map<string, DocChunk>;
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  aliasStatusK: number;
}): RetrievedDocumentSection[] {
  if (args.aliasStatusK <= 0 || args.slot.role !== "evidence") return [];
  return args.rankedCandidatePool
    .filter((trace) => !args.selectedIds.has(trace.version_id))
    .map((trace, index) => {
      const chunk = args.chunksById.get(trace.version_id);
      if (!chunk) return null;
      const section = sectionFromChunk(chunk);
      if ((section.tokens ?? 0) <= 0 || section.text.trim().length === 0) return null;
      const coverageScore = fieldCoverageScore({
        slot: args.slot,
        fields: args.fields,
        section,
      });
      if (coverageScore < 0.58) return null;
      const headingScore = aliasStatusHeadingScore(section);
      const score =
        coverageScore +
        (headingScore * 0.12) +
        (trace.final_score * 0.16) +
        (trace.packing_score * 0.08) -
        (staleSectionPenalty(section) * 0.5);
      return { section, index, score };
    })
    .filter((entry): entry is { section: RetrievedDocumentSection; index: number; score: number } => {
      return entry !== null && entry.score >= 0.72;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tokenDelta = (a.section.tokens ?? 0) - (b.section.tokens ?? 0);
      if (tokenDelta !== 0) return tokenDelta;
      return a.index - b.index;
    })
    .slice(0, args.aliasStatusK)
    .map((entry) => entry.section);
}

function sectionFitScore(args: {
  trace?: EvalDocCandidateTrace;
  section: RetrievedDocumentSection;
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
}): number {
  const syntheticTrace: EvalDocCandidateTrace = args.trace ?? {
    version_id: `${args.section.source}:${args.section.heading_path.join("/")}`,
    token_count: args.section.tokens ?? 0,
    final_score: 0,
    packing_score: 0,
    bm25_norm: 0,
    heading_match: 0,
  };
  const terms = buildSlotExpansionTerms({
    slot: args.slot,
    fields: args.fields,
  });
  return slotCandidateExpansionScore({
    trace: syntheticTrace,
    section: args.section,
    terms,
    slot: args.slot,
    fields: args.fields,
  });
}

function selectNearMissSections(args: {
  rankedCandidatePool: EvalDocCandidateTrace[];
  selectedIds: Set<string>;
  chunksById: Map<string, DocChunk>;
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  nearMissK: number;
}): RetrievedDocumentSection[] {
  if (args.nearMissK <= 0) return [];
  return args.rankedCandidatePool
    .filter((trace) => !args.selectedIds.has(trace.version_id))
    .map((trace, index) => {
      const chunk = args.chunksById.get(trace.version_id);
      if (!chunk) return null;
      const section = sectionFromChunk(chunk);
      if ((section.tokens ?? 0) <= 0 || section.text.trim().length === 0) return null;
      const coverageScore = fieldCoverageScore({
        slot: args.slot,
        fields: args.fields,
        section,
      });
      const headingScore = factLikeHeadingScore(section) + expectedPlaceHeadingScore(section);
      const stalePenalty = staleSectionPenalty(section);
      if (trace.final_score < 0.22 && coverageScore < 0.58) return null;
      if (stalePenalty >= 0.55 && coverageScore < 0.58) return null;
      const score =
        (trace.final_score * 0.65) +
        (trace.packing_score * 0.2) +
        (coverageScore * 0.75) +
        (headingScore * 0.08) -
        (stalePenalty * 0.75) -
        (index * 0.015);
      return { section, index, score };
    })
    .filter((entry): entry is { section: RetrievedDocumentSection; index: number; score: number } => {
      return entry !== null && entry.score >= 0.48;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tokenDelta = (a.section.tokens ?? 0) - (b.section.tokens ?? 0);
      if (tokenDelta !== 0) return tokenDelta;
      return a.index - b.index;
    })
    .slice(0, args.nearMissK)
    .map((entry) => entry.section);
}

function selectSourceLocalCompletionSections(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  currentSections: RetrievedDocumentSection[];
  importedChunks: DocChunk[];
  sourceLocalCompletionK: number;
  sourceFilter?: Set<string>;
}): RetrievedDocumentSection[] {
  if (args.sourceLocalCompletionK <= 0 || args.currentSections.length === 0) return [];
  const currentKeys = new Set(args.currentSections.map(sectionKey));
  const selectedSources = args.sourceFilter ?? new Set(args.currentSections.map((section) => section.source));
  const hasDerivedFields = slotHasDerivedFields(args.slot, args.fields);
  return args.importedChunks
    .filter((chunk) => selectedSources.has(chunk.source_path))
    .map((chunk, index) => {
      const section = sectionFromChunk(chunk);
      if (currentKeys.has(sectionKey(section))) return null;
      if ((section.tokens ?? 0) <= 0 || section.text.trim().length === 0) return null;
      const headingScore = factLikeHeadingScore(section) + expectedPlaceHeadingScore(section);
      const derivedInputScore = hasDerivedFields ? derivedInputSignalScore(section) : 0;
      if (headingScore <= 0 && derivedInputScore < 0.35) return null;
      const roleHeadingScore = slotRoleHeadingScore(args.slot, section);
      const coverageScore = fieldCoverageScore({
        slot: args.slot,
        fields: args.fields,
        section,
      });
      const fitScore = sectionFitScore({
        section,
        slot: args.slot,
        fields: args.fields,
      });
      const score =
        (fitScore * 0.82) +
        (coverageScore * 0.72) +
        (headingScore * 0.12) +
        (derivedInputScore * 0.34) +
        (roleHeadingScore * 0.34) -
        (staleSectionPenalty(section) * 0.45);
      return { section, index, score };
    })
    .filter((entry): entry is { section: RetrievedDocumentSection; index: number; score: number } => {
      return entry !== null && entry.score >= (hasDerivedFields ? 0.26 : 0.34);
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tokenDelta = (a.section.tokens ?? 0) - (b.section.tokens ?? 0);
      if (tokenDelta !== 0) return tokenDelta;
      return a.index - b.index;
    })
    .slice(0, args.sourceLocalCompletionK)
    .map((entry) => entry.section);
}

function selectCrossSlotSections(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  currentSections: RetrievedDocumentSection[];
  otherSections: RetrievedDocumentSection[];
  crossSlotK: number;
}): RetrievedDocumentSection[] {
  if (args.crossSlotK <= 0 || args.otherSections.length === 0) return [];
  const currentKeys = new Set(args.currentSections.map(sectionKey));
  const terms = buildSlotExpansionTerms({
    slot: args.slot,
    fields: args.fields,
  });
  const hasDerivedFields = slotHasDerivedFields(args.slot, args.fields);
  return args.otherSections
    .filter((section) => !currentKeys.has(sectionKey(section)))
    .map((section, index) => {
      const trace: EvalDocCandidateTrace = {
        version_id: `${section.source}:${section.heading_path.join("/")}`,
        token_count: section.tokens ?? 0,
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
      }) +
        (fieldCoverageScore({ slot: args.slot, fields: args.fields, section }) * 0.72) +
        (hasDerivedFields ? derivedInputSignalScore(section) * 0.5 : 0) -
        (staleSectionPenalty(section) * 0.75);
      return { section, index, score };
    })
    .filter((entry) => entry.score >= (hasDerivedFields ? 0.28 : 0.18))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tokenDelta = (a.section.tokens ?? 0) - (b.section.tokens ?? 0);
      if (tokenDelta !== 0) return tokenDelta;
      return a.index - b.index;
    })
    .slice(0, args.crossSlotK)
    .map((entry) => entry.section);
}

const ABSENCE_SIGNAL_TERMS = [
  "absent",
  "exception",
  "gap",
  "hold",
  "missing",
  "no",
  "not",
  "open",
  "pending",
  "unconfirmed",
  "without",
];

function absenceSignalScore(section: RetrievedDocumentSection): number {
  const tokens = tokenSet(`${section.source} ${section.heading_path.join(" ")} ${section.text}`);
  let score = 0;
  for (const term of ABSENCE_SIGNAL_TERMS) {
    if (tokens.has(term)) score += 1;
  }
  const text = normalizeText(section.text);
  if (text.includes("not confirmed")) score += 2;
  if (text.includes("no document")) score += 2;
  if (text.includes("no record")) score += 2;
  if (text.includes("open item")) score += 1.5;
  if (text.includes("still pending")) score += 1.5;
  return score;
}

function selectAbsenceVerifierSections(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  currentSections: RetrievedDocumentSection[];
  importedChunks: DocChunk[];
  absenceVerifierK: number;
}): RetrievedDocumentSection[] {
  if (
    args.absenceVerifierK <= 0 ||
    args.slot.slot_kind !== "missing_check"
  ) {
    return [];
  }
  const currentKeys = new Set(args.currentSections.map(sectionKey));
  const terms = buildSlotExpansionTerms({
    slot: args.slot,
    fields: args.fields,
  });
  return args.importedChunks
    .map((chunk, index) => {
      const section = sectionFromChunk(chunk);
      const key = sectionKey(section);
      if (currentKeys.has(key)) return null;
      const absenceScore = absenceSignalScore(section);
      if (absenceScore <= 0) return null;
      const trace: EvalDocCandidateTrace = {
        version_id: chunk.version_id,
        token_count: chunk.token_count,
        final_score: 0,
        packing_score: 0,
        bm25_norm: 0,
        heading_match: 0,
      };
      const slotScore = slotCandidateExpansionScore({
        trace,
        section,
        terms,
        slot: args.slot,
        fields: args.fields,
      });
      return {
        section,
        index,
        score: slotScore + (absenceScore * 0.12),
      };
    })
    .filter((entry): entry is { section: RetrievedDocumentSection; index: number; score: number } => {
      return entry !== null && entry.score >= 0.24;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tokenDelta = (a.section.tokens ?? 0) - (b.section.tokens ?? 0);
      if (tokenDelta !== 0) return tokenDelta;
      return a.index - b.index;
    })
    .slice(0, args.absenceVerifierK)
    .map((entry) => entry.section);
}

const FACT_LIKE_HEADING_TERMS = [
  "account",
  "date",
  "dates",
  "details",
  "entry",
  "facts",
  "header",
  "identity",
  "line",
  "lines",
  "master",
  "profile",
  "record",
  "request",
  "schedule",
  "scope",
  "status",
  "summary",
];

const EXPECTED_PLACE_HEADING_TERMS = [
  "activity",
  "call",
  "clearing",
  "exception",
  "exceptions",
  "guidance",
  "history",
  "identity",
  "ledger",
  "note",
  "notes",
  "participant",
  "participants",
  "preference",
  "relationship",
  "scope",
  "statement",
  "status",
  "stakeholder",
  "stakeholders",
  "summary",
  "thread",
];

const PARTICIPANT_SLOT_TERMS = new Set([
  "approver",
  "approval",
  "buyer",
  "champion",
  "contact",
  "employee",
  "executive",
  "manager",
  "owner",
  "participant",
  "requester",
  "signer",
  "sponsor",
  "stakeholder",
  "vendor",
]);

const PARTICIPANT_HEADING_TERMS = new Set([
  "approver",
  "approval",
  "champion",
  "contact",
  "contacts",
  "employee",
  "manager",
  "owner",
  "owners",
  "participant",
  "participants",
  "signer",
  "sponsor",
  "stakeholder",
  "stakeholders",
  "vendor",
]);

function slotRoleHeadingScore(slot: ContextSlot, section: RetrievedDocumentSection): number {
  const headingTokens = tokenSet(`${section.source} ${section.heading_path.join(" ")}`);
  let score = 0;
  for (const term of ROLE_HINT_TERMS[slot.role]) {
    if (headingTokens.has(term)) score += 1;
  }
  for (const term of SLOT_KIND_HINT_TERMS[slot.slot_kind]) {
    if (headingTokens.has(term)) score += 0.75;
  }
  return score;
}

function participantHeadingScore(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  section: RetrievedDocumentSection;
}): number {
  const slotFieldIds = new Set(args.slot.fields);
  const slotTokens = tokenSet([
    args.slot.purpose,
    ...args.slot.queries,
    ...args.fields
      .filter((field) => slotFieldIds.has(field.id))
      .flatMap((field) => [field.id, field.label]),
  ].join(" "));
  if (![...PARTICIPANT_SLOT_TERMS].some((term) => slotTokens.has(term))) return 0;

  const headingTokens = tokenSet(args.section.heading_path.join(" "));
  let hits = 0;
  for (const term of PARTICIPANT_HEADING_TERMS) {
    if (headingTokens.has(term)) hits += 1;
  }
  return Math.min(2, hits);
}

function isRuleApplicationSlot(slot: ContextSlot): boolean {
  return (
    slot.role === "rules" ||
    slot.role === "constraints" ||
    slot.role === "exceptions"
  );
}

function factLikeHeadingScore(section: RetrievedDocumentSection): number {
  const headingTokens = tokenSet(`${section.source} ${section.heading_path.join(" ")}`);
  let score = 0;
  for (const term of FACT_LIKE_HEADING_TERMS) {
    if (headingTokens.has(term)) score += 1;
  }
  return score;
}

function expectedPlaceHeadingScore(section: RetrievedDocumentSection): number {
  const headingTokens = tokenSet(`${section.source} ${section.heading_path.join(" ")}`);
  let score = 0;
  for (const term of EXPECTED_PLACE_HEADING_TERMS) {
    if (headingTokens.has(term)) score += 1;
  }
  return score;
}

function staleSectionPenalty(section: RetrievedDocumentSection): number {
  const tokens = tokenSet(`${section.source} ${section.heading_path.join(" ")} ${section.text}`);
  let penalty = 0;
  for (const term of STALE_OR_NONCURRENT_TERMS) {
    if (tokens.has(term)) penalty += 0.55;
  }
  const text = normalizeText(`${section.heading_path.join(" ")} ${section.text}`);
  if (text.includes("template guidance")) penalty += 0.55;
  if (text.includes("not automatically part")) penalty += 0.55;
  if (text.includes("does not amend")) penalty += 0.55;
  if (text.includes("non binding") || text.includes("nonbinding")) penalty += 0.55;
  if (text.includes("for reference only")) penalty += 0.55;
  return penalty;
}

function applicationNeedBoost(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  section: RetrievedDocumentSection;
}): number {
  const slotText = [
    args.slot.purpose,
    ...args.slot.queries,
    ...args.fields
      .filter((field) => args.slot.fields.includes(field.id))
      .flatMap((field) => [field.id, field.label]),
  ].join(" ");
  const slotTokens = tokenSet(slotText);
  const sectionTokens = tokenSet(`${args.section.source} ${args.section.heading_path.join(" ")} ${args.section.text}`);
  let boost = 0;
  const needsEligibilityFacts = [
    "days",
    "date",
    "effective",
    "eligibility",
    "hours",
    "months",
    "period",
    "schedule",
    "tenure",
    "waiting",
  ].some((term) => slotTokens.has(term));
  if (
    needsEligibilityFacts &&
    ["class", "date", "dates", "hours", "schedule", "status"].some((term) => sectionTokens.has(term))
  ) {
    boost += 1.0;
  }
  const needsApprovalFacts = [
    "approval",
    "before",
    "control",
    "required",
    "requirement",
    "review",
  ].some((term) => slotTokens.has(term));
  if (
    needsApprovalFacts &&
    ["approval", "approved", "request", "status"].some((term) => sectionTokens.has(term))
  ) {
    boost += 0.45;
  }
  return boost;
}

function selectRuleApplicationSections(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  workflow: DocumentWorkflowCase;
  currentSections: RetrievedDocumentSection[];
  importedChunks: DocChunk[];
  siblingSections: RetrievedDocumentSection[];
  ruleApplicationK: number;
}): RetrievedDocumentSection[] {
  if (args.ruleApplicationK <= 0 || !isRuleApplicationSlot(args.slot)) return [];
  const currentKeys = new Set(args.currentSections.map(sectionKey));
  const slotTerms = buildSlotExpansionTerms({
    slot: args.slot,
    fields: args.fields,
  });
  const taskTerms = weightedTermsFromText(
    [
      args.workflow.title,
      args.workflow.prompt,
      ...args.workflow.task_variants,
    ].join(" "),
    1.1,
  );
  const taskIdTerms = taskTerms.filter((term) => /\d/.test(term.term));
  const siblingSourceCounts = new Map<string, number>();
  for (const section of args.siblingSections) {
    siblingSourceCounts.set(section.source, (siblingSourceCounts.get(section.source) ?? 0) + 1);
  }

  return args.importedChunks
    .map((chunk, index) => {
      const section = sectionFromChunk(chunk);
      if (currentKeys.has(sectionKey(section))) return null;
      const factScore = factLikeHeadingScore(section);
      if (factScore <= 0) return null;
      const haystack = `${section.source} ${section.heading_path.join(" ")} ${section.text}`;
      const tokens = tokenSet(haystack);
      const taskOverlap = countWeightedOverlap(taskTerms, tokens);
      const slotOverlap = countWeightedOverlap(slotTerms, tokens);
      const siblingSourceBoost = siblingSourceCounts.has(section.source) ? 0.9 : 0;
      const idOverlap = taskIdTerms.some((term) => tokens.has(term.term));
      if (taskIdTerms.length > 0 && !idOverlap && siblingSourceBoost === 0) return null;
      const numericOrStatusBoost = /(?:\d{4}|status|date|amount|hours|limit|approved|completed|received)/i.test(haystack)
        ? 0.4
        : 0;
      const prerequisiteBoost = applicationNeedBoost({
        slot: args.slot,
        fields: args.fields,
        section,
      });
      const score =
        (factScore * 0.28) +
        (taskOverlap * 0.17) +
        (slotOverlap * 0.07) +
        siblingSourceBoost +
        numericOrStatusBoost -
        staleSectionPenalty(section) +
        prerequisiteBoost;
      return { section, index, score };
    })
    .filter((entry): entry is { section: RetrievedDocumentSection; index: number; score: number } => {
      return entry !== null && entry.score >= 0.62;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tokenDelta = (a.section.tokens ?? 0) - (b.section.tokens ?? 0);
      if (tokenDelta !== 0) return tokenDelta;
      return a.index - b.index;
    })
    .slice(0, args.ruleApplicationK)
    .map((entry) => entry.section);
}

function sourceCounts(sections: RetrievedDocumentSection[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const section of sections) {
    counts.set(section.source, (counts.get(section.source) ?? 0) + 1);
  }
  return counts;
}

function selectExpectedPlaceSections(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  workflow: DocumentWorkflowCase;
  currentSections: RetrievedDocumentSection[];
  importedChunks: DocChunk[];
  siblingSections: RetrievedDocumentSection[];
  expectedPlaceK: number;
}): RetrievedDocumentSection[] {
  if (args.expectedPlaceK <= 0 || args.slot.slot_kind !== "missing_check") return [];
  const currentKeys = new Set(args.currentSections.map(sectionKey));
  const currentSourceCounts = sourceCounts(args.currentSections);
  const siblingSourceCounts = sourceCounts(args.siblingSections);
  const slotTerms = buildSlotExpansionTerms({
    slot: args.slot,
    fields: args.fields,
  });
  const taskTerms = weightedTermsFromText(
    [
      args.workflow.title,
      args.workflow.prompt,
      ...args.workflow.task_variants,
    ].join(" "),
    0.8,
  );
  const taskIdTerms = taskTerms.filter((term) => /\d/.test(term.term));
  const overlapScale = Math.sqrt(Math.max(1, slotTerms.length));

  const rankedEntries = args.importedChunks
    .map((chunk, index) => {
      const section = sectionFromChunk(chunk);
      if (currentKeys.has(sectionKey(section))) return null;
      if ((section.tokens ?? 0) <= 0 || section.text.trim().length === 0) return null;
      const headingScore = expectedPlaceHeadingScore(section);
      const factScore = factLikeHeadingScore(section);
      const absenceScore = absenceSignalScore(section);
      const participantScore = participantHeadingScore({
        slot: args.slot,
        fields: args.fields,
        section,
      });
      if (headingScore <= 0 && factScore <= 0 && absenceScore <= 0) return null;
      const headingText = `${section.source} ${section.heading_path.join(" ")}`;
      const bodyText = section.text;
      const haystack = `${headingText} ${bodyText}`;
      const headingTokens = tokenSet(headingText);
      const bodyTokens = tokenSet(bodyText);
      const allTokens = tokenSet(haystack);
      const sameCurrentSourceBoost = currentSourceCounts.has(section.source) ? 0.9 : 0;
      const siblingSourceBoost = sameCurrentSourceBoost === 0 && siblingSourceCounts.has(section.source) ? 0.58 : 0;
      const sourceBoost = sameCurrentSourceBoost + siblingSourceBoost;
      const headingOverlap = countWeightedOverlap(slotTerms, headingTokens);
      const bodyOverlap = countWeightedOverlap(slotTerms, bodyTokens);
      const slotFit = ((headingOverlap * 0.16) + (bodyOverlap * 0.05)) / overlapScale;
      const outsideSourceAllowed =
        sourceBoost === 0 &&
        absenceScore >= 1 &&
        (headingScore > 0 || participantScore > 0) &&
        (slotFit + (participantScore * 0.35) + (headingScore * 0.08)) >= 0.5 &&
        staleSectionPenalty(section) < 0.55;
      const idOverlap = taskIdTerms.some((term) => allTokens.has(term.term));
      if (taskIdTerms.length > 0 && !idOverlap && sameCurrentSourceBoost === 0 && !outsideSourceAllowed) {
        return null;
      }
      if (sourceBoost === 0 && !outsideSourceAllowed) return null;
      const taskOverlap = countWeightedOverlap(taskTerms, allTokens) / Math.sqrt(Math.max(1, taskTerms.length));
      const score =
        sourceBoost +
        (headingScore * 0.26) +
        (factScore * 0.12) +
        (absenceScore * 0.28) +
        (participantScore * 0.5) +
        slotFit +
        (taskOverlap * 0.06) -
        (staleSectionPenalty(section) * 0.45);
      return { section, index, score, outsideSourceAllowed };
    })
    .filter((entry): entry is {
      section: RetrievedDocumentSection;
      index: number;
      score: number;
      outsideSourceAllowed: boolean;
    } => {
      return entry !== null && entry.score >= 0.78;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tokenDelta = (a.section.tokens ?? 0) - (b.section.tokens ?? 0);
      if (tokenDelta !== 0) return tokenDelta;
      return a.index - b.index;
    });

  const selectedEntries: typeof rankedEntries = [];
  const outsideEntry = rankedEntries.find((entry) => entry.outsideSourceAllowed);
  if (outsideEntry) selectedEntries.push(outsideEntry);
  for (const entry of rankedEntries) {
    if (selectedEntries.length >= args.expectedPlaceK) break;
    if (selectedEntries.some((existing) => sectionKey(existing.section) === sectionKey(entry.section))) continue;
    selectedEntries.push(entry);
  }

  return selectedEntries.map((entry) => entry.section);
}

function pruningAuthorityPenalty(section: RetrievedDocumentSection): number {
  const text = normalizeText(`${section.source} ${section.heading_path.join(" ")} ${section.text}`)
    .replace(/[-_]/g, " ");
  let penalty = staleSectionPenalty(section);
  if (text.includes("non authoritative")) penalty += 0.9;
  if (text.includes("unsupported corpus clutter")) penalty += 0.9;
  if (text.includes("for reference only")) penalty += 0.6;
  return penalty;
}

function slotBudgetRetentionScore(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  section: RetrievedDocumentSection;
}): number {
  const fitScore = sectionFitScore({
    section: args.section,
    slot: args.slot,
    fields: args.fields,
  });
  const coverageScore = fieldCoverageScore({
    slot: args.slot,
    fields: args.fields,
    section: args.section,
  });
  const roleScore = slotRoleHeadingScore(args.slot, args.section);
  const headingScore = factLikeHeadingScore(args.section) + expectedPlaceHeadingScore(args.section);
  const absenceScore = args.slot.slot_kind === "missing_check" ? absenceSignalScore(args.section) : 0;
  const derivedScore = slotHasDerivedFields(args.slot, args.fields) ? derivedInputSignalScore(args.section) : 0;
  const authorityPenalty = pruningAuthorityPenalty(args.section);
  const authorityPenaltyWeight = args.slot.slot_kind === "missing_check" ? 0.35 : 0.75;
  return (
    (fitScore * 0.9) +
    (coverageScore * 1.05) +
    (roleScore * 0.18) +
    (headingScore * 0.05) +
    (absenceScore * 0.18) +
    (derivedScore * 0.18) -
    (authorityPenalty * authorityPenaltyWeight)
  );
}

function pruneSlotSectionsToBudget(args: {
  slot: ContextSlot;
  fields: DocumentWorkflowFieldGold[];
  sections: RetrievedDocumentSection[];
}): {
  sections: RetrievedDocumentSection[];
  prunedSections: RetrievedDocumentSection[];
} {
  const maxTokens = args.slot.max_tokens;
  if (maxTokens === undefined) {
    return { sections: args.sections, prunedSections: [] };
  }
  if (args.slot.slot_kind === "missing_check") {
    return { sections: args.sections, prunedSections: [] };
  }
  let retrievedTokens = args.sections.reduce((sum, section) => sum + (section.tokens ?? 0), 0);
  if (retrievedTokens <= maxTokens) {
    return { sections: args.sections, prunedSections: [] };
  }
  const keptKeys = new Set(args.sections.map(sectionKey));
  const candidates = args.sections
    .map((section, index) => {
      const tokens = section.tokens ?? 0;
      const authorityPenalty = pruningAuthorityPenalty(section);
      const retentionScore = slotBudgetRetentionScore({
        slot: args.slot,
        fields: args.fields,
        section,
      });
      return { section, index, tokens, authorityPenalty, retentionScore };
    })
    .sort((a, b) => {
      if (a.retentionScore !== b.retentionScore) return a.retentionScore - b.retentionScore;
      if (b.authorityPenalty !== a.authorityPenalty) return b.authorityPenalty - a.authorityPenalty;
      if (b.tokens !== a.tokens) return b.tokens - a.tokens;
      return b.index - a.index;
    });
  const prunedSections: RetrievedDocumentSection[] = [];
  for (const candidate of candidates) {
    if (retrievedTokens <= maxTokens) break;
    if (candidate.tokens <= 0) continue;
    const lowFitLargeSection =
      candidate.tokens >= Math.ceil(maxTokens * 0.2) &&
      candidate.retentionScore < 0.55;
    const lowAuthoritySection =
      candidate.authorityPenalty >= 0.9 &&
      candidate.retentionScore < 0.85;
    if (!lowFitLargeSection && !lowAuthoritySection) continue;
    keptKeys.delete(sectionKey(candidate.section));
    prunedSections.push(candidate.section);
    retrievedTokens -= candidate.tokens;
  }
  if (prunedSections.length === 0) {
    return { sections: args.sections, prunedSections: [] };
  }
  return {
    sections: args.sections.filter((section) => keptKeys.has(sectionKey(section))),
    prunedSections,
  };
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

function sourceDispositionForSection(args: {
  workflow: DocumentWorkflowCase;
  fields: DocumentWorkflowFieldGold[];
  slot: ContextSlot;
  section: RetrievedDocumentSection;
}): DocumentSourceDisposition {
  const evidenceFields = args.fields.filter((field) =>
    args.slot.fields.includes(field.id) &&
    (field.evidence ?? []).some((requirement) => sectionSatisfiesRequirement(args.section, requirement)),
  );
  const searchedScopeMatch = fieldSearchedScopeForSlot(args.fields, args.slot)
    .some((requirement) => sectionSatisfiesRequirement(args.section, requirement));
  const isDecoy = args.workflow.decoy_sources.includes(args.section.source);
  const heading = args.section.heading_path.join(" > ");
  if (isDecoy && searchedScopeMatch) {
    return {
      source: args.section.source,
      heading_path: args.section.heading_path,
      disposition: "excluded_non_authoritative",
      reason: `Declared decoy source; retrieved to prove non-authoritative or missing-context scope at ${heading}.`,
    };
  }
  if (isDecoy) {
    const stalePenalty = staleSectionPenalty(args.section);
    return {
      source: args.section.source,
      heading_path: args.section.heading_path,
      disposition: stalePenalty > 0 ? "stale_or_wrong_scope" : "excluded_non_authoritative",
      reason: stalePenalty > 0
        ? `Declared decoy source with stale/wrong-scope signals at ${heading}; do not cite as authority.`
        : `Declared decoy source at ${heading}; do not cite as authority unless explicitly rejecting it.`,
    };
  }
  if (evidenceFields.some((field) => field.expected_status === "conflicting")) {
    return {
      source: args.section.source,
      heading_path: args.section.heading_path,
      disposition: "contradictory",
      reason: `Evidence for a field expected to require conflict review at ${heading}.`,
    };
  }
  if (evidenceFields.length > 0) {
    return {
      source: args.section.source,
      heading_path: args.section.heading_path,
      disposition: "authoritative",
      reason: `Matches required evidence for ${evidenceFields.map((field) => field.id).join(", ")}.`,
    };
  }
  if (searchedScopeMatch) {
    return {
      source: args.section.source,
      heading_path: args.section.heading_path,
      disposition: "supporting",
      reason: `Matches searched-scope proof for a missing-context field at ${heading}.`,
    };
  }
  return {
    source: args.section.source,
    heading_path: args.section.heading_path,
    disposition: "supporting",
    reason: `Retrieved as supporting context for slot ${args.slot.id}.`,
  };
}

function sourceDispositionsForSlot(args: {
  workflow: DocumentWorkflowCase;
  fields: DocumentWorkflowFieldGold[];
  slot: ContextSlot;
  sections: RetrievedDocumentSection[];
}): DocumentSourceDisposition[] {
  return args.sections.map((section) => sourceDispositionForSection({
    workflow: args.workflow,
    fields: args.fields,
    slot: args.slot,
    section,
  }));
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
    if (slot.cross_slot_sections.length > 0) {
      lines.push(`Cross-slot sections: ${slot.cross_slot_sections.length}`);
    }
    if (slot.absence_verifier_sections.length > 0) {
      lines.push(`Absence verifier sections: ${slot.absence_verifier_sections.length}`);
    }
    if (slot.rule_application_sections.length > 0) {
      lines.push(`Rule-application sections: ${slot.rule_application_sections.length}`);
    }
    if (slot.expected_place_sections.length > 0) {
      lines.push(`Expected-place sections: ${slot.expected_place_sections.length}`);
    }
    if (slot.alias_status_sections.length > 0) {
      lines.push(`Alias/status sections: ${slot.alias_status_sections.length}`);
    }
    if (slot.source_local_completion_sections.length > 0) {
      lines.push(`Source-local completion sections: ${slot.source_local_completion_sections.length}`);
    }
    if (slot.near_miss_sections.length > 0) {
      lines.push(`Near-miss sections: ${slot.near_miss_sections.length}`);
    }
    if (slot.budget_pruned_sections.length > 0) {
      lines.push(`Budget-pruned sections: ${slot.budget_pruned_sections.length}`);
    }
    lines.push("");
    lines.push("Source disposition:");
    if (slot.source_dispositions.length === 0) {
      lines.push("- none");
    } else {
      for (const disposition of slot.source_dispositions) {
        lines.push(
          `- ${disposition.disposition}: ${disposition.source} > ${disposition.heading_path.join(" > ")} - ${disposition.reason}`,
        );
      }
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
    ...query.swept_candidates,
    ...query.rejected_candidates,
  ]);
}

function selectedSlotCandidates(slot: DocumentWorkflowSlotTrace): DocumentRetrievalCandidateTrace[] {
  return slot.queries.flatMap((query) => [
    ...query.selected_candidates,
    ...query.swept_candidates,
  ]);
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
  const crossSlotK = opts.crossSlotK ?? DEFAULT_CROSS_SLOT_K;
  const absenceVerifierK = opts.absenceVerifierK ?? DEFAULT_ABSENCE_VERIFIER_K;
  const ruleApplicationK = opts.ruleApplicationK ?? DEFAULT_RULE_APPLICATION_K;
  const expectedPlaceK = opts.expectedPlaceK ?? DEFAULT_EXPECTED_PLACE_K;
  const aliasStatusK = opts.aliasStatusK ?? DEFAULT_ALIAS_STATUS_K;
  const sourceLocalCompletionK = opts.sourceLocalCompletionK ?? DEFAULT_SOURCE_LOCAL_COMPLETION_K;
  const nearMissK = opts.nearMissK ?? DEFAULT_NEAR_MISS_K;
  const rejectedLimit = opts.rejectedLimit ?? 5;
  const traceDir = opts.traceDir ? resolve(opts.traceDir) : undefined;
  const outputsByWorkflow = new Map(
    opts.outputs
      ? opts.outputs.map((output) => [output.workflow_id, output])
      : opts.outputPath
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
        const slotTraceInputs: {
          slot: ContextSlot;
          retrievedSections: RetrievedDocumentSection[];
          crossSlotSections: RetrievedDocumentSection[];
          absenceVerifierSections: RetrievedDocumentSection[];
          ruleApplicationSections: RetrievedDocumentSection[];
          expectedPlaceSections: RetrievedDocumentSection[];
          aliasStatusSections: RetrievedDocumentSection[];
          sourceLocalCompletionSections: RetrievedDocumentSection[];
          nearMissSections: RetrievedDocumentSection[];
          budgetPrunedSections: RetrievedDocumentSection[];
          queries: DocumentWorkflowQueryTrace[];
        }[] = [];
        for (const slot of workflow.slots) {
          const slotSectionsByKey = new Map<string, RetrievedDocumentSection>();
          const aliasStatusSectionsByKey = new Map<string, RetrievedDocumentSection>();
          const nearMissSectionsByKey = new Map<string, RetrievedDocumentSection>();
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
            const aliasStatusSections = buildAliasStatusSections({
              rankedCandidatePool,
              selectedIds,
              chunksById,
              slot,
              fields: workflow.fields,
              aliasStatusK,
            });
            const nearMissSections = selectNearMissSections({
              rankedCandidatePool,
              selectedIds,
              chunksById,
              slot,
              fields: workflow.fields,
              nearMissK,
            });
            for (const trace of [...selectedDocTraces, ...sweptDocTraces]) {
              const chunk = chunksById.get(trace.version_id);
              if (!chunk) continue;
              const section = sectionFromChunk(chunk);
              slotSectionsByKey.set(sectionKey(section), section);
              workflowSectionsByKey.set(sectionKey(section), section);
            }
            for (const section of aliasStatusSections) {
              aliasStatusSectionsByKey.set(sectionKey(section), section);
            }
            for (const section of nearMissSections) {
              nearMissSectionsByKey.set(sectionKey(section), section);
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
          for (const section of aliasStatusSectionsByKey.values()) {
            slotSectionsByKey.set(sectionKey(section), section);
            workflowSectionsByKey.set(sectionKey(section), section);
          }
          for (const section of nearMissSectionsByKey.values()) {
            slotSectionsByKey.set(sectionKey(section), section);
            workflowSectionsByKey.set(sectionKey(section), section);
          }
          const retrievedSections = [...slotSectionsByKey.values()];
          const sourceLocalCompletionSections = selectSourceLocalCompletionSections({
            slot,
            fields: workflow.fields,
            currentSections: retrievedSections,
            importedChunks,
            sourceLocalCompletionK,
          });
          for (const section of sourceLocalCompletionSections) {
            slotSectionsByKey.set(sectionKey(section), section);
            workflowSectionsByKey.set(sectionKey(section), section);
          }
          slotTraceInputs.push({
            slot,
            retrievedSections: [...slotSectionsByKey.values()],
            crossSlotSections: [],
            absenceVerifierSections: [],
            ruleApplicationSections: [],
            expectedPlaceSections: [],
            aliasStatusSections: [...aliasStatusSectionsByKey.values()],
            sourceLocalCompletionSections,
            nearMissSections: [...nearMissSectionsByKey.values()],
            budgetPrunedSections: [],
            queries: queryTraces,
          });
        }
        const originalSlotSections = new Map(
          slotTraceInputs.map((entry) => [entry.slot.id, entry.retrievedSections]),
        );
        for (const entry of slotTraceInputs) {
          const otherSectionsByKey = new Map<string, RetrievedDocumentSection>();
          for (const [slotId, sections] of originalSlotSections) {
            if (slotId === entry.slot.id) continue;
            for (const section of sections) otherSectionsByKey.set(sectionKey(section), section);
          }
          const crossSlotSections = selectCrossSlotSections({
            slot: entry.slot,
            fields: workflow.fields,
            currentSections: entry.retrievedSections,
            otherSections: [...otherSectionsByKey.values()],
            crossSlotK,
          });
          if (crossSlotSections.length === 0) continue;
          const mergedByKey = new Map(entry.retrievedSections.map((section) => [sectionKey(section), section]));
          for (const section of crossSlotSections) {
            mergedByKey.set(sectionKey(section), section);
            workflowSectionsByKey.set(sectionKey(section), section);
          }
          entry.retrievedSections = [...mergedByKey.values()];
          entry.crossSlotSections = crossSlotSections;
        }
        for (const entry of slotTraceInputs) {
          const siblingSections = [...originalSlotSections.entries()]
            .filter(([slotId]) => slotId !== entry.slot.id)
            .flatMap(([, sections]) => sections);
          const ruleApplicationSections = selectRuleApplicationSections({
            slot: entry.slot,
            fields: workflow.fields,
            workflow,
            currentSections: entry.retrievedSections,
            importedChunks,
            siblingSections,
            ruleApplicationK,
          });
          if (ruleApplicationSections.length === 0) continue;
          const mergedByKey = new Map(entry.retrievedSections.map((section) => [sectionKey(section), section]));
          for (const section of ruleApplicationSections) {
            mergedByKey.set(sectionKey(section), section);
            workflowSectionsByKey.set(sectionKey(section), section);
          }
          entry.retrievedSections = [...mergedByKey.values()];
          entry.ruleApplicationSections = ruleApplicationSections;
          const followupSourceLocalSections = selectSourceLocalCompletionSections({
            slot: entry.slot,
            fields: workflow.fields,
            currentSections: entry.retrievedSections,
            importedChunks,
            sourceLocalCompletionK,
            sourceFilter: new Set(ruleApplicationSections.map((section) => section.source)),
          });
          for (const section of followupSourceLocalSections) {
            mergedByKey.set(sectionKey(section), section);
            workflowSectionsByKey.set(sectionKey(section), section);
          }
          if (followupSourceLocalSections.length > 0) {
            entry.retrievedSections = [...mergedByKey.values()];
            entry.sourceLocalCompletionSections = [
              ...entry.sourceLocalCompletionSections,
              ...followupSourceLocalSections,
            ];
          }
        }
        for (const entry of slotTraceInputs) {
          const absenceVerifierSections = selectAbsenceVerifierSections({
            slot: entry.slot,
            fields: workflow.fields,
            currentSections: entry.retrievedSections,
            importedChunks,
            absenceVerifierK,
          });
          if (absenceVerifierSections.length === 0) continue;
          const mergedByKey = new Map(entry.retrievedSections.map((section) => [sectionKey(section), section]));
          for (const section of absenceVerifierSections) {
            mergedByKey.set(sectionKey(section), section);
            workflowSectionsByKey.set(sectionKey(section), section);
          }
          entry.retrievedSections = [...mergedByKey.values()];
          entry.absenceVerifierSections = absenceVerifierSections;
        }
        for (const entry of slotTraceInputs) {
          const siblingSections = [...originalSlotSections.entries()]
            .filter(([slotId]) => slotId !== entry.slot.id)
            .flatMap(([, sections]) => sections);
          const expectedPlaceSections = selectExpectedPlaceSections({
            slot: entry.slot,
            fields: workflow.fields,
            workflow,
            currentSections: entry.retrievedSections,
            importedChunks,
            siblingSections,
            expectedPlaceK,
          });
          if (expectedPlaceSections.length === 0) continue;
          const mergedByKey = new Map(entry.retrievedSections.map((section) => [sectionKey(section), section]));
          for (const section of expectedPlaceSections) {
            mergedByKey.set(sectionKey(section), section);
            workflowSectionsByKey.set(sectionKey(section), section);
          }
          entry.retrievedSections = [...mergedByKey.values()];
          entry.expectedPlaceSections = expectedPlaceSections;
        }
        for (const entry of slotTraceInputs) {
          const pruned = pruneSlotSectionsToBudget({
            slot: entry.slot,
            fields: workflow.fields,
            sections: entry.retrievedSections,
          });
          if (pruned.prunedSections.length === 0) continue;
          entry.retrievedSections = pruned.sections;
          entry.budgetPrunedSections = pruned.prunedSections;
        }
        workflowSectionsByKey.clear();
        for (const entry of slotTraceInputs) {
          for (const section of entry.retrievedSections) {
            workflowSectionsByKey.set(sectionKey(section), section);
          }
        }
        const slotSections = slotTraceInputs.map((entry) => ({
          slotId: entry.slot.id,
          retrievedSections: entry.retrievedSections,
        }));
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
              cross_slot_sections: entry.crossSlotSections,
              absence_verifier_sections: entry.absenceVerifierSections,
              rule_application_sections: entry.ruleApplicationSections,
              expected_place_sections: entry.expectedPlaceSections,
              alias_status_sections: entry.aliasStatusSections,
              source_local_completion_sections: entry.sourceLocalCompletionSections,
              near_miss_sections: entry.nearMissSections,
              budget_pruned_sections: entry.budgetPrunedSections,
              source_dispositions: sourceDispositionsForSlot({
                workflow,
                fields: workflow.fields,
                slot: entry.slot,
                sections: entry.retrievedSections,
              }),
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
        crossSlotK,
        absenceVerifierK,
        ruleApplicationK,
        expectedPlaceK,
        aliasStatusK,
        sourceLocalCompletionK,
        nearMissK,
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
    `${s.workflows} workflows, ${s.taskVariants} task variants, ${s.slots} slots, ${s.fields} fields, ${s.queries} queries, top-${report.topK} per query from candidate pool ${report.candidatePoolK}, source sweep ${report.sourceSweepK}, cross-slot ${report.crossSlotK}, absence verifier ${report.absenceVerifierK}, rule application ${report.ruleApplicationK}, expected place ${report.expectedPlaceK}, alias/status ${report.aliasStatusK}, source-local ${report.sourceLocalCompletionK}, near-miss ${report.nearMissK}`,
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
      "Extracted value accuracy",
      `${s.extractedAccuracyHits}/${s.extractedAccuracyTotal} (${pct(s.extractedAccuracyHits, s.extractedAccuracyTotal)})`,
    ],
    [
      "Computed value accuracy",
      `${s.computedAccuracyHits}/${s.computedAccuracyTotal} (${pct(s.computedAccuracyHits, s.computedAccuracyTotal)})`,
    ],
    [
      "Judgment value accuracy",
      `${s.judgmentAccuracyHits}/${s.judgmentAccuracyTotal} (${pct(s.judgmentAccuracyHits, s.judgmentAccuracyTotal)})`,
    ],
    [
      "Computed grounding",
      `${s.computedGroundingHits}/${s.computedGroundingTotal} (${pct(s.computedGroundingHits, s.computedGroundingTotal)})`,
    ],
    [
      "Judgment grounding",
      `${s.judgmentGroundingHits}/${s.judgmentGroundingTotal} (${pct(s.judgmentGroundingHits, s.judgmentGroundingTotal)})`,
    ],
    [
      "Citation validity",
      `${s.citationValidityHits}/${s.citationValidityTotal} (${pct(s.citationValidityHits, s.citationValidityTotal)})`,
    ],
    [
      "Citation authority",
      `${s.citationAuthorityHits}/${s.citationAuthorityTotal} (${pct(s.citationAuthorityHits, s.citationAuthorityTotal)})`,
    ],
    [
      "Review explanation",
      `${s.reviewExplanationHits}/${s.reviewExplanationTotal} (${pct(s.reviewExplanationHits, s.reviewExplanationTotal)})`,
    ],
    [
      "Decoy output use",
      `${s.decoyAuthorityMisuses} misuse fields; ${s.decoyAuthorityCitationTotal} authority citations; ${s.decoyRejectedCitationTotal} rejected citations across ${s.decoyOutputFields} output fields`,
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
    const crossSlotK = /^--cross-slot-k=(\d+)$/.exec(arg);
    if (crossSlotK) {
      const parsed = Number.parseInt(crossSlotK[1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.crossSlotK = parsed;
    }
    const absenceVerifierK = /^--absence-verifier-k=(\d+)$/.exec(arg);
    if (absenceVerifierK) {
      const parsed = Number.parseInt(absenceVerifierK[1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.absenceVerifierK = parsed;
    }
    const ruleApplicationK = /^--rule-application-k=(\d+)$/.exec(arg);
    if (ruleApplicationK) {
      const parsed = Number.parseInt(ruleApplicationK[1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.ruleApplicationK = parsed;
    }
    const expectedPlaceK = /^--expected-place-k=(\d+)$/.exec(arg);
    if (expectedPlaceK) {
      const parsed = Number.parseInt(expectedPlaceK[1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.expectedPlaceK = parsed;
    }
    const aliasStatusK = /^--alias-status-k=(\d+)$/.exec(arg);
    if (aliasStatusK) {
      const parsed = Number.parseInt(aliasStatusK[1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.aliasStatusK = parsed;
    }
    const sourceLocalCompletionK = /^--source-local-completion-k=(\d+)$/.exec(arg);
    if (sourceLocalCompletionK) {
      const parsed = Number.parseInt(sourceLocalCompletionK[1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.sourceLocalCompletionK = parsed;
    }
    const nearMissK = /^--near-miss-k=(\d+)$/.exec(arg);
    if (nearMissK) {
      const parsed = Number.parseInt(nearMissK[1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.nearMissK = parsed;
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
    crossSlotK: args.crossSlotK,
    absenceVerifierK: args.absenceVerifierK,
    ruleApplicationK: args.ruleApplicationK,
    expectedPlaceK: args.expectedPlaceK,
    aliasStatusK: args.aliasStatusK,
    sourceLocalCompletionK: args.sourceLocalCompletionK,
    nearMissK: args.nearMissK,
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
