# V5 — Synthetic Harness Build-Out + Real-Corpus Eval Findings

Date: 2026-05-08
Continuation of: PRD-0014 (Retrieval Engine V3 — source selection and aboutness)

## Purpose

Hand off context for the next session. We spent this session:

1. Building a comprehensive synthetic harness to make V3 leaks measurable.
2. Adding deterministic primitives (V5.1–V5.5) that closed every leak the harness exposed.
3. Running the real-corpus eval to see what the synthetic harness missed.

The honest finding from running real-corpus: V3+V4+V5 lifts top-1 from 71.3% → 77.7% (+6.4pp), but the next big leak is **upstream of source selection** — query-mode classification is wrong on ~12 of 33 remaining failures. The synthetic harness never probed that layer.

## Current state — TL;DR

- Tests: **875 passing, type-clean.**
- Real-corpus combined wire top-1: **77.7%** (was 71.3% at PRD-0014 baseline).
- 33 of 148 cases still fail top-1.
- Synthetic harness has 10 statistical claims at ≥99.2% with 95% confidence on the named loss classes.
- Synthetic suite shows zero residual leaks for V3 source selection on the patterns we model.

## What V5 shipped

### V5.1 — concept-over-leaves by purpose (closed 2 leaks)

**File:** `src/retrieve/aboutness.ts` + `src/retrieve/source-selection-decision.ts`

New aboutness reason `concept_over_leaves_by_purpose` fires when target is `doc_purpose: "concept"` AND ≥ 2 other cards are `guide`/`api_reference`. Path-structure-independent.

New selection rule `concept_over_leaves_by_purpose_promoted` adds +0.40 score for concept-purpose targets when intent is `broad_domain`/`decision_lookup`. Gated on coverage-tied-or-greater than all neighbors (prevents over-trigger on compositional queries).

Closed:
- `parent_vs_leaf` under path-noise: 63% → 100%
- `overview_vs_reference` (hardened) under verbosity: 13% → 100%

### V5.2 — changelog bonus 0.40 → 0.60 (closed 1 leak)

**File:** `src/retrieve/source-selection-decision.ts`

Bumped `changelog_release_intent_preserved` bonus so a "partial"-labeled changelog (0.5 base + 0.6 = 1.1) reliably beats a "covers"-labeled dense distractor (1.0). Rule only fires on changelog/release_note-purpose docs, no other class affected.

Closed:
- changelog under verbosity × paraphrase: 33% → 100%

### V5.3 — example-purpose promotion (closed 1 leak)

**File:** `src/retrieve/source-selection-decision.ts`

New selection rule `example_for_broad_domain_promoted` adds +0.55 to docs with `doc_purpose: "example"` for `broad_domain` queries. Lifts canonical examples into top-3 alongside the concept doc.

Closed:
- set-cover (concept + example) baseline: 0% → 100%
- set-cover under paraphrase: 0% → 100%

### V5.4 — overview-shape query detector (closed residual leak)

**File:** `src/retrieve/source-selection-decision.ts`

Added `queryIsOverviewShape(query_tokens)` that recognizes overview-vocab tokens (`overview`, `intro`, `explain`, `concept`, `basic`, `understand`, `big`, `pictur`, etc.) plus the bare `what` question word. When detected, V5.1's coverage gate is dropped — concept doc gets promoted even if a leaf has strictly higher token coverage.

Closed:
- paraphrase × path-noise residual: ~−30pp drop → < 5pp drop

### V5.5 — ambiguous multi-answer probe (new probe; V3 already passes)

**File:** `src/eval/synthetic/ambiguous.test.ts` + new generator in `generators.ts`

Probe for queries with 3 equally-canonical concept docs. V3 hits 500/500 (lower95 ≥ 99.2%). V5.1 + V5.3 already handle this case correctly.

## Synthetic harness layers built (V4.x and V5.x)

