import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadDocumentWorkflowFixture,
  loadDocumentWorkflowOutputs,
  parseDocumentWorkflowArgs,
  renderDocumentWorkflowReport,
  runDocumentWorkflowEval,
  scoreDocumentWorkflowCase,
  summarizeDocumentWorkflow,
  type DocumentWorkflowCase,
  type DocumentWorkflowOutput,
} from "./document-workflow-probe.js";
import { buildReferenceOutputs } from "./document-workflow-reference-outputs.js";

describe("document workflow fixture", () => {
  it("loads the insurance claim workflow fixture", () => {
    const fixture = loadDocumentWorkflowFixture();

    expect(fixture.fixture_name).toBe("insurance_claim_document_workflows");
    expect(fixture.corpus_globs).toEqual(["corpus/**/*.md"]);
    expect(fixture.workflows).toHaveLength(6);
    expect(fixture.workflows.map((workflow) => workflow.id)).toEqual([
      "residential_water_claim_summary",
      "coverage_a_payment_review",
      "proof_of_loss_readiness",
      "mitigation_vendor_direct_payment_review",
      "ale_payment_hold_review",
      "plumbing_vs_backup_coverage_review",
    ]);
    expect(fixture.workflows.map((workflow) => workflow.difficulty)).toEqual([4, 3, 5, 5, 5, 5]);
    expect(fixture.workflows.map((workflow) => workflow.split)).toEqual([
      "dev",
      "dev",
      "dev",
      "dev",
      "holdout",
      "stress",
    ]);
    expect(fixture.workflows[0]?.archetype).toBe("case_evidence_adjudication");
    expect(fixture.workflows[0]?.task_variants).toHaveLength(2);
    expect(fixture.workflows[0]?.decoy_sources).toEqual(["corpus/decoy-prior-water-claim.md"]);
    expect(fixture.workflows.flatMap((workflow) => workflow.slots)).toHaveLength(19);
    expect(fixture.workflows[0]?.slots.map((slot) => slot.id)).toEqual([
      "claim_identity",
      "loss_cause_conflict",
      "water_damage_rules",
      "prior_claim_history_gap",
    ]);
    expect(fixture.workflows[0]?.slots.map((slot) => slot.slot_kind)).toEqual([
      "evidence",
      "contradiction_check",
      "evidence",
      "missing_check",
    ]);
    expect(fixture.workflows.flatMap((workflow) => workflow.fields)).toHaveLength(34);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => field.expected_status !== "answerable"),
    ).toHaveLength(7);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => (field.searched_scope ?? []).length > 0),
    ).toHaveLength(6);
  });

  it("loads the contract policy review workflow fixture", () => {
    const fixture = loadDocumentWorkflowFixture(
      join(process.cwd(), "tests/fixtures/document-workflows/contract-policy-review/workflows.yaml"),
    );

    expect(fixture.fixture_name).toBe("contract_policy_review_workflows");
    expect(fixture.corpus_globs).toEqual(["corpus/**/*.md"]);
    expect(fixture.workflows).toHaveLength(6);
    expect(fixture.workflows.map((workflow) => workflow.id)).toEqual([
      "exit_rights_review",
      "risk_liability_review",
      "data_confidentiality_review",
      "assignment_audit_subprocessor_review",
      "post_termination_data_return_review",
      "ai_training_data_use_review",
    ]);
    expect(fixture.workflows.every((workflow) => workflow.archetype === "contract_policy_obligation_review")).toBe(true);
    expect(fixture.workflows.map((workflow) => workflow.difficulty)).toEqual([5, 4, 5, 5, 5, 5]);
    expect(fixture.workflows.map((workflow) => workflow.split)).toEqual([
      "dev",
      "dev",
      "dev",
      "dev",
      "holdout",
      "stress",
    ]);
    expect(fixture.workflows.flatMap((workflow) => workflow.slots)).toHaveLength(24);
    expect(fixture.workflows.flatMap((workflow) => workflow.fields)).toHaveLength(37);
    expect(fixture.workflows.reduce((sum, workflow) => sum + workflow.task_variants.length, 0)).toBe(17);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => field.expected_status !== "answerable"),
    ).toHaveLength(5);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => (field.searched_scope ?? []).length > 0),
    ).toHaveLength(5);
  });

  it("loads the numeric reconciliation workflow fixture", () => {
    const fixture = loadDocumentWorkflowFixture(
      join(process.cwd(), "tests/fixtures/document-workflows/numeric-reconciliation/workflows.yaml"),
    );

    expect(fixture.fixture_name).toBe("numeric_reconciliation_workflows");
    expect(fixture.workflows).toHaveLength(6);
    expect(fixture.workflows.map((workflow) => workflow.id)).toEqual([
      "three_way_match_review",
      "open_balance_reconciliation",
      "sales_tax_review",
      "vendor_statement_reconciliation",
      "remittance_trace_review",
      "variance_tax_release_review",
    ]);
    expect(fixture.workflows.every((workflow) => workflow.archetype === "numeric_transaction_reconciliation")).toBe(true);
    expect(fixture.workflows.map((workflow) => workflow.difficulty)).toEqual([5, 4, 5, 5, 5, 5]);
    expect(fixture.workflows.map((workflow) => workflow.split)).toEqual([
      "dev",
      "dev",
      "dev",
      "dev",
      "holdout",
      "stress",
    ]);
    expect(fixture.workflows.flatMap((workflow) => workflow.slots)).toHaveLength(20);
    expect(fixture.workflows.flatMap((workflow) => workflow.fields)).toHaveLength(44);
    expect(fixture.workflows.reduce((sum, workflow) => sum + workflow.task_variants.length, 0)).toBe(16);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => field.expected_status !== "answerable"),
    ).toHaveLength(7);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => (field.searched_scope ?? []).length > 0),
    ).toHaveLength(5);
  });

  it("loads the relationship history workflow fixture", () => {
    const fixture = loadDocumentWorkflowFixture(
      join(process.cwd(), "tests/fixtures/document-workflows/relationship-history/workflows.yaml"),
    );

    expect(fixture.fixture_name).toBe("relationship_history_workflows");
    expect(fixture.workflows).toHaveLength(6);
    expect(fixture.workflows.map((workflow) => workflow.id)).toEqual([
      "cto_follow_up_context",
      "renewal_risk_brief",
      "expansion_timing_review",
      "qbr_agenda_readiness",
      "security_review_reschedule_brief",
      "renewal_pricing_separation_stress",
    ]);
    expect(fixture.workflows.every((workflow) => workflow.archetype === "relationship_history_synthesis")).toBe(true);
    expect(fixture.workflows.map((workflow) => workflow.difficulty)).toEqual([5, 4, 5, 5, 5, 5]);
    expect(fixture.workflows.map((workflow) => workflow.split)).toEqual([
      "dev",
      "dev",
      "dev",
      "dev",
      "holdout",
      "stress",
    ]);
    expect(fixture.workflows.flatMap((workflow) => workflow.slots)).toHaveLength(22);
    expect(fixture.workflows.flatMap((workflow) => workflow.fields)).toHaveLength(43);
    expect(fixture.workflows.reduce((sum, workflow) => sum + workflow.task_variants.length, 0)).toBe(17);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => field.expected_status !== "answerable"),
    ).toHaveLength(6);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
      .filter((field) => (field.searched_scope ?? []).length > 0),
    ).toHaveLength(6);
  });

  it("loads the employee operations workflow fixture with eval splits", () => {
    const fixture = loadDocumentWorkflowFixture(
      join(process.cwd(), "tests/fixtures/document-workflows/employee-operations/workflows.yaml"),
    );

    expect(fixture.fixture_name).toBe("employee_operations_workflows");
    expect(fixture.workflows).toHaveLength(3);
    expect(fixture.workflows.map((workflow) => workflow.id)).toEqual([
      "new_hire_benefits_readiness",
      "medical_leave_accommodation_review",
      "remote_work_exception_review",
    ]);
    expect(fixture.workflows.every((workflow) => workflow.archetype === "employee_lifecycle_operations")).toBe(true);
    expect(fixture.workflows.map((workflow) => workflow.split)).toEqual(["dev", "holdout", "stress"]);
    expect(fixture.workflows.flatMap((workflow) => workflow.slots)).toHaveLength(10);
    expect(fixture.workflows.flatMap((workflow) => workflow.fields)).toHaveLength(26);
    expect(fixture.workflows.reduce((sum, workflow) => sum + workflow.task_variants.length, 0)).toBe(9);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => field.expected_status !== "answerable"),
    ).toHaveLength(3);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => (field.searched_scope ?? []).length > 0),
    ).toHaveLength(3);
  });

  it("loads the vendor onboarding workflow fixture with eval splits", () => {
    const fixture = loadDocumentWorkflowFixture(
      join(process.cwd(), "tests/fixtures/document-workflows/vendor-onboarding-compliance/workflows.yaml"),
    );

    expect(fixture.fixture_name).toBe("vendor_onboarding_compliance_workflows");
    expect(fixture.workflows).toHaveLength(3);
    expect(fixture.workflows.map((workflow) => workflow.id)).toEqual([
      "vendor_onboarding_readiness",
      "bank_change_payment_hold",
      "security_exception_approval_review",
    ]);
    expect(fixture.workflows.every((workflow) => workflow.archetype === "vendor_onboarding_compliance")).toBe(true);
    expect(fixture.workflows.map((workflow) => workflow.split)).toEqual(["dev", "holdout", "stress"]);
    expect(fixture.workflows.flatMap((workflow) => workflow.slots)).toHaveLength(12);
    expect(fixture.workflows.flatMap((workflow) => workflow.fields)).toHaveLength(24);
    expect(fixture.workflows.reduce((sum, workflow) => sum + workflow.task_variants.length, 0)).toBe(9);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => field.expected_status !== "answerable"),
    ).toHaveLength(1);
    expect(
      fixture.workflows
        .flatMap((workflow) => workflow.fields)
        .filter((field) => (field.searched_scope ?? []).length > 0),
    ).toHaveLength(1);
  });
});

