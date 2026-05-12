# PRD-0022: Source-Rerank Canonicality and Anchor-Basename Tiebreakers

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's twenty-second PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0007](../adr/0007-hybrid-scoring-additive-text-multiplicative-structure.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md). Related PRDs: [PRD-0014](0014-retrieval-engine-v3-source-selection-and-aboutness.md), [PRD-0016](0016-deterministic-retrieval-precision-and-assembly-ready-top3.md). Parked context: [.out-of-scope/facet-policy-promotion.md](../../.out-of-scope/facet-policy-promotion.md).
>
> Boundary rule: this PRD adds two surgical close-call tiebreakers inside the existing source-rerank pipeline. No new contract surface, no parser interpretation layer, no facet engine. Top-3 displayed is preserved. Source-rerank remains the only ranking authority.

## Problem Statement

Source-rerank delivers strong overall retrieval but loses the close-call top-1 decision on a specific class of cases. Real-corpus baseline:

| Metric | Source-rerank (displayed) |
|---|---:|
| top-1 | 105/121 (86.8%) |
| top-3 | 118/121 (97.5%) |

Target: top-1 ≥ 117/121 (97%), top-3 ≥ 120/121 (99%).

Inspection of the 16 displayed top-1 misses shows two recurring patterns where the right answer is *already at displayed rank 2 or 3* — the candidate is in the slate, just not winning the top-1 close call:

**Pattern A — child source winning over its parent on generic queries (~4 cases).** Examples:
- `vitest-anchored-mocking`: top-1 = `docs/guide/mocking/modules.md`, accepted = `docs/guide/mocking.md`
- `hono-cross-module-jsx`: top-1 = `docs/middleware/builtin/jsx-renderer.md`, accepted = `docs/guides/jsx.md`
- `prisma-cross-module-migrate-vs-schema`: top-1 = `.../workflows/customizing-migrations.md`, accepted = `.../understanding-prisma-migrate/mental-model.md`
- `tanstack-anchored-typescript-types`: top-1 = `docs/react/reference/useQueries.md`, accepted = `docs/react/typescript.md`

In each, the source-family graph already classifies the candidates as parent/child — the signal exists; it's just not tipping close calls toward the parent when the query lacks child-specific tokens.

**Pattern B — sibling with strong topical content beating the doc whose basename is the query's noun (~5 cases).** Examples:
- `trpc-anchored-procedures`: top-1 = `docs/server/validators.md`, accepted = `docs/server/procedures.md` (query targets "procedures")
- `vitest-anchored-snapshot`: top-1 = `docs/guide/learn/snapshots.md`, accepted = `docs/guide/snapshot.md` (singular vs plural)
- `zod-anchored-package-readme`: top-1 = `packages/docs-v3/README.md`, accepted = `packages/zod/README.md`
- `hono-anchored-validation`: top-1 = `docs/api/request.md`, accepted = `docs/guides/validation.md`

The current `path_token_coverage` doesn't differentiate basename hits from parent-directory hits strongly enough.

The remaining ~7 cases are scope/specificity-inference problems harder to address with deterministic rules — see Out of Scope.

## Solution

Add two close-call tiebreakers inside source-rerank. Both fire only when the score gap between the top-1 and top-2 candidates is below a tight threshold (i.e., when source-rerank is genuinely ambivalent). Both are pure structural rules — no parser interpretation.

### Rule 1: Parent-canonicality close-call tiebreaker

When the top two candidates by `source_rerank_score` are members of the same source-family with a parent/child relationship and the score gap is below the close-call threshold:

1. Tokenize the child's path components. Subtract the parent's path tokens. Call this set `child_unique_tokens` (lowercased, stemmed via the existing tokenizer).
2. If any token in `child_unique_tokens` appears in the query's content tokens (or the caller's `query_anchors`), the child stays at top-1 (the query genuinely targets the child sub-topic).
3. Otherwise, swap the parent above the child.

This is a pure structural rule using existing primitives: `source-family.ts` already builds the parent/child graph in `buildSourceFamilyGraph`. The tokenizer already handles stemming.

### Rule 2: Anchor-basename-exact close-call tiebreaker

When the top two candidates by `source_rerank_score` are not family-related and the score gap is below the close-call threshold:

1. Compute each candidate's extensionless basename (e.g., `docs/server/procedures.md` → `procedures`).
2. For each query token (from caller anchors + content tokens):
   - **Surface-form match** (no stemming): does the token equal the basename verbatim, case-insensitive?
   - **Stemmed match**: does the token's stem equal the basename's stem?
