# PRD-0005: Post-dogfood assessment — retrieval correctness and observability

> Source-of-truth canonical doc. Mirrored to issue tracker as the project's fifth PRD issue.
>
> Spec references throughout: `D{n}` = entry in [`docs/DESIGN.md`](../DESIGN.md); `ADR-NNNN` = [`docs/adr/`](../adr/). Glossary: [`docs/CONTEXT.md`](../CONTEXT.md). Predecessor: [PRD-0004](0004-mcp-payload-size.md).
>
> **No schedule pressure.** This is a post-dogfood correctness pass, not a race. If a gate fails, re-grill the design before lowering the bar.

## Problem Statement

PRD-0004 proved that the MCP payload can be made dramatically smaller without degrading answer quality. The remaining failures in the 20-query eval are now visible as *retrieval correctness* failures, not payload-shape failures.

Three patterns showed up repeatedly:

- **Locked-card misses on anchored file queries.** The cards are present in ranked output, but the hierarchical lock guarantee does not fire because file anchors do not reliably produce inferred query scope.
- **Meta-doc noise floods top-ranked results.** ContextTrail's own example-heavy docs mention canonical symbols and phrases (`RefundService.processRefund`, `idempotent`, `audit`) so often that BM25 and mention overlap let ideation/example prose crowd out the more useful operational docs.
- **Evidence cards under-rank even when they directly justify a locked rule.** `covers:` links exist, but retrieval does not currently treat them as part of the same connected explanation.

The 20-query eval also exposed an observability gap. We can tell a query failed, but not cleanly distinguish:

- "the user gave no structural signals,"
- "the user tried to anchor but ContextTrail could not ground them,"
- "the system inferred scope but a specific card still failed to lock,"
- "meta-doc demotion did or did not fire."

PRD-0005 fixes the correctness issues that are deterministic and local to the scoring/locking layer. It deliberately does **not** solve broad-query widening for fully unanchored requests; that is deferred to a later PRD once anchored correctness is fixed and query-mode observability exists.

## Solution

PRD-0005 ships six changes:

1. **Anchor-derived query scope inference** with `code_scopes` config fallback only on total emptiness. Anchors are truth; config is fallback; empty is honest.
2. **Multi-candidate inferred scope sets** per anchor (file/symbol/route), deduped by canonical scope tuple and capped at 10 unique scopes per anchor.
3. **One-hop `covers:` evidence promotion into the locked tier** via a new `lock_reason` kind, `evidence_covers_locked`, with bounded fan-out and provenance.
4. **`doc_role`-aware ranking demotion** so ideation/example/archive docs stop crowding anchored implementation queries.
5. **`query_mode` detection** (`anchored`, `signal_empty`, `unanchored`) plus a new `anchors_unrecognized` warning.
6. **Richer retrieval observability**: top-level `query_mode`, opt-in `explain.query_compilation`, `lock_failures`, and per-chunk role multipliers.

The phase is intentionally bounded. It does **not** implement a broad-query fallback algorithm. Instead it tags broad-query requests accurately so later work can target the `unanchored` bucket without muddying anchored correctness gates.

## User Stories

### Anchor-derived query scope inference

1. As a developer querying with `files: ["src/payments/refund.ts"]`, I want ContextTrail to infer scope from existing anchored cards and chunks tied to that file so project- and module-level constraints can lock without manual config.
2. As a developer, I want anchor-derived scope inference to be the primary path and `code_scopes` config to run only when anchor-derived inference returns no scopes for a file at all.
3. As a developer on a sparse day-1 repo, I want to author optional `code_scopes` path rules so file-anchored retrieval can still infer module/project scope before cards exist.
4. As a developer, I want empty anchor-derived inference to remain honest when no fallback exists, rather than silently inventing scope from heuristics.

### Multi-candidate scope sets

5. As a developer, I want a file anchored by multiple cards/chunks to contribute multiple candidate `QueryScope` values rather than a synthetic merged scope.
6. As a developer, I want candidate scopes deduped by canonical scope tuple and capped at 10 unique scopes per anchor (file/symbol/route) so popular anchors do not flood retrieval with redundant candidates.
7. As a developer, I want obviously stale sources filtered out before they contribute inferred scopes so deprecated or tombstoned artifacts do not contaminate locking.

