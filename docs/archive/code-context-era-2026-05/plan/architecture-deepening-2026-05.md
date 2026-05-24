# Architecture deepening plan — 2026-05 (post-PRD-0006)

> Status: **implemented and validated**
>
> Source: `/improve-codebase-architecture` walk on 2026-05-07 followed by a `/grill-me` pass that resolved every open design question. The planned slices in this note were later implemented and validated on the same pass.
>
> Vocabulary: domain terms come from [`docs/CONTEXT.md`](../CONTEXT.md). Architecture terms (depth, seam, deletion test, leverage, locality) come from the `improve-codebase-architecture` skill.
>
> Predecessor: [PRD-0006](../prd/0006-fact-finding-quality-and-context-assembly-bridge.md). The deepening was triggered by reviewing PRD-0006 implementation — code is fine, but the seams around locked-include, presentation, and test fixtures will get heavier as fact-finding work continues. This plan removes that friction before Slice B (Context Pack assembly) lands.

## Goals

1. Make the **retrieval pipeline** readable in fewer hops — today, understanding lock semantics, presentation, or scope inference requires bouncing across 3–4 modules each.
2. Strengthen **fact-finding quality** seams (PRD-0006 territory) so future hardening lands in one place.
3. Keep tests at the highest stable interface that exposes the behavior — don't degrade test surface.
4. Don't re-litigate locked ADRs (ADR-0007 scoring, ADR-0011 locked-include, ADR-0012 rendered_text).

## 2026-05-07 follow-up grilling: week-6/7 architecture deepening

This note also records the later `/grill-me` design session on the week-6 review flow, bootstrap, card materialization, and retrieval application seams. These decisions are intentionally captured here first as a planning artifact before any `CONTEXT.md` or ADR promotion.

### Shipped outcome

The four planned week-6/7 deepening slices all landed and are now complete:

1. `THO-87` — card materialization
2. `THO-88` — bootstrap proposal generation
3. `THO-89` — review flow
4. `THO-90` — retrieval deepening in place

Follow-up validation also landed:

5. `THO-91` — validated extraction-discipline doc under `docs/agents/`

What held up in practice:

- card materialization benefited from immediate extraction because the write-side rules were already duplicated
- bootstrap proposal generation benefited from immediate extraction because proposal policy and inbox materialization were already different jobs
- review flow benefited from immediate extraction because one CLI file already owned a full review state machine
- retrieval benefited from an in-place deepening first rather than a broad new layer

The planning sections below remain useful as the record of why those calls were made.

### Resolved sequencing

Implement in this order:

1. card materialization
2. bootstrap proposal generation
3. review flow
4. retrieval application

Reason:

- card materialization is upstream of review-flow acceptance
- bootstrap proposal extraction should preserve the materialization seam it feeds
- review flow depends on accepted-card writing and review-trace compaction
- retrieval should stay last because its first move is an in-place seam proof, not a broad module extraction

### Card materialization

Card materialization is a new extracted seam. It should be a module-level seam, not a class.

Resolved interface shape:

- `nextCardIdentity(...)` computes the next card id and file path honestly from current state
- `writeCardFile(...)` writes the card file from a typed request

Resolved rules:

- keep both operations in the same module
- use a typed request, not raw frontmatter
- use a small discriminated union by content shape, not workflow origin
- discriminator vocabulary should match the shape: `scaffold | materialized`
- the union is justified by one real required/forbidden split: `review_trace`
- all request fields stay in domain shape; the writer owns all on-disk translation
- callers should not know YAML layout, field ordering, or stable sorting rules

Acceptance checks:

- `card add` and `inbox accept` both call the new seam without sentinel flags
- differences between scaffold and accepted writes show up in request content, not mode switches
- no caller imports YAML/frontmatter helpers just to prepare a request

### Bootstrap proposal generation

Bootstrap proposal generation should be extracted immediately, but should match the current retrieval I/O style for now.

This week-6/7 bootstrap and clarification work is not a side workflow. It is the upstream product precursor to the week-9 setup loop from [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md) and [PRD-0007](../prd/0007-week-9-setup-initialization-and-confidence.md): the product needs to learn how to ask a small number of high-leverage questions that resolve clusters of uncertainty rather than forcing users through card-by-card review.

Resolved shape:

- keep two proposal collections during generation:
  - `CandidateProposalDraft[]`
  - `ClarificationProposalDraft[]`
