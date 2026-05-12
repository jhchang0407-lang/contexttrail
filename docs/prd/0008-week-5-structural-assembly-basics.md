# PRD-0008: Week 5 structural assembly basics

> Source-of-truth canonical doc. Mirrored to issue tracker as the project's eighth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Predecessor: [PRD-0006](0006-fact-finding-quality-and-context-assembly-bridge.md). Related ADRs: [ADR-0012](../adr/0012-retrieve-context-pack-rendered-text-opt-in.md), [ADR-0017](../adr/0017-structural-assembly-rollout-contract.md).
>
> **Sequencing rule:** this PRD follows fact-finding hardening. It proves the first narrow slice of Context Pack quality and keeps low-signal recovery separate.

## Problem Statement

ContextTrail's retrieval engine now performs strongly on the main query shapes that matter: anchored coding queries, cross-module queries, broad unanchored coding queries, and decision lookups. The current deterministic fixture passes all retrieval gates, and synthetic compression or token-multiplied assembly pressure does not expose a meaningful bend point.

That is good progress, but it leaves a specific product question unresolved:

> Once ContextTrail has already found the right grounded source object, can it add the minimum surrounding context needed for a safe implementation change?

Today, the system can often retrieve the right primary Doc Chunk or locked Card, but the product still lacks a proven answer for surrounding structure:

- when parent section context belongs
- when same-document sibling sections belong
- when directly linked rationale or operational docs belong
- when adding more context becomes noise instead of help

If ContextTrail does not answer that question deterministically, week 6 bootstrap and week 7 dogfood will build on a pack surface that still treats "found the right thing" and "gave the agent enough to act safely" as the same problem.

At the same time, week 5 must not overreach. Low-signal recovery remains a separate weakness. Broad-query widening, semantic neighbor discovery, embeddings, and LLM-driven sufficiency judgment are not the right first move here. The problem to solve now is narrower:

- prove the basics of **structural assembly**
- keep it inspectable
- keep it grounded in authoritative context
- ship it live only for the narrow slice it actually proves

## Solution

Add a **structural assembly** layer as the first narrow slice of Context Pack quality.

The workflow is:

1. Use the existing retrieval pipeline to identify the right grounded source object.
2. Select one grounded root for structural assembly.
3. Evaluate a deterministic structural ladder:
   - `primary_only`
   - `parent`
   - `siblings`
   - `linked_neighbor`
4. Stop as soon as the minimal sufficient stage is reached.
5. Treat over-expansion as a real failure, not a free win.
6. If the offline eval proves the targeted behavior, ship the same narrow behavior into live `retrieve_context_pack` results for that slice.

The product slice is intentionally narrow:

- anchored implementation queries
- one grounded source chunk root
- deterministic structural neighbors only
- no broad-query widening
- no low-signal recovery changes
- no semantic or embedding-driven neighbor discovery

This PRD also defines the rollout contract for live behavior:

- once proven, structural assembly becomes the default for its narrow slice
- it does not introduce a new user-facing config burden
- it remains inspectable through a mixed response contract:
  - `assembly_stage_reached` may be always-on
  - detailed assembly reasoning lives under `explain`
- `not_applicable` must remain distinct from `primary_only`

## User Stories