| Layer | File | What it probes |
|---|---|---|
| Generators (6 loss classes) | `generators.ts` | parent_vs_leaf, anchored_exact_vs_broad, decision_vs_procedural, adjacent_sibling, changelog_release_intent, overview_vs_reference |
| Hard variants | same | Adversarial versions where lexical fails |
| Paraphrase fanout | `paraphrase.test.ts` | Same case under N query phrasings |
| Title-noise perturbation | `title-noise.test.ts` | Verbose titles + filename perturbation |
| Path-structure noise | `path-noise.test.ts` | Broken parent/leaf path nesting |
| Set-cover (concept + example) | `set-cover.test.ts` | Top-3 must contain BOTH complementary docs |
| Compositional set-cover | `compositional-set-cover.test.ts` | "X with Y" — both anchors must surface |
| Adversarial near-miss | `near-miss.test.ts` | Bare "Topic" vs "Topic Internals" |
| Cross-corpus vocabulary | `cross-corpus.test.ts` | Same shape, nonsense words — V3 must not be vocab-fitted |
| Anti-pattern detection | `anti-pattern.test.ts` | Perturbations that should NOT improve V3 (caught the "Guide to" prefix leak) |
| Abstention | `abstention.test.ts` | V3 fail_closes on unsupported corpora; doesn't over-abstain on supported |
| Statistical certification | `scale.test.ts` + `stats.ts` | Wilson 95% CIs at N=500 for each named class |
| Larger corpus scale | `large-corpus.test.ts` | ~400 docs/case |
| Ambiguous multi-answer | `ambiguous.test.ts` | Three same-purpose canonical docs |

## Certifiable claims (95% confidence intervals)

| Property | N | Lower bound |
|---|---:|---:|
| hard parent_vs_leaf | 500 | ≥ 99.2% |
| hard anchored_exact_vs_broad | 500 | ≥ 99.2% |
| decision_vs_procedural | 500 | ≥ 99.2% |
| changelog_release_intent (clean) | 500 | ≥ 99.2% |
| concept near-miss | 500 | ≥ 99.2% |
| paraphrase × parent_vs_leaf | 2000 | ≥ 99.8% |
| paraphrase × anchored | 1600 | ≥ 99.8% |
| abstention on hard-unsupported | 500 | ≥ 99.2% |
| non-abstention on strong-support | 500 | over-abstention ≤ 0.8% |
| hard compositional set-cover | 500 | ≥ 99.2% |
| paraphrase × path-noise (V5.4) | 200+ | ≥ 95% |
| set-cover (concept + example) | 500 | ≥ 99.2% (post-V5.3) |
| ambiguous multi-answer | 500 | ≥ 99.2% |
| large-corpus parent_vs_leaf (~400 docs) | 200 | ≥ 98.1% |
| large-corpus anchored | 200 | ≥ 98.1% |
| large-corpus compositional top-3 | 200 | ≥ 98.1% |

## Real-corpus eval — actual numbers

Run via `npm run eval:real-corpus`.

### Aggregate

- Combined cases: 148
- Top-1 acceptable: **115/148 = 77.7%** (was 71.3% at PRD-0014 baseline)
- Top-1 fails: **33** (was 42)
- Improvement: **+6.4 percentage points**

### Per-repo

| Repo | Cases | Top-1 |
|---|---:|---:|
| drizzle | 6 | 100% |
| prisma | 10 | 90% |
| bun | 8 | 87.5% |
| hono | 25 | 84% |
| zod | 12 | 83.3% |
| turborepo | 22 | 81.8% |
| ralph | 10 | 70% |
| vitest | 25 | 68% |
| trpc | 22 | 68.2% |
| tanstack | 8 | 62.5% |

### Of the 13 originally documented losses (PRD-0014)

**Fixed by V5 (6):**
- hono-decision-middleware-design
- ralph-anchored-setup-sync
- trpc-cross-module-nextjs
- turborepo-unanchored-getting-started
- vitest-decision-pool-tradeoffs
- zod-unanchored-changelog

