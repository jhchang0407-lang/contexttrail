# ADR-0008: Card-to-chunk linking is author-declared with inline suggestions

**Status:** Accepted
**Date:** 2026-05-06

## Context

Cards (week 3) link to Doc Chunks via the `links` table. Each link pins the chunk's `version_id` at creation time so the indexer can detect when a linked chunk has changed and flip the card's `freshness_state` to `needs_review` (D41, ADR-0006). The link table is therefore the substrate for the entire freshness signal.

The grilling session on 2026-05-06 had to pick how links come to exist. Three real options surfaced:

1. **Author-declared only** — links exist when the author says so (frontmatter / `contexttrail card link` / `contexttrail card unlink`).
2. **Auto-derived only** — the indexer computes links from anchor and scope overlap, no author input.
3. **Both** — author declares; indexer also auto-derives; the union is the link set.

The choice cuts deeper than UX. It determines whether the freshness signal is high-precision or noisy, and whether the cold-start authoring loop feels effortless or pedantic.

## Decision

**Links are always author-declared. The system never invents links.**

To prevent this from feeling like homework, `contexttrail card add` runs an in-process search at save time and surfaces up to N candidate chunks (ranked by anchor overlap then scope_match) for one-keystroke selection. The selected chunks are written as `linked_chunks:` frontmatter with their pinned `version_pin`s. Authors may also edit the frontmatter directly or use `contexttrail card link` / `contexttrail card unlink` outside the add flow.

**No card type is gated on link presence.** Evidence cards with zero links save successfully and surface an `unlinked` cue in `contexttrail card list` and `contexttrail card show` so the author can revisit later.

## Considered alternatives

- **Auto-derived only.** Rejected because every card would silently link to dozens of tangentially-related chunks (anchor overlap is high-recall, low-precision). When any of those chunks rotated `version_id`, the card would flip `needs_review` for reasons unrelated to its actual claim. The freshness signal becomes noise within a week of corpus drift, and the `needs_review` UX becomes a wall of false alarms that authors learn to ignore.
- **Both (declared + auto-derived).** Rejected because it inherits the noise problem from "auto-derived only" and adds confusion about which links are "real." A two-source link table also means two places `needs_review` materialization has to be reasoned about — the seam is a bug factory.
- **Author-declared with hard save gate on evidence cards.** Rejected because it punishes the natural authoring rhythm (write a batch of cards in one pass; link in a follow-up pass). The `unlinked` cue surfaces the gap without blocking the save loop.

## Consequences

### Positive

- The `freshness_state` signal stays precise. A card's `needs_review` flip means a chunk *the author chose to attach as evidence* changed — that is the signal authors actually want.
- Inline suggestions keep cold-start ergonomic: the chunks the author *just read while writing the card* are the chunks they want to link, surfaced as one-keypress choices.
- The `links` table semantics are simple: every row was put there by a human (or by the helper at the human's explicit invocation). No hidden generation path.

### Negative

- A card whose body cites a chunk implicitly (via anchor overlap) but never declares the link will not flip `needs_review` when that chunk changes. The author has to either declare the link explicitly or accept the tradeoff. We accept this in v1.
- Authors who never re-engage with the suggest UI may end up with sparse linking. The `unlinked` cue is the safety valve, but it's an indicator, not enforcement.

### Anti-patterns this ADR exists to block

- "Auto-link by anchor overlap and rely on the author to delete bad links." Inverts the work in the wrong direction; the author has to audit O(N) silent links instead of approve O(K) explicit ones.
- "Require evidence cards to have at least one link before save." Blocks the natural batch-then-link authoring rhythm. The `unlinked` cue surfaces the gap without gating.
- "Add a separate `auto_links` table alongside `links` to keep declared links precise but still enable auto-derivation." Two link tables means two computation paths for `needs_review`; pick one source of truth.
- "Compute the suggestion list in a background daemon and write to the card." That *is* auto-derivation under a different name. Suggestions must be ephemeral and presented for explicit accept.

## References

- [DESIGN.md D40](../DESIGN.md) — full decision and authoring UX
- [DESIGN.md D41](../DESIGN.md) — how `links` powers `freshness_state` materialization
- [ADR-0006](0006-authority-as-trust-freshness-as-verification.md) — authority/freshness orthogonality
- [SCHEMA.md `links` table](../SCHEMA.md) — table shape with pinned `version_id`
- [PRD-0002](../prd/0002-week-3-cards-and-substrate.md) — week 3 implementation plan
- Feedback memory: `feedback_usable_over_correct` — "tool people will actually use, not a correctness demo"
