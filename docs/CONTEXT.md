# Context

## Product Thesis

ContextTrail should become an evidence-backed document workflow engine.

The system should help an agent or operator:

1. Find the exact source sections needed for a task.
2. Extract task-relevant facts.
3. Fill or draft structured outputs.
4. Cite every completed value back to source text.
5. Report missing or conflicting evidence.
6. Ask only for the clarification needed to complete the work.

## Target Users

The near-term user is not a developer. The target user works inside document
heavy operations: claims, underwriting, compliance, HR, sales operations,
customer onboarding, legal review, finance operations, or similar teams.

These users need trust, traceability, and review speed more than generic chat.

## Core Concepts

**Corpus**: a bounded set of source documents for a workflow.

**Workflow**: a repeatable business task performed against a corpus, such as
claim review, policy comparison, onboarding packet completion, or contract
clause extraction.

**Context Plan**: the set of typed context slots needed to complete a workflow.

**Context Slot**: one accountable role in the Context Plan. A slot has a role,
kind, purpose, field list, query list, optional filters, failure-mode tags, and
a budget. Retrieval fills slots; the final Context Pack is assembled from them.

**Field**: one structured output value a workflow needs.

**Evidence requirement**: the source, heading path, and text span required to
support a field.

**Citation**: the source-backed proof attached to an extracted value.

**Abstention**: choosing missing evidence, conflict, or needs review instead of
guessing.

**Review load**: the number of fields a human must inspect, and whether those
are the right fields.

**Searched scope**: the sections the engine checked before claiming evidence is
missing or unresolved.

**Miss diagnosis**: the trace-level explanation for a missing evidence or
searched-scope requirement. It should identify whether the problem came from
import coverage, chunking, slot retrieval, ranking, wrong-section selection,
decoy pressure, or workflow-level assembly.

**Eval split**: the workflow's role in engine evaluation. `dev` cases are
visible diagnostic pressure, `holdout` cases are promotion checks, and `stress`
cases are deliberately harder wording/decoy/missing-context probes.

**Mutation pressure**: deterministic perturbations of an eval fixture that keep
the same gold evidence but weaken queries or add corpus clutter. Mutation
pressure is not a replacement for held-out documents; it is a brittleness check
for methods that only work with perfect authored slot queries.

**Engine failure mode**: a pressure category such as wrong scope, shallow
relevance, missing synthesis, absence hallucination, false completeness,
budget collapse, citation weakness, numeric-text split, or natural task wording
failure.

## Context Assembly Pipeline

The architectural spine is:

```text
task
  -> context plan
  -> context slots
  -> slot-specific retrieval
  -> coverage-checked context pack
  -> workflow completion
```

Queries are a tactic inside a slot. Slots are the product primitive because
they say what job each retrieved chunk is supposed to do.

## Current Focus

The active eval fixtures now cover six work archetypes:

- Case / evidence adjudication through insurance claim paperwork.
- Contract / policy obligation review through legal business questions over
  signed terms, missing clauses, amendments, stale drafts, and policy memos.
- Numeric / transaction reconciliation through invoices, purchase orders,
  receiving reports, credit memos, ledgers, bank evidence, and tax review.
- Relationship / history synthesis through account plans, sales calls, support
  history, pricing threads, stakeholder maps, renewal risk, and expansion
  timing.
- Employee lifecycle operations through benefits eligibility, HR forms, leave
  requests, medical certification, remote-work exceptions, and approval gaps.
- Vendor onboarding compliance through high-risk onboarding packets, sanctions,
  SOC 2, insurance, DPA status, bank-change controls, and security exceptions.

The eval direction is battle-hardening, not just coverage counting: each lane
should accumulate more realistic documents, more workflow-shaped questions,
more near-miss decoys, and more explicit missing-context proof until engine
improvements generalize across the panel instead of fitting one clean example.