**Still failing (7+, all T1✗ RU✗ — canonical not in displayed top-3):**
- trpc-unanchored-overview
- trpc-unanchored-authorization
- trpc-decision-rpc-vs-rest
- turborepo-anchored-globs
- turborepo-decision-package-types
- vitest-anchored-cli
- vitest-unanchored-projects
- vitest-cross-module-browser-mode

### Failure-mode breakdown of all 33 current failures

| Failure mode | Count | What it is |
|---|---:|---|
| Query mode misclassified as `signal_empty` | ~12 | Anchored queries getting flagged as anchorless. **NEW finding — not in synthetic harness.** |
| T1✗ RU✓ — pure ranking loss | ~15 | Right answer in ranked results, just not at rank 1 |
| T1✗ RU✗ — recall loss | ~5 | Right answer not in displayed results |
| T1✗ RU✗ QM✗ — compound | ~1 | Multi-failure |

## The big architectural finding

**Query-mode classification is the dominant new leak.** The signal_empty classifier is over-triggering on queries that DO have anchors. ~12 of 33 failures are this. Examples:

- `hono-anchored-jwt`, `hono-anchored-validation` → wrongly classified `signal_empty`
- `trpc-anchored-router`, `trpc-anchored-procedures`, `trpc-anchored-middleware` → all wrongly `signal_empty`
- `vitest-anchored-mocking`, `vitest-anchored-snapshot`, `vitest-anchored-cli`, `vitest-anchored-extending-matchers` → all wrongly `signal_empty`
- `turborepo-anchored-globs`, `turborepo-anchored-boundaries` → wrongly classified
- `tanstack-anchored-typescript-types` → wrongly classified

When `query_mode` is wrong, V3 selection runs with the wrong intent — the V3 rules built for `file_anchored` queries can't fire because intent says `signal_empty`.

The synthetic harness assumes intent is given correctly. Real corpora prove this assumption is wrong ~8% of the time. **That's the next architectural layer to build.**

## Recommended next-session sequence

### 1. ✅ DONE — Query-mode probe added (V5.7)

`generateQueryModeCases` + `src/eval/synthetic/query-mode.test.ts` ship as part of this session. Sits AT `compileQueryScopes` instead of downstream. Six failure classes: `exact_match`, `no_anchors`, `anchors_absent`, `case_mismatch`, `form_variant`, `path_segment`.

**Probe results (current classifier, N≥100 per class):**

| Class | Lower-95 | Status |
|---|---:|---|
| `exact_match` | ≥ 95% | passes |
| `no_anchors` | ≥ 95% | passes |
| `anchors_absent` | ≥ 95% | passes |
| `path_segment` | ≥ 95% | passes (existing fallback works) |
| **`case_mismatch`** | **upper-95 ≤ 5%** | **CONFIRMED open leak — fails all cases** |
| **`form_variant`** | **upper-95 ≤ 5%** | **CONFIRMED open leak — fails all cases** |

**Overall N=600 balanced run:** 400/600 = 66.7% accuracy. The 33% failure rate matches real-corpus where ~12 of 33 failures are query-mode misclassification.

The synthetic probe now confirms the real-corpus theory: **case insensitivity and form variation are the two missing features in `compileQueryScopes`'s anchor lookup.**

### 2. Fix the case_mismatch + form_variant leaks (architectural)

Now confirmed. The classifier lives in `src/retrieve/query-scope.ts:88` (`compileQueryScopes`). The lookup function `makeInMemoryAnchorLookup` at line 344 does exact-string match on `(kind, value)`. Two fixes required:

**A. Case-insensitive symbol match.** Real queries use casing like "JWT" while indexed anchors use "jwt" or "Jwt". Lookup should compare `value.toLowerCase()`.

**B. Substring/superstring match for symbol anchors.** Real queries say "JWT" against indexed "JWTAuthMiddleware". Lookup should consider an anchor matched if either is a token-prefix of the other (case-insensitive).