describe("scoreDocumentWorkflowCase", () => {
  const workflow: DocumentWorkflowCase = {
    id: "wf",
    title: "Workflow",
    archetype: "case_evidence_adjudication",
    split: "dev",
    difficulty: 2,
    challenge_tags: ["direct_evidence"],
    failure_modes: ["absence_hallucination"],
    task_variants: ["Find the policy identity."],
    decoy_sources: ["corpus/decoy.md"],
    prompt: "Fill fields with citations.",
    slots: [
      {
        id: "identity",
        slot_kind: "evidence",
        role: "identity",
        purpose: "Find policy identity.",
        required: true,
        failure_modes: ["wrong_scope"],
        queries: ["policy number"],
        fields: ["policy_number"],
      },
      {
        id: "prior_history_gap",
        slot_kind: "missing_check",
        role: "missing_context",
        purpose: "Check whether prior claim history exists.",
        required: false,
        failure_modes: ["absence_hallucination"],
        queries: ["prior claims"],
        fields: ["prior_claims"],
      },
    ],
    fields: [
      {
        id: "policy_number",
        label: "Policy number",
        expected_status: "answerable",
        expected_value: "HOM-7842-19",
        evidence: [
          {
            source: "corpus/policy.md",
            heading_path: ["Policy", "Identity"],
            required_text: "Policy Number: HOM-7842-19",
          },
        ],
      },
      {
        id: "prior_claims",
        label: "Prior claims",
        expected_status: "missing",
        searched_scope: [
          {
            source: "corpus/policy.md",
            heading_path: ["Policy", "Identity"],
            required_text: "Policy Number: HOM-7842-19",
          },
        ],
        review_reason: "No prior-loss history document exists.",
      },
    ],
  };

  it("scores field accuracy, citation validity, abstention, and review load", () => {
    const output: DocumentWorkflowOutput = {
      workflow_id: "wf",
      fields: [
        {
          field_id: "policy_number",
          status: "answered",
          value: "HOM-7842-19",
          citations: [
            {
              source: "corpus/policy.md",
              heading_path: ["Policy", "Identity"],
              quote: "Policy Number: HOM-7842-19",
            },
          ],
        },
        {
          field_id: "prior_claims",
          status: "missing_evidence",
          explanation: "No prior-loss history document exists.",
        },
      ],
    };

    const result = scoreDocumentWorkflowCase({
      workflow,
      output,
      retrievedSections: [
        {
          source: "corpus/policy.md",
          heading_path: ["Policy", "Identity"],
          text: "Policy Number: HOM-7842-19\nNamed Insured: Maya Chen",
        },
      ],
      slotSections: [
        {
          slotId: "identity",
          retrievedSections: [
            {
              source: "corpus/policy.md",
              heading_path: ["Policy", "Identity"],
              text: "Policy Number: HOM-7842-19\nNamed Insured: Maya Chen",
            },
          ],
        },
        {
          slotId: "prior_history_gap",
          retrievedSections: [],
        },
      ],
    });
    const policy = result.fields.find((field) => field.id === "policy_number");
    const priorClaims = result.fields.find((field) => field.id === "prior_claims");

    expect(policy?.sectionRecallPass).toBe(true);
    expect(policy?.fieldAccuracy).toBe(true);
    expect(policy?.citationValid).toBe(true);
    expect(priorClaims?.abstentionCorrect).toBe(true);
    expect(priorClaims?.reviewed).toBe(true);

    const summary = summarizeDocumentWorkflow({ importedSources: 1, cases: [result] });
    expect(summary.slots).toBe(2);
    expect(summary.taskVariants).toBe(1);
    expect(summary.requiredSlots).toBe(1);
    expect(summary.requiredSlotsSatisfied).toBe(1);
    expect(summary.slotEvidenceHits).toBe(1);
    expect(summary.slotEvidenceTotal).toBe(1);
    expect(summary.searchedScopeHits).toBe(0);
    expect(summary.searchedScopeTotal).toBe(1);
    expect(summary.sectionRecallHits).toBe(1);
    expect(summary.sectionRecallTotal).toBe(1);
    expect(summary.fieldAccuracyHits).toBe(1);
    expect(summary.fieldAccuracyTotal).toBe(1);
    expect(summary.citationValidityHits).toBe(1);
    expect(summary.abstentionHits).toBe(1);
    expect(summary.reviewFields).toBe(1);
    expect(summary.reviewTruePositives).toBe(1);
    expect(summary.byFailureMode.wrong_scope?.satisfied).toBe(1);
    expect(summary.byDifficulty["2"]?.total).toBe(2);
    expect(summary.byArchetype.case_evidence_adjudication?.total).toBe(2);
    expect(summary.bySplit.dev?.total).toBe(2);
  });

  it("separates decoy authority misuse from explicit decoy rejection", () => {
    const output: DocumentWorkflowOutput = {
      workflow_id: "wf",
      fields: [
        {
          field_id: "policy_number",
          status: "answered",
          value: "HOM-7842-19",
          citations: [
            {
              source: "corpus/policy.md",
              heading_path: ["Policy", "Identity"],
              quote: "Policy Number: HOM-7842-19",
            },
            {
              source: "corpus/decoy.md",
              heading_path: ["Prior Claim", "Identity"],
              quote: "Policy Number: HOM-7842-19",
            },
          ],
        },
        {
          field_id: "prior_claims",
          status: "missing_evidence",
          explanation: "No prior-loss history document exists.",
          excluded_citations: [
            {
              source: "corpus/decoy.md",
              heading_path: ["Prior Claim", "Identity"],
              quote: "Prior claim belongs to a different loss packet.",
              disposition: "stale_or_wrong_scope",
              reason: "Old claim packet is not authority for the current workflow.",
            },
          ],
        },
      ],
    };

    const result = scoreDocumentWorkflowCase({
      workflow,
      output,
      retrievedSections: [
        {
          source: "corpus/policy.md",
          heading_path: ["Policy", "Identity"],
          text: "Policy Number: HOM-7842-19\nNamed Insured: Maya Chen",
        },
        {
          source: "corpus/decoy.md",
          heading_path: ["Prior Claim", "Identity"],
          text: "Policy Number: HOM-7842-19\nPrior claim belongs to a different loss packet.",
        },
      ],
    });
    const policy = result.fields.find((field) => field.id === "policy_number");
    const priorClaims = result.fields.find((field) => field.id === "prior_claims");

    expect(policy?.fieldAccuracy).toBe(true);
    expect(policy?.citationValid).toBe(false);
    expect(policy?.decoyAuthorityMisuse).toBe(true);
    expect(policy?.decoyAuthorityCitations).toHaveLength(1);
    expect(priorClaims?.abstentionCorrect).toBe(true);
    expect(priorClaims?.decoyRejectedCitations).toHaveLength(1);

    const summary = summarizeDocumentWorkflow({ importedSources: 2, cases: [result] });
    expect(summary.decoyAuthorityMisuses).toBe(1);
    expect(summary.decoyAuthorityCitationTotal).toBe(1);
    expect(summary.decoyRejectedCitationTotal).toBe(1);
    expect(summary.decoyOutputFields).toBe(2);
    expect(summary.citationValidityHits).toBe(0);
    expect(summary.citationValidityTotal).toBe(1);
    expect(summary.abstentionHits).toBe(1);
  });

  it("marks answered fields for review when their required evidence was not retrieved", () => {
    const output: DocumentWorkflowOutput = {
      workflow_id: "wf",
      fields: [
        {
          field_id: "policy_number",
          status: "answered",
          value: "HOM-7842-19",
          citations: [],
        },
      ],
    };

    const result = scoreDocumentWorkflowCase({
      workflow,
      output,
      retrievedSections: [],
    });
    const policy = result.fields.find((field) => field.id === "policy_number");

    expect(policy?.sectionRecallPass).toBe(false);
    expect(policy?.reviewExpected).toBe(true);
    expect(policy?.reviewed).toBe(false);
    expect(policy?.fieldAccuracy).toBe(true);
    expect(policy?.citationValid).toBe(false);
    expect(result.slots.find((slot) => slot.id === "identity")?.requiredSatisfied).toBe(false);
  });

  it("loads sample agent outputs with excluded decoy citations", () => {
    const outputs = loadDocumentWorkflowOutputs(
      join(process.cwd(), "tests/fixtures/document-workflows/sample-agent-outputs.yaml"),
    );
    const dataConfidentiality = outputs.find((output) => output.workflow_id === "data_confidentiality_review");

    expect(outputs).toHaveLength(3);
    expect(dataConfidentiality?.fields[0]?.excluded_citations?.[0]?.disposition)
      .toBe("excluded_non_authoritative");
  });

  it("builds full-panel reference outputs from workflow gold", () => {
    const outputs = buildReferenceOutputs();
    const fields = outputs.flatMap((output) => output.fields);

    expect(outputs).toHaveLength(30);
    expect(fields).toHaveLength(208);
    expect(fields.some((field) => field.excluded_citations && field.excluded_citations.length > 0)).toBe(true);
    expect(fields.every((field) =>
      field.status === "answered" ||
      typeof field.explanation === "string",
    )).toBe(true);
  });
});