3. Score per candidate: count of distinct query tokens with a surface-form match × 2, plus count of distinct query tokens with a stemmed-only match × 1.
4. The candidate with the higher score wins the swap. Stable path tie-break otherwise.

The asymmetry (surface-form weight = 2× stemmed) handles the singular/plural failure mode: `snapshot` ↔ `snapshot.md` is a surface-form match worth 2; `snapshot` ↔ `snapshots.md` is stemmed-only worth 1; the doc whose basename verbatim matches wins.

### Close-call threshold

Both rules use the same threshold: the gap between top-1's `source_rerank_score` and top-2's must be **less than 10% of top-1's score**. Tight enough to only fire on actual ties; wide enough to catch the failure cohort. The threshold is a single named constant so adversarial suites can vary it.

### Rule precedence

If both rules' preconditions hold (rare in practice), Rule 2 takes precedence — anchor-basename-exact is closer to caller intent than family canonicality. Encoded as: Rule 2 evaluates first; if it fires (basename-score difference is non-zero), apply its swap and skip Rule 1.

## User Stories

1. As a ContextTrail maintainer, I want parent docs to win close calls over their children when the query lacks child-specific tokens, so that "how do I X?" returns the canonical X overview rather than a sub-topic.
2. As a ContextTrail maintainer, I want children to still win when the query carries their unique tokens, so that "how do I X modules?" returns `mocking/modules.md` not `mocking.md`.
3. As a ContextTrail maintainer, I want close-call tiebreakers to fire only on actual close calls, so that the rules can't damage cases the existing source-rerank already gets right.
4. As a ContextTrail maintainer, I want exact basename matches against query tokens to win close calls over topical content matches, so that `procedures` query reaches `procedures.md` not `validators.md`.
5. As a ContextTrail maintainer, I want surface-form matches to outweigh stemmed matches, so that singular/plural collisions resolve toward the doc whose basename verbatim equals the query token.
6. As a ContextTrail maintainer, I want both rules to live inside the existing source-rerank pipeline, so that no new contract surface or eval engine is introduced.
7. As a ContextTrail maintainer, I want top-3 displayed to remain at three sources, so that downstream context-assembly noise stays bounded.
8. As a ContextTrail maintainer, I want every rule validated by a synthetic property-based test at lower-95 ≥ 95%, so that the rule generalizes outside the 121-case real corpus.
9. As a ContextTrail maintainer, I want every rule validated against an adversarial suite (multi-level family, generic parent paths, basename collisions across siblings), so that catastrophic failure modes are caught before promotion.
10. As a ContextTrail maintainer, I want every rule validated on a held-out cohort of failing real-corpus cases (5 train / 4 holdout split of the 9-case addressable bucket), so that we don't overfit to specific examples.
11. As a ContextTrail maintainer, I want each rule independently revertable, so that if one rule regresses we can disable it without losing the other.
12. As a ContextTrail maintainer, I want the close-call threshold exposed as a single named constant, so that adversarial tests can vary it and future PRDs can tune it without code archaeology.

## Implementation Decisions

- Both rules live in `src/retrieve/source-rerank.ts` (or a sibling module imported from it). No new top-level pipeline stage; they fire as a final post-sort pass on the top-N candidate list before slicing to top-3.
- The close-call threshold is `SOURCE_RERANK_CLOSE_CALL_RATIO = 0.10` exported as a named constant.
- Rule 1 uses `buildSourceFamilyGraph` from `src/retrieve/source-family.ts` to detect parent/child relationships. No changes to source-family logic.
- Rule 1's `child_unique_tokens` set: `Set(tokens(child.source_path)) − Set(tokens(parent.source_path))`. Tokens go through the existing retrieval tokenizer (lowercase + stem).
- Rule 1 checks `child_unique_tokens` against the union of query content tokens and `query_anchors.{files,symbols,routes}` tokens.
- Rule 2's basename: extensionless final path segment, lowercased.
- Rule 2's surface-form check uses raw lowercase comparison (no stemmer). Stemmed check uses the existing tokenizer's stem.
- Rule 2's score: `surface_matches × 2 + stemmed_only_matches × 1`. Tie → stable path tie-break.
- Both rules emit explain trace entries when they fire: rule name, candidates considered, score gap, swap decision, reasoning.
- Behind a feature flag at first: `RETRIEVAL_RERANK_TIEBREAKERS=on` (default off) so the change can be tested in shadow before becoming default.
- After shadow validation passes (see Promotion Gates), the flag default flips to `on` and existing tests are updated to reflect the new behavior.