Both fixes go in `makeInMemoryAnchorLookup` and need a confidence demotion (matched-but-fuzzy → confidence: "low"). The probe `case_mismatch` and `form_variant` assertions can flip from `upper-95 ≤ 5%` to `lower-95 ≥ 95%` once the fixes ship.

If we close this leak, predicted +8pp top-1 → 86%.

### 3. Investigate the 7 stubborn T1✗ RU✗ cases (selection-side)

Even with V5.1's purpose-based promotion, these cases display none of the canonical docs in top-3:

- trpc-unanchored-overview, trpc-unanchored-authorization, trpc-decision-rpc-vs-rest
- turborepo-anchored-globs, turborepo-decision-package-types
- vitest-anchored-cli, vitest-unanchored-projects, vitest-cross-module-browser-mode

Likely: the canonical doc IS in V3's top-50 cards, but V5.1 doesn't fire because the doc isn't classified as `concept` (real OSS profiles are noisy). Or the canonical doc has lower coverage than a denser non-canonical doc and V5.1's tie gate suppresses promotion.

Specific debug step: pick `trpc-unanchored-overview` and dump V3's actual `source_aboutness` reasons for the top-50 cards. Compare to what V5.1 needs to fire.

### 4. Don't add more V3 source-selection primitives until we understand 1+2

The synthetic harness shows V3 selection is solid on the patterns we model. Adding a 6th selection rule wouldn't move real-corpus numbers — the leaks are upstream (query mode) and downstream (recall on specific cases).

## Files added/modified this session

### New files
- `src/eval/synthetic/stats.ts` + `stats.test.ts` — Wilson confidence intervals
- `src/eval/synthetic/scale.test.ts` — N=500 statistical certification
- `src/eval/synthetic/abstention.test.ts` — V3 fail-closed measurement
- `src/eval/synthetic/compositional-set-cover.test.ts` — multi-anchor set-cover probe
- `src/eval/synthetic/ambiguous.test.ts` — multi-canonical probe
- `src/eval/synthetic/query-mode.test.ts` (V5.7) — `compileQueryScopes` classifier probe

### Existing files modified (V5 production code)
- `src/retrieve/aboutness.ts` — `concept_over_leaves_by_purpose` reason
- `src/retrieve/source-selection-decision.ts` — V5.1, V5.2, V5.3, V5.4 selection rules
- `src/retrieve/source-rerank-pipeline.ts` — `APPLY_SOURCE_SELECTION_REASONS` extended

### Existing test files updated
- `src/eval/synthetic/path-noise.test.ts` — assertions tightened post-V5.4
- `src/eval/synthetic/title-noise.test.ts` — overview test inverted (no longer a leak)
- `src/eval/synthetic/large-corpus.test.ts` — Wilson lower-95 floors

## Session 2 findings (2026-05-09)

Four blanket-policy fix attempts were tried against real-corpus, all regressed and were reverted. Net production change: 0. Real-corpus baseline 131/148 = 88.5% unchanged.

| Attempt | Hypothesis | Real-corpus | Outcome |
|---|---|---:|---|
| V5.8 | Apply V3 when `covers + rank > 1` | 131 → 112 | reverted |
| V5.9 | Trust file/symbol anchor intent → `intent_only` recognition | 131 → 130 | reverted |
| V5.11 | Treat `index.md` as directory parent in `isStrictAncestorPath` | 131 → 121 | reverted |
| V5.12 | Apply V3 when `covers + rank ∈ [2, 5]` (narrow band) | 131 → 116 | reverted |

### The mechanism finding (the actual deliverable)

A new debug script `src/eval/debug-case.ts` was written to dump V3's full trace for a single real-corpus case. Run as:

```bash
npm run eval:debug-case -- <repo> <case_id>
npm run eval:debug-case -- <repo> --list
# example:
npm run eval:debug-case -- vitest vitest-cross-module-browser-mode
```

