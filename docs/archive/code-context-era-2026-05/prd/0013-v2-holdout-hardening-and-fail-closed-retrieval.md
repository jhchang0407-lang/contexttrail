# PRD-0013: V2.5 structural retrieval generalization

> Source-of-truth canonical doc. Intended to be mirrored to the issue tracker as the project's thirteenth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADR: [ADR-0020](../adr/0020-retrieval-engine-v2-source-first-ceiling-probes.md). Related PRDs: [PRD-0010](0010-retrieval-engine-v2-slice-0-ceiling-probes.md), [PRD-0011](0011-confidence-abstention-rework.md), [PRD-0012](0012-source-profile-and-source-rerank.md).
>
> **Sequencing rule:** this PRD comes after PRD-0012 passed the original 42-case dev panel but failed the 106-case untouched holdout. V3 must not start until V2.5 proves structural generalization on holdout or explicitly parks deterministic V2 behind a measured ceiling.

## Problem Statement

PRD-0012 proved that source-first retrieval is directionally right, but the holdout result proved that passing the original panel was not enough.

The original dev panel passed:

| Metric | Dev Result |
|---|---:|
| answerable cases | 32 |
| candidate recall@50 | 100.0% |
| source-rerank top-1 | 78.1% |
| source-rerank top-3 | 96.9% |
| wire top-1 | 75.0% |
| wire top-3 | 96.9% |
| unsupported honesty | 100.0% |
| false-confident unsupported | 0 |

The untouched holdout failed:

| Metric | Holdout Result |
|---|---:|
| answerable cases | 90 |
| candidate recall@50 | 96.7% |
| source-rerank top-1 | 63.3% |
| source-rerank top-3 | 86.7% |
| wire top-1 | 67.8% |
| wire top-3 | 86.7% |
| unsupported honesty | 68.8% |
| false-confident unsupported | 5 |

The combined 148-case panel failed:

| Metric | Combined Result |
|---|---:|
| critical-source-set recall@50 | 97.5% |
| actual top-1 acceptable | 69.7% |
| actual top-3 acceptable | 89.3% |
| false-confident unsupported | 5 |
| synthetic regression | passed |
| active branch | `confidence_or_abstention` |

The tempting response is to add more samples and tune weights again. That is not acceptable as the core plan. More samples reduce variance, but they do not solve the architecture problem if the engine is still built around one candidate path, one hand-weighted source score, and a confidence policy that mistakes high lexical score for coverage.

For context assembly, this is dangerous. A context assembly request may use 5 or 6 retrievals. If each retrieval has weak holdout top-3 and can be confidently wrong, errors compound quickly.

The problem is therefore structural:

- The engine needs a coverage model, not just a score threshold.
- The engine needs multiple independent candidate paths, not a single retrieval path that source-rerank tries to rescue.
- The engine needs fail-closed confidence derived from coverage and agreement, not top-score optimism.
- The engine needs scorer generalization evidence, not coefficient tuning against whichever panel is currently visible.

## Solution

Build V2.5 as a structural retrieval generalization layer before any V3 work.

V2.5 introduces four architectural modules:

1. **Multi-path candidate generation**: generate source candidates through independent deterministic paths, then fuse them.
2. **Coverage verifier**: decide whether candidate sources actually cover the query need before confidence is allowed.
3. **Fail-closed confidence policy**: derive `coverage_confidence` from coverage, retriever agreement, and source evidence.
4. **Generalization harness**: enforce dev/holdout discipline, ablations, and no-ship rules for coefficient-only improvements.

The target behavior is:

- If the corpus supports the task, the critical source set appears in candidate sources and top displayed sources.
- If the corpus does not support the task, the engine reports uncertainty or unsupported status.
- If the engine is unsure whether the retrieved sources actually answer the task, it fails closed and asks for anchors or broader corpus coverage.

This is not a weight-tuning PRD. Weight changes may happen, but only when they implement or calibrate a named structural invariant.

## Success Criteria

This PRD ships only when holdout, combined, and regression gates pass together.

### Holdout Release Gates

