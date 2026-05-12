# Retrieval Engine V2 Slice 0 — Ceiling Probes

Generated: 2026-05-08T04:26:40.163Z
Repos: bun, drizzle, prisma, ralph, tanstack
Cases: 42 (answerable=32, unsupported=10)

## Branch decision

- **Primary branch:** `source_ranking_or_aboutness`
- **Recommended next PRD:** SourceProfile + Source Rerank
- **Rationale:** recall@50 = 100.0% (>=95%) but top-1 = 75.0%, top-3 = 96.9%; ranking/aboutness is the bottleneck

## Headline metrics

| Metric | Value |
|---|---:|
| critical-source-set recall@10 (answerable+critical) | 100.0% |
| critical-source-set recall@20 | 100.0% |
| critical-source-set recall@50 | 100.0% |
| actual top-1 acceptable (answerable) | 75.0% |
| actual top-3 acceptable (answerable) | 96.9% |
| oracle answerable success@50 | 100.0% |
| post-threshold critical recall@50 | 100.0% |
| post-pack critical recall@50 | 100.0% |
| false-confident unsupported | 0 |

## Per-repo

| Repo | Cases | Answerable | Critical recall@50 | Top-1 | Top-3 |
|---|---:|---:|---:|---:|---:|
| bun | 8 | 6 | 100.0% | 83.3% | 100.0% |
| drizzle | 6 | 4 | 100.0% | 100.0% | 100.0% |
| prisma | 10 | 8 | 100.0% | 87.5% | 100.0% |
| ralph | 10 | 8 | 100.0% | 62.5% | 100.0% |
| tanstack | 8 | 6 | 100.0% | 50.0% | 83.3% |

## Per-intent

| Intent | Cases | Critical recall@50 | Top-1 | Top-3 |
|---|---:|---:|---:|---:|
| broad_domain | 8 | 100.0% | 50.0% | 100.0% |
| cross_module | 5 | 100.0% | 80.0% | 80.0% |
| decision_lookup | 3 | 100.0% | 100.0% | 100.0% |
| exact_symbol | 3 | 100.0% | 66.7% | 100.0% |
| file_anchored | 13 | 100.0% | 84.6% | 100.0% |
| signal_empty | 10 | 0.0% | 0.0% | 0.0% |

## Top misses

_(none — all critical sources covered@50)_

## Unsupported separability

- classification: `weak`
- reason: score_gap=0.08, supported_confident=19%, unsupported_honest=100%
- supported avg top-1 score: 0.961
- unsupported avg top-1 score: 0.884
- false-confident unsupported: 0

Slice 0 features marked unavailable (intentionally not zero-filled): retriever_agreement, source_alias_hit_count, dense_sparse_agreement, generated_question_agreement, source_purpose_compatibility.

## Confidence diagnostics

Per-case confidence classifications for unsupported cases. False-confident rows (`coverage=confident` on an unsupported case) are PRD-0011 release blockers.

| Case | Coverage | Reason | Top-1 | t1-t2 | t1-t3 | Mode | Warnings |
|---|---|---|---:|---:|---:|---|---|
| bun-signal-empty-android-deployment | uncertain | low_confidence_warning | 0.840 | 0.140 | 0.229 | unanchored | low_confidence |
| bun-signal-empty-cobol-interop | uncertain | narrow_top_score_margin | 0.848 | 0.005 | 0.008 | unanchored | low_confidence |
| drizzle-signal-empty-graphql | uncertain | low_confidence_warning | 0.855 | 0.206 | 0.222 | unanchored | low_confidence |
| drizzle-signal-empty-redis | uncertain | narrow_top_score_margin | 0.828 | 0.000 | 0.021 | unanchored | low_confidence |
| prisma-signal-empty-blockchain | uncertain | narrow_top_score_margin | 0.880 | 0.040 | 0.060 | unanchored | low_confidence |
| prisma-signal-empty-graph-database | uncertain | low_confidence_warning | 0.880 | 0.209 | 0.308 | unanchored | low_confidence |
| ralph-signal-empty-kubernetes-deployment | uncertain | narrow_top_score_margin | 0.975 | 0.069 | 0.075 | unanchored | — |
| ralph-signal-empty-database-migration | uncertain | unanchored_score_below_confident_floor | 0.930 | 0.272 | 0.386 | unanchored | — |
| tanstack-signal-empty-mongodb | uncertain | narrow_top_score_margin | 0.840 | 0.040 | 0.040 | unanchored | low_confidence |
| tanstack-signal-empty-cli | uncertain | narrow_top_score_margin | 0.966 | 0.070 | 0.076 | unanchored | — |

## Synthetic regression

- **STATUS:** passed (no positive ship power; pass means the floor is intact).

## Slice 2 gates (PRD-0012)

- **STATUS:** PASSED

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
| prisma-anchored-many-to-many | docs/orm/prisma-schema/data-model/relations/many-to-many-relations.md | 1 | 1 | 0.374 | alias=3 |
| prisma-anchored-shadow-database | docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database.md | 1 | 1 | 0.485 | alias=3 |
| prisma-anchored-customize-migration | docs/orm/prisma-migrate/workflows/customizing-migrations.md | 1 | 1 | 1.208 | +purpose=0.30,alias=2 |
| prisma-unanchored-seeding | docs/orm/prisma-migrate/workflows/seeding.md | 1 | 1 | 1.448 | alias=5 |
| prisma-unanchored-generators | docs/orm/prisma-schema/data-model/multi-schema.md | 1 | 1 | 1.078 | alias=4 |
| prisma-signal-empty-blockchain | docs/orm/reference/prisma-client-reference.md | 1 | 1 | 0.802 | alias=3 |
