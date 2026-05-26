export const DOCUMENT_RETRIEVAL_CONFIDENCE = [
  "confident",
  "uncertain",
  "weak",
  "empty",
] as const;
export type DocumentRetrievalConfidence = (typeof DOCUMENT_RETRIEVAL_CONFIDENCE)[number];

export const DOCUMENT_ADEQUATE_SEARCH = [
  "adequate",
  "partial",
  "insufficient",
  "not_applicable",
] as const;
export type DocumentAdequateSearch = (typeof DOCUMENT_ADEQUATE_SEARCH)[number];

export const DOCUMENT_SLOT_READINESS = [
  "ready",
  "partial",
  "retry_required",
  "blocked",
] as const;
export type DocumentSlotReadiness = (typeof DOCUMENT_SLOT_READINESS)[number];

export const DOCUMENT_PACK_READINESS = [
  "ready",
  "partial",
  "retry_required",
  "blocked",
] as const;
export type DocumentPackReadiness = (typeof DOCUMENT_PACK_READINESS)[number];

export const DOCUMENT_RECOVERY_ACTIONS = [
  "answer",
  "answer_with_caveat",
  "retry_slot",
  "ask_user",
  "abstain",
] as const;
export type DocumentRecoveryAction = (typeof DOCUMENT_RECOVERY_ACTIONS)[number];

export type DocumentSlotReadinessReason =
  | "all_required_support_found"
  | "missing_context_supported_by_searched_scope"
  | "missing_context_supported_by_source_type_search"
  | "missing_context_search_unverified"
  | "optional_slot_incomplete"
  | "required_evidence_missing"
  | "required_source_type_unavailable"
  | "searched_scope_incomplete"
  | "source_type_search_incomplete"
  | "retrieval_empty"
  | "retrieval_weak";

export type DocumentWorkflowSlotReadinessInput = {
  slotId: string;
  required: boolean;
  taskCritical?: boolean;
  slotKind: string;
  role: string;
  queryCount: number;
  retrievedSectionCount: number;
  evidenceTotal: number;
  evidenceRetrieved: number;
  searchedScopeTotal: number;
  searchedScopeRetrieved: number;
  expectedSourceTypes?: string[];
  availableSourceTypes?: string[];
  searchedSourceTypes?: string[];
  missingFieldIds: string[];
  retryQueries: string[];
};

export type DocumentWorkflowSlotReadiness = {
  slotId: string;
  required: boolean;
  taskCritical: boolean;
  retrievalConfidence: DocumentRetrievalConfidence;
  adequateSearch: DocumentAdequateSearch;
  slotReadiness: DocumentSlotReadiness;
  recoveryAction: DocumentRecoveryAction;
  missingContextFinding: boolean;
  reasons: DocumentSlotReadinessReason[];
  suggestedRetry?: {
    queries: string[];
  };
};

export type DocumentPackReadinessInput = {
  slotId: string;
  required: boolean;
  taskCritical: boolean;
  slotReadiness: DocumentSlotReadiness;
  recoveryAction: DocumentRecoveryAction;
  missingContextFinding: boolean;
};

export type DocumentWorkflowPackReadiness = {
  packReadiness: DocumentPackReadiness;
  recoveryAction: DocumentRecoveryAction;
  blockingSlots: string[];
  partialSlots: string[];
  retrySlots: string[];
  missingContextFindings: string[];
  reasons: string[];
};

