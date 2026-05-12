# PRD-0023 slice 23.3 verdict — flag stays off

THO-214 ran the path-topology boost block under
`RETRIEVAL_PATH_TOPOLOGY_BOOSTS=on` against the full real-corpus
eval. Per the PRD's promotion gates, **the flag does not flip**. The
principled magnitudes do not deliver as predicted; the principle is
the thing being tested, not the values, so we revisit before any
flip.

## Aggregate result

| Gate | Baseline (flag off) | Flag on | Verdict |
|---|---:|---:|---|
| top-1 (answer_top_1_improvement) | 106/122 | 106/122 | **no movement** |
| top-3 (answer_top_3_no_regression) | 118/122 | 118/122 | pass |
| signal_empty_coverage_honest | 26/26 | 25/26 | **regression** |
| combined_coverage_honest | 148/148 | 147/148 | **regression** |
| agent_answer_no_regression | 147/148 | 146/148 | **regression** |
| query_mode_no_regression | 107/148 | 107/148 | pass |
| chunk_correctness_no_regression | 3/3 | 2/2 | **regression** |

Net top-1 delta is zero — the predicted addressable cohort flips
land, but they are exactly cancelled by unpredicted regressions
elsewhere.

## Per-case identity

### Predicted clean flips (PRD-0023)

- `vitest-anchored-mocking` (`is_section_landing`) — already on the
  expected answer at baseline; the boost did not change the answer.
- `vitest-cross-module-browser-mode` (`is_index_file`) — flipped
  from `docs/guide/browser/component-testing.md` to
  `docs/guide/browser/index.md`. Predicted ✓.
- `zod-unanchored-readme-v3` (`is_index_file` + `version_segment`)
  — flipped from `packages/docs-v3/ERROR_HANDLING.md` to
  `packages/docs-v3/README.md`. Predicted ✓.

### Predicted soft flips

- `hono-cross-module-jsx` (`path_depth`) — flipped from
  `docs/middleware/builtin/jsx-renderer.md` to
  `docs/guides/jsx.md`. Different from baseline; whether this is the
  preferred answer is corpus-specific.
- `tanstack-cross-module-eslint` (`package_segment`) — did not flip.
  PRD already flagged this as a true top-3 miss that needs
  candidate-generation work, not just ranking-time boosts.

### Unpredicted regressions (sample — full diff in eval logs)

Many cases regressed to a generic `index.md` or `README.md` that
was previously beaten by a more specific child:

- `bun-unanchored-file-io` — `docs/runtime/file-io.md` →
  `docs/runtime/index.md`
- `hono-cross-module-helpers-overview` — `docs/guides/helpers.md` →
  `docs/index.md`
- `hono-signal-empty-android/graphql/grpc/orm` — all four →
  `docs/index.md`
- `prisma-anchored-many-to-many` —
  `docs/orm/prisma-schema/data-model/relations/many-to-many-relations.md`
  → `docs/orm/prisma-schema/data-model/relations/index.md`
- `prisma-cross-module-migrate-vs-schema` —
  `docs/orm/prisma-migrate/workflows/customizing-migrations.md` →
  `docs/orm/prisma-migrate/index.md`
- `prisma-signal-empty-blockchain/graph-database` →
  `docs/orm/index.md`
- `turborepo-decision-package-types` —
  `docs/core-concepts/package-types.md` → `docs/index.md`
- `turborepo-unanchored-getting-started` —
  `docs/getting-started/add-to-existing-repository.md` →
  `docs/index.md`
- `vitest-unanchored-environment` —
  `docs/guide/browser/component-testing.md` → `docs/blog.md`
- `vitest-unanchored-projects` — `docs/config/projects.md` →
  `docs/config/index.md`
- `zod-signal-empty-cli/runtime` — moved to a different README
  variant than baseline.

## Diagnosis

The `landing + index = +0.55` composition is too aggressive on a
real corpus where many docs have a parent README/`index.md` that is
*not* the canonical answer for unanchored or signal_empty queries.
Per-case identity is exactly the failure mode the PRD warned about:
predicted addressable wins land, but the same magnitudes over-fire
elsewhere and drag signal_empty / coverage honesty down.

The PRD locks the discipline:
> Magnitudes are principled, not tuned. If the principled
> magnitudes don't deliver, we don't tune them — we revisit the
> principle.

So the verdict is **the principle (uniform magnitude path-topology
boosts on top of source-rerank) does not deliver in this slice**.
Two paths forward, both for a future PRD:

1. **Conditional boosts gated on intent / query shape.** Index/landing
   boosts only fire for `broad_domain` queries with no anchors and
   short content tokens. Signal_empty cases never get the boost.
   This is the natural hypothesis the cohort-scan suggests, but it
   adds a query-shape interaction that PRD-0023 explicitly held off
   to keep slice 1 measurable.
2. **Shift to candidate-generation rather than ranking-time
   boost.** The miss audit's stronger framing was that the failing
   cohort is a signal-extraction problem at import. Slices 2–5
   (heading exact-match, code-fence symbols, nav parsing, link
   graph) extract richer evidence that ranking can already use
   without adding new score-component coefficients.

Either direction is a separate PRD. Slice 1's purpose was to test
the architectural premise; that test ran, and the answer is "the
boost shape needs more structure than uniform additive."

## What ships

- The path-topology extractor module
  (`src/retrieve/path-topology.ts`) and its property tests stay —
  they are correct, deterministic, and useful for slice 2 and beyond.
- The `SourceProfile` and `SourceCard` extensions stay — additive
  fields that future slices consume.
- The `computePathTopologyBoost` block stays behind
  `RETRIEVAL_PATH_TOPOLOGY_BOOSTS` (default off). Useful for shadow
  analysis on future PRDs that want to revisit the boost shape.
- The promotion gates run; the verdict is documented; the flag does
  not flip.
