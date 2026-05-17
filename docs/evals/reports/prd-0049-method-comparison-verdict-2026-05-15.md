# PRD-0049 method comparison verdict - 2026-05-15

This report records the PRD-0049 OSS code-context method adoption spike. The
work is deliberately shadow-only: no production retrieval behavior changes, no
new hosted services, no credentials, and no copied OSS code.

Baseline: PRD-0048 final report at
`docs/evals/reports/prd-0048-promotion-verdict-2026-05-15.md`.

## Commands

- `npm test -- --run src/eval/code-context-shadow.test.ts`
- `npm run build:all`
- `npm test`
- `npm run eval:code-lane-comparison`
- `node --input-type=module -e 'import { buildPrd0042ValidationRepos } from "./dist/eval/prd-0042-promotion-verdict.js"; import { runCrossRepoCodeLaneComparison, renderCrossRepoCodeLaneComparison } from "./dist/eval/cross-repo-code-lane-comparison.js"; const report = await runCrossRepoCodeLaneComparison({ repos: buildPrd0042ValidationRepos(process.cwd()) }); process.stdout.write(renderCrossRepoCodeLaneComparison(report));'`
- `npm run eval:real-corpus`

The focused TDD suite covers the prior-art matrix renderer, the adapter
contract/current-production baseline, the repository-map adapter, the hybrid
retrieval/rerank adapter, the graph/xref adapter, and the final verdict
renderer.

Verification results:

- Focused PRD-0049 suite: 6 passing tests.
- Full suite: 207 files, 1,947 passing tests, 1 skipped.
- `npm run build:all`: passed.
- Paired code-lane comparison: completed, preserving the PRD-0048 final shape.
- Cross-repo comparison: completed, preserving the known Ralph holdout gaps.
- Real-corpus eval: completed with the known release verdict failure on
  `true_top_3_misses_target` and `top_3_hit_top_1_miss_target`; all
  no-regression guardrails passed, including payload size growth at 0.0%.

## Prior-Art Matrix

Durable matrix:
`docs/evals/reports/prd-0049-prior-art-matrix-2026-05-15.md`

Verdict from the matrix:

| Method family | Reuse boundary | Operational boundary | Expected fit |
| --- | --- | --- | --- |
| Aider-style repository map | Method adaptation only | Local/offline | Strong owner retention and exact navigation candidate |
| Continue-style hybrid retrieval/rerank | Method adaptation only | Local default; embeddings/model rerankers optional only | Strongest candidate for separating recall misses from rerank misses |
| Sourcegraph/Cody-style multi-source context | Method adaptation only | Hosted/code-intelligence assumptions out of scope | Useful pattern, but only local graph/search signals are admissible here |
| OpenGrok-style search/cross-reference | Method adaptation only; CDDL code not copied | Local index only | Useful xref pattern, but broad service-style indexing is not promoted |
| REPOFUSE-style fused repository context | Paper attribution only | Model-dependent variants out of scope | Research lead for set-level context, not directly promotable |

## Code Graph Capability Inventory

Existing capabilities:

- `code_sources` stores per-file structural facts: file path, exported symbols,
  signatures, purpose, and imports.
- `code_chunks` stores exact navigation metadata for orientation and declaration
  chunks.
- `code_graph_edges` stores resolved import edges and supports outgoing and
  incoming traversal.
- Current retrieval already uses bounded late graph augmentation for support
  clusters.

Genuinely missing shadow signals:

- typed symbol references beyond import edges
- call-site/reference counts that distinguish necessary support from broad
  related files
- typed schema/store support edges beyond path, symbol, and purpose evidence

PRD-0049 keeps those gaps in shadow reports. It does not reimplement the graph
substrate or promote broad graph expansion.

## Shadow Adapter Surface

`src/eval/code-context-shadow.ts` adds:

- A method adapter contract with method metadata, dependency notes, candidate
  code entries, support candidates, trace reasons, exact navigation metadata,
  initial candidate slate, and final top-K candidates.
- A shadow runner that reports owner, support, and full-set candidate recall
  before final selection, top-K usefulness after ordering, ranked usefulness,
  support-cluster usefulness, set-level context quality, per-family movement,
  ticket robustness, and payload tokens.
- A current-production adapter wrapping the PRD-0048 chunk-first code lane as a
  baseline without changing runtime retrieval.
- Three deterministic local adapters:
  - `repository-map`
  - `hybrid-rerank`
  - `graph-xref`

## Focused Shadow Results

The focused synthetic cases are intentionally tiny but behavior-shaped. They
prove the public adapter outcomes rather than private score constants.

Evidence scope: `focused_synthetic`. Focused synthetic evidence can promote a
method into a full-panel shadow eval, but cannot recommend production promotion.

