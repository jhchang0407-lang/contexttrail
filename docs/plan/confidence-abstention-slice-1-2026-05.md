# Confidence / Abstention Slice 1 Plan

> Created after Retrieval Engine V2 Slice 0 was fixed and rerun on 2026-05-08.
> Governing evidence: `docs/evals/reports/retrieval-v2-slice0-2026-05-08.md`.
> The full JSON report is generated locally by the eval command and is not
> checked in because it can exceed GitHub's per-file size limit.
> Related PRD: `docs/prd/0010-retrieval-engine-v2-slice-0-ceiling-probes.md`.

## Current Evidence

Slice 0 originally reported `critical-source-set recall@50 = 93.3%`, but the two missing critical sources were caused by import/chunking bugs rather than architecture:

- `packages/drizzle-zod.md` existed in the Drizzle fixture but was outside `REAL_CORPUS_IMPORT_GLOBS`.
- `docs/react/quick-start.md` existed in the TanStack fixture but had frontmatter `title: Quick Start` with no Markdown heading, so the chunker emitted zero chunks.

After fixing those two problems, Slice 0 now reports:

| Metric | Result |
|---|---:|
| critical-source-set recall@50 | 100.0% |
| oracle answerable success@50 | 100.0% |
| actual top-1 acceptable | 62.5% |
| actual top-3 acceptable | 87.5% |
| false-confident unsupported | 7 |
| synthetic fixture | passed |
| primary branch | `confidence_or_abstention` |

This means candidate generation is no longer the first bottleneck on this panel. The system can usually get the necessary source into the candidate set, but it still presents unsupported queries too confidently.

## Problem

`coverage_confidence` currently over-trusts weak unanchored retrieval. Several unsupported cases produce low-confidence warnings or narrow top-score margins but still surface as `confident`.

Examples from the current report:

| Case | Top source | Signal |
|---|---|---|
| `bun-signal-empty-android-deployment` | `docs/bundler/fullstack.md` | `coverage=confident`, `low_confidence`, top1 score 0.840 |
| `bun-signal-empty-cobol-interop` | `docs/bundler/bytecode.md` | `coverage=confident`, top1/top2 margin 0.005 |
| `drizzle-signal-empty-graphql` | `docs/custom-types.md` | `coverage=confident`, `low_confidence`, top1 score 0.855 |
| `drizzle-signal-empty-redis` | `docs/custom-types.lite.md` | `coverage=confident`, top1/top2 margin 0.000 |
| `ralph-signal-empty-kubernetes-deployment` | `docs/prd/0001-ralph-v1.md` | `coverage=confident`, top1/top2 margin 0.069 |
| `tanstack-signal-empty-mongodb` | `docs/react/devtools.md` | `coverage=confident`, top1/top2 margin 0.040 |
| `tanstack-signal-empty-cli` | `docs/react/guides/does-this-replace-client-state.md` | `coverage=confident`, top1/top2 margin 0.070 |

The policy mismatch is the important part: the system sometimes knows the match is weak enough to warn, but `coverage_confidence` still says confident.

## Goal

Make unsupported or out-of-corpus queries honest without changing candidate generation, ranking, source aggregation, or Context Pack assembly.

Primary goal:

- Reduce false-confident unsupported cases from `7/10` to `0/10` on the Phase 8 panel.

Guardrails:

- Keep `critical-source-set recall@50 = 100%`.
- Keep the synthetic 126-case fixture passing.
- Do not reduce answerable `coverageHonest`.
- Do not change MCP ranked object shape unless an explicit contract update is approved.
- Do not implement SourceProfiles, RRF, dense retrieval, source aliases, or reranking in this slice.

## Proposed Slice

Build a small deterministic confidence policy that uses already-available signals:

- `query_mode`
- locked entry presence
- displayed ranked count
- displayed top score
- top1/top2 and top1/top3 score margins
- generated warning kinds, especially `low_confidence`
- safety-net/no-match behavior

The policy should centralize the decision that is currently split between warning generation and `coverage_confidence`.

