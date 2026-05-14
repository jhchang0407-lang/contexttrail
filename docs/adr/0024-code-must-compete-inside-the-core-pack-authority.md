# ADR-0024: Code must compete inside the core pack authority

**Status:** Accepted
**Date:** 2026-05-13

Code retrieval should participate inside the core retrieval and packing contract rather than arriving through a presenter-only or eval-only side channel. In practice, that means code entries must compete under the same budget authority, omission semantics, readiness semantics, confidence semantics, and recovery semantics as the rest of the pack, instead of being appended after `packWithLocked()` has already decided what fit.

We are recording this because the current code path makes the opposite trade-off: `packWithLocked()` is the real budget authority, but code can still be introduced later through assembly-side helpers. That shape is easy to ship locally and hard to reason about globally. Once code becomes a first-class retrieval unit, leaving it outside the core pack contract would keep budget accounting, omissions, readiness, and MCP presentation structurally inconsistent. The chosen direction is to unify the ranked-entry path end to end and let any code-lane reservation live inside the core pack authority rather than in a second pass.
