# PRD-0011: Confidence and abstention rework

> Source-of-truth canonical doc. Intended to be mirrored to the issue tracker as the project's eleventh PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADR: [ADR-0020](../adr/0020-retrieval-engine-v2-source-first-ceiling-probes.md). Reference plan: [Confidence / Abstention Slice 1 Plan](../plan/confidence-abstention-slice-1-2026-05.md). Related PRDs: [PRD-0005](0005-retrieval-correctness-and-observability.md), [PRD-0010](0010-retrieval-engine-v2-slice-0-ceiling-probes.md).
>
> **Sequencing rule:** this PRD comes after Slice 0 proved `critical-source-set recall@50 = 100%` on the Phase 8 panel. It must improve honest abstention without changing candidate generation, source recall, or source-first V2 architecture.

## Problem Statement

Slice 0 did the job we needed it to do. After fixing the import-surface and headingless-doc bugs, the real-corpus eval now shows:

| Metric | Result |
|---|---:|
| critical-source-set recall@50 | 100.0% |
| oracle answerable success@50 | 100.0% |
| actual top-1 acceptable | 62.5% |
| actual top-3 acceptable | 87.5% |
| false-confident unsupported | 7/10 |
| synthetic regression | passed |

That changes the question. Retrieval is no longer primarily failing because required sources are absent from the candidate set. It is failing because unsupported or weakly supported queries are still presented too confidently.

The current confidence behavior has a policy mismatch:

- unsupported queries can emit `low_confidence` warnings and still report `coverage_confidence=confident`
- very narrow top-score margins still read as confident when they should be uncertain
- `query_mode` and confidence semantics remain conceptually separate, but the actual confidence policy does not yet use enough of the available evidence to be honest

For context assembly, this matters as much as recall. A wrong confident pack can poison the final assignment even when candidate generation is otherwise healthy.

## Solution

Implement a deterministic **confidence and abstention policy rework** that makes `coverage_confidence` and warning behavior agree with the actual retrieval evidence.

The new behavior should:

1. preserve the current retrieval and ranking pipeline
2. centralize confidence judgment in one policy module
3. use already-available signals such as:
   - query mode
   - locked entry presence
   - displayed ranked scores
   - top-1 / top-2 / top-3 score margins
   - warning kinds, especially `low_confidence`
   - empty ranked output and safety-net behavior
4. reduce false-confident unsupported cases to zero on the current Phase 8 real-corpus panel
5. keep answerable-case recall intact

This PRD is intentionally smaller than a ranking or source-first slice. It is a trust-surface correction: when the corpus does not actually support the task, the engine must say so honestly.

## User Stories

1. As a ContextTrail maintainer, I want unsupported queries to report `uncertain` or `empty` instead of `confident`, so that the eval does not overstate engine readiness.
2. As a ContextTrail maintainer, I want `coverage_confidence` to use the same evidence that already drives `low_confidence` warnings, so that the wire contract is internally consistent.
3. As a ContextTrail maintainer, I want narrow score-margin cases treated more skeptically, so that lexical near-ties do not masquerade as trustworthy answers.
4. As a ContextTrail maintainer, I want locked Cards to remain confidently trusted, so that abstention work does not weaken authored operational knowledge.
5. As a ContextTrail maintainer, I want empty ranked output to remain clearly `empty`, so that no-match behavior stays legible.
6. As a ContextTrail maintainer, I want unanchored ranked-only output to need stronger evidence before being called confident, so that broad unsupported requests do not sound solved.
7. As a ContextTrail maintainer, I want confidence policy moved into one module, so that presenter logic and eval logic stop drifting apart.
8. As a ContextTrail maintainer, I want per-case confidence reasons in eval artifacts, so that we can explain why a case was classified as `confident`, `uncertain`, or `empty`.
9. As a ContextTrail maintainer, I want false-confident unsupported cases to be a first-class regression target, so that future ranking work cannot quietly reintroduce them.
10. As a ContextTrail maintainer, I want answerable retrieval to stay confident when evidence is actually strong, so that honesty work does not become over-abstention.
11. As a ContextTrail maintainer, I want this slice to leave source recall untouched, so that we can attribute any movement cleanly to confidence policy.
12. As a ContextTrail maintainer, I want the synthetic 126-case fixture to remain green, so that confidence changes do not break the easier deterministic floor.
13. As a ContextTrail maintainer, I want the Slice 0 branch decision to stop selecting `confidence_or_abstention` once false-confident unsupported cases are fixed, so that the next bottleneck becomes visible mechanically.
14. As a future ranking implementer, I want the engine to abstain honestly before source-ranking work lands, so that unsupported cases do not contaminate evaluation of later slices.
15. As an agent consuming `retrieve_context_pack`, I want weak matches to be labeled honestly, so that I can ask for anchors or clarify the task instead of acting on noise.
16. As an agent consuming `retrieve_context_pack`, I want clearly supported anchored retrieval to remain confident, so that normal workflows do not become hesitating or noisy.
17. As a maintainer reading the real-corpus report, I want confidence diagnostics grouped alongside the unsupported cases, so that I can judge whether the abstention policy is working without manual trace spelunking.
18. As a maintainer, I want confidence policy thresholds to be explicit and testable, so that changes can be tuned deliberately rather than by gut feel.
19. As a maintainer, I want this PRD to avoid MCP contract churn unless absolutely necessary, so that the work remains small and low-risk.
20. As a future V2 implementer, I want honest abstention solved before source-first architecture work expands the retrieval surface, so that we do not scale a misleading confidence model.