## Implementation Detail

1. Extract a confidence policy module.

Suggested public surface:

```ts
type CoverageConfidenceInput = {
  query_mode: "anchored" | "signal_empty" | "unanchored";
  has_locked: boolean;
  ranked_scores: number[];
  warning_kinds: string[];
  safety_net_engaged: boolean;
};

type CoverageConfidenceDecision = {
  coverage_confidence: "confident" | "uncertain" | "empty";
  reason: string;
};
```

The `reason` can stay internal or explain-only in Slice 1. Do not add it to MCP output unless the PRD explicitly approves a contract change.

2. Align warnings and confidence.

Rules to test first:

- Locked entries remain `confident`.
- Empty ranked output remains `empty`.
- Any `low_confidence` warning caps coverage at `uncertain`.
- `signal_empty` query mode caps coverage at `uncertain` unless ranked output is empty, in which case it is `empty`.
- Unanchored ranked-only output requires both a strong top score and a meaningful margin to be `confident`.
- Very narrow score margins become `uncertain` even if the absolute top score is high.

Initial threshold candidates:

- `confident_top_score_floor`: `0.90`
- `confident_top1_top2_margin_floor`: `0.12`
- `confident_top1_top3_margin_floor`: `0.15`
- `empty_score_floor`: keep existing low floor behavior for truly empty/near-zero results

These should be tuned only against the real-corpus report and synthetic fixture, not by hand-picking one query.

3. Make `presentContextPack` use the shared policy.

The presenter currently computes `coverage_confidence` from displayed top score only. It should instead consume the presentation warnings and score distribution through the shared policy.

4. Extend eval reporting.

Slice 0 already reports false-confident unsupported cases. Add enough per-case confidence diagnostics to see why a case became `confident`, `uncertain`, or `empty`.

Useful fields:

- confidence reason
- displayed top score
- displayed top1/top2 margin
- displayed top1/top3 margin
- warning kinds
- whether the cap came from `low_confidence`, `signal_empty`, margin, or empty ranked output

5. Add regression fixtures.

Create tests that pin representative false-confidence patterns:

- low-confidence warning must cap coverage at `uncertain`
- high absolute score with tiny margin must be `uncertain`
- empty ranked output must be `empty`
- locked Card output remains `confident`
- answerable anchored or clearly supported retrieval remains `confident`

6. Rerun the full gates.

Required commands:

```bash
npm test
npm run eval:real-corpus -- --ceiling-probes --report-out docs/evals/reports/retrieval-v2-slice0-2026-05-08
```

## Acceptance Criteria

- Phase 8 false-confident unsupported cases are `0`.
- Slice 0 branch no longer selects `confidence_or_abstention` due to false-confident unsupported cases.
- `critical-source-set recall@50` remains `100.0%`.
- Synthetic fixture passes.
- Existing MCP output schema remains stable unless the PRD explicitly approves a contract field addition.
- Confidence logic is covered by focused unit tests and at least one real-corpus regression assertion.

## Expected Outcome

The floor is high because this slice does not need semantic search or a new retriever. It is fixing a policy inconsistency: weak or ambiguous unanchored matches should not be represented as confident.

Expected floor:

- False-confident unsupported drops from `7` to `0-2` with no ranking changes.
- Slice 0 remains stable and reproducible.

Expected ceiling:

- False-confident unsupported reaches `0/10`.
- The branch table then likely moves to `source_ranking_or_aboutness`, because recall is now strong but answerable top-1/top-3 are still weak (`62.5%` / `87.5%`).

This slice will not solve ranking quality. It should make the engine honest enough to safely proceed to source ranking/aboutness work without masking unsupported queries as real answers.

## Why This Is Worth Doing Before Source-First V2

Source-first V2 raises the ceiling, but confidence/abstention protects the user while we climb toward that ceiling. With context assembly, an unsupported query that looks confident can poison the pack as badly as a missing source. Since recall@50 is now at 100% on the panel, the next cheapest risk reduction is making confidence honest before investing in SourceProfiles or multi-retriever ranking.
