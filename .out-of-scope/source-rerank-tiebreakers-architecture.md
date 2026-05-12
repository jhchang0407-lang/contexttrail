# Close-Call Tiebreaker Architecture — Information-Zero Result

**Decision:** Stop iterating on the post-sort close-call tiebreaker architecture for source-rerank. Five experimental shapes were measured against the 122-case real-corpus eval; **none deliver positive net top-1 lift.** The architecture itself extracts no information advantage on this corpus.

**What was tried** (on branch `experiment/prd0022-iterations`):

| # | Shape | Top-1 vs baseline | Improvements | Regressions |
|---:|---|---:|---:|---:|
| baseline | source-rerank only (flag off) | 106 / 122 | — | — |
| 1 | PRD-0022 default (10% close-call, exact basename) | 105 (−1) | 2 | 3 |
| A | Widen to 30% close-call | 102 (−4) | 3 | 7 |
| B | Component-coverage basename scoring | 106 (+0) | 0 | 0 |
| D | Rule 1 always-on + Rule 2 close-call (exact) | 104 (−2) | 2 | 4 |
| E | Rule 1 always-on, Rule 2 disabled | 105 (−1) | 0 | 1 |
| F | Rule 1 always-on + Rule 2 close-call (components) | 105 (−1) | 0 | 1 |

Top-3 was unchanged in every variant (118/122). Coverage honesty unchanged.

## Why this architecture can't deliver lift

**Component-mode (Experiment B) is the most informative result.** It rescues 3 cases that the exact-mode rule broke (turborepo-remote-caching, vitest-test-context, vitest-extending-matchers) and breaks 2 cases that the exact-mode rule rescued (hono-jsx, vitest-environment). Net change vs baseline: **exactly zero.**

That's not a coincidence. Both shapes — exact-basename and component-coverage — are deterministic functions of the same surface signals (basename string + query tokens). They project the same signal in opposite directions:

| Failure mode | Exact-mode behavior | Component-mode behavior |
|---|---|---|
| simpler-vs-compound (e.g. `jsx-renderer.md` vs `jsx.md`, query "JSX") | rescue (jsx wins) | regress (jsx-renderer wins) |
| compound-vs-simpler (e.g. `caching.md` vs `remote-caching.md`, query "remote caching") | regress (caching wins) | rescue (remote-caching wins) |

The two failure modes have **identical surface signatures** (a single-component basename competing with a multi-component basename, query tokens overlapping both). Without semantic understanding of which is the user's actual intent, no surface-level rule can pick correctly more than half the time.

**Rule 1 (parent-canonicality) hits the same ceiling.** Always-on Rule 1 introduced one new regression (`bun-unanchored-file-io`: `docs/runtime/index.md` swapped above `docs/runtime/file-io.md` because the user's query — about file I/O — didn't carry tokens unique to the child path beyond the basename `file-io` itself). The "child-unique-tokens" heuristic fails when the child's basename **is** the topic the user is asking about; that's a recurring shape, not an edge case.

## What the data is telling us

The 16 displayed top-1 misses fall into these score-gap brackets (per the prior PRD-0022 22.3 release-gate run):

| Case | Top-1 score | Top-2 score | Gap ratio |
|---|---:|---:|---:|
| `vitest-anchored-mocking` | 1.969 | 1.409 | 28% |
| `trpc-anchored-procedures` | 1.704 | 1.113 | 35% |
| `tanstack-anchored-typescript-types` | 1.697 | 1.371 | 19% |
| `hono-anchored-validation` | 1.426 | 1.276 | 10.5% |
| `vitest-anchored-snapshot` | 1.747 | 1.745 | 0.1% |

Most failing cases sit at gap ratios of 19–35%. Source-rerank is **confidently wrong** on these — not ambivalent. A close-call tiebreaker by definition only fires on small gaps, so most of the addressable cohort is structurally beyond its reach. Widening the threshold (Experiment A) lets the rule fire on more cases but multiplies the surface-signal-ambiguity collateral damage faster than it rescues true positives.

## What this rules in vs out

**Ruled out (this iteration cycle proved info-zero):**

- Post-sort close-call tiebreakers in any shape (exact basename, component coverage, threshold-tuned, mixed-rule).
- Always-on parent-canonicality rules with structural-only signals (path tokens minus parent path tokens).
- Combinations of Rule 1 + Rule 2 in any close-call ordering tested.

**Not ruled out — directions PRD-0023 could try instead:**

1. **Score-component re-weighting inside source-rerank itself.** The 19–35% gaps say source-rerank is over-weighting some signal (probably heading/snippet content matches, which favor sibling docs with topical headings) and under-weighting others (probably basename-equals-query-topic). Tuning weights inside the existing scoring function would change the underlying ranking, not just close calls. Trade-off: higher regression risk because weight changes have global interactions; needs a strict held-out + synthetic-property gate.
2. **Query-shape-conditional priors.** Classify the query into shape buckets (e.g., "what is X" vs "how do I X" vs "X reference") and apply different score weighting per bucket. The data shape of the failing cases suggests the parent-vs-child bias should differ by query shape: "what is X" wants the X overview (parent); "how do I X with Y" wants the more specific Y child. Trade-off: query-shape classification is itself a parser-interpretation layer, which we already ruled out for retrieval authority in PRD-0019 / PRD-0020 lessons. Could be safer if confined to *boost* signals only, never *gate* signals.
3. **Two-stage retrieval with a holistic rank-3 evaluator.** Source-rerank picks top-N; a second pass re-evaluates each top-N source with a different scoring function tuned for "is this actually the right answer for this exact query." This is a real architectural shift, not a tuning pass. Trade-off: that's effectively bringing back something like PRD-0019/0020's facet engine through a different door — would need new generalization gates from the start.
4. **Candidate-generation recall first.** The previous attribution analysis (the broken half-PRD-0021 run) hinted that some failing cases have the right answer outside the top-N candidate slate. PRD-0023 could instead target broader candidate generation (anchor-graph traversal, basename-component recall) so the right answer at least surfaces in the slate before any re-ranking decision.

## What stays committed

- **Branch `prd-0022-shipped` (tag)**: the as-shipped PRD-0022 implementation. Feature flag `RETRIEVAL_RERANK_TIEBREAKERS=off`.
- **Branch `experiment/prd0022-iterations`**: the experiment harness commit (env-configurable threshold + basename modes + Rule toggles) plus this findings doc.
- **`main`**: unchanged ranking behavior — source-rerank only.

## Lessons for future PRDs

1. **A surface-signal rule can only extract information up to the symmetry of the signal.** When opposite intents have the same surface signature, a deterministic surface rule is information-zero by construction. Synthetic property tests can pass at lower-95 ≥ 95% on the rule's own stated property while delivering zero empirical lift, because the property doesn't capture the intent the failing cases need.
2. **"Close-call" framing is only valid when the ranking function is genuinely ambivalent.** Score-gap data is the right diagnostic: when the failing cohort sits at 19–35% gaps, the function is confidently wrong, and the fix has to live in the function itself, not in a post-sort layer.
3. **Per-case improvement counts cancel into net-zero when the rule is symmetric across opposite intents.** The "+2 / −3" outcome of the original PRD-0022 was the same shape as the "+0 / −0" component-mode outcome, just rearranged. Watch for this pattern: when an experiment makes different cases the wrong/right ones without changing the headline number, the rule has zero information advantage.
