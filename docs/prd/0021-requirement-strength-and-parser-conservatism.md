# PRD-0021: Caller-Anchored Requirements and Parser Inference as Optional Evidence

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's twenty-first PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0015](../adr/0015-task-readiness-gates-authority-not-access.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md), [ADR-0020](../adr/0020-retrieval-engine-v2-source-first-ceiling-probes.md). Related PRDs: [PRD-0019](0019-task-facet-harness-and-deterministic-evidence-policy.md), [PRD-0020](0020-deterministic-facet-coverage-and-evidence-based-top3-selection.md).
>
> Boundary rule: only caller-supplied anchors are required-facet evidence. Everything the parser infers from task text is optional evidence — citable, scorable, but never grounds for failing closed. Excluded facets remain penalty-only, derived strictly from explicit caller-typed negation patterns.

## Problem Statement

PRD-0020 shipped a deterministic facet coverage provider and an evidence-based top-3 assembly policy. The first real-corpus shadow run regresses displayed retrieval rather than improving it.

| Metric | Displayed | Deterministic v1 + new policy | Δ |
|---|---:|---:|---:|
| top-1 | 105/121 | 94/121 | **−11** |
| top-3 | 118/121 | 104/121 | **−14** |
| rescues | — | 2 | |
| regressions | — | 13 | |
| true top-3 misses | — | 2 | |

Bottleneck attribution on cases where the deterministic engine missed top-1:

| Layer | Count |
|---|---:|
| parser | 0 |
| candidate_generation | 27 |
| coverage | 21 |
| policy | 6 |

The failure mode is consistent across regression traces. The parser puts every extracted token into `required_facets` — typical examples from the corpus include `topic:across`, `topic:set`, `topic:run`, `topic:react`, `topic:multiple`. The deterministic provider correctly returns `absent` because no candidate's title or headings match those shards. The facet policy then fails closed: no candidate has direct or supporting required-facet evidence, so the pack is empty and the displayed-best source loses its slot.

The architecture is not at fault. Every case parsed cleanly (parser bucket = 0) and the policy followed its specified rules. What's missing is a discipline boundary: the parser is allowed to convert any inferred token into a hard requirement that the policy must respect. There is no separation between "the caller stated an explicit anchor" (auditable, trusted) and "the parser inferred a topic from a verb keyword" (heuristic, brittle).

The next product question is:

> Can the parser produce useful evidence without granting itself authority to gate retrieval?

## Solution

Restrict `required_facets` to caller-supplied anchors only. Route every parser-inferred facet through `optional_facets`, which already has the right semantics (boost when matched, never gate, never cause displacement). When required-facet coverage cannot be satisfied, fall back deterministically to raw source-rerank order — except in the cases where the caller's explicit signal must be honored.

Concretely:

- `required_facets` carries only `file:`, `symbol:`, and `route:` facets that come from the caller's `query_anchors` field.
- `optional_facets` carries every other parser-emitted facet: `topic:*`, `task:*`, `role:*`, `constraint:*`, plus the legacy unprefixed names (`examples`, `step_by_step`, `rationale`).
- `excluded_facets` is unchanged in mechanism: parser-emitted from the existing `NEAR_MISS_PATTERNS` regex bank, applies the existing `EXCLUDED_CONTRADICTED_PENALTY = -0.4 × weight` in the policy-active path. Excluded facets remain penalty-only — they never gate pack-usability and never cause empty packs. The contract gains explicit metadata fields documenting this authority axis.
- `TaskFacetSpec.schema_version` does **not** bump — the contract is unchanged. This is a parser-emission and policy-fallback change, not a contract change.

### Policy decision tree

The policy follows this precedence on every case:

```
1. ambiguity == "high"
   → readiness = "needs_clarification"
   → empty pack
   → clarification_hints surfaced

2. spec.required_facets is empty (caller supplied no anchors)
   → readiness = "ready_no_caller_anchor"
   → selection_mode = "source_rerank_fallback"
   → top-3 by raw source_rerank_score, stable path tie-break
   → no facet deltas applied

3. spec.required_facets non-empty AND
   no candidate has direct/supporting coverage of any required facet AND
   the unmet anchor IS in the imported source set
   → readiness = "needs_anchor"
   → empty pack
   → clarification_hints lists the unmet anchors

4. spec.required_facets non-empty AND
   no candidate has direct/supporting coverage of any required facet AND
   the unmet anchor is NOT in the imported source set
   → readiness = "ready_no_caller_anchor"
   → selection_mode = "source_rerank_fallback"
   → top-3 by raw source_rerank_score, stable path tie-break
   → no facet deltas applied

5. spec.required_facets non-empty AND
   at least one candidate has direct/supporting coverage
   → policy-active path (PRD-0020 logic)
   → set-cover top-3 assembly with primary + complementary picks
   → all PRD-0020 rules in effect (topic-only-no-anchor top-1 guard,
      complementary displacement, source-family redundancy, etc.)
```