### Evidence connected to locked rules

8. As a developer, I want evidence cards whose `covers:` list references an already-locked card to be promoted into the `locked` section with a new `lock_reason`, not merely boosted in ranked output.
9. As a developer, I want this traversal to be strictly one-hop from already-locked cards so the lock graph remains bounded and explainable.
10. As a developer, I want evidence promotion capped at 2 evidence cards per primary locked card, with dedupe across primaries, so one widely-referenced rule cannot explode locked overhead.
11. As a developer, I want promoted evidence to carry `derived_from: card_id[]` provenance so I can see which locked cards pulled it in.

### Doc-role-aware demotion

12. As a developer running an anchored or inferred-scope query, I want ideation/example docs demoted relative to canonical docs so example-heavy product prose stops flooding top-3 results.
13. As a developer, I want `archive` docs demoted on every query, even fully unanchored ones, because archived content is stale by definition.
14. As a developer, I want `doc_role` computed deterministically at import time with precedence `frontmatter > path default > canonical default`.
15. As a developer, I want frontmatter override to win over path defaults so authored truth can promote or demote a doc explicitly when repo conventions differ.

### Query modes and warnings

16. As a developer, I want every retrieval response to declare `query_mode` as one of `anchored`, `signal_empty`, or `unanchored` so I can tell whether I gave useful structural signals and whether ContextTrail recognized them.
17. As a developer who supplied files/symbols/routes but got no inferred scope, I want a structured `anchors_unrecognized` warning telling me that my anchors produced no inferred scope and suggesting what to do next.
18. As a developer, I want `signal_empty` to be distinct from `unanchored` because "I tried to anchor and ContextTrail failed" is a different diagnosis from "I provided only natural language."

### Observability and eval support

19. As a developer, I want top-level always-on fields to stay lean: `query_mode` and warnings for agent behavior; heavy diagnostics remain behind `explain: true`.
20. As an evaluator, I want `explain.query_compilation` to show provided/recognized anchor counts, inferred scopes, inference mode per anchor, and contributing anchors so I can debug grounding failures mechanically.
21. As an evaluator, I want `lock_failures` with enum failure reasons so expected-locked misses can be bucketed by cause instead of reverse-engineered from the output.
22. As an evaluator, I want `per_chunk` traces to include `doc_role`, `role_source`, and `role_multiplier` so meta-doc demotion is directly visible in the score trace.

## Implementation Decisions

### Architecture and scope

- **Anchors are truth. Config is fallback. Empty is honest.** Per-anchor scope inference (across all three anchor kinds: `file`, `symbol`, `route`) consults anchor-derived candidates first. Only when that returns no scopes for an anchor does `code_scopes` run, and `code_scopes` is file-pattern-only — symbol/route anchors with empty anchor-derived inference contribute nothing. If both paths are empty, the anchor contributes no inferred scope.
- **Scope inference is multi-candidate, not merged.** `inferQueryScopes` returns one `QueryScope` per unique anchored truth-bearing scope, deduped and capped per anchor. The existing OR semantics in `scope_match` and locked-include matching remain the contract.
- **Connected evidence is part of locked context.** Evidence cards that `covers:` an already-locked card enter the `locked` array with `lock_reason = evidence_covers_locked`. This is a wire-contract change and ships as an **ADR-0011 amendment**, extending the locked-include taxonomy without introducing a competing ADR path.
- **Role-based demotion is deterministic.** `doc_role` is computed at import time from path defaults with frontmatter override. No heuristic content classifier ships in this phase.
- **Broad-query widening is deferred.** PRD-0005 detects `unanchored` mode but does not change the retrieval algorithm for it. Broad-query widening is separate work.

### Query scope inference

- Inference generalizes across all anchor kinds. For each `file`, `symbol`, and `route` value in the request, query `code_anchors_v2 WHERE kind = ? AND value = ?` and gather the scopes of every contributing card/chunk.
- Filter ineligible contributors before scope extraction:
  - cards with `authority: deprecated`
  - chunks with `status: tombstoned`
  - cards with `freshness_state: potentially_superseded`
  - cards with `freshness_state` in `unverified` / `needs_review` / `maybe_affected` still contribute scope; the existing freshness warnings still emit through their normal path.