| Gate | Required |
|---|---:|
| candidate recall@50 | 100.0% |
| false-confident unsupported | 0 |
| unsupported honesty | 100.0% |
| source-rerank top-1 | >= 75.0% |
| source-rerank top-3 | >= 93.8% |
| wire top-1 acceptable | >= 75.0% |
| wire top-3 acceptable | >= 93.8% |
| synthetic regression | passed |

### Combined Panel Gates

| Gate | Required |
|---|---:|
| critical-source-set recall@50 | 100.0% |
| false-confident unsupported | 0 |
| wire top-1 acceptable | >= 75.0% |
| wire top-3 acceptable | >= 93.8% |

### Structural Gates

| Gate | Required |
|---|---|
| No coefficient-only ship | Every scoring change must map to a named structural invariant. |
| Ablation discipline | Reports must show dev and holdout deltas per structural module. |
| Coverage before confidence | No unsupported case may be `confident` without passing coverage verification. |
| Candidate-source explanation | Every critical-source miss must be classified by layer. |
| Fail-closed behavior | Incomplete coverage must produce `uncertain`, `empty`, or `needs_anchors`, not confident output. |

### Floor And Ceiling Interpretation

The current observed holdout floor is `67.8%` wire top-1, `86.7%` wire top-3, and `68.8%` unsupported honesty.

If V2.5 lands cleanly, the deterministic floor should become `75%+` top-1, `93.8%+` top-3, and `0` false-confident unsupported on holdout. A plausible deterministic V2.5 ceiling is `80-85%` top-1 and `95-98%` top-3 on this corpus shape without neural retrieval. If V2.5 cannot reach that after multi-path recall, coverage verification, and fail-closed confidence are implemented, V3 is justified as a new-primitives effort rather than another coefficient pass.

## User Stories

1. As a ContextTrail maintainer, I want holdout gates to be hard release gates, so that visible-panel tuning cannot ship as generalization.
2. As a ContextTrail maintainer, I want every retrieval improvement tied to a structural invariant, so that we do not play whack-a-mole across repos.
3. As a ContextTrail maintainer, I want multiple deterministic candidate paths, so that source recall does not depend on one scorer's blind spots.
4. As a ContextTrail maintainer, I want path/title/heading/symbol/question/source-profile retrievers to contribute independently, so that different doc shapes can still surface canonical sources.
5. As a ContextTrail maintainer, I want RRF or equivalent deterministic fusion over candidate paths, so that no single retriever dominates too early.
6. As a ContextTrail maintainer, I want candidate recall misses classified by layer, so that missing import surface, weak query construction, and weak scoring are not conflated.
7. As a ContextTrail maintainer, I want non-standard doc roots such as `wiki/` included when a corpus declares them, so that corpus coverage failures are explicit.
8. As a ContextTrail maintainer, I want a coverage verifier, so that high lexical score does not automatically mean the source answers the task.
9. As a ContextTrail maintainer, I want confidence derived from verified coverage, so that unsupported tasks cannot become confident through incidental term overlap.
10. As a ContextTrail maintainer, I want retriever agreement used as a confidence signal, so that independent agreement is treated differently from one brittle high score.
11. As a ContextTrail maintainer, I want source aboutness checked before top sources are trusted, so that broad README sections and ecosystem lists do not create false support.
12. As a ContextTrail maintainer, I want decision-lookup, exact-symbol, broad-domain, cross-module, and file-anchored cases verified differently, so that one generic confidence policy does not flatten task intent.
13. As a ContextTrail maintainer, I want fail-closed recovery when coverage is incomplete, so that agents ask for anchors or corpus coverage instead of acting on noise.
14. As a ContextTrail maintainer, I want source-rerank metrics separated from wire metrics, so that packing/display bugs and scorer bugs stay distinguishable.
15. As a ContextTrail maintainer, I want source-rerank ablations on dev and holdout, so that improvements are validated as architecture, not refitting.
16. As a ContextTrail maintainer, I want README-heavy and API-heavy corpora reported separately, so that different documentation shapes expose different weaknesses.
17. As a ContextTrail maintainer, I want locked Cards to retain current semantics, so that retrieval hardening does not weaken accepted operational truth.
18. As a ContextTrail maintainer, I want SourceProfiles to remain rebuildable deterministic metadata, so that retrieval quality does not depend on index-time LLM calls.
19. As a context assembly user, I want top-3 to contain the canonical source reliably, so that assembly has a stable substrate.
20. As a context assembly user, I want unsupported retrieval to be visibly uncertain, so that downstream assignment planning can pause before using bad context.
21. As a future V3 implementer, I want a clean deterministic ceiling report, so that heavier primitives are justified by evidence.
22. As a future V3 implementer, I want V2.5 modules tested independently, so that V3 can replace or enhance one layer without guessing.

