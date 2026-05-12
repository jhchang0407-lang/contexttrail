# Facet Policy Production Promotion

**Decision:** Do not promote the deterministic facet coverage engine (PRD-0019 / PRD-0020) into displayed retrieval. Source-rerank remains the production ranking engine.

**Reason:** Empirical lift is too small relative to the engineering cost and the more impactful retrieval ceiling.

## The data behind the decision

Real-corpus baseline (148-case eval suite, 121 answer-bearing-imported):

| Metric | Source-rerank (displayed) |
|---|---:|
| top-1 | 105/121 (86.8%) |
| top-3 | 118/121 (97.5%) |
| coverage honesty | 148/148 |
| agent answer | 147/148 |

Oracle facet-coverage ceiling (PRD-0019, perfect coverage labels):

| Metric | Oracle |
|---|---:|
| top-1 | 114/121 (94.2%) |
| top-3 | 119/121 (98.3%) |

So the *absolute upper bound* of what facet-policy promotion can ever buy us:

- top-1: +9 cases (105 → 114)
- top-3: +1 case (118 → 119)

Realistic deterministic-policy lift after PRD-0021 hardening: ~3–5 top-1 cases, ~1 top-3 case. The actual deterministic_v1 + new policy run regressed (-11 top-1, -14 top-3) on the first eval, traced to parser-inferred topic facets being given gating authority. PRD-0021 designed a structural fix for that, but the math hadn't changed: even after a perfect fix, the lift ceiling is small.

## Where the real lift lives

Bottleneck attribution from the PRD-0020 shadow eval (deterministic top-1 misses):

| Layer | Count |
|---|---:|
| parser | 0 |
| candidate_generation | **27** |
| coverage | 21 |
| policy | 6 |

**27 cases where the accepted source isn't in the top-N candidate slate at all.** No selection policy can rescue these — they're a candidate-generation recall problem. That's where the headroom is.

To reach the stated targets (top-1 ~97%, top-3 ~99%):

- top-1 117/121 — requires 12 more cases beyond displayed; 9 are oracle-reachable, 3 are candidate-generation
- top-3 120/121 — requires 2 more cases; 1 oracle-reachable, 1 candidate-generation

Both targets require candidate-generation work. Top-3 specifically *cannot* hit 99% via policy alone.

## What we keep from PRD-0019 / PRD-0020

The eval substrate stays. It's the load-bearing diagnostic that told us "27 cases is candidate-generation, not coverage." Specifically:

- `runFacetTop3ShadowEval` — bottleneck attribution by layer (parser / candidate_generation / coverage / policy)
- `runFacetCoverageShadowEval` — deterministic_v1 vs oracle agreement by facet kind
- `runFacetOracleEval` — ceiling probe using oracle labels
- `deterministicFacetCoverageProvider` — deterministic_v1 coverage signal usable in any future shadow analysis
- `applyFacetCoveragePolicy` — pack assembly logic; useful for shadow eval comparisons

These remain in the codebase and remain runnable. They are *not* wired into displayed retrieval.

## What's parked

- Promoting the deterministic policy or shadow ordering into displayed retrieval (would require closing the regression and clearing PRD-0020 promotion gates; lift insufficient to justify)
- AI parser shadow runs (PRD-0019 THO-192, infrastructure exists but not used)
- `RetrievalIntent` v2 contract with provenance / confidence (was sketched in PRD-0021 grilling, not pursued)
- Caller-supplied `query_anchors.excluded_concepts` field (mentioned as future contract surface)

## Prior requests / linked decisions

- PRD-0019 (THO-185): task facet harness + deterministic evidence policy — eval infrastructure stays, policy stays diagnostic
- PRD-0020 (THO-194): deterministic facet coverage + evidence-based top-3 selection — eval stays, selection policy not promoted
- PRD-0021 (THO-201): caller-anchored requirements + parser conservatism — canceled before implementation; design is correct but the lift it would unlock isn't worth the engineering cost

## What's next

PRD-0022 will target the 27-case candidate-generation bucket. Direction: broader candidate recall (anchor-graph traversal, path/basename expansion, source-profile alias enrichment, optional local-embedding fused candidates). Selection stays on source-rerank.
