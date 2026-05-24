# ADR-0020: Retrieval Engine V2 uses source-first ceiling probes before architecture rework

**Status:** Accepted
**Date:** 2026-05-08

Retrieval Engine V2 supersedes ADR-0019 as the governing decision for the next retrieval architecture phase. ADR-0019 correctly captured deterministic hardening for pilot-readiness, but the Week 7 broader real-corpus panel changed the question from "can deterministic chunk ranking become pilot-usable?" to "can retrieval support high-reliability Context Pack and context assembly work without compounding failures?"

The V2 work therefore starts with Slice 0 ceiling probes before implementing the source-first architecture. Slice 0 is **measurement-only**: it may enrich eval/reporting, persist full scored candidates, aggregate chunks into deduped source candidates, compute post-hoc oracle source rerank ceilings, audit unsupported-query separability using available raw evidence features, check synthetic regression safety, and measure assignment-level coverage. Source recall for the ceiling probe is measured pre-pack: after scoring, before `min_final_score`, budget packing, and structural assembly. Post-threshold and post-pack recall may be reported as loss diagnostics, but they are not the candidate-generation ceiling metric. Slice 0 must not change production retrieval behavior, introduce source profiles, add RRF, change confidence semantics, or alter the MCP/CLI contract.

If those probes show high candidate recall and separable confidence, V2 proceeds to source-first retrieval: multi-retriever candidate generation, source-level reranking, source-scoped chunk selection, pack coverage verification, and fail-closed recovery. If the probes are weak, the next target is candidate generation or corpus/indexing, not reranking.

Source profiles introduced by V2 are rebuildable retrieval index metadata, not a new Context Object kind. They may influence source ranking, candidate explanation, and pack verification, but final Context Packs continue to cite Doc Chunks and Cards only.

The V2 north-star metric is **critical-source recall or honest abstention**, not top-1 accuracy. Top-1 remains a usability and ranking diagnostic, but V2 is successful only when every source required for a task is present in the candidate/assembled context, or the engine explicitly reports `partial`, `unsupported`, or `needs_anchors` instead of returning a confident wrong pack.

For Slice 0 evals, `must_include_sources` is the critical-source set for answerable cases. `expected_top_source` and `acceptable_top_sources` are top-ranking targets, not the full coverage target. Unsupported or `signal_empty` cases have no critical-source set and are scored on honest abstention and separability instead.

Card correctness is measured separately from source recall. Locked Cards are governed by locked-include correctness gates, not doc source recall. Non-locked Cards may participate in ranked retrieval metrics, but they do not satisfy source recall unless a fixture explicitly declares a Card as a critical Context Object. This prevents curated operational knowledge from hiding whether the doc retrieval engine can find the required imported sources.

Slice 0 must produce an explicit branch decision. If critical-source-set recall@50 is below 95%, candidate generation or indexing is the bottleneck and V2 must not start with reranking. If critical-source-set recall@50 is at least 95% but top-1/top-3 ranking remains weak, ranking/aboutness is the bottleneck and V2 should proceed to SourceProfiles plus source-level reranking. If unsupported cases are not separable with available features, confidence/abstention is the bottleneck and V2 must not claim readiness even if answerable recall improves. If the synthetic fixture regresses, stop and fix the instrumentation or accidental behavior change before interpreting real-corpus movement.

The deterministic-core principle remains locked: deterministic retrieval is the default floor, no index-time LLM calls are required for correctness, and neural or LLM reranking is optional, measured, and gated behind evidence that candidate recall is already high. Locked Cards and non-locked Card bias semantics from ADR-0011/D37-D43 remain unchanged.

**Supersedes:** ADR-0019 for future high-ceiling retrieval architecture work.

**Reference plan:** [Retrieval Engine V2 Rework Plan](../plan/retrieval-engine-v2-rework-2026-05.md).

**Immediate implementation PRD:** [PRD-0010](../prd/0010-retrieval-engine-v2-slice-0-ceiling-probes.md), covering Slice 0 only. Later implementation PRDs are selected from the Slice 0 branch decision.
