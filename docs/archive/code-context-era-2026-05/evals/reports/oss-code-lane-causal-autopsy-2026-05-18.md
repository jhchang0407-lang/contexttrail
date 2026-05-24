# OSS Code-Lane Causal Autopsy - 2026-05-18

## Scope

This report is the first causal autopsy pass over the full local OSS code-lane
corpus. It uses the same manifest shape as the accepted PRD-0052/0053 baseline:

- manifest: `.contexttrail/evals/oss-code-lane-manifest-local.json`
- prompt variants per case: `10`
- repos: `16`
- prompt variants with strict source targets: `7360`
- accepted baseline prompt top-3: `4607 / 7360` (`62.6%`)

The autopsy intentionally goes one level deeper than the existing aggregate
eval report. The existing report says whether a prompt hit top-3, ranked
somewhere, support, or recall@N. This report assigns a primary cause to each
top-3 miss using the per-prompt candidate recall fields.

## Cause Labels

- `candidate_buried_top10`: a target file is present by recall@10 but not in
  top-3.
- `candidate_buried_top30`: a target file is absent from recall@10 but present
  by recall@30.
- `candidate_buried_top100`: a target file is absent from recall@30 but present
  by recall@100.
- `candidate_generation_miss`: no target file is present by recall@100.

Modifiers are non-exclusive:

- `many_decoys_in_top3`: the top-3 slate contains three non-target files.
- `weak_prompt_identity`: the prompt has no normalized token overlap with the
  strict target file paths.
- `large_target_set`: the commit has four or more strict target files.

## Corrected Autopsy Result

Prompt variants: `7360`

Top-3 misses: `2753` (`37.4%`)

### Primary Causes

| Cause | Misses | Share of top-3 misses |
| --- | ---: | ---: |
| `candidate_buried_top10` | `1082` | `39.3%` |
| `candidate_buried_top30` | `701` | `25.5%` |
| `candidate_generation_miss` | `680` | `24.7%` |
| `candidate_buried_top100` | `290` | `10.5%` |

### Modifiers

| Modifier | Misses | Share of top-3 misses |
| --- | ---: | ---: |
| `many_decoys_in_top3` | `2330` | `84.6%` |
| `weak_prompt_identity` | `1335` | `48.5%` |
| `large_target_set` | `520` | `18.9%` |

## Interpretation

The current code lane is not primarily failing because targets are impossible
to generate. It is mostly failing because the correct file is present but
buried.

Useful target files are present by recall@100 in `2073 / 2753` top-3 misses
(`75.3%`). More importantly, useful target files are already present by
recall@10 in `1082 / 2753` misses (`39.3%`). That points away from more broad
candidate generation as the next default move and toward first-slate arbitration
or bundle selection.

The `many_decoys_in_top3` modifier is very high: `2330 / 2753` misses
(`84.6%`). That means the engine commonly has enough signal to produce a code
slate, but the slate is occupied by plausible wrong files. This is stronger
evidence for an arbitration problem than the previous aggregate eval could show.

The `weak_prompt_identity` modifier is also high: `1335 / 2753` misses
(`48.5%`). Nearly half of misses have no direct identity-token overlap between
the prompt and target paths. That explains why lexical/facet tuning has been
low-yield: many prompts require repo ownership inference, not just better
token matching.

The `large_target_set` modifier affects `520` misses (`18.9%`). These cases
are real work, but they are often not solvable as "pick the one owner file."
They need bundle-level treatment or a separate sweep/change-family policy.

## Causes By Change Type

| Change type | Misses | Dominant causes |
| --- | ---: | --- |
| `runtime` | `1395` | generation miss `421`, buried top10 `535`, buried top30 `329` |
| `retrieval_index` | `339` | buried top10 `109`, buried top30 `97`, buried top100 `73` |
| `configuration` | `261` | buried top10 `123`, buried top30 `66`, generation miss `47` |
| `api` | `202` | buried top10 `78`, buried top30 `58`, generation miss `42` |
| `cli_workflow` | `166` | buried top10 `98`, buried top30 `40`, generation miss `11` |
| `ui` | `126` | buried top10 `63`, buried top30 `42`, generation miss `10` |
| `storage` | `119` | buried top30 `44`, generation miss `31`, buried top10 `29` |
| `parser` | `75` | buried top10 `22`, generation miss `21`, buried top30 `18` |
| `build_tooling` | `70` | generation miss `37`, buried top10 `25` |

Runtime dominates total misses, but not all runtime misses have the same
shape. Many runtime misses are target-present ranking/arbitration failures,
while build-tooling misses skew more toward target absence.

## Causes By Repo

| Repo | Misses | Dominant causes |
| --- | ---: | --- |
| Biome | `247` | generation miss `88`, buried top10 `83`, buried top30 `39` |
| Drizzle ORM | `224` | buried top30 `83`, generation miss `60`, buried top10 `57` |
| Zod | `205` | buried top30 `92`, buried top10 `54`, generation miss `46` |
| Effect | `201` | buried top30 `73`, buried top10 `70`, generation miss `35` |
| tRPC | `196` | buried top30 `64`, generation miss `58`, buried top10 `51` |
| Vite | `194` | buried top10 `67`, buried top30 `50`, generation miss `50` |
| Vitest | `189` | buried top10 `88`, buried top30 `58`, generation miss `23` |
| Hono | `188` | buried top10 `66`, buried top30 `58`, generation miss `34` |
| Valibot | `183` | generation miss `68`, buried top30 `61`, buried top10 `45` |
| Prisma | `177` | buried top10 `60`, buried top30 `52`, buried top100 `40` |
| Turborepo | `177` | buried top10 `76`, generation miss `46`, buried top100 `29` |
| Fastify | `152` | buried top10 `86`, generation miss `62` |
| Flask | `126` | buried top10 `86`, generation miss `33` |
| bat | `109` | buried top10 `79`, generation miss `16` |
| TanStack Query | `96` | buried top10 `41`, generation miss `21`, buried top30 `20` |
| Cobra | `89` | buried top10 `73`, generation miss `15` |