- Dedupe by canonical scope tuple.
- Rank candidate scopes by:
  1. higher anchor confidence
  2. card-derived over chunk-derived on ties
  3. more specific scope on ties
  4. stable object id as final tie-break
- Keep top 10 unique scopes per anchor.
- If zero remain for an anchor, consult `code_scopes` config rules for it. `code_scopes` matches file path patterns only; symbol- and route-anchor fallback is out of scope for v1 (an anchor of that kind that produced no anchor-derived scope contributes nothing).
- Concatenate per-anchor scope candidates into the request-level `QueryScope[]`.

Performance: anchor-derived inference is O(anchor_count) indexed lookups against `code_anchors_v2 (kind, value)`; expected sub-millisecond per request on the v1 cache.

`code_scopes` config schema (parallel shape to `doc_scopes`; user-authored, no defaults shipped in v1):

```yaml
code_scopes:
  - id: payments-src
    pattern: "src/payments/**"
    scope:
      layer: module
      project: payments
      module_from_path_after: src
  - id: auth-src
    pattern: "src/auth/**"
    scope:
      layer: module
      project: auth
      module_from_path_after: src
```

### Evidence locking

- Extend the lock-reason enum with `evidence_covers_locked`.
- After primary locked cards are resolved, do a one-hop forward traversal over `covers:` links from those cards to evidence cards.
- Filter:
  - `authority: deprecated`
  - `freshness_state: potentially_superseded`
- Keep `verified`, `unverified`, `needs_review`, and `maybe_affected`, surfacing existing freshness warnings as usual.
- Rank candidate evidence deterministically by:
  1. freshness priority (`verified > unverified > needs_review > maybe_affected`)
  2. broader coverage count
  3. stable id
- Cap at 2 evidence cards per primary locked card.
- Dedupe promoted evidence across primaries.
- Carry `derived_from: card_id[]` provenance on the lock reason.

### `doc_role`

- New role enum for doc chunks:
  - `canonical`
  - `ideation`
  - `example`
  - `archive`
- Precedence:
  1. frontmatter `doc_role`
  2. `doc_roles` path rules in config
  3. default `canonical`
- Store:
  - `doc_role`
  - `role_source: frontmatter | config_pattern | default`
- Apply role multipliers only when `query_mode` is `anchored` or `signal_empty`:
  - `canonical`: `1.0`
  - `ideation`: `0.5`
  - `example`: `0.4`
- Always apply (regardless of `query_mode`):
  - `archive`: `0.3`
- The multiplier applies to the chunk's final score after the existing scoring chain, as a thumb on the scale, not a hard filter.

`doc_roles` config schema (parallel shape to `doc_scopes`; defaults shipped in v1):

```yaml
doc_roles:
  - pattern: "docs/{CONTEXT,VISION,IDEAS,DESIGN,SCHEMA,CORE,MVP,OPEN}.md"
    role: ideation
  - pattern: "docs/archive/**"
    role: archive
  - pattern: "docs/runbooks/**"
    role: canonical
  - pattern: "docs/adr/**"
    role: canonical
  - pattern: "docs/prd/**"
    role: canonical
```

Frontmatter override accepts only the four enum values (`canonical | ideation | example | archive`); unknown values fail validation at import time.

Schema additions: `doc_chunk_ext.doc_role TEXT NOT NULL DEFAULT 'canonical'`, `doc_chunk_ext.role_source TEXT NOT NULL DEFAULT 'default'`. Migration is additive, but rollout is **not** complete until existing caches are backfilled. PRD-0005 therefore requires one of two explicit rollout paths:

1. migration-time backfill of `doc_role` / `role_source` for all existing chunks, or
2. a mandatory reindex/re-import step that recomputes both columns before the new ranking behavior is considered active.

Silent reliance on lazy future imports is not acceptable, because it would leave upgraded repos stuck on `canonical/default` and make the doc-role demotion appear implemented without actually affecting ranking.

### Query modes and warnings

- Introduce `query_mode` with three values:
  - `anchored`
  - `signal_empty`
  - `unanchored`
