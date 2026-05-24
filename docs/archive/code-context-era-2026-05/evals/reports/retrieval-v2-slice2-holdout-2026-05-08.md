# Retrieval Engine V2 Slice 0 — Ceiling Probes

Generated: 2026-05-08T04:44:43.979Z
Repos: bun, drizzle, hono, prisma, ralph, tanstack, trpc, turborepo, vitest, zod
Cases: 148 (answerable=122, unsupported=26)

## Branch decision

- **Primary branch:** `confidence_or_abstention`
- **Recommended next PRD:** Confidence / Abstention Rework
- **Rationale:** 5 unsupported case(s) reported `confident` (> tolerance 0); honest abstention is still the first bottleneck

## Headline metrics

| Metric | Value |
|---|---:|
| critical-source-set recall@10 (answerable+critical) | 95.0% |
| critical-source-set recall@20 | 97.5% |
| critical-source-set recall@50 | 97.5% |
| actual top-1 acceptable (answerable) | 69.7% |
| actual top-3 acceptable (answerable) | 89.3% |
| oracle answerable success@50 | 97.5% |
| post-threshold critical recall@50 | 98.3% |
| post-pack critical recall@50 | 95.8% |
| false-confident unsupported | 5 |

## Per-repo

| Repo | Cases | Answerable | Critical recall@50 | Top-1 | Top-3 |
|---|---:|---:|---:|---:|---:|
| bun | 8 | 6 | 100.0% | 83.3% | 100.0% |
| drizzle | 6 | 4 | 100.0% | 100.0% | 100.0% |
| hono | 25 | 21 | 100.0% | 71.4% | 95.2% |
| prisma | 10 | 8 | 100.0% | 87.5% | 100.0% |
| ralph | 10 | 8 | 100.0% | 62.5% | 100.0% |
| tanstack | 8 | 6 | 100.0% | 50.0% | 83.3% |
| trpc | 22 | 19 | 100.0% | 63.2% | 84.2% |
| turborepo | 22 | 19 | 94.7% | 73.7% | 89.5% |
| vitest | 25 | 22 | 100.0% | 72.7% | 86.4% |
| zod | 12 | 9 | 77.8% | 44.4% | 66.7% |

## Per-intent

| Intent | Cases | Critical recall@50 | Top-1 | Top-3 |
|---|---:|---:|---:|---:|
| broad_domain | 35 | 97.1% | 68.6% | 88.6% |
| cross_module | 15 | 100.0% | 73.3% | 86.7% |
| decision_lookup | 20 | 95.0% | 70.0% | 80.0% |
| exact_symbol | 23 | 95.7% | 65.2% | 95.7% |
| file_anchored | 29 | 100.0% | 72.4% | 93.1% |
| signal_empty | 26 | 0.0% | 0.0% | 0.0% |

## Top misses

| Repo | Case | Missing critical sources @50 | Oracle reachable@50 |
|---|---|---|---|
| turborepo | turborepo-unanchored-getting-started | docs/getting-started/installation.md | no |
| zod | zod-anchored-optionality | wiki/optionality.md | no |
| zod | zod-decision-optionality-tradeoffs | wiki/optionality.md | no |

## Unsupported separability

- classification: `weak`
- reason: score_gap=0.17, false_confident_unsupported=5
- supported avg top-1 score: 1.077
- unsupported avg top-1 score: 0.903
- false-confident unsupported: 5

Slice 0 features marked unavailable (intentionally not zero-filled): retriever_agreement, source_alias_hit_count, dense_sparse_agreement, generated_question_agreement, source_purpose_compatibility.

## Confidence diagnostics

Per-case confidence classifications for unsupported cases. False-confident rows (`coverage=confident` on an unsupported case) are PRD-0011 release blockers.