- bundle them in one aggregate result alongside the summary counts
- do not introduce a mixed review-proposal union during generation
- the mixed union begins at inbox persistence, where `InboxItem` already earns its keep

Resolved ownership split:

- generator owns sentence classification, dedupe, canonical wording, and proposal counts
- inbox materialization owns ids, timestamps, trace history, and clarification default scaffolding

Resolved dependency shape:

- bootstrap uses a higher-level function-record query adapter, not raw store queries
- keep queries separate rather than joined:
  - `listCanonicalChunks()`
  - `getConfidentSymbolAnchors(versionId)`
- default implementation should stay co-located with bootstrap, not promoted into a repo-wide adapter layer
- loader policy owns canonical/doc-role and confident symbol-anchor filtering
- generator policy owns candidate / clarification decisions

Resolved consistency choice:

- do not force a pure `load -> generate -> persist` split yet
- instead, match retrieval and use injected query functions for testability
- treat anchor batching or N+1 cleanup as a separate optimization under the same seam

### Review flow

Review flow should be extracted immediately as one module with two public operations:

- answer clarification need
- accept candidate card

Resolved shape:

- keep clarification answering and candidate acceptance in one module
- do not split them prematurely
- sidecar review-trace writing stays inside review flow as private implementation detail
- review flow depends directly on inbox persistence functions for now
- do not introduce a `ReviewItems` adapter yet because the inbox layer is currently honest CRUD, not hidden query policy

Review-flow policy boundaries:

- review flow owns status transitions, trace-history interpretation, materiality handling, clarification rewrite policy, and accepted-card review-trace compaction
- card materialization becomes a downstream dependency of review flow
- inbox persistence remains `get/list/write` storage mechanics

Split trigger to revisit later:

- if a later operation introduces a different review-state machine or the shared helpers start accumulating per-operation conditionals, revisit whether review flow should split

### Retrieval application

Retrieval should be deepened in place first rather than extracted into a broad new layer immediately.

Resolved shape:

- retrieval application should become the single caller path above the retrieval pipeline for both CLI and MCP
- it should return an internal result type richer than the MCP wire contract
- CLI and MCP remain adapters over that internal result

Rules for the internal result:

- it must be strictly richer than the MCP wire surface
- if it ends up structurally close to the wire type with only renamed fields, it is not earning its keep
- likely richer fields include the full ranked list, full warnings, raw `query_mode`, full budget accounting, lock-decision details, and the normalized original request

Resolved implementation style:

- do this in place first inside `src/retrieve/`
- only promote it into a broader module/file split if the seam proves real after use
- do not treat this as justification for a general application layer

### Extraction discipline to validate before pinning

These rules were resolved in the session but should be validated by the first extraction before promotion into a durable agent-method doc:

- extract only when moving real policy and real callers in the same change
- no empty modules
- no future-home files
- shape interfaces from current callers only
- keep requests in domain shape and let adapters own disk or wire translation
- prefer the smallest seam that removes real misplaced policy

### Explicit deferrals for week-9 setup work

Two adjacent ideas were intentionally **not** extracted during this deepening pass:

- **clustering**
- **confidence computation**

Reason:

- neither has a real pre-week-9 consumer today
- extracting either one now would violate the same anti-scaffolding discipline used elsewhere in this plan
- the current week-6/7 seams should preserve raw signal for later work, not pre-commit to setup-loop interfaces

Current stance:

- bootstrap does **not** own clustering
- review flow does **not** own clustering
- retrieval does **not** consume setup confidence yet
- bootstrap heuristics and retrieval warnings should not be stretched into partial versions of the week-9 confidence model

What should exist now:

- preserve raw signal that future setup work may cluster or score:
  - structured scope
  - supporting chunks
  - heading paths
  - symbol anchors
  - clarification relationships

What should **not** exist now:

- a standalone clustering seam
- a standalone confidence seam
- a probe-pass-rate-only "confidence" surface

Week-9 implication:

- clustering and confidence are deferred as **design work**, not merely implementation work
- ADR-0014 names the confidence signals and operating bands, but the actual computation model, type shapes, weighting, and user-facing surfaces remain open until setup-loop work begins under PRD-0007

## Already shipped (quick wins on this branch)