## Implementation Decisions

- This is a V2.5 architecture PRD, not V3.
- This PRD must not introduce dense retrieval, embeddings, cross-encoder reranking, LLM reranking, or learning-to-rank.
- This PRD may add deterministic candidate paths, RRF-style fusion, coverage verification, fail-closed confidence, and eval/reporting changes.
- The dev/holdout split is the primary release discipline.
- The eval command must fail when holdout gates fail.
- False-confident unsupported takes precedence over ranking failures in the branch decision.
- Candidate recall failures take precedence over source-rerank failures once confidence is safe.
- Coefficient-only improvements do not count as ship evidence unless attached to a named structural invariant and ablation.

### Implementation Guardrails

- Do not fix a named holdout case by adding a repo-specific path, title, package, or source rule.
- Do not weaken expected sources or unsupported labels to make the holdout pass.
- Do not ship a scoring coefficient change unless the issue body names the structural invariant it implements and the report shows the ablation impact.
- Do not let `final_score`, `packing_score`, or source-rerank score alone produce `coverage_confidence=confident`.
- Do not treat source-rerank top-3 and wire top-3 as interchangeable. They measure different layers and both must be reported.
- Do not use SourceProfiles as final cited authority. Final Context Packs still cite Doc Chunks and Cards only.
- Do not use an LLM at index time or retrieval time for this PRD.
- Do not hide recall failures behind confidence. Candidate-source recall and honest abstention are separate gates.
- Do not hide confidence failures behind ranking. Unsupported honesty is the first branch-decision bottleneck while false-confident unsupported is nonzero.
- Do not assume one documentation shape. README-heavy, API-heavy, guide-heavy, and mixed-doc corpora must stay visible in diagnostics.
- Do not collapse not-imported, not-retrieved, below-threshold, budget-dropped, and displayed-but-wrong failures into one "ranking miss" bucket.
- Do not remove locked Card or `card_type_bias` behavior while changing doc retrieval.
- Do not make holdout a tuning surface. Holdout is observed after changes; development and coefficient experiments must be justified from dev, structural bugs, or explicit ablations.

### Module 1: Multi-Path Candidate Generation

- Build source candidates from multiple independent deterministic paths.
- Required candidate paths:
  - chunk lexical retrieval
  - source path and filename matching
  - title and H1 matching
  - heading outline matching
  - deterministic alias matching from SourceProfiles
  - symbol and route anchor matching where anchors exist
  - question-shaped heading matching where available
- Candidate paths should emit source-level candidates with per-path ranks and reasons.
- Fuse source candidates with deterministic reciprocal-rank fusion or an equivalent transparent method.
- Preserve chunk-level traces so final Context Packs still cite Doc Chunks.
- Do not remove the existing chunk lexical path; it remains one candidate source, not the whole system.
- Add repo-configurable import globs for real-corpus fixtures so import coverage is measured honestly.
- Classify every critical-source miss as:
  - not imported
  - imported but absent from candidate paths
  - present but not top-50 after fusion
  - present top-50 but below threshold
  - present and packed but not displayed

### Module 2: Coverage Verifier

- Add a deterministic source-level verifier that asks whether a source plausibly covers the query need.
- The verifier is not a reranker. It is a gate and diagnostic layer used by confidence and assembly readiness.
- The verifier should consume:
  - query intent
  - query tokens after shared retrieval tokenization
  - source title/path/heading/alias/question coverage
  - source purpose and role
  - candidate-path agreement
  - top chunk evidence
  - required anchor matches where available
- The verifier should output:
  - `covers`
  - `partial`
  - `unsupported`
  - `needs_anchors`
  - structured reason codes
- Coverage must be intent-aware. Exact-symbol coverage is not the same as decision-lookup coverage.
- Coverage must be source-aware. A broad source can be partial even when a chunk has a high lexical score.
- Coverage should be conservative on unanchored unsupported cases.