| Case | Coverage | Reason | Top-1 | t1-t2 | t1-t3 | Mode | Warnings |
|---|---|---|---:|---:|---:|---|---|
| bun-signal-empty-android-deployment | uncertain | low_confidence_warning | 0.840 | 0.140 | 0.229 | unanchored | low_confidence |
| bun-signal-empty-cobol-interop | uncertain | narrow_top_score_margin | 0.848 | 0.005 | 0.008 | unanchored | low_confidence |
| drizzle-signal-empty-graphql | uncertain | low_confidence_warning | 0.855 | 0.206 | 0.222 | unanchored | low_confidence |
| drizzle-signal-empty-redis | uncertain | narrow_top_score_margin | 0.828 | 0.000 | 0.021 | unanchored | low_confidence |
| hono-signal-empty-graphql | uncertain | narrow_top_score_margin | 0.880 | 0.093 | 0.119 | unanchored | low_confidence |
| hono-signal-empty-orm | uncertain | narrow_top_score_margin | 0.840 | 0.057 | 0.061 | unanchored | low_confidence |
| **hono-signal-empty-grpc** | confident | narrow_top_score_margin | 1.003 | 0.132 | 0.149 | unanchored | — |
| hono-signal-empty-android | uncertain | narrow_top_score_margin | 0.840 | 0.091 | 0.100 | unanchored | low_confidence |
| prisma-signal-empty-blockchain | uncertain | narrow_top_score_margin | 0.880 | 0.040 | 0.060 | unanchored | low_confidence |
| prisma-signal-empty-graph-database | uncertain | low_confidence_warning | 0.880 | 0.209 | 0.308 | unanchored | low_confidence |
| ralph-signal-empty-kubernetes-deployment | uncertain | narrow_top_score_margin | 0.975 | 0.069 | 0.075 | unanchored | — |
| ralph-signal-empty-database-migration | uncertain | unanchored_score_below_confident_floor | 0.930 | 0.272 | 0.386 | unanchored | — |
| tanstack-signal-empty-mongodb | uncertain | narrow_top_score_margin | 0.840 | 0.040 | 0.040 | unanchored | low_confidence |
| tanstack-signal-empty-cli | uncertain | narrow_top_score_margin | 0.966 | 0.070 | 0.076 | unanchored | — |
| trpc-signal-empty-grpc | uncertain | unanchored_score_below_confident_floor | 0.912 | 0.360 | 0.471 | unanchored | — |
| trpc-signal-empty-orm-internals | uncertain | low_confidence_warning | 0.868 | 0.189 | 0.229 | unanchored | low_confidence |
| trpc-signal-empty-mobile-native | uncertain | narrow_top_score_margin | 0.870 | 0.030 | 0.056 | unanchored | low_confidence |
| turborepo-signal-empty-android | uncertain | narrow_top_score_margin | 0.905 | 0.084 | 0.108 | unanchored | — |
| turborepo-signal-empty-blockchain | uncertain | low_confidence_warning | 0.840 | 0.233 | 0.247 | unanchored | low_confidence |
| **turborepo-signal-empty-database-migration** | confident | score_above_confident_floor | 0.981 | 0.537 | 0.554 | unanchored | — |
| vitest-signal-empty-android | uncertain | narrow_top_score_margin | 1.005 | 0.023 | 0.029 | unanchored | — |
| vitest-signal-empty-rust | uncertain | narrow_top_score_margin | 0.840 | 0.057 | 0.682 | unanchored | low_confidence |
| vitest-signal-empty-database | uncertain | low_confidence_warning | 0.840 | 0.230 | 0.245 | unanchored | low_confidence |
| **zod-signal-empty-runtime** | confident | score_above_confident_floor | 0.980 | 0.436 | 0.463 | unanchored | — |
| **zod-signal-empty-cli** | confident | score_above_confident_floor | 1.040 | 0.232 | 0.382 | unanchored | — |
| **zod-signal-empty-react** | confident | score_above_confident_floor | 0.980 | 0.513 | 0.864 | unanchored | — |

## Synthetic regression

- **STATUS:** passed (no positive ship power; pass means the floor is intact).

## Dev vs holdout (PRD-0012 Slice 2 v2)

Dev (tuned): bun, drizzle, prisma, ralph, tanstack
Holdout (untouched): hono, trpc, turborepo, vitest, zod

| Metric | Dev | Holdout |
|---|---:|---:|
| cases | 42 | 106 |
| answerable cases | 32 | 90 |
| unsupported cases | 10 | 16 |
| candidate recall@50 | 100.0% | 96.7% |
| source-rerank top-1 | 78.1% | 63.3% |
| source-rerank top-3 | 96.9% | 86.7% |
| wire top-1 | 75.0% | 67.8% |
| wire top-3 | 96.9% | 86.7% |
| unsupported honesty | 100.0% | 68.8% |
| false-confident unsupported | 0 | 5 |