| # | Result |
|---|---|
| #1 transform.ts | Deleted pass-through; `handlers.ts` calls `presentContextPack` directly. Tests merged into `presenter.test.ts`. |
| #4 scoring | `specificity.ts`, `heading-match.ts`, `mention-overlap.ts` inlined into `score.ts`. Tests merged into `score.test.ts`. `scope-match.ts` and `bm25.ts` kept (real seams: `scope-match` has 2 callers; `bm25` wraps FTS5). 6 fewer files. |

All 351 tests pass; build clean.

---

## Slice A — Card-locking consolidation

**Why first:** locked-include is at the heart of fact-finding quality. PRD-0006 just hardened it, but the implementation is still fractured across three files. Future evidence/freshness work will land here.

### Decided sub-slices

**A.0 — drop the duplicate `lockReasonsByCardId` map.**
- Verified: every `LockedTrace` already carries `lock_reason` inline (`retrieve.ts:186`); the parallel map (`retrieve.ts:210`) is rebuilt from the same source list.
- `presenter.ts:60` reads from the map but always falls back to `trace.lock_reason` — they're identical.
- Action: remove `lockReasonsByCardId` from `RetrievalResult`. `presenter.ts` reads `trace.lock_reason` directly. `LockedTrace` is the single source of truth.

**A.1 — move evidence-promotion freshness policy into `freshness-policy.ts`.**
- "Is this evidence fresh enough to promote?" is a freshness predicate, not a locking rule.
- Today the rule lives inline in `cards/locked-include.ts` (filter `freshness_state !== "potentially_superseded"` at line 289 and the `EVIDENCE_FRESHNESS_RANK` table at lines 53–59).
- Action: extract `isEvidencePromotable(card)` and `evidenceFreshnessRank(card)` into `freshness-policy.ts`. `locked-include.ts` calls them. Locking enforces a policy it doesn't define.

**A.2 — rename internal `symbol_anchor_match` → `symbol_note_exact`; delete `WIRE_LOCK_REASON`.**
- Today: internal `LockReason.kind` uses `symbol_anchor_match` while the wire enum uses `symbol_note_exact`. A `WIRE_LOCK_REASON` map in `presenter.ts:23-30` translates.
- Decision: align the seam to the domain language. CONTEXT.md and ADR-0011 both treat `symbol_note` as the load-bearing term. Internal name aligns with the wire schema.
- Trade-off accepted: this couples internal `LockReason.kind` to the wire schema. If they ever need to diverge, the map comes back. We judged the chance is low enough.
- Action: rename the internal kind across the codebase (TypeScript identifier + tests). Delete `WIRE_LOCK_REASON`. Presenter spreads `lock_reason` directly to the wire entry.

**A.3 — define a lean `LockedEntry` shape; Card-locking owns the type.**
- Today: `LockedTrace = ScoreTrace & { kind, card_id, card_type, lock_reason }`. Locked entries carry zero-valued score fields (`bm25_norm: 0, scope_match: 0, ...`) that no consumer reads. The `extends ScoreTrace` is a lie.
- Decision: replace `LockedTrace` with a lean `LockedEntry = { card: Card, reason: LockReason, token_count: number }`. Card-locking returns `LockedEntry[]` directly.
- Action: redefine the type in `cards/locked-include.ts`, adapt `pack.ts` (only used `token_count` and `lock_reason`), remove the `LockedTrace`-from-Card stitching in `retrieve.ts:170-188`, update tests.

### Touchpoints

- `src/cards/locked-include.ts` (rename, extract evidence-fresh, return new shape)
- `src/cards/freshness-policy.ts` (grow with evidence-fresh helpers)
- `src/retrieve/retrieve.ts` (drop stitching; drop `lockReasonsByCardId`)
- `src/retrieve/pack.ts` (consume `LockedEntry`; drop unused score fields on locked path)
- `src/mcp/presenter.ts` (read `trace.lock_reason` directly; delete `WIRE_LOCK_REASON`)
- `src/mcp/schemas.ts` (no change — the wire `lock_reason` enum stays the same; only the internal name aligns to it)
- All tests touching `LockReason.kind` strings, `LockedTrace` synthetic fixtures, or the `lockReasonsByCardId` field

### ADR exposure

- ADR-0011 (locked-include matching rules): rules don't change; only their owning module changes. No new ADR needed.

---

## Slice B — `PackPresentation` (resolved internal representation)

**Why second:** depends on Slice A's `LockedEntry` shape. Once locks are clean, the presentation seam is the next-largest churn area.

### Premise correction (after grilling)

