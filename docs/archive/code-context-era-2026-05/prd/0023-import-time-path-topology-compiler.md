# PRD-0023: Import-Time Path Topology Compiler (slice 1)

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's twenty-third PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0007](../adr/0007-hybrid-scoring-additive-text-multiplicative-structure.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md). Related PRDs: [PRD-0014](0014-retrieval-engine-v3-source-selection-and-aboutness.md), [PRD-0016](0016-deterministic-retrieval-precision-and-assembly-ready-top3.md). Parked context: [.out-of-scope/source-rerank-tiebreakers-architecture.md](../../.out-of-scope/source-rerank-tiebreakers-architecture.md), [.out-of-scope/source-profile-v2-miss-audit.md](../../.out-of-scope/source-profile-v2-miss-audit.md).
>
> Boundary rule: this PRD is slice 1 of a multi-slice direction. The compiler is **deterministic, import-time, no AI, no author-mandatory frontmatter**. Slice 1 ships path-topology signals only. Subsequent slices add code/config extraction, heading exact-match, nav/sidebar parsing, and link graph as independent PRDs.

## Problem Statement

Real-corpus eval baseline: top-1 105/121 (86.8%), top-3 118/121 (97.5%). Target: 97% top-1, 99% top-3.

PRD-0022 attempted a post-sort tiebreaker layer and was empirically information-zero across five experimental shapes (see [`.out-of-scope/source-rerank-tiebreakers-architecture.md`](../../.out-of-scope/source-rerank-tiebreakers-architecture.md)). The 16 displayed top-1 misses sit at score gaps of 19–35% — source-rerank is *confidently wrong*, not ambivalent. Surface-signal tiebreakers cannot reach the cohort.

The miss audit ([`.out-of-scope/source-profile-v2-miss-audit.md`](../../.out-of-scope/source-profile-v2-miss-audit.md)) reframed the problem at the **input layer**: today's importer leaves significant deterministic signal on the table — path topology, nav config, link graph, code-fence symbol declarations, doc-shape metrics. The 16 misses are a **signal-extraction problem**, not a ranking-function problem.

PRD-0023 slice 1 ships the smallest piece of that signal extractor that can be measured independently: **path topology only.**

## Solution

Build a deterministic path-topology compiler that runs at import time and populates additive optional fields on `SourceProfile`. Source-rerank consumes the new fields as principled fixed-magnitude score boosts, behind a feature flag (default off; flips after promotion gates pass).

**Slice 1 fields on `SourceProfile`** (all additive, no schema_version bump):

```ts
type SourceProfile = {
  // …existing fields unchanged…
  path_depth?: number;             // directory depth under import root
  is_index_file?: boolean;         // index/readme/_index by recognized markdown extension
  is_section_landing?: boolean;    // Foo.md adjacent to Foo/, with conflict resolution
  package_segment?: string | null; // detected from path patterns
  version_segment?: string | null; // detected from path version markers
};
```

**Field rules (deterministic, no inference):**

- `path_depth` — directory depth under import root, counted by path segments. `mocking.md → 0`, `guide/mocking.md → 1`, `guide/mocking/modules.md → 2`. Filename does not count as a segment.
- `is_index_file` — true iff (basename, case-insensitive) ∈ `{index, readme, _index}` AND (extension, case-insensitive) ∈ `{.md, .mdx, .markdown}`. `index.txt`, extensionless `index`, `INDEX.html` → false.
- `is_section_landing`:
  - case (i) `Foo.md` exists AND `Foo/` directory exists in same parent → `Foo.md.is_section_landing = true`
  - case (ii) `Foo/index.md` exists AND `Foo.md` does NOT exist in parent → `Foo/index.md.is_section_landing = true`
  - case (iii) both `Foo.md` and `Foo/index.md` exist → `Foo.md.is_section_landing = true`, `Foo/index.md.is_section_landing = false` (parent-level `.md` wins; one canonical landing per section)
  - case (iv) child file alone (no `Foo.md`, no `Foo/index.md`) → no landing flagged