## Representative Misses

### Candidate Buried Top10

- Biome runtime: `docs: clarify vcs.root description (#10379)`
  - target: `crates/biome_configuration/src/vcs.rs`
  - top3: `crates/biome_analyze/src/diagnostics.rs`, `crates/biome_analyze/src/rule.rs`, `crates/biome_cli/src/execute/migrate/prettier.rs`
  - interpretation: target is already near the top, but generic docs/diagnostics/migration files occupy the first slate.

- Biome configuration: `fix(config): support trailingCommas in overrides (#10318)`
  - target: `crates/biome_configuration/src/overrides.rs`, `crates/biome_service/src/settings.rs`, `packages/@biomejs/backend-jsonrpc/src/workspace.ts`
  - top3: Tailwind sort config and trailing-comma formatter files
  - interpretation: the prompt has real config identity, but arbitration chooses plausible same-word decoys.

- Fastify, Flask, bat, Cobra, and several Go/Python/Rust repos also skew
  heavily toward buried-top10 misses. This suggests the top-3 selector is too
  weak even when the retrieval candidate pool is adequate.

### Candidate Buried Top30

- Drizzle ORM storage: `Netlify-DB for main (#5663)`
  - target: `drizzle-orm/src/netlify-db/driver.ts`, `index.ts`, `migrator.ts`, `session.ts`, and related files
  - interpretation: multi-file feature bundles need a set-level owner/support view, not isolated file scoring.

- Drizzle ORM API: `Fixed bun-sql:postgresql date, timestamp mappers...`
  - target: `drizzle-orm/src/pg-core/columns/date.ts`, `timestamp.ts`
  - top3: Gel and bun-sql neighboring files
  - interpretation: same-shaped modules across dialects confuse file-level ranking. A repo map needs to understand dialect/package ownership.

### Candidate Generation Miss

- Biome runtime: `docs: fix duplicate-word typos in code comments (#10371)`
  - target: formatter and analyzer implementation files
  - interpretation: weak prompt identity and comment-only changes are underdetermined from the title alone.

- Drizzle ORM API: `where is drizzle orm core columns date timestamp source implementation wired in the code`
  - target: `pg-core` date/timestamp files
  - top3: MySQL/Gel date/timestamp files
  - interpretation: this is not pure absence of date/timestamp candidates; it is failure to bind the correct dialect family.

## What This Changes

Before this autopsy, the plausible next step was "more candidate generation" or
"promote conventional scopes." The corrected causal split says that would only
attack part of the problem.

The largest bucket is not absent candidates. It is target-present,
wrong-first-slate behavior:

- recall@10 but not top-3: `39.3%`
- recall@30 but not top-3: `25.5%`
- recall@100 but not top-3: `10.5%`
- absent at recall@100: `24.7%`

That suggests the next architecture experiment should prioritize:

1. **First-slate arbitration / bundle selection**
   - Take the existing top 10-30 candidates and choose a coherent edit bundle.
   - Penalize three unrelated decoys in top-3.
   - Prefer owner plus necessary support over three individually plausible files.

2. **Repo-family/dialect ownership maps**
   - Needed for Drizzle-style `pg-core` versus `mysql-core` versus `gel-core` confusions.
   - Needed for Biome crate-family ownership.
   - This is not broad graph-first retrieval; it is candidate disambiguation among already-found same-shaped files.

3. **Weak-prompt handling**
   - Nearly half the misses have weak prompt identity.
   - For those, a one-shot ranker may be inherently weak.
   - The engine may need a deterministic investigation step or to mark the pack as exploratory rather than confidently choosing decoys.

4. **Generation repair for the 24.7% absent-at-100 bucket**
   - Still important, but no longer the first bottleneck.
   - Build-tooling and some runtime/parser misses are the clearest candidates.

## Caveats

This is still heuristic causal labeling. It is stronger than the previous
aggregate report because it uses per-prompt recall depth and target identity
overlap, but it is not a human judgment pass. In particular:

- `candidate_generation_miss` means absent by the current `recall@100` probe,
  not literally impossible to generate.
- `weak_prompt_identity` uses normalized token overlap with target paths, not
  a semantic model of the title.
- `large_target_set` marks target-set size, not whether all files were equally
  necessary in the Context Pack.

The report is good enough to redirect architecture work, but not enough to make
fine-grained product claims about individual tickets without manual review.

## Command

```bash
source ~/.nvm/nvm.sh && nvm use 22.22.3 >/dev/null && \
  node dist/eval/oss-code-lane-autopsy.js \
    --manifest=.contexttrail/evals/oss-code-lane-manifest-local.json \
    --target-prompts-per-case=10
```