There are **three** projections, not two:
- **MCP wire** (`presenter.ts`) — bounded omitted summary, structured warnings, schema-locked
- **CLI markdown** (`render.ts:renderText`) — three-section grouping by Card type, "verified*" / "needs_review (drift)" labels
- **CLI JSON** (`render.ts:renderJson`) — used by `contexttrail context --json`; full ScoreTrace embedded; unbounded omitted; `card_id` field

The three formats have legitimately different presentation grammars. **We are not unifying the projections.** What's actually duplicated is *resolution* — card lookup, freshness state derivation, lock-reason structuring, drift shaping, warning derivation. All three projections do this independently and can drift silently.

### Decided sub-slices

**B.1 — define `PackPresentation` as a normalized internal representation.**
- Owns: card/chunk lookup, structured freshness state, structured lock-reason metadata, drift (where shared), structured warning derivation.
- Carries **structured state, not pre-formatted strings.** State semantics live in `freshness-policy.ts` and `Card-locking`; formatting lives in each projection.
- Sketch (subject to implementation refinement):

```ts
type PackPresentation = {
  query_mode: QueryMode;
  budget: { requested: number; used: number; locked_overhead: number };
  locked: PresentedLockedEntry[];   // card resolved, lock-reason structured, freshness summary
  ranked: PresentedRankedEntry[];   // card-or-chunk resolved, contexttrail, structured freshness summary
  omitted: PresentedOmittedEntry[];
  warnings: PresentedWarning[];
  query_compilation: QueryCompilation;
  lock_failures: LockFailure[];
  safety_net_engaged: boolean;
};
```

**B.2 — three projections consume `PackPresentation`.**
- `presenter.ts` projects to MCP wire (drops internal-only warning kinds like `freshness`, `tombstoned_link`; bounds the omitted summary).
- `render.ts:renderText` projects to grouped markdown (sections by Card type; inline freshness labels).
- `render.ts:renderJson` projects to CLI JSON (full ScoreTrace embedded; unbounded omitted).

**B.3 — Slice E folds in here.**
- The wire-vs-internal warning vocabulary (`WIRE_WARNING_KINDS` Set) becomes a property of the wire projection, not a free-floating constant in presenter.ts.

### What stays separate

- The three projections themselves stay. They have distinct grammars by design.
- `chunkContextTrail` is already shared between projections — leave it.
- ADR-0012 (rendered_text opt-in) — no change to opt-in policy; just dedupe the implementation behind it.

### Touchpoints

- New: `src/retrieve/presentation.ts` (or similar) defining `PackPresentation` and the resolver.
- `src/mcp/presenter.ts` (project from `PackPresentation`)
- `src/retrieve/render.ts` (`renderText` and `renderJson` both project from `PackPresentation`)
- Snapshot tests will move; review snapshot diffs line-by-line, do not blanket-update.

### ADR exposure

- None.

---

## Slice C — Scope consolidation: REJECTED (ADR only)

**Decision: do not consolidate.**

After grilling the code, the plan's premise was wrong. Five "scope" concerns exist, but they aren't duplicates — they share *types* and the *layer hierarchy* but not behavior:

| Module | Concern | Returns |
|---|---|---|
| `scope/resolve.ts` | **Assignment**: where does this chunk live? | one `ChunkScope` |
| `retrieve/query-scope.ts` | **Inference**: what scope is the query about? | `QueryScope[]` |
| `retrieve/scope-match.ts:scopeMatchScore` | **Ranking signal**: how aligned are these? (symmetric, graded) | `[0, 1]` |
| `cards/locked-include.ts:constraintMatchesScope` | **Lock eligibility**: does this constraint apply? (asymmetric, ancestor-or-equal) | `boolean` + path |
| `scope/rules.ts:matchesGlob` | **Glob primitive** | `boolean` |