- `package_segment` — regex match on path for `packages/<name>/`, `apps/<name>/`, `crates/<name>/`, `sdk/<name>/`. Capture `<name>`. First-match wins on nested patterns. No `package.json` filesystem walk in slice 1.
- `version_segment` — regex match on segment boundaries for `vN(\.x)?`, `N\.x`, or literal markers `{next, beta, latest, legacy, deprecated}`. Canonical normalization (`v3`, `v4`, `next`, etc.). Outer-segment wins on multiple markers.

**Source-rerank score-formula additions** (behind feature flag `RETRIEVAL_PATH_TOPOLOGY_BOOSTS=on`, default `off` in implementation slice; flips after gates pass):

| Boost | Magnitude | Fires when |
|---|---:|---|
| `is_section_landing` | `+0.35` | always (additive on candidates with the flag) |
| `is_index_file` | `+0.20` | always (additive) |
| `package_segment` query-token match | `+0.30` | candidate's `package_segment` appears as a content token in the query |
| `version_segment` query-token match | `+0.30` | candidate's `version_segment` appears as a content token in the query |
| `path_depth` decay | `-0.05` per depth level beyond 2 | always (smooth, small per-step penalty so depth doesn't dominate) |

Boosts are **additive on the existing source-rerank score**. Magnitudes are **principled fixed values, not tuned against the failing cohort.** If the principled magnitudes don't deliver, we don't tune them — we revisit the principle.

## User Stories

1. As a ContextTrail maintainer, I want index files (`index.md`, `README.md`, `_index.md`) to be recognized at import as canonical entry points for their directory, so that source-rerank can prefer them when queries lack sub-anchors.
2. As a ContextTrail maintainer, I want a section-landing detector that resolves the `Foo.md`-adjacent-to-`Foo/` pattern, so that parent docs win over child docs on generic queries (e.g., `mocking.md` over `mocking/modules.md`).
3. As a ContextTrail maintainer, I want section-landing conflicts (`Foo.md` AND `Foo/index.md`) resolved deterministically in favor of `Foo.md`, so that sections never have two competing canonical landing pages.
4. As a ContextTrail maintainer, I want path-depth decay applied as a smooth, small per-step penalty, so that depth becomes a tiebreaker for queries about general topics without dominating other signals.
5. As a ContextTrail maintainer, I want package and version segments extracted from paths, so that queries mentioning a package or version can route to the right sub-section of a multi-package or multi-version corpus.
6. As a ContextTrail maintainer, I want all five fields stored on `SourceProfile` at import time, so that ranking-time consumption is cheap and eval traces are diff-able.
7. As a ContextTrail maintainer, I want the schema to remain at version 1 (additive optional fields), so that existing baselines and persisted profiles stay valid.
8. As a ContextTrail maintainer, I want every signal validated by a synthetic property test at lower-95 ≥ 95%, so that the rule generalizes outside our 121-case real corpus.
9. As a ContextTrail maintainer, I want adversarial test coverage for each rule's edge cases (deep nesting, multi-conflict landings, version-LIKE-but-non-version segments, etc.), so that catastrophic failure modes are caught before promotion.
10. As a ContextTrail maintainer, I want predicted addressable-cohort flips verified by per-case identity and unpredicted flips reviewed before acceptance, so that we cannot ship a regression by accident even at small absolute deltas.
11. As a ContextTrail maintainer, I want zero per-case top-1 regressions vs displayed baseline, so that no displayed-correct case is silently demoted.
12. As a ContextTrail maintainer, I want a feature flag to gate the new boosts during slice-1 development, so that the ranking-time behavior remains the displayed baseline until promotion gates pass.

## Implementation Decisions

### Code shape

- New module `src/retrieve/path-topology.ts`. Exports five pure functions:
  - `computePathDepth(source_path: string, import_root: string): number`
  - `detectIsIndexFile(source_path: string): boolean`
  - `detectIsSectionLanding(source_path: string, all_source_paths: Set<string>): boolean`
  - `detectPackageSegment(source_path: string): string | null`
  - `detectVersionSegment(source_path: string): string | null`
- Each function is independently testable with synthetic inputs. No filesystem dependency beyond what's already passed in (`all_source_paths` for landing detection).
- The source-profile builder (existing module) calls all five at import time and populates the new fields on each `SourceProfile`.
- `SourceProfile` extends with the five optional fields. No schema_version bump (additive).
- `SourceCard` (the retrieval-time projection) carries forward whichever subset of these fields ranking actually consumes.
- Source-rerank score-formula additions live in the existing source-rerank module, gated by the feature flag.

### Feature flag

- Env var `RETRIEVAL_PATH_TOPOLOGY_BOOSTS`. Default `off` during slice-1 implementation. Flips to `on` (or default-on) only after all promotion gates pass on real-corpus eval.
- The boost code reads the flag at ranking time and skips the boost calculation entirely when off — guarantees the displayed baseline is preserved until the flag flips.

### Boost composition

- All five boosts are additive on the existing `source_rerank_score`. Per-candidate maximum boost from path-topology signals is `+0.55` (landing + index simultaneously) `+ +0.30` (package match) `+ +0.30` (version match) `= +1.15`. Path-depth decay is small (≤ `-0.05 × max_depth`) and rarely dominates.
- The feature flag's `on` state activates the boost block as a single unit. No partial enablement of individual boosts in slice 1.

### What's explicitly excluded from slice 1

- **`path_segment_role` directory markers** (e.g., `learn/` vs `guide/`, `understanding-` vs `workflows/`) — depends on query-shape classification, properly belongs in slice 2 with `doc_role` and heading exact-match.
- **Heading exact-match extension** — slice 2.
- **Code/config extraction from code fences** — slice 3 (resolves trpc/router, trpc/procedures, zod/error-handling cohort).
- **Nav/sidebar parsing** — slice 4 (resolves trpc-overview cohort; needs N parsers per docs framework).
- **Link graph + PageRank-ish centrality** — slice 5 (resolves true top-3 misses).
- **Author opt-in frontmatter overrides** — slice 6 (or later, if any field's deterministic inference proves insufficient).
- **Performance / persistence optimization** — current import-time computation is O(corpus) per build; slice 1 doesn't optimize.

## Testing Decisions

### Synthetic property tests (per signal)

All in `src/eval/synthetic/path-topology.test.ts`. Each rule generates 200 random inputs, asserts the property, requires lower-95 ≥ 95%.

| Signal | Property | Adversarial cases |
|---|---|---|
| `is_index_file` | basename (lowercased, ext-checked) ∈ {`index`, `readme`, `_index`} with extension ∈ {`.md`, `.mdx`, `.markdown`} ⇒ true; else false | mixed-case (`Index.md`, `README.MD`), `.markdown` extension, paths with multiple dots (`my.config.md`), `index.txt`, extensionless `index`, `index.html` |
| `is_section_landing` | (i) `Foo.md` + `Foo/` ⇒ landing; (ii) `Foo/index.md` alone ⇒ landing; (iii) both ⇒ `Foo.md` landing, `Foo/index.md` not; (iv) child only ⇒ no landing flagged | deep nesting (3+ levels), multi-conflict (`Foo.md` AND `Foo/index.md` AND `Foo/README.md`), only-`Foo/index.md` (case ii), case where parent `.md` is only conflicting form (case iii) |
| `path_depth` | directory depth under import root via path-segment count | leading/trailing slashes, double slashes, mixed separators, paths with empty segments, `.` and `..` segments rejected/normalized |
| `package_segment` | regex captures `<name>` from `packages/<name>/`, `apps/<name>/`, `crates/<name>/`, `sdk/<name>/`; null otherwise | nested (`packages/a/apps/b/`) — outer wins; package-LIKE substrings off segment boundary (`my-packages/foo`) ignored |
| `version_segment` | matches `vN(\.x)?`, `N\.x`, or literal {`next`, `beta`, `latest`, `legacy`, `deprecated`} on segment boundary; canonical form returned | version-LIKE non-version (`v8engine.md`), multiple markers (`docs-v3/legacy/file.md` — outer wins), numeric-only segments (`2.x` valid; `42` not) |

### Composition + ordering tests

- **Boost composition** — when both `is_section_landing` and `is_index_file` apply, total boost is `+0.55` (additive). 200 random combinations, assert magnitude.
- **Pairwise ordering** — two synthetic candidates with one having a landing flag and equal other features; landed candidate ranks higher 200/200 times. Same test for `is_index_file` and for combined.
- **Boost decay** — for `path_depth`, generate pairs at different depths with equal other features; deeper candidate's score is lower by exactly `-0.05 × depth_delta`.

### Real-corpus discipline

**Predicted addressable cohort (slice 1):**

- 3 clean expected flips:
  - `vitest-anchored-mocking` (via `is_section_landing`)
  - `vitest-cross-module-browser-mode` (via `is_index_file`)
  - `zod-unanchored-readme-v3` (via `is_index_file` + `version_segment`)
- 2 partial / soft expectations (these may or may not flip; documented separately):
  - `hono-cross-module-jsx` (via `path_depth` decay — small boost might not clear the score gap)
  - `tanstack-cross-module-eslint` (via `package_segment` — true top-3 miss; needs candidate-gen too in a future slice)

**Per-case identity verification** is a hard gate. Every flip must be classified before acceptance:

- predicted clean → must flip OR be explained
- predicted soft → may or may not flip; documented either way
- unpredicted flip → reviewed and classified as good or bad before acceptance (good = legitimate signal we didn't predict; bad = over-fire that should block promotion)
- per-case regression → hard fail (any displayed-top-1 case that becomes a non-top-1 case)

## Promotion Gates

Conjunctive — every gate must pass before the feature flag flips to `on`:

- `npm test` passes
- `npx tsc -p tsconfig.json --noEmit` passes
- All synthetic property tests pass at lower-95 ≥ 95% (5 signals + composition + ordering)
- Adversarial suites pass for each rule
- Real-corpus eval: top-1 increases by at least 3 (105 → 108+)
- Real-corpus eval: top-3 does not regress (≥ 118/121)
- Coverage honesty stays at 148/148
- Agent answer correct ≥ 147/148
- Per-case `regressions == 0` against displayed top-1 baseline
- All predicted clean flips verified or explained
- All unpredicted flips reviewed and classified before acceptance

If gates pass, the feature flag default flips from `off` to `on` and the relevant `acceptable_top_sources` / `expected_top_source` fields in `tests/fixtures/real-corpus/*.yaml` are updated for the recovered cases.

## Out of Scope (Explicit)

- Path-segment role markers (`learn/`, `guide/`, `understanding-*/`, etc.) — slice 2 (PRD-0024 likely)
- Heading exact-match extension to `SourceProfile` — slice 2
- Code/config extraction from code fences — slice 3 (PRD-0025)
- Nav/sidebar parsing per docs-framework — slice 4
- Link graph extraction + centrality — slice 5
- Author opt-in frontmatter overrides — deferred until any deterministic signal proves insufficient
- AI in any inference path — explicitly off-the-table for this PRD and the SourceProfile v2 direction generally
- Production MCP response-shape changes
- Performance optimization beyond import-time pass
- Tuning the close-call tiebreaker architecture (PRD-0022 work) — that architecture is parked

## Further Notes

This PRD is the smallest measurable test of the deterministic-signal-compiler architecture. Expected delta is intentionally small (3 clean wins, 2 soft) so that:

1. **The architectural premise is the thing being tested.** If 3+ clean cases flip with principled magnitudes, the path-topology compiler approach works and slice 2 can extend it. If 0 flip, we've learned the principle was wrong without burning credibility.
2. **The test discipline scales to subsequent slices.** Slice 2's heading-exact-match adds another ~5 cases of expected lift; slice 3's code/config extraction adds ~5 more. Each slice ships independently with its own held-out verification.
3. **The lessons from PRD-0022 are baked in.** Per-case identity verification is a hard gate, not a soft summary. Synthetic property tests carry the generalization weight, not real-corpus aggregate. Magnitudes are principled, not tuned.

The trade-off to flag honestly: with a 3-case expected delta on a 122-case eval, signal-to-noise is low. A single unpredicted regression cancels a real win at the aggregate level. The mitigation is per-case identity (predicted-cohort verification + zero-regression gate). The compounding mitigation is that each subsequent slice adds independent cohorts whose deltas accumulate, making the multi-slice aggregate increasingly robust.

If slice 1 passes its gates, slice 2 follows directly. If it fails, the audit doc already lists the four candidate directions for the next attempt — score-component re-weighting, query-shape priors, two-stage retrieval, candidate-generation first.