- Structured retrieval signals in v1 are exactly the `files`, `symbols`, and `routes` arrays of the MCP request (the existing v1 request shape locked in PRD-0003 / ADR-0012). Test/diff/error anchors are Prune CR-01 territory and are **out of scope for this PRD**.
- Classification rule (precise predicate):
  - Let `provided_anchor_count = request.files.length + request.symbols.length + request.routes.length`.
  - Let `recognized_anchor_count = number of anchors that were recognized structurally by retrieval`.
  - An anchor counts as structurally recognized when **either**:
    1. the per-anchor scope pipeline (anchor-derived OR `code_scopes` fallback) produced ≥1 non-empty scope, **or**
    2. the anchor matched a structurally-recognized exact surface that retrieval can act on directly even without inferred scope (for example an exact symbol anchor that can drive symbol-note locking, or a recognized route anchor).
  - If `provided_anchor_count == 0` → `unanchored`.
  - Else if `recognized_anchor_count == 0` → `signal_empty`.
  - Else → `anchored`.
- Add warning kind:
  - `anchors_unrecognized`
- Emit `anchors_unrecognized` exactly when `query_mode == "signal_empty"`. Suggested copy:
  - `message`: "Files/symbols/routes were provided but produced no inferred scope."
  - `hint`: "Author cards or chunks anchored to these paths/symbols, or query a path/symbol already present in the corpus."

### Observability schema

Always-on response fields:

- `query_mode`
- `warnings[]` (extended with `anchors_unrecognized`)

Opt-in `explain` additions:

- `query_compilation`
  - `query_mode` — duplicated from top-level so the artifact is self-contained in test logs
  - `provided_anchor_count` — `request.files.length + request.symbols.length + request.routes.length`
  - `recognized_anchor_count` — number of anchors recognized structurally, whether by inferred scope or by exact-anchor recognition
  - `anchors[]` — one entry per provided anchor, including anchors that failed to ground
    - `anchor` — `{ kind: "file" | "symbol" | "route", value: string }`
    - `recognition: scope_inferred | exact_anchor_only | none`
    - `mode: anchor_derived | code_scopes_fallback | none`
    - `scopes[]` — zero or more canonical `QueryScope` tuples
    - `contributing_anchors[]` — empty when `mode == code_scopes_fallback` or `none`
      - `object_id` — id of the contributing card or chunk
      - `kind: card | chunk`
      - `value` — the anchor value (file path, symbol, or route) on the contributor that matched
      - `confidence` — pulled from `code_anchors_v2.confidence`
- `lock_failures[]`
  - `card_id`
  - `card_type`
  - `candidate_match_path`
  - `failed_reason` enum
  - optional `detail`
- `per_chunk[]` gains:
  - `doc_role`
  - `role_source`
  - `role_multiplier`

Suggested `failed_reason` enum:

- `missing_inferred_scope_field`
- `scope_mismatch`
- `no_query_scope`
- `symbol_not_exact`
- `filtered_stale`
- `not_lockable_type`

## Acceptance Criteria

Acceptance is **mode-bucketed**, not pooled. If a target fails, treat it as a design problem, not a target-tuning problem.

### Anchored mode

- Locked-card correctness: **100%**
- Ranked-useful Pass: **≥80%**
- Agent-answer Pass: **≥80%**

### Signal-empty mode

- `anchors_unrecognized` warning emitted: **100%**
- Ranked-useful: best-effort, not a primary gate
- Agent-answer Pass: **≥50%** (graceful degradation)

### Unanchored mode

- No regression versus the pre-PRD baseline on ranked-useful or agent-answer quality
- Improvement is welcome but not required in this PRD

### Cross-cutting gates

- No query that passed in the pre-PRD baseline regresses to fail after PRD-0005.
- Omitted-summary usefulness remains **≥95%**.
- PRD-0004 payload wins are preserved (no material regression in response size shape).
- `query_mode` populated on every response.
- `explain.query_compilation` populated when `explain: true`.
- `explain.query_compilation.anchors[]` contains one entry per provided anchor, including `mode: none` failures.
- `lock_failures` populated when an expected locked card misses.
- `doc_role` populated on every per-chunk explain trace.
- `evidence_covers_locked` entries carry non-empty `derived_from`.

