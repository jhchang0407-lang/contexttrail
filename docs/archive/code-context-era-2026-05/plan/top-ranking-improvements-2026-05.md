# Top-ranking improvement plan — 2026-05

> Status: **ready for implementation**
>
> Source: retrieval fixture eval + context assembly baseline as of 2026-05-07.
>
> Baselines:
> - [retrieval-context-assembly-baseline-2026-05-07.json](../evals/baselines/retrieval-context-assembly-baseline-2026-05-07.json)
> - [post-prd-0005-quality-checklist.md](../evals/post-prd-0005-quality-checklist.md)
>
> Predecessors:
> - [PRD-0006](../prd/0006-fact-finding-quality-and-context-assembly-bridge.md)
> - [architecture-deepening-2026-05.md](./architecture-deepening-2026-05.md)

## Why this plan exists

The current retrieval engine is strong enough to stop inventing new eval surfaces and start improving the existing one.

The current baseline says:

- **retrieval correctness is strong**
  - overall ranked useful: `89.3%`
  - anchored ranked useful: `95.4%`
  - agent answer: `100%`
  - must-include coverage in top-3: `98.4%`
- **assembly first-read quality is not strong enough yet**
  - overall top-1 acceptable: `56.6%`
  - anchored top-1 acceptable: `86.2%`
  - cross-module-boundary top-1 acceptable: `63.2%`
  - decision-rationale top-1 acceptable: `16.7%`

The next pass should therefore improve **top-1**, **top-3 usefulness**, and **first-read assembly quality** using the current tests, without weakening retrieval correctness.

This is not a new PRD because it does not change the product contract. It is an implementation hardening plan against the existing eval.

## Non-goals

- Do not optimize for a single fixture id.
- Do not special-case specific file paths, contexttrails, or doc names.
- Do not weaken the current retrieval correctness gates to make ranking changes look good.
- Do not optimize signal-empty or broad vague queries in ways that hurt anchored precision.
- Do not begin token-compression work yet. We first need stronger first-read quality so later compression has quality margin to spend.

## Current baseline, interpreted

### What is already good enough

- Retrieval finds the right material often enough to continue:
  - anchored ranked useful `95.4%`
  - scope inference `95.4%`
  - locked authority retrieval `95.4%`
  - agent answer `100%`
- Packs are already compact:
  - average pack tokens used: `1,096`
  - anchored average pack tokens used: `939`
  - `100%` of cases are under `12k`
  - `99.2%` of cases are under `5k`

### What is not good enough

- The first thing surfaced is too often not the best thing to read first.
- Top-1 misses are concentrated in a few real query classes:
  - `cross_module_boundary`: `7 / 19` misses
  - `decision_rationale`: `5 / 6` misses
- Low top-1 on `signal_empty` and broad ambiguous queries should not drive the next engine work. Those are evaluation classes where warning honesty and recovery are more important than perfect top-1.

## Success criteria

These are the target ranges that should be met before moving on to compression work.

### Retrieval guardrails

- anchored ranked useful: stay at or above `95%`
- agent answer: remain `100%`
- must-include coverage in top-3: remain at or above `98%`
- top-3 source balance overall: remain at or above `90%`
- no regressions in:
  - query mode exactness
  - locked correctness
  - forbidden locked
  - forbidden in top-3
  - expected warnings
  - evidence provenance

### Assembly targets

- anchored top-1 acceptable: raise from `86.2%` to at least `90%`
- cross-module-boundary top-1 acceptable: raise from `63.2%` to at least `75%`
- decision-rationale top-1 acceptable: raise from `16.7%` to at least `60%`
- overall top-1 acceptable: raise from `56.6%` to at least `70%`

These are not all-or-nothing ship bars. They are the targets for this hardening pass.

## Implementation strategy

### Principle

Improve by **query class** and **ranking seam**, not by case.

The engine should become better at:

- choosing the best **first doc** for multi-anchor, multi-module anchored queries
- choosing the best **first doc** for rationale-style queries
- reducing redundant repetition in top-3 when several chunks from the same source are close in score

### Pass 1 — document-level coverage for anchored multi-scope queries

**Goal**

- Improve first surfaced doc for `cross_module_boundary` and other multi-scope anchored queries.

**Hypothesis**

The current scorer is too chunk-local. A narrow high-scoring chunk from one module can beat a document that better covers the whole query.

**Implementation direction**

- Add a document-level coverage signal for anchored multi-scope queries.
- Prefer sources that cover more of:
  - recognized anchors
  - inferred scopes
  - touched modules
- Apply the signal only when the query actually has multiple distinct inferred scopes or multiple materially distinct anchors.

**Important constraint**

This must be a general ranking feature, not a path-specific rule.

**Expected movement**

- anchored top-1 acceptable up
- cross-module-boundary top-1 acceptable up
- top-3 source balance stays flat or improves

### Pass 2 — rationale-style query shaping

**Goal**

- Improve top-1 for `decision_rationale`.

**Hypothesis**

The current scorer is too implementation-oriented. Queries that ask for reasons or decisions still let implementation docs outrank ADR-style docs.

**Implementation direction**

- Add a lightweight rationale-intent heuristic from the query text.
- Signals can include words such as:
  - `why`
  - `decision`
  - `rationale`
  - `tradeoff`
  - `chosen`
  - `ADR`
- When that intent is present, decision-layer docs should receive an additive or multiplicative ranking advantage at display time.

**Important constraint**

This should remain transparent and limited in scope. It is not a broad query classifier project.

**Expected movement**

- decision-rationale top-1 acceptable up
- no change to locked semantics
- minimal impact on anchored implementation queries

### Pass 3 — top-3 redundancy reduction

**Goal**

- Improve top-3 usefulness without reducing correctness.

**Hypothesis**

Top-3 is often technically correct but too repetitive. Closely scored chunks from the same source crowd out a more useful second or third source.

**Implementation direction**

- Add a mild repetition penalty in displayed top-3 ordering.
- Prefer parent or introductory chunks before multiple sibling subsections from the same source when scores are close.
- Keep this as a display-order rule, not a retrieval recall rule.

**Important constraint**

Do not reduce must-include coverage or hide important evidence.

**Expected movement**

- top-3 usefulness up
- top-3 source balance up or flat
- top-1 may also improve as a side effect

## Query classes to prioritize

### Priority 1

- `cross_module_boundary`
- `decision_rationale`

These are the real first-read quality failures that matter for future context assembly.

### Priority 2

- anchored `file_anchored` misses where a locked card beats the canonical doc at top-1

These are small in count but important for first-read usability.

### De-prioritized for this pass

- `signal_empty`
- broad ambiguous `none`
- generic unanchored top-1 perfection
- token compression

These should not dictate the next ranking changes.

## How we will evaluate each pass

For every implementation pass:

1. Run the existing fixture eval and compare against:
   - [retrieval-context-assembly-baseline-2026-05-07.json](../evals/baselines/retrieval-context-assembly-baseline-2026-05-07.json)
2. Check these first:
   - anchored ranked useful
   - cross-module-boundary top-1 acceptable
   - decision-rationale top-1 acceptable
   - must-include coverage in top-3
   - top-3 source balance
3. Reject any change that:
   - drops retrieval correctness gates
   - improves one case by clearly harming a whole query class
   - uses path-specific or fixture-specific logic

## Practical next step

Implement **Pass 1** first:

- add document-level coverage support for anchored multi-scope queries
- rerun the current eval
- inspect whether the gains appear in the whole `cross_module_boundary` bucket rather than only a couple of cases

If Pass 1 generalizes, then move to Pass 2.

If Pass 1 helps only individual fixtures and not the bucket, stop and revise the hypothesis before writing more code.