### Anchor-in-corpus check (Q6)

The "anchor is in the imported source set" check fires only on path **3 vs 4** above. Implementation:

- For `file:<path>` anchors: walk `imported_source_paths` and apply the same matching rules `deterministic_v1` uses for `file:` direct coverage (exact path / suffix / basename / extensionless basename). If any imported source matches, the anchor is in-corpus.
- For `symbol:<sym>` and `route:<r>` anchors: lazy semantics — the anchor is considered in-corpus iff at least one candidate in the top-N slate has direct or supporting coverage of it. (No cheap whole-corpus scan exists for these without indexing content.)

### Source-rerank fallback semantics (Q7)

When the policy enters `source_rerank_fallback` mode, top-3 ordering is determined by raw `source_rerank_score` only. **No facet-derived deltas are applied** — no required deltas, no optional boosts, no role_fit, no anchor_boost, no excluded penalty. This guarantees the invariant:

> If fallback is selected, PRD-0021 must preserve displayed source-rerank ordering exactly.

The policy result records this explicitly:

```ts
selection_mode: "source_rerank_fallback",
fallback_score_basis: "source_rerank_score_only",
ignored_policy_deltas: [
  "required_facet_deltas",
  "optional_facet_deltas",
  "excluded_facet_penalty",
  "anchor_boost_delta",
  "role_fit_delta",
],
```

A future "fallback plus caller negatives" mode (which would re-include `excluded_facet_penalty` in fallback) is explicitly out of scope and would land as a separately named selection mode with its own eval gate.

### Excluded facet authority (Q10)

Excluded facets are kept as-is but the contract gains explicit authority metadata, and the explain trace gains provenance fields:

```ts
// On FacetReference (excluded bucket only):
authority: "caller_text_negation",
policy_effect: "bounded_penalty",
can_gate_pack: false,

// In explain trace per excluded match:
{
  facet: "deprecated_path",
  source: "explicit_negation_pattern",
  matched_text: "not deprecated",
  policy_effect: "score_penalty_only"
}
```

Excluded patterns must remain tied to explicit textual negation; broadening to inferred or implicit negation is out of scope and requires its own eval gate.

## User Stories

1. As a ContextTrail maintainer, I want the parser to never put inferred facets into `required_facets`, so that parser brittleness cannot gate retrieval.
2. As a ContextTrail maintainer, I want caller-supplied anchors to remain the only source of required facets, so that the trust boundary already established for setup (ADR-0014) is preserved in retrieval.
3. As a ContextTrail maintainer, I want parser-inferred facets to remain inspectable and scoreable, so that explain traces continue to surface useful evidence.
4. As a ContextTrail maintainer, I want the policy to fall back to raw source-rerank order when no caller anchor was supplied, so that the deterministic engine cannot regress below the displayed baseline by emitting an empty pack.
5. As a ContextTrail maintainer, I want fallback to use raw `source_rerank_score` with zero deltas, so that the fallback path is provably equivalent to displayed retrieval and easy to debug.
6. As a ContextTrail maintainer, I want the policy to fail closed only when caller anchors were supplied and the anchor maps into the imported source set, so that explicit caller claims still produce honest "needs_anchor" outputs without regressing on out-of-corpus anchors.
7. As a ContextTrail maintainer, I want `ambiguity=high` to preserve PRD-0020's `needs_clarification` failure mode, so that the parser's "I don't know" signal is never silently downgraded to a guess.
8. As a ContextTrail maintainer, I want the existing PRD-0020 set-cover and complementary-pick rules to remain in force on the policy-active path, so that pack assembly behavior on real anchored tasks does not change.
9. As a ContextTrail maintainer, I want the existing optional-facet boosts to apply unchanged on the policy-active path, so that doc-level relevance still surfaces in shadow_score for ranking.
10. As a ContextTrail maintainer, I want excluded facets to remain penalty-only with explicit authority metadata and trace provenance, so that the bounded blast radius is documented and future broadening requires a separate eval gate.
11. As a ContextTrail maintainer, I want a strict `regressions == 0` promotion gate, so that no displayed top-1 is silently downgraded by the new engine.
12. As a ContextTrail maintainer, I want the real-corpus shadow eval to split regressions by anchor presence (`regressions_caller_anchored` vs `regressions_unanchored`), so that the next PRD can attribute residual misses correctly.
13. As a ContextTrail maintainer, I want every fallback selection traced with `selection_mode`, `fallback_score_basis`, and `ignored_policy_deltas`, so that explain output is unambiguous about which path produced the pack.
14. As a future implementer, I want this slice to make zero contract changes to `TaskFacetSpec` schema_version, so that downstream eval baselines and persisted artifacts stay diffable.
15. As a future PRD author, I want bottleneck attribution to remain split into parser / candidate_generation / coverage / policy, so that the next PRD can target the correct layer (currently candidate_generation, 27 cases).