1. As an agent operator, I want ContextTrail to distinguish fact-finding quality from structural assembly quality, so that I can debug missing context without relitigating retrieval ranking.
2. As an agent operator, I want a Context Pack to include the minimum surrounding structure needed for a safe implementation change, so that the agent does not miss nearby rules or rationale.
3. As an agent operator, I want structural assembly to start from grounded context, so that additional context is traceable to a known authoritative source.
4. As an agent operator, I want structural assembly to stay deterministic, so that I can understand and trust why neighboring context appeared.
5. As an agent operator, I want structural assembly to stop once it is sufficient, so that the agent does not get flooded with avoidable extra context.
6. As an agent operator, I want over-expansion treated as a real defect, so that bigger packs do not masquerade as better packs.
7. As an agent operator, I want parent section context included when it materially frames the grounded source, so that the agent understands the section it is operating inside.
8. As an agent operator, I want relevant sibling sections included selectively, so that the pack captures nearby behavior without dumping the whole document neighborhood.
9. As an agent operator, I want directly linked rationale or operational docs surfaced when they materially constrain the task, so that the agent sees the governing context without broad semantic drift.
10. As an agent operator, I want structural assembly to stay off when the query is not in its supported slice, so that unsupported behavior is not mislabeled as proven assembly.
11. As an agent operator, I want `signal_empty` to remain a separate recovery problem, so that missing grounding is not hidden behind neighbor expansion.
12. As a maintainer, I want week 5 to define a narrow product slice, so that week 6 and week 7 can build on a real improvement instead of a vague ambition.
13. As a maintainer, I want structural assembly measured with explicit fixture expectations, so that success is defined by sufficiency rather than by taste.
14. As a maintainer, I want each targeted assembly case to declare its minimal sufficient stage, so that the eval can tell whether the pack stopped too early or too late.
15. As a maintainer, I want `assembly_need` and `minimal_sufficient_stage` to stay separate, so that "why surrounding context matters" is not collapsed into "how far expansion climbed."
16. As a maintainer, I want the first assembly-focused fixture subset to target anchored implementation questions, so that week 5 proves the most product-relevant basics first.
17. As a maintainer, I want `local_semantics`, `cross_module_boundary`, and `decision_rationale` to lead the first assembly slice, so that structural assembly is tested where structure is most legible.
18. As a maintainer, I want `setup_recovery` and `signal_empty` kept out of the first structural assembly gate, so that recovery work does not blur into pack assembly work.
19. As a maintainer, I want the live runtime behavior to follow the proven narrow slice once the eval wins, so that bootstrap and dogfood exercise the real pack path rather than a lab-only prototype.
20. As a maintainer, I want no new user-facing config toggle for structural assembly rollout, so that product uncertainty does not become setup burden.
21. As a maintainer, I want live structural assembly to remain inspectable, so that future pack growth is not invisible magic.
22. As a maintainer, I want `assembly_stage_reached` available as a small behavior-shaping summary, so that agents and tooling can react to how far assembly climbed.
23. As a maintainer, I want detailed assembly reasons under `explain`, so that the normal MCP contract stays compact while debugging remains possible.
24. As a maintainer, I want `not_applicable` distinguished from `primary_only`, so that "assembly did not run" is not confused with "assembly ran and stayed at the root."
25. As a maintainer, I want default CLI output to stay calm, so that human readers are not forced to read execution-trace noise for every pack.
26. As a maintainer, I want assembly stage surfaced in CLI only when the user asks for `--explain` or when the stage matters to a warning/debug flow, so that the interface stays readable.
27. As a maintainer, I want the structural ladder to stay rooted in one grounded source chunk in the first pass, so that assembly does not prematurely turn into graph search.
28. As a maintainer, I want card-led retrievals to resolve to a best supporting chunk before structural assembly runs, so that neighbor selection stays source-grounded rather than card-body-grounded.
29. As a maintainer, I want multi-linked cards to choose one best root in week 5, so that the first assembly slice remains measurable and bounded.
30. As a maintainer, I want parent context treated as a fixed structural unit in the first pass, so that complexity budget goes toward the parts where real selection is needed.
31. As a maintainer, I want sibling selection to be deterministic and local, so that we do not smuggle semantic retrieval into week 5 under the name of "neighbors."
32. As a maintainer, I want linked-neighbor policy to start conservative, so that the first proof is stable even if later weeks deepen what counts as a neighbor.
33. As a maintainer, I want later weeks to be able to deepen neighbor policy without invalidating week 5's core principles, so that the product can learn from bootstrap and dogfood evidence.
34. As a maintainer, I want the assembly benchmark to compare `primary_only`, `parent`, `siblings`, and `linked_neighbor`, so that stage-level gains and regressions are visible.
35. As a maintainer, I want the benchmark to measure both under-expansion and over-expansion, so that structural assembly does not optimize only for recall.
36. As a maintainer, I want payload growth measured by stage, so that structural sufficiency is judged alongside context pressure.
37. As a maintainer, I want existing retrieval gates to remain hard guardrails during structural assembly work, so that pack improvements do not quietly erode fact-finding correctness.
38. As a maintainer, I want the response contract to stay compatible with current MCP design principles, so that assembly observability follows the same always-on versus `explain` split as retrieval observability.
39. As a maintainer, I want week 6 bootstrap to assume only the proven narrow structural baseline, so that bootstrap evaluation does not claim benefits from broader unresolved assembly behavior.
40. As a maintainer, I want week 7 dogfood to compare fact-finding only versus structural-assembly-enabled packing, so that the product value of week 5 is directly measurable.
41. As an evaluator, I want targeted assembly cases to fail when the primary source is right but the surrounding context is insufficient, so that week 5 tests the real product gap.
42. As an evaluator, I want targeted assembly cases to fail when the pack climbs past the minimal sufficient stage, so that more context is not automatically treated as better context.
43. As an evaluator, I want stage-level results rendered in reports, so that I can see where structural assembly is succeeding or overshooting.
44. As an evaluator, I want `assembly_stage_reached` visible in machine-readable outputs, so that later dashboards and comparisons can consume the same signal.
45. As a future assembly implementer, I want week 5 to freeze the first structural contract without freezing the forever-definition of neighbor policy, so that later improvements remain possible without rewriting the product story.

## Implementation Decisions