describe("document workflow eval runner", () => {
  it("runs the insurance fixture through retrieval and renders a workflow report", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "contexttrail-document-workflow-trace-"));
    const report = await runDocumentWorkflowEval({ topK: 5, traceDir });

    expect(report.fixtureName).toBe("insurance_claim_document_workflows");
    expect(report.importedSources).toBe(13);
    expect(report.summary.workflows).toBe(6);
    expect(report.summary.taskVariants).toBe(15);
    expect(report.summary.slots).toBe(19);
    expect(report.summary.requiredSlots).toBe(18);
    expect(report.summary.fields).toBe(34);
    expect(report.summary.sectionRecallTotal).toBe(31);
    expect(report.summary.sectionRecallHits).toBeGreaterThan(10);
    expect(report.summary.searchedScopeTotal).toBe(11);
    expect(report.summary.byFailureMode.absence_hallucination?.total).toBeGreaterThan(0);
    expect(report.summary.fieldAccuracyTotal).toBe(0);
    const waterClaimAnalysis = report.failureAnalyses.find(
      (analysis) => analysis.workflow_id === "residential_water_claim_summary",
    );
    expect(waterClaimAnalysis?.miss_count).toBe(0);
    expect(existsSync(join(traceDir, "summary.json"))).toBe(true);
    expect(existsSync(join(traceDir, "workflows", "proof_of_loss_readiness", "retrieval-trace.json"))).toBe(true);
    expect(existsSync(join(traceDir, "workflows", "residential_water_claim_summary", "failure-analysis.md"))).toBe(true);
    const trace = JSON.parse(
      readFileSync(join(traceDir, "workflows", "proof_of_loss_readiness", "retrieval-trace.json"), "utf8"),
    ) as {
      slots: Array<{
        source_dispositions: Array<{ disposition: string; source: string }>;
        queries: Array<{ selected_candidates: unknown[]; rejected_candidates: unknown[] }>;
      }>;
    };
    expect(trace.slots.some((slot) => slot.queries.some((query) => query.selected_candidates.length > 0))).toBe(true);
    expect(trace.slots.some((slot) => slot.source_dispositions.length > 0)).toBe(true);
    const residentialTrace = JSON.parse(
      readFileSync(join(traceDir, "workflows", "residential_water_claim_summary", "retrieval-trace.json"), "utf8"),
    ) as { slots: Array<{ source_dispositions: Array<{ disposition: string; source: string }> }> };
    expect(residentialTrace.slots.some((slot) =>
      slot.source_dispositions.some((disposition) =>
        disposition.source === "corpus/decoy-prior-water-claim.md" &&
        disposition.disposition === "stale_or_wrong_scope",
      ),
    )).toBe(true);
    const failureAnalysis = readFileSync(
      join(traceDir, "workflows", "residential_water_claim_summary", "failure-analysis.md"),
      "utf8",
    );
    expect(failureAnalysis).toContain("Misses diagnosed: 0");

    const rendered = renderDocumentWorkflowReport(report);
    expect(rendered).toContain("Document workflow eval");
    expect(rendered).toContain("Slot evidence recall");
    expect(rendered).toContain("Required slots satisfied");
    expect(rendered).toContain("Evidence section recall");
    expect(rendered).toContain("Searched-scope coverage");
    expect(rendered).toContain("Decoy output use");
    expect(rendered).toContain("Failure-mode pressure");
    expect(rendered).toContain("Archetype pressure");
    expect(rendered).toContain("Split pressure");
    expect(rendered).toContain("expected place");
    expect(rendered).toContain("Human review load");
    rmSync(traceDir, { recursive: true, force: true });
  });

  it("runs the contract policy fixture through retrieval and renders pressure diagnostics", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "contexttrail-contract-policy-trace-"));
    const report = await runDocumentWorkflowEval({
      fixturePath: join(process.cwd(), "tests/fixtures/document-workflows/contract-policy-review/workflows.yaml"),
      topK: 5,
      traceDir,
    });

    expect(report.fixtureName).toBe("contract_policy_review_workflows");
    expect(report.importedSources).toBe(7);
    expect(report.summary.workflows).toBe(6);
    expect(report.summary.taskVariants).toBe(17);
    expect(report.summary.slots).toBe(24);
    expect(report.summary.requiredSlots).toBe(24);
    expect(report.summary.fields).toBe(37);
    expect(report.summary.sectionRecallTotal).toBe(35);
    expect(report.summary.searchedScopeTotal).toBe(9);
    expect(report.summary.byFailureMode.override_failure?.total).toBeGreaterThan(0);
    expect(report.summary.byFailureMode.wrong_scope?.total).toBeGreaterThan(0);
    expect(existsSync(join(traceDir, "workflows", "exit_rights_review", "retrieval-trace.json"))).toBe(true);
    expect(existsSync(join(traceDir, "workflows", "exit_rights_review", "failure-analysis.json"))).toBe(true);

    const rendered = renderDocumentWorkflowReport(report);
    expect(rendered).toContain("contract_policy_review_workflows");
    expect(rendered).toContain("Failure-mode pressure");
    expect(rendered).toContain("Difficulty pressure");
    rmSync(traceDir, { recursive: true, force: true });
  });

  it("runs the numeric reconciliation fixture through retrieval and renders pressure diagnostics", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "contexttrail-numeric-reconciliation-trace-"));
    const report = await runDocumentWorkflowEval({
      fixturePath: join(process.cwd(), "tests/fixtures/document-workflows/numeric-reconciliation/workflows.yaml"),
      topK: 5,
      traceDir,
    });

    expect(report.fixtureName).toBe("numeric_reconciliation_workflows");
    expect(report.importedSources).toBe(13);
    expect(report.summary.workflows).toBe(6);
    expect(report.summary.taskVariants).toBe(16);
    expect(report.summary.slots).toBe(20);
    expect(report.summary.requiredSlots).toBe(20);
    expect(report.summary.fields).toBe(44);
    expect(report.summary.sectionRecallTotal).toBe(43);
    expect(report.summary.searchedScopeTotal).toBe(9);
    expect(report.summary.byFailureMode.numeric_text_split?.total).toBeGreaterThan(0);
    expect(report.summary.byFailureMode.wrong_scope?.total).toBeGreaterThan(0);
    expect(existsSync(join(traceDir, "workflows", "three_way_match_review", "retrieval-trace.json"))).toBe(true);
    expect(existsSync(join(traceDir, "workflows", "three_way_match_review", "failure-analysis.md"))).toBe(true);

    const rendered = renderDocumentWorkflowReport(report);
    expect(rendered).toContain("numeric_reconciliation_workflows");
    expect(rendered).toContain("Failure-mode pressure");
    rmSync(traceDir, { recursive: true, force: true });
  });

  it("runs the relationship history fixture through retrieval and renders pressure diagnostics", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "contexttrail-relationship-history-trace-"));
    const report = await runDocumentWorkflowEval({
      fixturePath: join(process.cwd(), "tests/fixtures/document-workflows/relationship-history/workflows.yaml"),
      topK: 5,
      traceDir,
    });

    expect(report.fixtureName).toBe("relationship_history_workflows");
    expect(report.importedSources).toBe(12);
    expect(report.summary.workflows).toBe(6);
    expect(report.summary.taskVariants).toBe(17);
    expect(report.summary.slots).toBe(22);
    expect(report.summary.requiredSlots).toBe(22);
    expect(report.summary.fields).toBe(43);
    expect(report.summary.sectionRecallTotal).toBe(39);
    expect(report.summary.searchedScopeTotal).toBe(11);
    expect(report.summary.byFailureMode.natural_task_wording_failure?.total).toBeGreaterThan(0);
    expect(report.summary.byFailureMode.wrong_scope?.total).toBeGreaterThan(0);
    expect(existsSync(join(traceDir, "workflows", "cto_follow_up_context", "retrieval-trace.json"))).toBe(true);
    expect(existsSync(join(traceDir, "workflows", "cto_follow_up_context", "failure-analysis.json"))).toBe(true);

    const rendered = renderDocumentWorkflowReport(report);
    expect(rendered).toContain("relationship_history_workflows");
    expect(rendered).toContain("Difficulty pressure");
    rmSync(traceDir, { recursive: true, force: true });
  });

  it("runs the employee operations fixture and supports holdout-only filtering", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "contexttrail-employee-operations-trace-"));
    const report = await runDocumentWorkflowEval({
      fixturePath: join(process.cwd(), "tests/fixtures/document-workflows/employee-operations/workflows.yaml"),
      topK: 5,
      split: "holdout",
      traceDir,
    });

    expect(report.fixtureName).toBe("employee_operations_workflows");
    expect(report.importedSources).toBe(10);
    expect(report.splitFilter).toBe("holdout");
    expect(report.summary.workflows).toBe(1);
    expect(report.summary.taskVariants).toBe(3);
    expect(report.summary.slots).toBe(4);
    expect(report.summary.fields).toBe(9);
    expect(report.summary.sectionRecallTotal).toBe(9);
    expect(report.summary.searchedScopeTotal).toBe(1);
    expect(report.summary.bySplit.holdout?.total).toBe(4);
    expect(report.summary.byArchetype.employee_lifecycle_operations?.total).toBe(4);
    expect(existsSync(join(traceDir, "workflows", "medical_leave_accommodation_review", "failure-analysis.md"))).toBe(true);

    const rendered = renderDocumentWorkflowReport(report);
    expect(rendered).toContain("Split: holdout");
    expect(rendered).toContain("employee_lifecycle_operations");
    rmSync(traceDir, { recursive: true, force: true });
  });

  it("runs the vendor onboarding fixture through retrieval and renders pressure diagnostics", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "contexttrail-vendor-onboarding-trace-"));
    const report = await runDocumentWorkflowEval({
      fixturePath: join(process.cwd(), "tests/fixtures/document-workflows/vendor-onboarding-compliance/workflows.yaml"),
      topK: 5,
      traceDir,
    });

    expect(report.fixtureName).toBe("vendor_onboarding_compliance_workflows");
    expect(report.importedSources).toBe(9);
    expect(report.summary.workflows).toBe(3);
    expect(report.summary.taskVariants).toBe(9);
    expect(report.summary.slots).toBe(12);
    expect(report.summary.fields).toBe(24);
    expect(report.summary.sectionRecallTotal).toBe(24);
    expect(report.summary.searchedScopeTotal).toBe(2);
    expect(report.summary.bySplit.dev?.total).toBe(4);
    expect(report.summary.bySplit.holdout?.total).toBe(4);
    expect(report.summary.bySplit.stress?.total).toBe(4);
    expect(report.summary.byArchetype.vendor_onboarding_compliance?.total).toBe(12);
    expect(existsSync(join(traceDir, "workflows", "bank_change_payment_hold", "retrieval-trace.json"))).toBe(true);

    const rendered = renderDocumentWorkflowReport(report);
    expect(rendered).toContain("vendor_onboarding_compliance_workflows");
    expect(rendered).toContain("Archetype pressure");
    expect(rendered).toContain("Split pressure");
    rmSync(traceDir, { recursive: true, force: true });
  });

  it("parses CLI flags", () => {
    expect(parseDocumentWorkflowArgs([
      "--json",
      "--fixture=fixture.yaml",
      "--output=answers.yaml",
      "--trace-dir=trace",
      "--split=stress",
      "--top-k=7",
      "--candidate-pool-k=11",
      "--source-sweep-k=2",
      "--cross-slot-k=2",
      "--absence-verifier-k=2",
      "--rule-application-k=2",
      "--expected-place-k=2",
      "--alias-status-k=2",
      "--source-local-completion-k=2",
      "--near-miss-k=2",
      "--rejected-limit=3",
    ])).toEqual({
      json: true,
      fixturePath: "fixture.yaml",
      outputPath: "answers.yaml",
      traceDir: "trace",
      split: "stress",
      topK: 7,
      candidatePoolK: 11,
      sourceSweepK: 2,
      crossSlotK: 2,
      absenceVerifierK: 2,
      ruleApplicationK: 2,
      expectedPlaceK: 2,
      aliasStatusK: 2,
      sourceLocalCompletionK: 2,
      nearMissK: 2,
      rejectedLimit: 3,
    });
  });
});
