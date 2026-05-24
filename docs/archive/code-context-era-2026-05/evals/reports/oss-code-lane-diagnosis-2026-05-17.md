# OSS code-lane diagnosis - 2026-05-17

## Scope

This diagnosis treats the large OSS code-lane generalization eval as the real
benchmark. It does not use the ContextTrail MCP setup or the small local
ContextTrail/Ralph panels as the source of truth.

Baseline command:

```bash
PATH="/Users/thomas/.npm/_npx/8758e404b5eed2f3/node_modules/node/bin:$PATH" \
  node dist/eval/oss-code-lane-generalization.js \
  --manifest=.contexttrail/evals/oss-code-lane-manifest-local.json \
  --target-prompts-per-case=10
```

The manifest-local copy only rewrites stale absolute checkout roots from the
generated manifest to this workspace.

## Baseline result

- Outcome: fail.
- Corpus: 16 repos, 781 cases, 7,810 prompt variants, 5 languages.
- Prompt top-3: 3,522 / 7,610 = 46.3% (lower99 = 44.8%).
- Ticket top-3 robust: 130 / 761 = 17.1% (lower99 = 13.9%).
- Ranked useful: 3,522 / 7,610 = 46.3% (lower99 = 44.8%).
- Support file hits: 145 / 4,033 = 3.6% (lower99 = 2.9%).

Weakest repos by top-3:

- Biome: 31.8%.
- Drizzle ORM: 34.6%.
- Cobra: 36.6%.
- Vitest: 38.2%.
- Vite: 40.4%.

## What the slices show

Path/oracle cleanliness explains some denominator pain, but not the main
retrieval failure:

- Probe-scored source files: 4,033.
- Files surviving a stricter implementation-target filter: 2,850.
- Probe source path buckets:
  - normal: 2,882
  - root or nested `test/`: 614
  - examples: 371
  - generated/snapshot: 84
  - missing at HEAD: 59
  - docs/build/fixtures: 23

Top-3 by target size:

- 1 source file: 1,820 / 4,140 = 44.0%.
- 2-4 source files: 1,037 / 2,330 = 44.5%.
- 5-9 source files: 408 / 800 = 51.0%.
- 10-24 source files: 150 / 290 = 51.7%.
- 25+ source files: 107 / 250 = 42.8%.

Top-3 by cleanliness:

- Clean small targets (`strict <= 9`): 2,994 / 6,400 = 46.8%.
- Noisy or large targets: 528 / 1,410 = 37.4%.
- Strict-equal oracle targets: 3,095 / 6,850 = 45.2%.
- Targets with extra noisy files: 427 / 960 = 44.5%.

The important conclusion: oracle noise is real, especially for support-file
coverage, but even clean small implementation targets are only at 46.8% top-3.
So the large eval is not merely unfair; the code lane has a genuine candidate
generation/ranking problem.

## Why this is happening

### 1. The scorer and manifest builder disagree on what a source target is

`oss-code-lane-manifest-builder.ts` filters many non-target paths, but only when
the path contains slash-delimited segments like `/examples/` or `/test/`.
Root-level `examples/...`, `test/...`, `tests/...`, `build/...`, generated, and
snapshot paths leak through later because `agent-completion-probe.ts` recomputes
changed files with its own broader `categorizeAgentCompletionPath()`.

The probe also uses `git show --name-only` without the builder's `--diff-filter`
or `existsSync` check, so deleted/renamed files and files missing at HEAD can
enter the denominator even though the retrieval index cannot return them.

This inflates exact-file support misses and makes large/mechanical commits look
like ordinary agent-context failures.

### 2. The benchmark currently treats every changed implementation-ish file as necessary context

Several cases are broad sweeps:

- TanStack Query: 755 scored source files in one Angular query-key commit, 307
  from examples.
- Vitest: 331 scored source files for a `test/cli -> test/e2e` rename, 326 from
  root `test/`.
- tRPC: 154 scored source files for OpenAPI generation, with examples, generated
  clients, and test routers.
- Drizzle ORM: 93 source files for a new dialect.

These are legitimate commits, but they are not all the same retrieval task. A
small context pack should not be expected to return every generated output,
example file, rename target, or release-sweep touch. Those should be separate
benchmark families with different metrics.

### 3. Query panels are often too weak for real code ownership discovery

The mined prompts are mostly commit subject plus "implementation files" plus a
small path-token bag. That is general, but many OSS subjects are low-signal:
`0.41`, `Cache`, `Apply code changes`, `improvements from PR review`, release
commits, typo/comment-only changes, and broad refactors.

Path-token overlap falls sharply as target size grows:

- 1-file cases: average path-token overlap about 0.79.
- 5-9 files: about 0.52.
- 10-24 files: about 0.35.
- 25+ files: about 0.19.

This means the eval is often asking the engine to infer code ownership from
underspecified natural language, which is the right product problem, but the
current query generation does not reveal whether failure came from weak prompt
wording, candidate generation, or pack selection.

### 4. `ranked useful` is not measuring a deeper candidate ceiling