- Introduce **structural assembly** as a named product concept under Context Pack quality, distinct from low-signal recovery.
- Keep the first week-5 slice narrowly scoped to anchored implementation questions where the primary grounded source is already correct.
- Preserve the separation between fact-finding quality and structural assembly quality.
- Add a deterministic structural ladder with explicit stages: `primary_only`, `parent`, `siblings`, `linked_neighbor`.
- Treat structural assembly as rooted in one grounded source chunk, even for card-led retrievals.
- Resolve card-led structural assembly through the best grounded supporting chunk rather than through the card body itself.
- Keep the first linked-neighbor policy conservative and deterministic rather than trying to solve the final neighbor model in week 5.
- Model sufficiency as an eval-first concept through explicit minimal-stage expectations on targeted fixture cases.
- Add an explicit assembly-stage axis separate from `assembly_need`.
- Measure both under-expansion and over-expansion.
- Count stage-level over-expansion as a true product failure.
- Keep broad-query widening and low-signal recovery out of the first structural assembly implementation slice.
- Keep semantic neighbor discovery, embeddings, and LLM-driven assembly judgment out of week 5.
- Introduce or deepen a structural assembly module boundary so neighbor selection and stage progression do not get buried inside scoring or presentation logic.
- Keep retrieval responsible for finding the grounded source object.
- Keep structural assembly responsible for selecting deterministic neighbors and early-stop behavior.
- Keep presentation responsible for formatting the resolved pack and its observability fields.
- Add a live rollout contract: once the targeted offline eval wins, structural assembly ships into live `retrieve_context_pack` behavior for the supported slice.
- Do not add a user-facing config toggle for that rollout.
- Add a mixed observability contract:
  - a minimal always-on assembly stage summary
  - detailed assembly reasoning under `explain`
- Distinguish `not_applicable` from `primary_only` in the response contract.
- Keep default human-readable CLI output free of assembly-stage trace noise unless the user asks for `--explain` or the stage matters to a warning or debugging flow.
- Preserve all existing retrieval correctness gates while structural assembly is introduced.
- Allow week 6 bootstrap and week 7 dogfood to deepen the product based on the proven narrow baseline rather than assuming broad assembly is already solved.

## Testing Decisions

- Good tests must verify external behavior and contract surfaces, not implementation details.
- Structural assembly tests should read like product assertions: "this anchored implementation query stops at `parent`" or "this case over-expands to `linked_neighbor` and fails," not "helper X picked helper Y."
- The targeted assembly fixture subset should be the main integration surface for week 5.
- That subset should include at least one live stage-checked case for `parent`, `siblings`, and `linked_neighbor` before week 6 bootstrap or week 7 dogfood claim the baseline is ready.
- Assembly-stage expectations should be validated at fixture-load time so malformed cases fail fast.
- The offline structural assembly benchmark should be testable as a deep module with stable stage-by-stage outputs.
- The live `retrieve_context_pack` contract should be tested at the MCP handler layer once structural assembly ships for the narrow slice.
- Response-contract tests must cover:
  - `assembly_stage_reached` presence and value semantics
  - `not_applicable` vs `primary_only`
  - detailed assembly reasons under `explain`
  - unchanged `signal_empty` behavior
  - unchanged locked correctness and warning honesty
- CLI and rendering tests should confirm that default human-readable output stays calm while `--explain` exposes the new assembly signals.
- Modules that deserve direct focused tests include:
  - assembly root selection
  - structural stage progression
  - sibling selection
  - linked-neighbor selection
  - early-stop behavior
  - response-surface shaping for assembly observability
- Prior art in the codebase includes:
  - fixture retrieval evals
  - assembly-pressure benchmark tests
  - MCP contract-equivalence tests
  - MCP schema tests
  - render/explain tests
  - snapshot and payload-size tests around `retrieve_context_pack`
- When assembly behavior goes live, test the highest stable interface that exposes the behavior rather than private helper internals.

## Out of Scope

- Broad-query widening for under-specified but not `signal_empty` requests.
- Low-signal recovery and `signal_empty` behavior changes.
- Embedding-based neighbor discovery.
- LLM-based runtime sufficiency judgment.
- Repo-wide semantic neighbor search.
- Multi-root assembly.
- Second-hop graph expansion.
- New user-facing structural-assembly configuration.
- Full final definition of neighbor policy for all future weeks.
- Card bootstrap implementation details beyond what week 6 already owns.
- Setup confidence and task readiness work.
- Drift detection and freshness automation.

## Further Notes

- This PRD is intentionally narrower than "full context assembly." It proves the first grounded, deterministic, inspectable slice.
- Week 5's job is not to settle the forever-shape of assembly. Its job is to prove that ContextTrail can improve a Context Pack after retrieval without turning into opaque semantic retrieval.
- Neighbor policy is expected to deepen in later weeks based on bootstrap and dogfood evidence, but the stable principles should remain:
  - grounded
  - deterministic
  - cautious
  - inspectable
- If the week-5 slice does not show a clear win on the targeted cases, the right response is to defer live expansion with evidence, not to broaden the problem until something looks good.