## Testing Decisions

- **Synthetic property-based tests** (`src/eval/synthetic/source-rerank-tiebreakers.test.ts`):
  - Rule 1: generate 200 random parent-child trees with varied path depths and query token compositions. Property: "child wins iff `child_unique_tokens ∩ query_tokens ≠ ∅`, otherwise parent wins." Lower-95 ≥ 95%.
  - Rule 2: generate 200 sibling-pair candidate sets with controlled basename/title token compositions and source_rerank_score gaps. Property: "candidate with higher (surface×2 + stemmed×1) score wins close calls; non-close-call ties never fire the rule." Lower-95 ≥ 95%.
- **Adversarial suite** (same test file):
  - Multi-level family (grandparent → parent → child) — Rule 1 must operate on adjacent pairs only.
  - Generic parent paths (`index.md`, `README.md`) where `child_unique_tokens` is the entire child path — Rule 1 must still produce sensible behavior.
  - Basename collisions across siblings (`docs/a/foo.md` and `docs/b/foo.md` both basename `foo`) — Rule 2 must use stable path tie-break, never crash.
  - Score gaps exactly at the close-call threshold — both rules must be deterministic at the boundary.
- **Held-out cohort validation**: of the ~9 addressable cases, split 5 into a train set used during development and hold 4 out for the final eval run. The 4 held-out cases must improve top-1 outcome after the change.
- **Real-corpus regression**: the 105 displayed top-1 wins under source-rerank must remain top-1 after the change. Per-case `regressions == 0` against the displayed baseline.
- **Standard checks**: `npm test` passes, `npx tsc --noEmit` passes, `npm run eval:real-corpus` no safety regression.

## Promotion Gates

Conjunctive — every gate must pass before the feature flag default flips to `on`:

- `npm test` passes.
- `npx tsc -p tsconfig.json --noEmit` passes.
- `npm run eval:real-corpus` has no safety regression.
- Rule 1's synthetic property test passes at lower-95 ≥ 95%.
- Rule 2's synthetic property test passes at lower-95 ≥ 95%.
- Adversarial suites pass for both rules.
- Real-corpus top-1 ≥ 113/121 (vs displayed 105 — at least the held-out 4 plus most of the train 5 must improve).
- Real-corpus top-3 ≥ 118/121 (no top-3 regression).
- Per-case `regressions == 0` against displayed top-1.
- coverage honesty remains `148/148`.
- agent answer correct ≥ `147/148`.

If gates pass, the feature flag default flips to `on` and existing real-corpus expectations are updated to the new top-1.

## Out of Scope

- The remaining ~7 displayed top-1 misses (overview/index ambiguity, cross-directory misroute, ADR/README depth misses). Targeted by a future PRD-0023 once PRD-0022's lift is validated and lessons banked.
- Top-N expansion. Top-3 displayed stays at three sources; context-assembly tightness is load-bearing.
- Candidate-generation work. Anchor-graph traversal, embedding-fused candidates, etc. are separate PRDs.
- Parser interpretation, AI-driven retrieval, facet engines. The lessons from PRD-0019/0020/0021 are documented in [`.out-of-scope/facet-policy-promotion.md`](../../.out-of-scope/facet-policy-promotion.md).
- Production MCP response-shape changes.
- Per-case ranking hacks for individual real-corpus failures.

## Further Notes

This PRD is intentionally minimal. Two surgical rules, both close-call only, both built on existing primitives (source-family graph, retrieval tokenizer). No new contract surface. The lessons from PRD-0019/0020/0021 land directly: when an interpretation layer is given gating authority, it produces regressions; when adjustments stay inside source-rerank's existing scoring shape, regression risk is bounded.

Expected lift: +9 top-1 cases (105 → 114, ~94%). That's still short of the 97% target, but it's a real, measurable, regression-free step. The remaining gap to 97% needs ideas that this PRD explicitly defers.

The generalization gate is the load-bearing review point. Synthetic property tests at lower-95 ≥ 95% are how we know the rule isn't overfit to the 9 specific cases that motivated it. The held-out 4 cases are how we know the rule isn't memorizing the train 5.

If both rules clear gates, future PRDs (PRD-0023+) can target the residual ~7 cases. If a rule fails its synthetic gate, it doesn't ship — the cases it was meant to fix become future-PRD scope rather than corpus-specific patches.
