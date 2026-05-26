import type { PackReadinessState } from "./eval-readiness.js";
import type { PackReadinessReasonCode } from "./pack-verifier.js";
import type { RecoveryPlan } from "./recovery-plan.js";
import type { TaskNeed } from "./task-need.js";
import {
  assessDocumentWorkflowPackReadiness,
  assessDocumentWorkflowSlotReadiness,
  type DocumentAdequateSearch,
  type DocumentPackReadiness,
  type DocumentRecoveryAction,
  type DocumentRetrievalConfidence,
  type DocumentSlotReadiness,
  type DocumentWorkflowSlotReadiness,
} from "./workflow-readiness.js";

export type RuntimeTaskReadinessSlot = {
  slot_id: string;
  role: string;
  required: boolean;
  task_critical: boolean;
  retrieval_confidence: DocumentRetrievalConfidence;
  adequate_search: DocumentAdequateSearch;
  slot_readiness: DocumentSlotReadiness;
  recovery_action: DocumentRecoveryAction;
  found_fields: string[];
  missing_fields: string[];
  reasons: string[];
  suggested_retry?: {
    queries: string[];
  };
};

export type RuntimeTaskReadiness = {
  pack_readiness: DocumentPackReadiness;
  recovery_action: DocumentRecoveryAction;
  blocking_slots: string[];
  partial_slots: string[];
  retry_slots: string[];
  missing_context_findings: string[];
  reasons: string[];
  slots: RuntimeTaskReadinessSlot[];
};

export type RuntimeTaskReadinessInput = {
  task: string;
  has_sources: boolean;
  coverage_confidence: "confident" | "uncertain" | "empty";
  legacy_pack_readiness: PackReadinessState;
  legacy_reason_codes: PackReadinessReasonCode[];
  missing_needs: TaskNeed[];
  satisfied_needs: TaskNeed[];
  warnings: string[];
  ranked_count: number;
  locked_count: number;
  recovery_plan?: RecoveryPlan;
};

export function buildRuntimeTaskReadiness(input: RuntimeTaskReadinessInput): RuntimeTaskReadiness {
  const retrievedSectionCount = input.ranked_count + input.locked_count;
  const blocked = isBlocked(input);
  const ready = input.coverage_confidence === "confident" && input.legacy_pack_readiness === "ready";
  const support = evidenceSupportFor(input, ready, retrievedSectionCount);
  const slot = blocked
    ? blockedSlot(input)
    : assessDocumentWorkflowSlotReadiness({
        slotId: "context_pack",
        required: true,
        taskCritical: true,
        slotKind: "evidence",
        role: "evidence",
        queryCount: 1,
        retrievedSectionCount,
        evidenceTotal: support.total,
        evidenceRetrieved: support.retrieved,
        searchedScopeTotal: 0,
        searchedScopeRetrieved: 0,
        missingFieldIds: ready ? [] : missingFieldsFor(input),
        retryQueries: retryQueriesFor(input),
      });
  const pack = blocked
    ? {
        packReadiness: "blocked" as const,
        recoveryAction: "ask_user" as const,
        blockingSlots: ["context_pack"],
        partialSlots: [],
        retrySlots: [],
        missingContextFindings: [],
        reasons: ["required_slot_blocked"],
      }
    : assessDocumentWorkflowPackReadiness([{
        slotId: slot.slotId,
        required: slot.required,
        taskCritical: slot.taskCritical,
        slotReadiness: slot.slotReadiness,
        recoveryAction: slot.recoveryAction,
        missingContextFinding: slot.missingContextFinding,
      }]);

  return {
    pack_readiness: pack.packReadiness,
    recovery_action: pack.recoveryAction,
    blocking_slots: pack.blockingSlots,
    partial_slots: pack.partialSlots,
    retry_slots: pack.retrySlots,
    missing_context_findings: pack.missingContextFindings,
    reasons: uniqueStrings([
      ...pack.reasons,
      ...slot.reasons,
      ...input.legacy_reason_codes,
      ...input.warnings,
    ]),
    slots: [slotToWire(slot, input)],
  };
}

function isBlocked(input: RuntimeTaskReadinessInput): boolean {
  return !input.has_sources ||
    input.legacy_pack_readiness === "needs_anchors" ||
    input.warnings.includes("anchors_unrecognized");
}

function evidenceSupportFor(
  input: RuntimeTaskReadinessInput,
  ready: boolean,
  retrievedSectionCount: number,
): { total: number; retrieved: number } {
  if (ready) return { total: 1, retrieved: 1 };
  if (retrievedSectionCount > 0 && input.coverage_confidence !== "empty") {
    return { total: 2, retrieved: 1 };
  }
  return { total: 1, retrieved: 0 };
}

function blockedSlot(input: RuntimeTaskReadinessInput): DocumentWorkflowSlotReadiness {
  const retrievedSectionCount = input.ranked_count + input.locked_count;
  return {
    slotId: "context_pack",
    required: true,
    taskCritical: true,
    retrievalConfidence: retrievedSectionCount === 0 ? "empty" : "weak",
    adequateSearch: "insufficient",
    slotReadiness: "blocked",
    recoveryAction: "ask_user",
    missingContextFinding: false,
    reasons: uniqueStrings([
      retrievedSectionCount === 0 ? "retrieval_empty" : "retrieval_weak",
      !input.has_sources ? "required_source_type_unavailable" : "required_evidence_missing",
    ]) as DocumentWorkflowSlotReadiness["reasons"],
    suggestedRetry: { queries: retryQueriesFor(input) },
  };
}

function slotToWire(
  slot: DocumentWorkflowSlotReadiness,
  input: RuntimeTaskReadinessInput,
): RuntimeTaskReadinessSlot {
  return {
    slot_id: slot.slotId,
    role: "evidence",
    required: slot.required,
    task_critical: slot.taskCritical,
    retrieval_confidence: slot.retrievalConfidence,
    adequate_search: slot.adequateSearch,
    slot_readiness: slot.slotReadiness,
    recovery_action: slot.recoveryAction,
    found_fields: input.satisfied_needs,
    missing_fields: input.missing_needs.length > 0 ? input.missing_needs : slot.suggestedRetry ? ["context_pack"] : [],
    reasons: uniqueStrings([...slot.reasons, ...input.legacy_reason_codes, ...input.warnings]),
    ...(slot.suggestedRetry ? { suggested_retry: slot.suggestedRetry } : {}),
  };
}

function missingFieldsFor(input: RuntimeTaskReadinessInput): string[] {
  if (input.missing_needs.length > 0) return input.missing_needs;
  if (input.coverage_confidence === "empty") return ["evidence"];
  if (input.coverage_confidence === "uncertain") return ["coverage"];
  if (input.legacy_pack_readiness !== "ready") return ["context_pack"];
  return [];
}

function retryQueriesFor(input: RuntimeTaskReadinessInput): string[] {
  const searches = input.recovery_plan?.follow_up_searches ?? [];
  return searches.length > 0 ? searches : [input.task];
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