Concrete check: `module: payments/refunds` chunk vs query `project: payments`:
- `scopeMatchScore` → 0.6 (symmetric project-level match — used in scoring per ADR-0007)
- `constraintMatchesScope` → does NOT match (descendant doesn't subsume ancestor — used for locking per ADR-0011)

Different answers by design. `CARD_LAYER_ORDER` (in `src/types/card.ts:107`) already captures the shared hierarchy.

### Action

Capture as [ADR-0016](../adr/0016-scope-concerns-split-by-purpose.md) — _Scope concerns are intentionally split by purpose_. Records: why scope is intentionally fragmented, the five concerns, why a unified module would be a regression, and pointers to ADR-0007 and ADR-0011.

This is preservation work: the next architecture review should not re-suggest the consolidation.

---

## Slice D — `TestCorpus`

**Why fourth (independent):** the duplication is wider than the original plan implied — `runImport` / `runCardImport` / `mkdtemp` / `copyDirSync` boilerplate appears across 10+ test files in `src/mcp/`, `src/cli/`, and `src/eval/`, not just lab.ts.

### Decided sub-slices

**D.1 — introduce `TestCorpus` as a builder API.**
- Wrap the CLI command functions, don't bypass them. Tests still exercise the real `runImport` and `runCardImport` paths.
- Imperative, composable shape:

```ts
type TestCorpus = {
  cwd: string;
  copyDocsFrom(src: string): void;
  writeDoc(path: string, contents: string): void;
  writeCard(spec: TestCardSpec): void;       // generalize EvalCardFixture
  importDocs(globs?: string[]): void;
  importCards(): void;
  cleanup(): void;
};

function createTestCorpus(opts?: {
  configOverrides?: Partial<ContextTrailConfig>;
}): TestCorpus;
```

- `TestCardSpec` is the existing typed Card-fixture writer made general (it's already nearly there in `src/eval/card-fixtures.ts`).

**D.2 — migrate `lab.ts` to TestCorpus first.**
- Eval lab becomes a thin wrapper that calls TestCorpus and writes the eval-specific Card set.

**D.3 — migrate the 10+ test files in batches.**
- `src/mcp/lookup.test.ts`, `src/mcp/edge-cases.test.ts`, `src/mcp/payload-size.test.ts`, `src/mcp/snapshots.test.ts`, `src/mcp/contract-equivalence.test.ts`, `src/cli/context.golden.test.ts`, `src/cli/explain-snapshot.test.ts`, `src/cli/card-cmds.test.ts`, plus any others discovered in migration.
- Keep `src/cli/cold-install.test.ts` as a separate seam (it tests the subprocess integration; intentional).

### ADR exposure

- None.

---

## Slice E — wire enum maps: SUBSUMED

After grilling: Slice E folds entirely into A.2 (`WIRE_LOCK_REASON` deleted by the rename) and B (the wire-vs-internal warning vocabulary moves into the wire projection of `PackPresentation`). No standalone work.

---

## Sequencing

| Slice | Depends on | Estimated size | ADR? |
|---|---|---|---|
| A — Card-locking | quick wins (already shipped) | medium | no (ADR-0011 unchanged) |
| B — PackPresentation | A.3 (LockedEntry shape) | medium-large | no |
| C — Scope ADR | independent | tiny (ADR only) | yes (ADR-0016) |
| D — TestCorpus | independent | medium (multi-file migration) | no |
| E — wire enums | folded into A.2 + B | — | — |

Recommended order: **A → C (ADR) → B → D**. A and C are quick; A unblocks B's locked-entry shape; D is independent and can ride alongside any of them. The ADR-only Slice C lands first as a tiny PR so future reviews stop suggesting the rejected consolidation.

## Branching

PRD-0006 work lands first as its own PR (separate review). Then this deepening plan ships as 4 separate PRs (A, C-the-ADR, B, D) on top of merged `main`. The refactor PRs are easier to review in isolation.

## What's NOT in this plan

- **`freshness-policy.ts` extraction** — was flagged but verified to have 3 distinct callers (loader, materialization, verify). Earns its keep. Leave alone (Slice A.1 only *grows* it with the evidence-fresh helpers).
- **`scope-match.ts` and `bm25.ts`** — kept during #4 as real seams. Leave alone.
- **`src/types/`, `src/store/`, `src/parse/`** — already clean. Don't touch.
- **PRD-0006 eval split (`src/eval/`)** — the model the rest of the codebase should aspire to. Use it as a template, don't change it.
- **Unifying the three projection grammars (wire / markdown / JSON)** — they're legitimately different by audience.

## Risks

- **Snapshot churn (Slice B).** Touches `payload-size.test.ts.snap` and `snapshots.test.ts.snap`. Plan: review snapshot diffs line by line; do not blanket-update.
- **Test migration scope (Slice D).** 10+ files with slight per-test variation. Mitigate by migrating in small batches and running the full suite between batches.
- **A.2 rename ripple.** Internal `symbol_anchor_match` → `symbol_note_exact` touches every test that asserts on `LockReason.kind`. Mitigate by codemod-style global rename then run tests.
