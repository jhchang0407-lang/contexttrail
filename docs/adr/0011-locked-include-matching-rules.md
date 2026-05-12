# ADR-0011: Locked-include matching — hierarchical for constraints, strict equality for symbol_notes, one-hop evidence from locked cards

**Status:** Accepted
**Date:** 2026-05-06
**Amended:** 2026-05-06

## Context

Per ADR-0010, locked-include content is pulled into the pack as a hard guarantee. But *which* objects lock for *which* requests? The matching rule is the substrate the entire locked-include contract sits on. If matching is too loose, locked-include floods every pack with irrelevant cards and the signal becomes noise. If matching is too strict, authors must duplicate the same card across every scope variant or accept silent gaps in coverage.

The initial grilling session on 2026-05-06 (Q4 + Q5) pinned two matching rules — one for `constraint` Cards (which lock by **scope**) and one for `symbol_note` Cards (which lock by **anchor**). A follow-up post-dogfood pass added a third bounded rule for `evidence` linked from already-locked cards. The architectural insight remains the same: the rules **should not all be symmetric**. Scope is a hierarchy; anchors are flat strings extracted from a regex table (D32); evidence uses explicit authored graph links. Treating them all the same way produces either over-broad locking, hidden graph explosion, or punishing authoring tax.

Each rule had real alternatives. The asymmetry between the chosen rules is the load-bearing design decision and is the reason this ADR bundles all three.

## Decision

**Constraint locked-include uses hierarchical-down scope matching.** A `constraint` Card locks when its `scope` is the request's inferred scope **or any ancestor of it**.

- A `project: fundops` constraint locks for any task whose inferred scope is `fundops` or any module/symbol within fundops.
- A `module: fundops/ledger` constraint does **not** lock for `module: fundops/billing` (no sibling matching).
- A `module: fundops/ledger` constraint does **not** lock for a `project: fundops`-level task (descendant cannot lock for ancestor — would leak module-specific rules to project-wide work).
- `company:`-scope constraints lock universally. This is intentional: company-level invariants ("never log PII") should reach every retrieval. `contexttrail explain` surfaces a `broad_scope` reason on each company-locked Card so authors can audit whether the broad lock is deliberate.

**Symbol_note locked-include uses strict anchor equality.** A `symbol_note` Card locks when **any** of its declared `symbol_anchors` is a member of the request's `query_anchors` under **strict string equality** on the full anchor (case-sensitive, including any `Class.member` chain).

- A card anchored to `LedgerEntry.post` locks **only** when the query mentions `LedgerEntry.post` verbatim.
- A query for the bare class `LedgerEntry` does **not** lock a card anchored to `LedgerEntry.post`. A query for `LedgerEntry.post` does **not** lock a card anchored to bare `LedgerEntry`.
- Authors who want both class-level and member-level coverage declare **both anchors explicitly**: `symbol_anchors: [LedgerEntry, LedgerEntry.post]`. Multi-anchor declaration is the supported breadth escape hatch — there is no implicit prefix or chain matching.

**Evidence linked from already-locked cards is itself locked.** An `evidence` Card locks when its `covers:` list references a card that has already locked via the two rules above.

- The traversal is **one hop forward only** from the already-locked card to the evidence card.
- Evidence promotion is capped at **2 evidence cards per primary locked card**, with dedupe across primaries.
- Promoted evidence carries `lock_reason = evidence_covers_locked` plus `derived_from: card_id[]` provenance naming the primary locked cards that pulled it in.
- `authority: deprecated` and `freshness_state: potentially_superseded` evidence is filtered out before promotion.

## Why the asymmetry

**Scope is a hierarchy.** The taxonomy `company > team > project > module > symbol > decision` (D33, CONTEXT.md `layer`) carries a containment relationship — an ancestor scope semantically subsumes its descendants. "This applies to all of fundops" is a natural authoring statement that *should* extend to anything inside fundops; forcing per-module duplication produces silent gaps when authors miss a module. Hierarchical-down matching mirrors how humans actually think about constraints.

**Anchors are flat strings, not a hierarchy.** The mention-extraction regex table (D32) treats bare `PascalCase` and `PascalCase.member` as **distinct anchors**, not as parent and child. There is no general rule that "the class subsumes its member" — a member can have invariants the class does not, and vice versa. Strict equality at the locked-include layer matches the same granularity the index uses, keeping retrieval and locking consistent.

If both original rules were hierarchical, a `LedgerEntry` symbol_note would auto-fire on every member query — flooding packs with imprecise notes. If both were strict, a `project: fundops` constraint would fail to lock for any module work — forcing authoring duplication that defeats the purpose of having scope hierarchy at all. If evidence used unrestricted graph expansion, one locked rule could drag in an unbounded neighborhood. The asymmetry is the right answer to *all three* problems.

## Considered alternatives

### For constraint matching