## Implementation Decisions

### Parser changes

- `parseTaskDeterministically` is updated so that:
  - `required_facets` contains only `file:`, `symbol:`, and `route:` facets derived from `query_anchors`.
  - `optional_facets` contains every facet derived from task text: `topic:*`, `task:*`, `role:*`, `constraint:*`, and existing unprefixed entries.
  - Weights, kinds, and the closed-set conservative emission rules from THO-195 are preserved — only the bucket changes for parser-extracted entries.
  - When `query_anchors` is empty, `required_facets` is empty.

### Contract changes

- `TaskFacetSpec.schema_version` stays at `1`. No migration.
- `verifyTaskFacetSpec` relaxes the `high_confidence_without_required_facets` rule. The new rule: confidence ≥ 0.7 requires `query_anchors` non-empty **or** `optional_facets` non-empty. Either side proves the parser produced grounded structured output.
- `FacetPolicyReadiness` adds `"ready_no_caller_anchor"` to its union. Existing values (`"ready"`, `"needs_clarification"`, `"needs_anchor"`, `"no_supporting_evidence"`) keep their meanings.
- `FacetPolicyResult` adds `selection_mode: "policy_active" | "source_rerank_fallback"`, `fallback_score_basis: string | null`, `ignored_policy_deltas: string[]`. These are populated only on the fallback path; the policy-active path leaves `selection_mode = "policy_active"` and the others empty.
- `FacetReference` for excluded-bucket facets gains optional metadata: `authority: "caller_text_negation"`, `policy_effect: "bounded_penalty"`, `can_gate_pack: false`. Required and optional facets do not carry these fields.
- The existing `FacetPolicyExplainTrace.facet_signals` entry for excluded matches gains `source: "explicit_negation_pattern"` and `matched_text: string` fields.

### Policy changes

