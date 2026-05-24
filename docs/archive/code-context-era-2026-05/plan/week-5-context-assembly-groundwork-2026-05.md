# Week 5 context assembly groundwork - 2026-05

> Status: draft for review after week-5 grilling.
>
> Predecessors: [PRD-0006](../prd/0006-fact-finding-quality-and-context-assembly-bridge.md), [next-session handoff](next-session-handoff-2026-05-07.md), and the current week-by-week scope in [MVP.md](../MVP.md#week-5--context-assembly-groundwork).
>
> Related ADR: [ADR-0017](../adr/0017-structural-assembly-rollout-contract.md).
>
> Product slice: anchored implementation questions where ContextTrail already finds the right primary source, but the agent still needs nearby structure to implement safely.

## Product promise

If an engineer points ContextTrail at the code they are changing, ContextTrail should return not just the best matching rule or doc chunk, but the minimum surrounding documentation needed to make the change safely.

This deliberately narrows week 5 without making the product ambition small. Week 5 is about one product-critical claim:

- once fact finding identifies the right authoritative object, ContextTrail can assemble the minimum useful surrounding context

It is not trying to solve every context failure mode at once. Low-signal recovery, cold-start bootstrap, broad repo-memory lookup, and real pilot measurement remain separate product risks.

## Core decision

Week 5 is evaluator-first.

The first deliverable is a realistic structural assembly evaluation that can show where the current packer bends. Production pack behavior should change only after the eval exposes a named sufficiency defect.

Why:

- current retrieval is already strong on anchored and unanchored fixture cases
- compression and synthetic assembly pressure did not expose a meaningful bend point
- the existing pressure benchmark expands token counts, but does not model real structural neighbors
- changing live packs before measuring structural expansion would make it harder to tell whether usefulness improved or payloads merely grew

## Target task family

Start with anchored implementation tasks:

- "I am changing this file; what nearby rules also matter?"
- "This module touches another module; what adjacent docs define the boundary?"
- "This implementation detail points at a decision; what rationale constrains it?"

Do not lead with broad repo-memory queries or `signal_empty` recovery. Those matter, but they mix fact finding, assembly, and recovery.

## Scope

In scope:

- structural expansion from a single grounded source chunk
- fixture-defined sufficiency expectations
- `assembly_need` reporting preserved as the problem-type axis
- a new expansion-stage axis for "how far did the pack need to grow?"
- stage-level over-expansion checks
- selective sibling and linked-neighbor selection
- offline eval and benchmark output before live behavior changes

Out of scope for this slice:

- repo-wide semantic similarity expansion
- LLM reranking
- embeddings
- second-order graph walks
- multi-root expansion
- production runtime confidence scores
- broad canonical entrypoint recovery
- `signal_empty` top-result optimization
- card bootstrap or setup intelligence

## Expansion ladder

Expansion should be incremental and stop as soon as sufficiency is met.

Stages:

1. `primary_only`
2. `parent`
3. `siblings`
4. `linked_neighbor`

The ladder is intentionally strict. Parent and same-document structure are easier to inspect and less likely to drift than cross-document neighbors. Linked ADRs, runbooks, or glossary docs come later because they cross a stronger relation boundary.

## Sufficiency

Week 5 sufficiency is an eval concept first, not a runtime oracle.

Each assembly-focused eval case should declare the minimal sufficient expansion stage. A stage passes when it satisfies the case's explicit assembly expectation without climbing to a later neighbor class.

Example shape:

```yaml
minimal_sufficient_stage: parent
required_neighbor_sources:
  - docs/domain/payments.md
forbidden_expansion_stages:
  - siblings
  - linked_neighbor
```

This gives us a crisp metric:

- under-expansion: the pack stops before the minimal sufficient stage
- over-expansion: the pack climbs past the minimal sufficient stage

For the first pass, over-expansion should be strict at the stage level, not token-perfect within a stage. If `parent` is enough, adding siblings is a failure. If `siblings` is the right stage, including one extra sibling is less urgent than climbing all the way to linked neighbors.

## Taxonomy

Keep two separate axes:

- `assembly_need`: why surrounding context is needed
- `minimal_sufficient_stage`: how far structural expansion had to go

First targeted `assembly_need` buckets:

- `local_semantics`
- `cross_module_boundary`
- `decision_rationale`

Buckets to keep separate initially:

- `setup_recovery`
- `debugging_evidence`
- `domain_constraints`
- `none`

`setup_recovery` and `signal_empty` are primarily recovery problems. `domain_constraints` may be solved by locked cards rather than structural expansion. `debugging_evidence` probably needs its own pass once the core structural ladder is observable.

## Root selection

Expansion starts from one grounded source chunk.

Rules:

- if the top authoritative hit is a doc chunk, expand from that chunk
- if the top authoritative hit is a locked or ranked card, expand from the best linked source chunk
- if the card has no grounded source chunk, do not fabricate structural expansion
- if a card links to multiple source chunks, choose one root for week 5

Best linked root tie-breakers:

1. strongest anchor overlap with the query
2. highest retrieval score if available
3. stable document order

Single-root expansion is a deliberate constraint. Multi-root expansion can come later, after single-root assembly has a measurable win.

## Neighbor selection

Parent context:

- include the immediate parent section context as a fixed structural unit
- use it to establish "what section am I inside?"
- do not spend week-5 complexity on selecting sub-fragments inside the parent

Sibling context:

- select siblings, do not dump all siblings
- prefer nearby siblings in document order
- boost siblings whose heading or body overlaps query terms, file anchors, symbol anchors, route anchors, or root chunk terms
- preserve document order as the final tie-breaker

Linked neighbors:

- select direct links only
- prefer linked ADRs, runbooks, or glossary docs when the root chunk explicitly points to them
- do not follow second-hop links
- do not use broad semantic similarity as a substitute for explicit structure

This is intentionally a conservative first neighbor policy, not the forever-definition of "neighbor." Week 5 only needs a deterministic model strong enough to prove the basics. Later weeks may deepen neighbor policy based on bootstrap and dogfood evidence without changing the underlying principle that structural assembly stays grounded, inspectable, and cautious.

## Failure modes

Week 5 should treat these as real failures:

- the primary hit is right, but parent context needed for implementation is missing
- the primary hit is right, but a relevant sibling section needed for implementation is missing
- the primary hit is right, but directly linked rationale is missing
- the pack expands beyond the minimal sufficient stage
- structural expansion improves recall but damages first-read usefulness

This avoids rewarding bloated packs. A technically complete pack can still be worse for the agent if it buries the useful context under avoidable neighbors.

## Proposed implementation slices

### Slice A - structural assembly eval schema

Add fixture fields for assembly-specific expectations:

- `minimal_sufficient_stage`
- `required_neighbor_sources`
- `forbidden_expansion_stages`
- optional `assembly_notes`

Add validation and reporting for:

- stage accuracy
- under-expansion
- over-expansion
- sufficiency by `assembly_need`
- payload growth by stage

Keep these fields optional until the first assembly-focused fixture subset is ready, then require them only for cases marked as assembly-stage cases.

### Slice B - offline structural expansion prototype

Add an offline evaluator that runs the current retrieval result and then simulates structural expansion from the selected root.

Expected module direction:

- `src/assemble/` owns structural expansion concepts
- `src/eval/` owns fixture scoring and reports
- `src/retrieve/` continues to own fact finding, scoring, and current pack behavior

Candidate public functions:

- `selectAssemblyRoot(...)`
- `buildStructuralNeighbors(...)`
- `selectSiblingNeighbors(...)`
- `selectLinkedNeighbors(...)`
- `assembleByStage(...)`

The first benchmark should compare:

- current ranked pack
- `primary_only`
- `parent`
- `siblings`
- `linked_neighbor`

### Slice C - fixture expansion

Add a small, high-signal fixture subset before broadening:

- 4 to 6 `local_semantics` cases
- 4 to 6 `cross_module_boundary` cases
- 3 to 5 `decision_rationale` cases

Cases should be anchored implementation tasks where the current top source is already acceptable. The case should fail only because the surrounding context is insufficient or over-expanded.

The first live readiness subset should at minimum prove one clear case for each narrow stage that week 5 claims to support:

- one `parent` case
- one `siblings` case
- one `linked_neighbor` case

That subset is the bridge into week 6 and week 7. Bootstrap and dogfood should build on those measured live cases, not just on the presence of runtime assembly code.

### Slice D - promotion criteria for live behavior

Do not wire structural expansion into `retrieve_context_pack` until the offline eval shows:

- better minimal-stage sufficiency on the targeted subset
- no regression in existing retrieval gates
- no stage-level over-expansion trend
- acceptable payload growth under default budget
- explain output can show why each neighbor was selected

Week 5 should not stop at a lab-only result if those conditions pass. Once the targeted offline eval clearly wins, the same narrow behavior should ship into live `retrieve_context_pack` behavior so week 6 bootstrap and week 7 dogfood build on something real.

This rollout should not add new user-facing setup burden. The narrow structural assembly behavior becomes the default for its targeted slice once it is proven; the boundary is behavioral, not configurational.

Once those pass, live behavior can be introduced behind a narrow policy:

- anchored implementation queries only
- single-root structural expansion only
- early-stop by deterministic sufficiency rule
- existing `signal_empty` behavior unchanged

Live structural assembly also needs explicit observability before it counts as shipped. At minimum, explain/reporting output should surface:

- `assembly_root`
- `assembly_stage_reached`
- neighbor selection reasons
- early-stop reason

Response-surface split:

- `assembly_stage_reached` may be always-on if agents need a small behavior-shaping summary
- `assembly_root`, neighbor reasons, and early-stop reasoning belong under `explain`
- `assembly_stage_reached` should distinguish "assembly did not apply" from "assembly ran and stayed at primary" (`not_applicable` vs `primary_only`)

## Success criteria

Week 5 is successful when:

- assembly-stage expectations exist for the first targeted fixture subset
- the benchmark reports minimal sufficient stage, under-expansion, and over-expansion
- the current synthetic pressure benchmark is supplemented by structural expansion pressure
- the plan identifies at least one real bend point or proves that the targeted slice is already sufficient
- production expansion is either justified by data and shipped narrowly, or explicitly deferred with evidence
- live structural assembly remains inspectable rather than becoming invisible pack growth
- the response contract keeps detailed assembly traces behind `explain` while allowing a minimal always-on stage summary

Hard guardrails:

- existing retrieval gates keep passing
- `query_mode` exactness stays a 100% gate
- warning honesty remains intact
- `signal_empty` is not treated as a normal ranking optimization target

## Review questions for the whole plan

The remaining review questions are now second-order, not blockers:

- Should `minimal_sufficient_stage` be required directly on eval cases, or nested under an `assembly_expectation` object?
- Should linked-neighbor expansion include only Markdown links at first, or also explicit card-to-chunk links?
- Should `domain_constraints` enter the first subset if locked cards leave visible gaps?
- What payload ceiling should be considered acceptable for the anchored implementation slice?