## Implementation Decisions

- This is a **policy slice**, not a retrieval-primitive slice. It does not change candidate generation, source aggregation, ranking stages, source-first architecture, or pack assembly order.
- Introduce a dedicated confidence-policy module whose only responsibility is mapping retrieval evidence to `coverage_confidence`.
- The confidence-policy module should consume:
  - query mode
  - whether locked entries exist
  - displayed ranked scores
  - top-score margins
  - warning kinds
  - safety-net / empty-pack state
- `coverage_confidence` and `low_confidence` must agree. A case that triggers the low-confidence path must not still surface as `confident`.
- Locked entries remain an explicit confidence override. Authored accepted operational knowledge keeps its current trust semantics.
- Empty ranked output remains `empty`; this slice does not redefine no-match behavior.
- Unanchored ranked-only output must clear both an absolute score floor and a margin floor before becoming `confident`.
- Narrow score margins should cap the result at `uncertain` even if the top score is numerically high.
- `signal_empty` query mode should bias toward `uncertain` or `empty`, not `confident`, unless a future explicit rule proves otherwise.
- The confidence-policy module should return a decision shape rich enough to support explain/eval diagnostics, even if only `coverage_confidence` is exposed in the stable MCP contract.
- Presenter integration should be thin. The presenter should ask the policy module for the decision instead of re-implementing thresholds inline.
- Slice 0 reporting should capture per-case confidence diagnostics:
  - confidence classification
  - reason/category
  - top-1 score
  - top-1/top-2 margin
  - top-1/top-3 margin
  - warning kinds
- The real-corpus eval remains the primary decision surface for this PRD. The synthetic fixture remains a hard regression gate, not the readiness surface.
- The target success condition is `0` false-confident unsupported cases on the current Phase 8 panel while preserving `critical-source-set recall@50 = 100%`.
- This PRD does not add SourceProfiles, RRF, dense retrieval, cross-encoder reranking, LLM reranking, or new retrieval stages.
- This PRD should prefer additive explain/eval detail over MCP contract changes. If a new external field becomes necessary, it requires an explicit follow-up decision.

## Testing Decisions

- Good tests should verify **observable confidence behavior**, not private helper implementation details.
- The confidence-policy module should have focused unit tests that pin representative cases:
  - locked result stays confident
  - empty ranked output becomes empty
  - low-confidence warning caps confidence at uncertain
  - strong top score with weak margin becomes uncertain
  - strong supported retrieval remains confident
- Presenter-level tests should verify that `retrieve_context_pack` uses the shared policy rather than drifting from it.
- Slice 0 report tests should verify that false-confident unsupported counts and per-case confidence diagnostics remain stable.
- Real-corpus regression tests should validate the actual unsupported cases that motivated this PRD, especially the seven currently false-confident panel cases.
- The full suite must continue to pass after snapshot refreshes where score-only output moves as a consequence of policy changes.
- Prior art already exists in:
  - schema and presenter tests for MCP wire behavior
  - Slice 0 report and separability tests
  - real-corpus eval and fixture-based regression surfaces
- This PRD should keep tests concentrated around:
  - the confidence policy module
  - presenter integration
  - Slice 0 report regression

## Out of Scope

- Candidate generation changes
- Source-level reranking
- SourceProfile introduction
- RRF or multi-retriever fusion
- Dense retrieval
- Cross-encoder or LLM reranking
- Broad source-first V2 implementation
- Context assembly redesign
- New answer-generation or task-execution layers
- Weakening existing locked-include trust rules

## Further Notes

- Slice 0 now supports the original architecture thesis: critical sources are present, but confidence honesty is not good enough yet.
- The likely next branch after this PRD, if successful, is `source_ranking_or_aboutness`, because answerable top-1 and top-3 still lag even after recall reached 100%.
- The most important discipline in this slice is not to let “confidence work” quietly turn into ranking work. If ranking starts moving a lot, we lose attribution.
- This PRD is worth doing before source-first V2 because it reduces user-facing risk immediately while preserving a clean runway for the higher-ceiling ranking work.