export function assessDocumentWorkflowSlotReadiness(
  input: DocumentWorkflowSlotReadinessInput,
): DocumentWorkflowSlotReadiness {
  const taskCritical = input.taskCritical ?? input.required;
  const evidenceComplete = input.evidenceRetrieved >= input.evidenceTotal;
  const searchedScopeComplete = input.searchedScopeRetrieved >= input.searchedScopeTotal;
  const adequateSearch = adequateSearchFor(input);
  const isMissingContextSlot = input.slotKind === "missing_check" || input.role === "missing_context";
  const hasExpectedSourceTypes = (input.expectedSourceTypes?.length ?? 0) > 0;
  const unavailableExpectedSourceTypes = unavailableSourceTypesFor(input);
  const sourceTypeUnavailable = unavailableExpectedSourceTypes.length > 0;
  const sourceTypeSearchComplete = !hasExpectedSourceTypes || adequateSearch === "adequate";
  const sourceTypeSearchSatisfied =
    hasExpectedSourceTypes && adequateSearch === "adequate";
  const searchedScopeSatisfied = input.searchedScopeTotal > 0 && searchedScopeComplete;
  const absenceOnlyMissingContextSlot = isMissingContextSlot && input.evidenceTotal === 0;
  const missingContextFinding =
    isMissingContextSlot &&
    sourceTypeSearchComplete &&
    (searchedScopeSatisfied || sourceTypeSearchSatisfied);
  const complete =
    evidenceComplete &&
    sourceTypeSearchComplete &&
    (absenceOnlyMissingContextSlot ? missingContextFinding : searchedScopeComplete);
  const retrievalConfidence = retrievalConfidenceFor({ ...input, complete });
  const reasons: DocumentSlotReadinessReason[] = [];

  if (input.retrievedSectionCount === 0) reasons.push("retrieval_empty");
  if (retrievalConfidence === "weak") reasons.push("retrieval_weak");
  if (!evidenceComplete) reasons.push("required_evidence_missing");
  if (sourceTypeUnavailable) reasons.push("required_source_type_unavailable");
  if (!searchedScopeComplete) reasons.push("searched_scope_incomplete");
  if (hasExpectedSourceTypes && adequateSearch !== "adequate") {
    reasons.push("source_type_search_incomplete");
  }
  if (missingContextFinding && input.searchedScopeTotal > 0) {
    reasons.push("missing_context_supported_by_searched_scope");
  }
  if (missingContextFinding && sourceTypeSearchSatisfied) {
    reasons.push("missing_context_supported_by_source_type_search");
  }
  if (absenceOnlyMissingContextSlot && !missingContextFinding) {
    reasons.push("missing_context_search_unverified");
  }
  if (complete) reasons.push("all_required_support_found");

  if (complete) {
    return {
      slotId: input.slotId,
      required: input.required,
      taskCritical,
      retrievalConfidence,
      adequateSearch,
      slotReadiness: "ready",
      recoveryAction: "answer",
      missingContextFinding,
      reasons,
    };
  }

  if (input.required && sourceTypeUnavailable) {
    return {
      slotId: input.slotId,
      required: input.required,
      taskCritical,
      retrievalConfidence,
      adequateSearch,
      slotReadiness: "blocked",
      recoveryAction: "ask_user",
      missingContextFinding: false,
      reasons,
    };
  }

  if (!input.required) {
    return {
      slotId: input.slotId,
      required: input.required,
      taskCritical,
      retrievalConfidence,
      adequateSearch,
      slotReadiness: "partial",
      recoveryAction: "answer_with_caveat",
      missingContextFinding: false,
      reasons: reasons.length > 0 ? reasons : ["optional_slot_incomplete"],
      suggestedRetry: { queries: input.retryQueries },
    };
  }

  return {
    slotId: input.slotId,
    required: input.required,
    taskCritical,
    retrievalConfidence,
    adequateSearch,
    slotReadiness: taskCritical ? "retry_required" : "partial",
    recoveryAction: taskCritical ? "retry_slot" : "answer_with_caveat",
    missingContextFinding: false,
    reasons,
    suggestedRetry: { queries: input.retryQueries },
  };
}

export function assessDocumentWorkflowPackReadiness(
  slots: DocumentPackReadinessInput[],
): DocumentWorkflowPackReadiness {
  const blockingSlots = slots
    .filter((slot) => slot.required && slot.taskCritical && slot.slotReadiness === "blocked")
    .map((slot) => slot.slotId);
  const retrySlots = slots
    .filter((slot) =>
      slot.required &&
      slot.taskCritical &&
      (slot.slotReadiness === "retry_required" || slot.slotReadiness === "partial")
    )
    .map((slot) => slot.slotId);
  const partialSlots = slots
    .filter((slot) => slot.slotReadiness === "partial")
    .map((slot) => slot.slotId);
  const missingContextFindings = slots
    .filter((slot) => slot.missingContextFinding)
    .map((slot) => slot.slotId);

  if (blockingSlots.length > 0) {
    return {
      packReadiness: "blocked",
      recoveryAction: "ask_user",
      blockingSlots,
      partialSlots,
      retrySlots,
      missingContextFindings,
      reasons: ["required_slot_blocked"],
    };
  }
  if (retrySlots.length > 0) {
    return {
      packReadiness: "retry_required",
      recoveryAction: "retry_slot",
      blockingSlots,
      partialSlots,
      retrySlots,
      missingContextFindings,
      reasons: ["required_slot_retry_required"],
    };
  }
  if (partialSlots.length > 0) {
    return {
      packReadiness: "partial",
      recoveryAction: "answer_with_caveat",
      blockingSlots,
      partialSlots,
      retrySlots,
      missingContextFindings,
      reasons: ["non_critical_slot_partial"],
    };
  }
  return {
    packReadiness: "ready",
    recoveryAction: "answer",
    blockingSlots,
    partialSlots,
    retrySlots,
    missingContextFindings,
    reasons: ["all_task_critical_required_slots_ready"],
  };
}

function unavailableSourceTypesFor(input: DocumentWorkflowSlotReadinessInput): string[] {
  if ((input.expectedSourceTypes?.length ?? 0) === 0 || input.availableSourceTypes === undefined) return [];
  const available = new Set(input.availableSourceTypes);
  return input.expectedSourceTypes!.filter((sourceType) => !available.has(sourceType));
}

function adequateSearchFor(input: DocumentWorkflowSlotReadinessInput): DocumentAdequateSearch {
  if ((input.expectedSourceTypes?.length ?? 0) > 0) {
    const searched = new Set(input.searchedSourceTypes ?? []);
    const expected = input.expectedSourceTypes ?? [];
    const matched = expected.filter((sourceType) => searched.has(sourceType)).length;
    if (matched === expected.length) return "adequate";
    if (matched > 0) return "partial";
    return "insufficient";
  }
  if (input.searchedScopeTotal === 0) return "not_applicable";
  if (input.searchedScopeRetrieved >= input.searchedScopeTotal) return "adequate";
  if (input.searchedScopeRetrieved > 0) return "partial";
  return "insufficient";
}

function retrievalConfidenceFor(
  input: DocumentWorkflowSlotReadinessInput & { complete: boolean },
): DocumentRetrievalConfidence {
  if (input.retrievedSectionCount === 0) return "empty";
  if (input.complete) return "confident";
  if (input.evidenceRetrieved > 0 || input.searchedScopeRetrieved > 0) return "uncertain";
  return "weak";
}
