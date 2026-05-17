# Code-lane baseline - 2026-05-17

This report captures the current code-context eval baseline before the next
improvement loop. It uses the repo's existing eval harnesses rather than
ContextTrail MCP retrieval.

## Commands

- `npm run eval:code-lane-comparison`
- `npm run eval:code-lane-expanded-prompts`
- `node --input-type=module -e '...runCrossRepoExpandedPromptPanel with /Users/thomas/Repos/Ralph...'`
- `npm run eval:prd-0050-shadow`
- `npm run eval:real-corpus`
- `npm test -- --run src/eval/code-context-shadow.test.ts src/eval/code-lane-comparison.test.ts src/eval/code-lane-expanded-prompt-panel.test.ts src/eval/cross-repo-expanded-prompt-panel.test.ts src/eval/oss-code-lane-generalization.test.ts src/eval/oss-code-lane-manifest-builder.test.ts src/retrieve/code-family-evidence.test.ts src/retrieve/code-source-mix.test.ts`
- `npm test`

The local Node 26 runtime is not compatible with the checked-in
`better-sqlite3` native module version, so the evals were run under Node 25.9.0.
macOS quarantine attributes were cleared from `node_modules` native bindings so
Vitest and SQLite could load their local dependencies.

## Paired code-lane comparison

The current chunk-first code lane is a large improvement over the old file-card
path, but it is not yet full implementation-context coverage.

| Metric | Old file-card | Current chunk-first |
| --- | ---: | ---: |
| Ranked code-file coverage | 0/66 (0.0%) | 31/66 (47.0%) |
| Code top-1 acceptable | 0/14 (0.0%) | 13/14 (92.9%) |
| Code ranked useful | 0/14 (0.0%) | 14/14 (100.0%) |
| Support-cluster useful | 0/14 (0.0%) | 12/14 (85.7%) |
| Prompt variant top-1 | 0/42 (0.0%) | 28/42 (66.7%) |
| Prompt variant top-3 | 0/42 (0.0%) | 39/42 (92.9%) |
| Prompt variant ranked | 0/42 (0.0%) | 39/42 (92.9%) |
| Tickets top-3 robust | 0/14 | 11/14 |
| Tickets ranked robust | 0/14 | 11/14 |

Residual families from the current lane:

| Family | Missing from ranked | Support missing | Main shape |
| --- | ---: | ---: | --- |
| `import_workflow` | 12 | 14 | CLI/import/reindex/parser companion files are often absent. |
| `persistence_substrate` | 11 | 11 | `src/store/db.ts`, schema, chunks, and storage companions are under-recalled. |
| `source_profile_storage` | 5 | 8 | SourceProfile storage companions remain patchy. |
| `other` | 5 | 9 | Retrieval feature flags and source-card support files are inconsistent. |
| `cli_workflow` | 1 | 1 | Small local miss, bigger in Ralph. |
| `retrieval_index` | 1 | 1 | Small local miss, bigger in Ralph. |

Top local target files:

- `src/store/db.ts`: missing/support-missing in 6 tickets.
- `src/store/source-profiles.ts`: missing/support-missing in 4 tickets.
- `src/cli/import.ts`: missing/support-missing in 3 tickets.
- `src/cli/index-cmd.ts`, `src/retrieve/fused-source-candidates.ts`,
  `src/retrieve/source-card.ts`, and `src/store/schema.ts`: each repeated
  residual support pressure.

## Expanded prompt panel

The expanded local prompt panel shows the top-3 metric is strong on the familiar
repo, but the remaining misses are true candidate-generation misses rather than
mere ordering misses.

| Metric | Current |
| --- | ---: |
| Base prompts | 42 |
| Expanded prompts | 140 |
| Prompt top-3 useful | 132/140 (94.3%, lower99=87.0%) |
| Prompt ranked useful | 132/140 (94.3%, lower99=87.0%) |
| Tickets top-3 robust | 11/14 (78.6%, lower99=44.4%) |

Top local miss examples:

- `THO-225`: structural chunk context flag candidate recall eval.
- `THO-223`: chunk-level `doc_purpose` extractor synthetic property.
- `THO-219`: code-fence entities markdown extractor.

In these examples, `ranked_changed=(none)`, so widening or improving candidate
generation matters more than retuning the final top-3 order alone.

## Cross-repo holdout

The Ralph holdout remains the clearest generalization gap.

| Repo | Prompts | Prompt top-3 useful |
| --- | ---: | ---: |
| ContextTrail | 140 | 132/140 (94.3%, lower99=87.0%) |
| Ralph | 40 | 15/40 (37.5%, lower99=20.9%) |
| Aggregate | 180 | 147/180 (81.7%, lower99=73.2%) |

Breadth gates intentionally fail for OSS confidence: only 2 repos, 18 cases, and
180 prompt variants versus the policy target of 30 repos, 600 cases, and 2000
prompt variants.

Ralph paired code-lane result:

| Metric | Current chunk-first |
| --- | ---: |
| Ranked code-file coverage | 3/9 (33.3%) |
| Code top-1 acceptable | 3/4 (75.0%) |
| Code ranked useful | 3/4 (75.0%) |
| Support-cluster useful | 0/4 (0.0%) |
| Prompt variant top-1 | 3/12 (25.0%) |
| Prompt variant top-3 | 4/12 (33.3%) |
| Prompt variant ranked | 4/12 (33.3%) |

Ralph residual families:

- `retrieval_index`: missing/support-missing around `src/artifacts/index.ts`,
  `src/runner/index.ts`, and `src/validate/index.ts`.
- `cli_workflow`: support-missing around runner reset/takeover and validator
  command files.
- `other`: artifact summaries and git support are still missed.

## PRD-0050 shadow

The full-panel shadow result does not promote the combined bundle candidate.
It reduces payload size, but weakens top-3, support file hits, code top-1, and
support-cluster guardrails.

| Metric | PRD-0048 baseline | Combined bundle | Gate |
| --- | ---: | ---: | --- |
| Prompt variant top-3 | 39/42 | 35/42 | >=75% |
| Tickets top-3 robust | 11/14 | 9/14 | >=10/14 |
| Support file hits | 43/66 | 26/66 | >=50/66 |
| Code top-1 acceptable | 13/14 | 11/14 | no regression |
| Code ranked useful | 14/14 | 14/14 | no regression |
| Support-cluster useful | 14/14 | 13/14 | no regression |
| Payload tokens | 29184 | 9898 | reported impact |

Disposition: `shadow-only`. The next blocker is top-3 robustness, followed by
support file hits and owner/support guardrail regressions.

## Real-corpus guardrail

The broad real-corpus eval completes, but the PRD-0016 release verdict remains
`FAIL`.

| Gate | Current | Result |
| --- | ---: | --- |
| Answer top-1 improvement | 149 | PASS |
| Answer top-3 no regression | 170 | PASS |
| True top-3 misses target | 4 | FAIL |
| Top-3 hit / top-1 miss target | 21 | FAIL |
| Signal-empty coverage honest | 25 | FAIL |
| Combined coverage honest | 199/200 | PASS |
| Agent answer no regression | 196/200 | PASS |
| Query mode no regression | 161/200 | PASS |
| Chunk correctness no regression | 3/3 | PASS |
| Payload size no bloat | 0.0% growth | PASS |
| Synthetic regression | passed | PASS |

The broad guardrail failures are mostly ordering and honesty failures rather
than code-lane-specific owner retrieval failures.

## Verification

Focused code-lane guard tests passed:

- 8 test files passed.
- 91 tests passed.

Full `npm test` completed but failed:

- 209 files passed, 4 files failed.
- 1999 tests passed, 4 failed, 1 skipped.
- Failing tests:
  - `src/eval/synthetic/compositional.test.ts`: multi-anchor V3 below lexical.
  - `src/eval/synthetic/cross-corpus.test.ts`: changelog nonsense vocabulary
    delta outside 10pp band.
  - `src/eval/synthetic/paraphrase.test.ts`: indirect changelog phrasings below
    the 0.8 floor.
  - `src/eval/synthetic/scale.test.ts`: changelog clean-phrasing lower95 below
    the 0.95 floor.

## Improvement hypotheses

The next methods should generalize across repos and should be validated against
ContextTrail plus Ralph before runtime promotion.

1. Build a repo-map owner layer from parsed symbols, exported functions,
   command registries, and file path roles. Use it to recover owners such as
   `runner/index.ts`, `artifacts/index.ts`, `store/db.ts`, and CLI entrypoints
   when prompt wording names behavior rather than exact symbols.
2. Add a support-necessity graph that distinguishes task-critical companions
   from merely related files. Start with local, deterministic edges:
   barrel/export edges, command registration edges, schema/store edges,
   parser/dispatcher edges, and test-to-implementation edges.
3. Split candidate generation from top-3 assembly more explicitly. First
   optimize recall@30 for owner/support/full-set; only then optimize top-3 as a
   bundle. Do not promote methods that only shrink payload or support clusters
   while reducing owner quality.
4. Introduce language-agnostic structural chunk roles beyond TS exports:
   command entrypoint, barrel/index, schema/store adapter, parser adapter,
   config/defaults, validator, and artifact writer. These roles should come
   from syntax and path evidence, not repo-specific aliases.
5. Add support-aware query rewriting that expands durable engineering concepts
   into local retrieval facets, for example "import workflow" -> CLI command,
   parser, chunker, reindex, storage; "persistence substrate" -> schema, db,
   store, migrations, read/write call sites.
6. Add a second-stage top-3 bundle scorer that scores sets, not individual
   files: owner retained, required support diversity, no passive eval/report
   files unless requested, and no duplicate role slots.
7. Improve cross-repo calibration before ratcheting. The current ContextTrail
   local panel is too familiar; Ralph shows the method does not yet generalize
   to runner/artifact/validator workflows.
8. Keep broad real-corpus honesty separate from code-lane ranking. Signal-empty
   and doc ordering failures should not be fixed by code support heuristics, but
   they should remain guardrails to prevent code-lane work from damaging docs.
