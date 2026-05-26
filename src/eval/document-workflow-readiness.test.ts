import { describe, expect, it } from "vitest";
import {
  assessDocumentWorkflowPackReadiness,
  assessDocumentWorkflowSlotReadiness,
} from "./document-workflow-readiness.js";

describe("document workflow slot readiness", () => {
  it("marks a required slot ready when all required evidence and searched-scope proof is found", () => {
    const readiness = assessDocumentWorkflowSlotReadiness({
      slotId: "invoice_amounts",
      required: true,
      taskCritical: true,
      slotKind: "evidence",
      role: "evidence",
      queryCount: 1,
      retrievedSectionCount: 2,
      evidenceTotal: 2,
      evidenceRetrieved: 2,
      searchedScopeTotal: 1,
      searchedScopeRetrieved: 1,
      missingFieldIds: [],
      retryQueries: ["invoice total credit memo amount"],
    });

    expect(readiness).toMatchObject({
      retrievalConfidence: "confident",
      adequateSearch: "adequate",
      slotReadiness: "ready",
      recoveryAction: "answer",
    });
    expect(readiness.reasons).toContain("all_required_support_found");
  });

  it("treats missing context as ready when searched-scope proof is adequate", () => {
    const readiness = assessDocumentWorkflowSlotReadiness({
      slotId: "approval_gap",
      required: true,
      taskCritical: true,
      slotKind: "missing_check",
      role: "missing_context",
      queryCount: 1,
      retrievedSectionCount: 2,
      evidenceTotal: 0,
      evidenceRetrieved: 0,
      searchedScopeTotal: 2,
      searchedScopeRetrieved: 2,
      missingFieldIds: [],
      retryQueries: ["signed approval form exception notes"],
    });

    expect(readiness).toMatchObject({
      adequateSearch: "adequate",
      slotReadiness: "ready",
      recoveryAction: "answer",
      missingContextFinding: true,
    });
    expect(readiness.reasons).toContain("missing_context_supported_by_searched_scope");
  });

  it("treats missing context as ready when expected source types were searched", () => {
    const readiness = assessDocumentWorkflowSlotReadiness({
      slotId: "damage_cause_confirmation",
      required: true,
      taskCritical: true,
      slotKind: "missing_check",
      role: "missing_context",
      queryCount: 1,
      retrievedSectionCount: 2,
      evidenceTotal: 0,
      evidenceRetrieved: 0,
      searchedScopeTotal: 0,
      searchedScopeRetrieved: 0,
      expectedSourceTypes: ["adjuster_report", "inspection_report"],
      searchedSourceTypes: ["adjuster_report", "inspection_report"],
      missingFieldIds: [],
      retryQueries: ["adjuster confirmed cause inspection report"],
    });

    expect(readiness).toMatchObject({
      adequateSearch: "adequate",
      slotReadiness: "ready",
      recoveryAction: "answer",
      missingContextFinding: true,
    });
  });

  it("requires retry when required evidence is missing and search support is weak", () => {
    const readiness = assessDocumentWorkflowSlotReadiness({
      slotId: "damage_cause",
      required: true,
      taskCritical: true,
      slotKind: "evidence",
      role: "current_state",
      queryCount: 1,
      retrievedSectionCount: 1,
      evidenceTotal: 2,
      evidenceRetrieved: 0,
      searchedScopeTotal: 1,
      searchedScopeRetrieved: 0,
      missingFieldIds: ["cause_confirmation"],
      retryQueries: ["inspection report confirmed cause of damage"],
    });

    expect(readiness).toMatchObject({
      retrievalConfidence: "weak",
      adequateSearch: "insufficient",
      slotReadiness: "retry_required",
      recoveryAction: "retry_slot",
      suggestedRetry: { queries: ["inspection report confirmed cause of damage"] },
    });
    expect(readiness.reasons).toContain("required_evidence_missing");
    expect(readiness.reasons).toContain("searched_scope_incomplete");
  });

  it("requires retry when expected source-type search is only partial", () => {
    const readiness = assessDocumentWorkflowSlotReadiness({
      slotId: "forms_gap",
      required: true,
      taskCritical: true,
      slotKind: "missing_check",
      role: "missing_context",
      queryCount: 1,
      retrievedSectionCount: 1,
      evidenceTotal: 0,
      evidenceRetrieved: 0,
      searchedScopeTotal: 0,
      searchedScopeRetrieved: 0,
      expectedSourceTypes: ["employee_record", "signed_forms_packet"],
      searchedSourceTypes: ["employee_record"],
      missingFieldIds: [],
      retryQueries: ["signed forms packet benefits waiver"],
    });

    expect(readiness).toMatchObject({
      adequateSearch: "partial",
      slotReadiness: "retry_required",
      recoveryAction: "retry_slot",
      missingContextFinding: false,
    });
    expect(readiness.reasons).toContain("source_type_search_incomplete");
  });
});

describe("document workflow pack readiness", () => {
  it("marks a pack partial when required slots are ready but optional context is partial", () => {
    const pack = assessDocumentWorkflowPackReadiness([
      {
        slotId: "identity",
        required: true,
        taskCritical: true,
        slotReadiness: "ready",
        recoveryAction: "answer",
        missingContextFinding: false,
      },
      {
        slotId: "background",
        required: false,
        taskCritical: false,
        slotReadiness: "partial",
        recoveryAction: "answer_with_caveat",
        missingContextFinding: false,
      },
    ]);

    expect(pack).toMatchObject({
      packReadiness: "partial",
      recoveryAction: "answer_with_caveat",
      blockingSlots: [],
      retrySlots: [],
    });
    expect(pack.partialSlots).toEqual(["background"]);
  });

  it("promotes a task-critical required partial slot to pack retry_required", () => {
    const pack = assessDocumentWorkflowPackReadiness([
      {
        slotId: "identity",
        required: true,
        taskCritical: true,
        slotReadiness: "ready",
        recoveryAction: "answer",
        missingContextFinding: false,
      },
      {
        slotId: "coverage_rules",
        required: true,
        taskCritical: true,
        slotReadiness: "partial",
        recoveryAction: "answer_with_caveat",
        missingContextFinding: false,
      },
    ]);

    expect(pack).toMatchObject({
      packReadiness: "retry_required",
      recoveryAction: "retry_slot",
      retrySlots: ["coverage_rules"],
    });
  });
});