- **Exact-only scope matching.** Rejected. Forces authoring duplication ("this applies to all of fundops" must be re-authored per module), which is exactly the friction that kills the cold-start week.
- **Bidirectional (any overlap in subtree).** Rejected. A `module: ledger` constraint must not lock for `module: billing` work — that is a leak, not a guarantee. Sibling matches break trust faster than missing matches.

### For symbol_note matching

- **Prefix match on member chains.** A card anchored to `LedgerEntry.post` would lock if the query had `LedgerEntry.post` *or* `LedgerEntry`. Rejected. A note about `post`'s rounding rule shouldn't auto-fire on every `LedgerEntry` query — that's exactly the imprecise locking the strict rule is designed to prevent.
- **Bidirectional chain matching.** A class-level note locks for member queries, and a member-level note locks for class-level queries. Rejected for the same reason as bidirectional scope matching: sibling/descendant leakage is worse than missing matches.
- **Implicit multi-anchor (auto-derive `[Class, Class.member]` from a single declaration).** Rejected. Authors should make breadth choices explicitly so the locking behavior is visible in the frontmatter — a future reader (human or AI) auditing why a card fires sees the answer in `symbol_anchors:`, not in implicit rules.

### For evidence matching

- **Ranked-only evidence boost.** Rejected. If evidence can still be cut by budget, it does not solve the actual failure mode: the proof of a locked rule disappears exactly when the pack is tight.
- **Separate `linked_evidence` response field.** Rejected. It creates a second-tier concept that agents must learn, while still leaving ambiguity about whether this evidence is guaranteed.
- **Transitive evidence locking.** Rejected. Multi-hop traversal turns authored linkage into graph expansion. One hop is explainable and bounded; transitive closure is not.

## Consequences

### Positive

- The matching rules align with how each kind of locking is naturally authored. Scope-based authoring expresses inheritance ("this applies to fundops"); anchor-based authoring expresses surgical precision ("this applies to this exact symbol").
- The asymmetry makes the two rules *individually* simple to reason about. A reader doesn't have to remember "is matching fuzzy here or strict here?" — the answer is "fuzzy where scope is fuzzy (a hierarchy), strict where anchors are flat."
- Multi-anchor declaration is the explicit escape hatch for symbol_notes that need broader coverage. The breadth is auditable in the frontmatter.
- Evidence linked through `covers:` can now be part of the same guaranteed context as the rule it justifies, but only in a narrowly-bounded, one-hop form.

### Negative

- The asymmetry is non-obvious to a first-time reader. They will ask "why does scope match hierarchically but anchor match strictly?" The CONTEXT.md `locked-include` entry and this ADR exist to answer that question.
- Evidence promotion adds more locked overhead. ADR-0010 remains the backstop: overflow is honest and warning-driven rather than silently truncating linked evidence.
- Symbol_note staleness on rename is a silent failure mode in v1. A card anchored to `LedgerEntry.post` becomes inert when the symbol is renamed to `LedgerEntry.record`. v1 has no AST resolution; the `mark-needs-review` / `verify` commands and `contexttrail scope inspect` are the coping mechanisms. AST-based rename tracking is v1.5+ territory.
- Company-scope constraints lock universally. If an author over-uses `company:` as a default tag, packs get noisy. The `broad_scope` flag in `contexttrail explain` is the audit surface; treat chronic broad-scope appearances as a tagging discipline issue, not a tool defect.

### Anti-patterns this ADR exists to block

- "Make symbol_note matching hierarchical too, for symmetry with constraints." Reintroduces the imprecision-flood failure mode. The asymmetry is deliberate.
- "Make constraint matching strict too, for symmetry with symbol_notes." Reintroduces the per-module duplication burden.
- "Add fuzzy / similarity-based locked-include for borderline cases." Defeats the entire point of locked-include, which is `bool` not `score`. Borderline matches belong in the ranker, where they are weighted alongside everything else.
- "Use the embedding cosine to decide locked-include." Embeddings are a relevance enhancement (D35); locked-include is a contract. The two should not be coupled.
- "Let evidence walk the whole link graph once a card locks." Reintroduces uncontrolled expansion through a different path. One-hop forward traversal is deliberate.

## References

- [DESIGN.md D38](../DESIGN.md) — constraint hierarchical-down matching
- [DESIGN.md D39](../DESIGN.md) — symbol_note strict equality matching
- [DESIGN.md D44](../DESIGN.md) — one-hop evidence promotion from locked cards
- [DESIGN.md D33](../DESIGN.md) — scope hierarchy and layer taxonomy
- [DESIGN.md D32](../DESIGN.md) — mention-extraction regex table that produces flat anchors
- [DESIGN.md D34](../DESIGN.md) — `scope_match_score` (the same hierarchy, scored continuously) for the ranker
- [ADR-0010](0010-locked-include-overflow-policy.md) — what "locked-include" guarantees once a Card matches
- [CONTEXT.md `locked-include`](../CONTEXT.md), `scope`, `layer`, `code anchor`, `query anchors`
- [PRD-0002](../prd/0002-week-3-cards-and-substrate.md) — week 3 implementation