### Eval scope

PRD-0005 gates against the existing 20-query ContextTrail self-hosted eval only. A simulated customer repo is deferred to later work alongside broad-query widening. This keeps the scope aligned with what PRD-0005 actually fixes: anchored correctness and observability.

## Testing Decisions

- **Curate the 20-query eval into a fixture.** The existing 20-query eval lives in conversation transcripts today; PRD-0005 ships it as `tests/fixtures/eval-set.yaml` so the harness can run mechanically. Per-query schema:
  - `task: string`
  - `files?: string[]`, `symbols?: string[]`, `routes?: string[]`
  - `budget?: "small" | "default" | "large"`
  - `expected_query_mode: "anchored" | "signal_empty" | "unanchored"`
  - `expected_locked: string[]` (card ids)
  - `expected_signal_empty_warning: boolean`
  - `expected_evidence_covers_locked?: string[]` (evidence card ids that should appear via one-hop traversal)
  - notes/rubric for ranked-useful and agent-answer scoring
- Reuse this fixture as the sole eval source for PRD-0005's mode-bucketed acceptance gates. A simulated customer repo eval is deferred to PRD-0006.
- Extend the eval harness to request `explain: true` and assert the new observability fields.
- Add targeted tests for:
  - anchor-derived scope inference across all three anchor kinds (`file`, `symbol`, `route`)
  - `code_scopes` fallback on total emptiness only (file-anchor only)
  - scope dedupe and per-anchor cap
  - `evidence_covers_locked` one-hop traversal, N=2/primary cap, dedupe across primaries
  - `doc_role` precedence (frontmatter > config > default) and multiplier application gated on `query_mode`
  - `anchors_unrecognized` warning emission iff `query_mode == "signal_empty"`
  - `query_mode` classification predicate (all three modes plus boundary cases)
- Extend MCP contract tests for:
  - new top-level `query_mode`
  - new warning kind `anchors_unrecognized`
  - new lock reason kind `evidence_covers_locked` with `derived_from: card_id[]`
  - extended `explain.query_compilation` and `explain.lock_failures`
  - extended `explain.per_chunk` with `doc_role`, `role_source`, `role_multiplier`

## Out of Scope

- Broad-query widening / domain-card fallback for fully `unanchored` queries
- Simulated customer repo eval corpus
- Embeddings or LLM rerank
- Heuristic content classification for doc roles
- Multi-hop or transitive evidence locking
- Any payload-shape changes already settled by PRD-0004

## Further Notes

### Why this phase is bounded

This PRD fixes deterministic retrieval correctness issues and adds the observability needed to evaluate them honestly. It does not try to solve every broad-query failure in the same phase. The intent is:

1. fix anchored correctness
2. tag `signal_empty` honestly
3. preserve the payload improvements
4. defer broad-query widening to a later PRD with a cleaner eval split

### Relationship to existing ADRs

- **ADR-0010** continues to govern locked-overflow behavior. `evidence_covers_locked` entries count toward locked overhead under the existing rule; no carve-out.
- **ADR-0011** is amended in place to add `evidence_covers_locked` (one-hop forward traversal of `covers:`, N=2-per-primary cap, dedupe across primaries, deterministic ranking, provenance via `derived_from`). This keeps the locked-include taxonomy in one canonical ADR instead of splitting the matching contract across two files.
- **ADR-0012** remains the contract record for opt-in `rendered_text`. PRD-0005's wire-contract additions (`query_mode` top-level, extended `explain` with `query_compilation` and `lock_failures`, new `evidence_covers_locked` lock_reason kind, new `anchors_unrecognized` warning kind) are **additive**; no existing fields change shape or semantics. ADR-0012's "what's locked" section is updated in this PRD's deliverables to reference the additions.

### What "done" looks like

When PRD-0005 is complete:

- A file-anchored refund query that should lock project/module cards does so reliably.
- Evidence that directly justifies a locked constraint or symbol note appears in `locked`, not buried in ranked output.
- Anchored implementation queries stop flooding on ideation/example docs.
- Every retrieval tells the agent whether it is `anchored`, `signal_empty`, or `unanchored`.
- The eval harness can explain every miss mechanically rather than by manual inspection.