| Method | Owner candidate recall | Support candidate recall | Set candidate recall | Top-3 usefulness | Ranked usefulness | Support-cluster usefulness | Set-level quality | Payload-size impact | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| PRD-0048 current production | 1/1 harness baseline | 0/0 harness baseline | 1/1 harness baseline | 1/1 harness baseline | 1/1 harness baseline | 0/0 harness baseline | 0/0 harness baseline | 1 compact projection | defer: baseline |
| Repository map | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | bounded by candidate limit | combine: strong exact-navigation owner/support behavior |
| Hybrid rerank | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | bounded by candidate limit | promote to full-panel shadow eval: best generation-vs-rerank diagnostic fit |
| Graph/xref | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | bounded by candidate limit | defer as shadow-only support signal until holdout top-3 improves |

Per-family movement covered by focused tests:

| Family | Adapter evidence |
| --- | --- |
| `persistence_substrate` | Repository-map exact owner retention plus schema/store support |
| `import_workflow` | Hybrid broad recall plus deterministic local rerank of command and parser/chunker support |
| `retrieval_index` | Graph/xref outgoing import, reverse import, and schema/store support reasons |
| `cli_workflow` | Graph/xref reverse-import support is visible but not promoted alone |

## PRD-0048 Baseline Comparison

The production baseline remains PRD-0048:

| Metric | PRD-0048 final |
| --- | ---: |
| Ranked code-file coverage | 54/66 (81.8%) |
| Code top-1 acceptable | 12/14 (85.7%) |
| Code ranked useful | 14/14 (100.0%) |
| Support-cluster useful | 14/14 (100.0%) |
| Prompt variant top-1 | 20/42 (47.6%) |
| Prompt variant top-3 | 26/42 (61.9%) |
| Prompt variant ranked | 41/42 (97.6%) |

Because the new adapters are shadow-only and not wired into production
retrieval, the full code-lane, cross-repo, and real-corpus guardrail metrics are
not changed by this PRD. The local `npm run eval:code-lane-comparison` result
confirmed the same PRD-0048 final numbers above.

## Cross-Repo Holdout

The PRD-0048 holdout result remains the live comparison point:

| Family | PRD-0048 holdout verdict |
| --- | --- |
| `retrieval_index` | still missing ranked/support files in Ralph |
| `cli_workflow` | still ranked below top 3 and support-missing in Ralph |
| `other` | still has uncovered holdout files |

The graph/xref adapter now provides traceable local reasons for import edge,
reverse import edge, schema/store support, and support necessity. It is not
promoted until those reasons improve holdout top-3 or support usefulness on a
full imported holdout workspace. The cross-repo command completed with the same
Ralph metrics: 3/9 ranked code-file coverage, 0/4 code top-1 acceptable, 3/4
code ranked useful, and 0/4 support-cluster useful.

## Real-Corpus Guardrails

The broad real-corpus verdict remains the PRD-0048 state: existing release-gate
failures on true top-3 misses and top-3-hit/top-1-miss ordering, with no
documented no-regression guardrail failure from PRD-0048. The local
`npm run eval:real-corpus` result was:

| Gate | Result |
| --- | --- |
| Answer top-1 improvement | PASS |
| Answer top-3 no regression | PASS |
| True top-3 misses target | FAIL |
| Top-3 hit / top-1 miss target | FAIL |
| Signal-empty coverage honest | PASS |
| Combined coverage honest | PASS |
| Agent answer no regression | PASS |
| Query mode no regression | PASS |
| Chunk correctness no regression | PASS |
| Payload size no bloat | PASS, current growth 0.0% |
| Synthetic regression | PASS |

PRD-0049 adds no production behavior, so it cannot claim real-corpus improvement.
It also does not weaken PRD-0016, PRD-0042, PRD-0047, or PRD-0048 guardrails.

## Method Dispositions

| Method | Disposition | Reason |
| --- | --- | --- |
| `prd-0048-baseline` | defer | comparison baseline, not a new method |
| `repository-map` | combine | owner retention and exact navigation are strong; combine with hybrid rerank before production |
| `hybrid-rerank` | promote to full-panel shadow eval | best next candidate because it separates candidate generation from final ordering without required external dependencies |
| `graph-xref` | defer | useful trace reasons, but broad graph expansion remains rejected until holdout top-3/support improves |

## Next Production PRD Recommendation

Do not open a production retrieval rewrite yet.

Open the next PRD as a full-panel shadow evaluation of the hybrid rerank method,
combined with repository-map owner retention. That PRD should run against the
existing code-lane panel, Ralph holdout, and real-corpus no-regression guardrails
before any runtime promotion. If the method implies a materially different
production architecture, write an ADR before implementation.