Output for vitest-cross-module-browser-mode confirmed exactly what the user originally described:

- V2.5 rerank: `index.md` (the right answer) at **rank 3**
- V3 selection: `index.md` at **selected_sources[0]** with `aboutness_label: "covers"`, score 1.0
- `source_selection_applied: false` — the apply gate blocks because the only reason code is `covers_label`
- Displayed top-1: `component-testing.md` (V2.5's pick — wrong)

V3 **finds** the right answer; the gate suppresses application.

### Why every blanket gate-relaxation regressed

The same trace dump showed the aboutness verifier giving "covers" labels to clearly-non-canonical docs (e.g., `docs/blog/vitest-4-1.md` got "covers" at V2.5 rank 38 for the same case). Every relaxation that lets `covers_label` apply also lets these false-positive covers labels apply, displacing V2.5's correct picks 15-19 times to fix one.

### What the architecture actually needs

**Tighten what "covers" means in the aboutness verifier** before any apply-gate broadening will work. The current threshold (`combined ≥ 0.5 AND fused ≥ 1 AND bestScore ≥ 0.3`) is hit by too many docs. Candidates for stricter conditions:

- Title token coverage specifically must be ≥ 0.7 (not just any field's max)
- OR title-exact-match (V4.2's `uniqueTitleExactMatch` shape)
- OR multiple distinct fields hitting the query, not just one

Any tightening needs its own synthetic probe so it doesn't break the certified ≥99% claims on the existing suite. The `aboutness.test.ts` already exists as a foundation — extend it with a "covers must be earned" probe that asserts: docs at rank 30+ should NOT get "covers" label without exceptional title evidence.

### What got committed from this session

Nothing in production retrieval code: every blanket-policy attempt reverted. The surviving deliverable is the debug utility (`src/eval/debug-case.ts`) plus this session note, which preserve the mechanism finding without shipping a regressive ranking change.

## Open items (not addressed this session)

1. **Query-mode classifier fix** — biggest single leak in real corpus, no synthetic coverage yet
2. **7 stubborn T1✗ RU✗ cases** — V5.1 didn't fire on real-corpus cases that match its synthetic shape; investigate why
3. **Real-corpus untouched holdout** — current dev/holdout repos have all been graded; need 2–3 fresh OSS repos for unbiased certification
4. **Larger-corpus assertions** — Wilson lower-95 at ~98% on synthetic, but real-corpus suggests synthetic large-corpus is still cleaner than reality

## Run commands

```bash
# Synthetic suite
npx vitest run src/eval/synthetic/

# Real corpus
npm run eval:real-corpus

# Full suite + typecheck
npx vitest run
npx tsc -p tsconfig.json --noEmit
```

## Glossary of V5 reason codes

- `concept_over_leaves_by_purpose` — aboutness reason. Concept-purpose target with ≥ 2 leaf-purpose neighbors.
- `concept_over_leaves_by_purpose_promoted` — selection reason. +0.40 to concept-purpose targets matching the above.
- `example_for_broad_domain_promoted` — selection reason. +0.55 to example-purpose targets for broad_domain queries.
- `title_exact_match_promoted` (V4.2) — selection reason. +0.50 when one card's title or filename token set equals the query token set.
- `parent_over_leaf` (V3) — selection reason. Path-based ancestor promotion.
- `decision_over_procedural` (V3) — selection reason. ADR/concept beats guide for decision queries.
- `anchored_over_broad` (V3) — selection reason. Guide beats api_reference for file_anchored queries.
- `changelog_release_intent_preserved` (V3, V5.2 bumped) — selection reason. +0.60 (was 0.40) to changelog docs for release queries.

## Updated query-shape detectors

- `queryAsksReleaseHistory` — release vocabulary stems + version-shape tokens (`v?\d+(\.\d+)*`).
- `queryIsOverviewShape` (V5.4) — overview vocabulary stems plus the `what` question word.