In the large run, prompt top-3 and ranked useful are identical:

- Prompt top-3: 3,522 / 7,610.
- Ranked useful: 3,522 / 7,610.
- Miss taxonomy: `ranked_hit_top3_miss = 0`.

That means this benchmark does not currently show whether the right file was
available at rank 10, 30, or 100 before pack admission. The failure could be
candidate generation, reranking, or budget/pack admission. We need raw candidate
recall instrumentation to tell those apart.

### 5. Non-TS languages have facts, but only generic file-level chunks

TypeScript/JavaScript get richer code-index artifacts. Python, Go, and Rust
extract facts, but `code-source-dispatch.ts` emits one generic orientation chunk
per file for those languages. That chunk includes path, purpose, exports,
imports, and compact body terms, but it does not produce declaration-level
chunks.

The language rates are all poor, so this is not only a non-TS issue:

- Go: 36.6%.
- Rust: 42.1%.
- JavaScript: 43.8%.
- Python: 46.0%.
- TypeScript: 47.0%.

Still, zero-hit examples in Biome show plausible one-file Rust parser changes
losing to adjacent parser/formatter files. Symbol-level Rust/Go/Python chunks
would make those files easier to distinguish.

### 6. Support clusters are evaluated against the wrong denominator

Support-file hits are 145 / 4,033 = 3.6%. The support system is built around a
primary file plus import/same-family companions, but the metric checks exact
overlap with every changed source file. For sweep commits, generated output,
examples, and broad refactors, most changed files are not "support files" in the
agent-context sense.

The support metric should be redefined around necessary companions, not every
file in the commit diff.

## Recommended next methods

### Eval repairs before tuning retrieval

1. Share one target-file filter between manifest mining and scoring.

   Use one `isEvalCodeTargetFile()` function for both. It should apply
   `--diff-filter=ACMRT`, require file existence in the indexed checkout, exclude
   root and nested examples/tests/fixtures/docs/build/dist/target/vendor paths,
   exclude generated/snapshot output by default, and record exclusions in the
   report.

2. Split the benchmark into task families.

   Keep the broad OSS corpus, but report separate gates for:
   source-owner discovery, support-companion discovery, tests/examples,
   generated-output/source-owner pairing, and large mechanical sweeps. Do not
   force one top-3/support exact-file metric to explain all of them.

3. Add candidate-ceiling instrumentation.

   Measure raw candidate recall before pack selection: recall@10, recall@30,
   recall@100, path/fact candidate recall, and pack-admitted recall. This will
   show whether the right file never appears, appears but ranks too low, or is
   dropped by budget/support packing.

4. Track oracle cleanliness in the report.

   Add per-case columns for `srcCount`, `strictSrcCount`, excluded path buckets,
   missing-at-HEAD count, generated/example/test flags, language, and change type.
   This makes regressions interpretable without weakening the benchmark.

### Engine improvements that should generalize

1. Add a path/facts candidate generator beside FTS.

   Current lexical/path boosts mostly rerank chunks that FTS already found; path
   fallback only activates for path-shaped queries. Add a generator over
   `code_sources` facts and normalized path tokens so `markdown_parser`,
   `frontmatter`, `date mapper`, or `node-postgres session` can retrieve files
   even when chunk body BM25 points at neighbors.

2. Use multi-query decomposition for code ownership.

   Decompose each task into subject terms, domain nouns, symbol-like tokens,
   path-like tokens, and workflow verbs. Run a small ensemble and fuse by file.
   This is general across repos and should help vague commit-style prompts
   without overfitting to the eval.

3. Emit symbol/declaration chunks for Rust, Go, and Python.

   Reuse the existing regex facts to create declaration chunks, not only a
   generic orientation chunk. Include private top-level declarations when the
   task is implementation/debug-oriented, because agent tasks often target
   internal functions rather than public APIs.

4. Improve module/package graph support.

   Add Rust `mod`/sibling module relations, Go package-local files, Python
   package/module resolution, barrel/index companions, generated/source-owner
   pairing, and same-directory feature clusters. This should improve support
   discovery after the primary file is correct.

5. Make test/example retrieval intent-aware.

   Exclude tests/examples from normal implementation-owner gates, but allow them
   when the query is explicitly about tests, examples, regressions, fixtures, or
   snapshots. This avoids both false negatives and noisy wins.

6. Revisit pack admission only after candidate ceiling is known.

   If recall@30 is high but top-3 is low, improve reranking and pack admission.
   If recall@30 is also low, focus on candidate generation and language
   chunking first.

## Current working diagnosis

The large OSS eval is telling us something real: the code lane is only about
46% top-3 even on clean small implementation targets. The biggest likely
product-quality gap is candidate generation for code ownership, especially
path/fact retrieval and multi-query fusion.

At the same time, the support-file gate and some exact-file denominators are
too noisy to guide optimization. Fix the eval instrumentation first, then tune
retrieval against clean task-family metrics so improvements generalize across
repos instead of chasing giant commit artifacts.
