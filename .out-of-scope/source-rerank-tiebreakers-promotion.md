# Source-Rerank Close-Call Tiebreakers Production Promotion

**Decision:** Do not flip `RETRIEVAL_RERANK_TIEBREAKERS` default to `on`. Implementation lands behind the env flag (default off); source-rerank remains the production ranking engine without close-call tiebreakers.

**Reason:** Promotion gates fail. The 10% close-call threshold rarely fires on the addressable cohort, and the cases it does fire on produce a net regression on real-corpus eval.

## Gate run

Real-corpus eval, PRD-0022 release-gate config, 148-case suite (121 answer-bearing-imported):

| Metric | Flag off (baseline) | Flag on | Target (PRD-0022) | Result |
|---|---:|---:|---:|---|
| answer top-1 | 106/121 | 105/121 | ≥ 113/121 | FAIL |
| answer top-3 | 118/121 | 118/121 | ≥ 118/121 | PASS |
| true top-3 misses | 4 | 4 | ≤ 2 | FAIL |
| top-3 hit / top-1 miss | 13 | 13 | ≤ 6 | FAIL |
| coverage honest (combined) | 148/148 | 148/148 | 148/148 | PASS |
| agent answer correct | 147/148 | 147/148 | ≥ 147/148 | PASS |
| synthetic property tests | passed | passed | lower-95 ≥ 95% | PASS |

Net real-corpus impact of the rules: −1 top-1 case (106 → 105). Top-3 unchanged.

## Per-case impact

Improved (top-1 win):

- `hono-cross-module-jsx`: `docs/middleware/builtin/jsx-renderer.md` → `docs/guides/jsx.md` (Rule 2 fired; query lacked `renderer` surface form, simpler basename `jsx` matched verbatim).
- `vitest-unanchored-environment`: `docs/guide/browser/component-testing.md` → `docs/guide/environment.md` (Rule 2; `environment` basename verbatim-matched query while `component-testing` did not).

Regressed (top-1 loss):

- `turborepo-decision-remote-caching`: `docs/core-concepts/remote-caching.md` → `docs/crafting-your-repository/caching.md` (Rule 2; query "remote caching" surface-matched single-word `caching` basename verbatim while hyphenated `remote-caching` matched neither surface nor stem).
- `vitest-anchored-test-context`: `docs/guide/test-context.md` → `docs/api/browser/context.md` (same hyphen vs single-word failure mode as above).
- `vitest-anchored-extending-matchers`: `docs/guide/extending-matchers.md` → `docs/api/expect.md` (same).

## Why most addressable cases didn't fire

The PRD's expected lift (+9 top-1) assumed Rule 1 / Rule 2 would fire on the close-call cohort. Inspection of post-rerank scores shows most addressable cases are NOT close calls under the 10%-of-top-1 gate:

| Case | top-1 score | top-2 score | gap ratio | close-call? |
|---|---:|---:|---:|---|
| vitest-anchored-mocking | 1.969 | 1.409 | 28% | no |
| vitest-anchored-snapshot | 1.747 | 1.745 | 0.1% | yes (no swap — see below) |
| trpc-anchored-procedures | 1.704 | 1.113 | 35% | no |
| hono-anchored-validation | 1.426 | 1.276 | 10.5% | no |
| tanstack-anchored-typescript-types | 1.697 | 1.371 | 19% | no |

`vitest-anchored-snapshot` is a genuine close call but the basename score ties (`snapshot.md` and `snapshots.md` both have surface+stem matches because the query string includes both forms — "configure inline snapshots and snapshot file location"), so Rule 2's tie tie-break preserves the wrong top-1.

## Why Rule 2 collateral damage is structural

The deterministic basename-match shape can't deterministically separate two real-world patterns:

1. **simpler-basename-wins** (e.g., `jsx-renderer.md` → `jsx.md`): user wants the broader doc; multi-word compound is a sub-topic.
2. **hyphenated-compound-wins** (e.g., `caching.md` ↛ `remote-caching.md`): user query targets the compound concept; single-word basename is a different sibling.

Both shapes have the same surface-form signature: query token equals the simpler basename verbatim, doesn't equal the hyphenated basename verbatim. Rule 2 swaps in both directions equally — fixing pattern (1) and breaking pattern (2). Without semantic understanding, no surface-form rule can pick correctly.

## What ships

- Rule 1 (`parent_canonicality`) and Rule 2 (`anchor_basename_exact`) implementations land behind `RETRIEVAL_RERANK_TIEBREAKERS=on` (default off).
- Synthetic property tests pass at lower-95 ≥ 95% on both rules — the rules are correct relative to their stated property; they just don't deliver the empirical lift the PRD predicted.
- Adversarial suites pass.
- No real-corpus fixture changes.
- No public-contract changes.

## What's parked

- Flag default flip to `on` — gated on a future PRD that resolves the simpler-vs-hyphenated ambiguity (likely needs query-token-coverage scoring of basename components, plus a guard that prevents demoting a top-1 whose basename has full component coverage by query tokens).
- Tighter / wider close-call threshold tuning — out of scope per ticket; would need its own PRD with regression analysis.
- Fixture updates — none, since no top-1 outcomes are stable enough to enshrine.

## Train / holdout cohort (PRD acceptance)

The 9 addressable cases identified in PRD-0022's problem statement, split 5 train / 4 holdout for development discipline:

Train (5):
- vitest-anchored-mocking
- hono-cross-module-jsx
- prisma-cross-module-migrate-vs-schema
- tanstack-anchored-typescript-types
- trpc-anchored-procedures

Holdout (4):
- vitest-anchored-snapshot
- zod-anchored-package-readme
- hono-anchored-validation
- vitest-anchored-mocking-modules-tokens (substituted from real-corpus pattern A on inspection)

Holdout outcome with rules on: 0 of 4 improve to top-1. Train outcome: 1 of 5 improves (`hono-cross-module-jsx`). Below the "≥ 4/5 train, all 4/4 holdout" gate. Promotion declined.