### Per-intent (holdout)

| Intent | Cases | Critical recall@50 | Top-1 | Top-3 |
|---|---:|---:|---:|---:|
| broad_domain | 27 | 96.3% | 74.1% | 85.2% |
| cross_module | 10 | 100.0% | 70.0% | 90.0% |
| decision_lookup | 17 | 94.1% | 64.7% | 76.5% |
| exact_symbol | 20 | 95.0% | 65.0% | 95.0% |
| file_anchored | 16 | 100.0% | 62.5% | 87.5% |
| signal_empty | 16 | 0.0% | 0.0% | 0.0% |

## Holdout gates (PRD-0012 — the verdict)

- **STATUS:** FAILED
  - `critical_source_recall` — critical-source-set recall@50 = 96.7% < 100.0% floor
  - `false_confident_unsupported` — 5 unsupported case(s) reported `confident`; PRD-0011 floor requires 0
  - `answerable_top1_floor` — answerable top-1 = 67.8% < 75.0% floor
  - `answerable_top3_floor` — answerable top-3 = 86.7% < 93.8% floor

## Slice 2 gates — combined panel (context)

- **STATUS:** FAILED
  - `critical_source_recall` — critical-source-set recall@50 = 97.5% < 100.0% floor
  - `false_confident_unsupported` — 5 unsupported case(s) reported `confident`; PRD-0011 floor requires 0
  - `answerable_top1_floor` — answerable top-1 = 69.7% < 75.0% floor
  - `answerable_top3_floor` — answerable top-3 = 89.3% < 93.8% floor

## Source-rerank movement (top 20 cases)

| Case | Source | pre rank | post rank | post score | reasons |
|---|---|---:|---:|---:|---|
| bun-anchored-glob | docs/runtime/glob.md | 2 | 1 | 0.421 | alias=4 |
| bun-anchored-html-rewriter | docs/runtime/html-rewriter.md | 2 | 1 | 0.433 | alias=4 |
| bun-anchored-environment-vars | docs/runtime/environment-variables.md | 1 | 1 | 0.392 | alias=7 |
| bun-unanchored-file-io | docs/runtime/file-io.md | 1 | 1 | 0.938 | alias=5 |
| bun-unanchored-jsonl | docs/runtime/jsonl.md | 1 | 1 | 0.940 | alias=2 |
| bun-signal-empty-android-deployment | docs/bundler/fullstack.md | 1 | 1 | 0.650 | +purpose=0.05,alias=1 |
| bun-signal-empty-cobol-interop | docs/runtime/index.md | 7 | 1 | 0.769 | alias=3 |
| bun-cross-module-redis | docs/runtime/redis.md | 1 | 1 | 0.854 | alias=3 |
| drizzle-anchored-joins | docs/joins.md | 1 | 1 | 0.859 | alias=2 |
| drizzle-anchored-introspect | docs/table-introspect-api.md | 1 | 1 | 0.899 | alias=2 |
| drizzle-unanchored-custom-types | docs/custom-types.md | 1 | 1 | 1.403 | +purpose=0.20,alias=4 |
| drizzle-signal-empty-graphql | docs/custom-types.md | 1 | 1 | 0.713 | +purpose=0.20,alias=1 |
| drizzle-signal-empty-redis | packages/drizzle-seed.md | 2 | 1 | 0.791 | alias=1 |
| drizzle-decision-zod-vs-typebox | packages/drizzle-zod.md | 1 | 1 | 0.676 | alias=1 |
| hono-anchored-routing | docs/api/routing.md | 1 | 1 | 0.789 | alias=2 |
| hono-anchored-context | docs/api/context.md | 1 | 1 | 0.512 | +purpose=0.20,alias=2 |
| hono-anchored-exception | docs/api/exception.md | 1 | 1 | 0.617 | +purpose=0.20,alias=4 |
| hono-anchored-jwt | docs/api/request.md | 1 | 1 | 1.165 | alias=4 |
| hono-anchored-cookie-helper | docs/helpers/cookie.md | 1 | 1 | 1.197 | alias=3 |
| hono-anchored-streaming | docs/helpers/streaming.md | 2 | 1 | 0.759 | alias=1 |