### Module 3: Fail-Closed Confidence

- Confidence must be computed by one shared policy module.
- Confidence must consume coverage verifier results.
- Confidence must consume retriever agreement and disagreement.
- Confidence must consume source-rerank margin, but margin alone is insufficient for confidence.
- Confidence must consume warning kinds and safety-net state.
- `coverage_confidence=confident` is allowed only when coverage verification passes or locked Cards provide accepted authority for the task.
- Unsupported, partial, or needs-anchor coverage must cap confidence at `uncertain` or `empty`.
- Low-confidence warnings and `coverage_confidence` must agree.
- Unsupported cases with high lexical score but poor aboutness must become uncertain.
- The confidence policy should return a structured reason used by report diagnostics.

### Module 4: Generalization Harness

- Keep dev, holdout, and combined reports separate.
- Add ablation reporting for:
  - lexical-only baseline
  - SourceProfile rerank only
  - multi-path candidate generation only
  - coverage verifier only
  - fail-closed confidence only
  - full V2.5 stack
- Each ablation must show dev and holdout deltas.
- Add per-shape reporting for README-heavy, API-heavy, guide-heavy, and mixed-doc corpora where the fixture marks or infers the shape.
- Add per-failure reports for the current named failures:
  - Hono gRPC false confidence
  - Turborepo database migration false confidence
  - Zod runtime false confidence
  - Zod CLI false confidence
  - Zod React false confidence
  - Turborepo getting-started recall miss
  - Zod optionality import/recall misses
- Preserve the synthetic regression gate as a hard sanity check.

## Testing Decisions

- Good tests should verify structural behavior and observable diagnostics, not private coefficients.
- Multi-path candidate generation tests should verify each path can independently surface a source.
- Fusion tests should verify that a source supported by multiple weak paths can beat a source supported by one strong but narrow path.
- Import coverage tests should verify repo-specific globs include non-standard doc roots.
- Coverage verifier tests should cover:
  - exact-symbol source covers symbol query
  - broad README ecosystem mention is partial or unsupported
  - decision lookup requires rationale-like source evidence
  - unsupported off-domain query becomes unsupported or needs anchors
  - anchored query with missing source coverage becomes needs anchors or partial
- Confidence-policy tests should cover:
  - coverage pass can become confident
  - partial coverage caps confidence
  - unsupported coverage caps confidence
  - locked accepted Cards can preserve confidence
  - high lexical score without aboutness remains uncertain
- Eval/report tests should cover:
  - holdout gate failure exits nonzero
  - structural gates render in reports
  - branch decision precedence chooses confidence/abstention when false-confident unsupported is nonzero
  - critical-source misses are classified by layer
  - ablation tables render deterministically
- Full regression must include:
  - synthetic fixture
  - original 42-case dev panel
  - 106-case holdout panel
  - 148-case combined panel
  - MCP schema and snapshot checks when output order intentionally changes

## Out of Scope

- Retrieval Engine V3
- Dense retrieval
- Embedding indexes
- Cross-encoder reranking
- LLM reranking
- Learning-to-rank training
- Assignment-level context assembly
- Changing locked Card semantics
- Treating SourceProfiles as Context Objects
- Weakening holdout expectations to make the report pass
- Repo-specific hard-coded fixes for individual failing cases
- Shipping coefficient-only improvements as proof of generalization

## Further Notes

- The PRD-0012 architecture should not be reverted. The holdout shows source-first packing and SourceProfiles are useful, but not sufficient.
- The most important holdout result is not the top-1 drop. The most important result is unsupported honesty dropping to `68.8%`.
- The Zod failures show that corpus/import coverage can be the bottleneck. Reranking cannot recover sources that were never imported.
- The Turborepo getting-started miss shows candidate generation still matters even when overall recall is high.
- The dev-to-holdout source-rerank gap shows the current deterministic scorer has overfit pressure.
- This PRD should leave the project with a clean go/no-go decision for V3. If V2.5 reaches the holdout gates with margin, V3 can target context assembly. If V2.5 cannot, V3 should target the measured remaining primitive rather than start from vague "better accuracy" anxiety.