- `applyFacetCoveragePolicy` accepts a new optional input `imported_source_paths: Set<string>`. When omitted, the policy treats all caller anchors as "in-corpus" (preserves previous behavior for callers that don't yet supply this).
- Policy follows the five-state decision tree above. No PRD-0020 rule on the policy-active path is changed.

### Eval changes

- `runFacetTop3ShadowEval` summary gains `regressions_caller_anchored` and `regressions_unanchored` counts.
- The pre-existing `oracle_improves_miss_cohort` gate from PRD-0019 facet-oracle eval is wired into the PRD-0020 top-3 shadow gate set as a hard gate.
- A new strict gate `regressions_zero` is added: `regressions == 0`.

## Testing Decisions

- Update parser unit tests so they assert `topic:*`, `task:*`, `role:*`, `constraint:*` land in `optional_facets`, never `required_facets`.
- Update parser unit tests so caller-supplied anchors land in `required_facets` and only there.
- Update the high-confidence verifier test to reflect the relaxed rule (anchors-or-optional).
- Add a regression test reproducing the PRD-0020 failure mode: a task with no anchors and a noisy `topic:across`-style required-facet bucket. Assert the policy enters `source_rerank_fallback`, top-3 matches what `source_rerank_score` would pick, `selection_mode` and `ignored_policy_deltas` populated correctly.
- Add a policy unit test for the `needs_anchor` failure mode: caller supplies `query_anchors.files = ["src/x.ts"]`, `imported_source_paths` contains `src/x.ts`, no candidate covers it. Assert empty pack and `readiness === "needs_anchor"`.
- Add a policy unit test for the anchor-out-of-corpus fallback: caller supplies `query_anchors.files = ["src/x.ts"]`, `imported_source_paths` does NOT contain anything matching `src/x.ts`. Assert `readiness === "ready_no_caller_anchor"`, `selection_mode === "source_rerank_fallback"`.
- Add a policy unit test for `ambiguity=high` preservation: spec with `ambiguity: "high"` and empty `required_facets`. Assert `readiness === "needs_clarification"` regardless of candidates available.
- Add a policy unit test verifying the fallback invariant: in `source_rerank_fallback` mode, the top-3 order is byte-identical to sorting candidates by `source_rerank_score` with stable path tie-break.
- Add an excluded-facet test asserting the trace contains `source: "explicit_negation_pattern"` and `matched_text` when a contradiction is detected.
- Run the real-corpus shadow eval before and after; the report must include the `regressions_caller_anchored` and `regressions_unanchored` split and pass every gate.
- Run focused facet suites, full `npm test`, `npx tsc --noEmit`, `npm run eval:real-corpus`, and the new top-3 shadow eval before any promotion discussion.

## Promotion Gates

Conjunctive — every gate must pass before promotion:

- `npm test` passes.
- `npx tsc -p tsconfig.json --noEmit` passes.
- `npm run eval:real-corpus` has no safety regression.
- coverage honesty remains `148/148`.
- top-1 does not regress from `106/122`.
- top-3 does not regress from `118/122`.
- deterministic coverage shadow top-3 ≥ `119/121`.
- true top-3 misses ≤ `3`.
- `regressions == 0` (no per-case regression vs. displayed top-1).
- `oracle_improves_miss_cohort` passes (rescues > 0 OR no displayed misses to rescue).
- agent answer correct ≥ `147/148`.

There is no parser-quality numeric gate. The regression-count gate is the empirical backstop for parser quality.

## Out of Scope

- Candidate-generation improvements. The shadow eval shows 27 cases where the accepted source is not in the top-N candidate slate. Separate PRD; this slice cannot rescue cases the candidate pipeline did not produce.
- A `RetrievalIntent` v2 contract with provenance and confidence on every facet. Not needed for the regression fix.
- Caller-supplied `query_anchors.excluded_concepts`. Cleaner long-term contract, but adds interface surface before any caller actually supplies it.
- Broadening excluded-facet patterns beyond explicit textual negation. Requires its own eval.
- "Fallback plus caller negatives" mode that re-includes `excluded_facet_penalty` in fallback. Future separately-named mode with its own gate.
- AI parser. Deterministic parser only.
- Embedding-based coverage. Optional and ablation-only per PRD-0020 / THO-200.
- Production MCP response-shape changes. Shadow-only first.
- Per-case ranking hacks for current corpus misses.

## Further Notes

The data is unambiguous about where the lift is and is not. Parser bucket is 0 — the contract works. The 13 regressions are concentrated in cases where `query_anchors` was empty and the parser inferred topic-shaped required facets that no candidate could match. This PRD cuts the regression vector at the source: the parser no longer has authority to put inferred tokens into `required_facets`.

The trust boundary is the load-bearing principle. ADR-0014 already made this call for setup ("agent-assisted setup without truth promotion"). PRD-0020 stayed within deterministic policy authority but allowed parser inference to flow into the same gating bucket as caller-declared anchors. PRD-0021 brings retrieval back in line with ADR-0014: parser inference is supplemental evidence, not authority.

The design tree was resolved through a grilling pass that identified ten branch points; all locked in this doc:

1. Fallback semantics → raw `source_rerank_score` order.
2. Caller anchor unmet → fail closed only when in-corpus.
3. Soft evidence → existing `optional_facets`, no new field.
4. Anchor-in-corpus check → required for the fail-closed-vs-fallback decision.
5. `ambiguity=high` → preserve PRD-0020 `needs_clarification`.
6. In-corpus check → path-rule for `file:`, lazy slate-presence for `symbol:`/`route:`.
7. Fallback details → pure raw source_rerank, zero deltas, explicit trace fields.
8. Parser-quality gate → dropped; regression-count is the backstop.
9. Regressions threshold → strict zero, paired with `oracle_improves_miss_cohort`.
10. Excluded facets → keep as-is, penalty-only, with explicit authority metadata and provenance trace.

The single design risk to watch: if a future caller starts populating `query_anchors` with weak anchors (e.g., the AI parser feeding a guessed file path back into anchors), the same fail-closed regression returns through a different door. The defense is the existing authority guard on `query_anchors` — a caller-supplied field, not a parser-output one — plus the `regressions == 0` gate as the empirical backstop.

This PRD is intentionally smaller than a full contract rewrite. The simpler choice — collapse the new evidence axis into the existing `optional_facets` bucket and tighten parser emission — is also the more defensible one. A larger `RetrievalIntent` v2 may follow once we know which axis (confidence, provenance, ambiguity scope) actually moves the metric.
