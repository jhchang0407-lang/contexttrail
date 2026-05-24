# PRD-0009: Week 6 bootstrap, inbox, and triage

> Source-of-truth canonical doc. Mirrored to issue tracker as the project's ninth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Predecessors: [PRD-0008](0008-week-5-structural-assembly-basics.md), [PRD-0007](0007-week-9-setup-initialization-and-confidence.md). Related ADRs: [ADR-0002](../adr/0002-card-provenance-from-day-one.md), [ADR-0004](../adr/0004-bar-2-scope-with-embeddings-and-bootstrap.md), [ADR-0006](../adr/0006-authority-as-trust-freshness-as-verification.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0018](../adr/0018-inbox-backed-by-local-files-ui-through-agent-surface.md).
>
> **Sequencing rule:** this PRD follows week-5 structural assembly groundwork. It closes the cold-start gap without weakening the authority boundary or pretending that candidate context is accepted truth.

## Implementation status

Implemented as of `2026-05-07`.

The shipped week-6 surface now includes:

- explicit `contexttrail card bootstrap`
- bootstrap proposal generation from imported canonical Doc Chunks
- local inbox persistence under `.contexttrail/inbox/`
- mixed inbox review types:
  - candidate cards
  - clarification needs
- CLI inbox actions for list, show, accept, and answer
- clarification answers that can rewrite multiple pending candidates
- accepted cards written into the normal cards surface with:
  - `authority: accepted`
  - `provenance: system_derived`
  - `authored_by: contexttrail-bootstrap`
- per-card review trace sidecars under `.contexttrail/review-trace/`

Still intentionally out of scope for this PRD's shipped slice:

- `evidence` candidate generation
- bootstrap from code/tests/schemas/conversations/current diff
- automatic authority promotion
- setup-wide clustering or confidence computation

## Problem Statement

ContextTrail now has a strong deterministic retrieval engine, live structural assembly for a narrow anchored slice, and a solid cards model for accepted repo truth. That is real progress, but it still leaves the cold-start adoption problem unresolved:

> When a new repo has imported docs but few or no accepted cards, how does ContextTrail get from "empty cards surface" to "useful Context Pack" without forcing the user to author everything from scratch?

Today the user can:

- import docs
- retrieve doc chunks
- manually author cards

That works for a committed maintainer, but it is still too much ceremony for the first useful loop. A stranger installing ContextTrail should not need to understand every file, author every rule manually, or answer a giant queue of narrow questions before the product becomes helpful.

At the same time, week 6 must not solve this by weakening the truth model. ContextTrail cannot let AI suggestions become accepted automatically, cannot flood the user with low-confidence guesses, and cannot turn triage into dozens of micro-approvals. The problem to solve now is narrower:

- bootstrap candidate cards from imported docs
- route them through a readable local inbox
- present them primarily through the MCP / agent UI
- keep candidate context provisional until human triage
- prefer a small number of high-leverage review decisions
- leave room for week-7 measurement and later layering such as `evidence`

## Solution

Add a week-6 **bootstrap + inbox + triage** flow that generates candidate cards from imported Doc Chunks and lets a human review them through the agent UI while storing them durably on disk.

The workflow is:

1. The repo has imported docs and the week-5 structural assembly baseline already available.
2. The user runs `contexttrail card bootstrap` explicitly.
3. Bootstrap reads imported Doc Chunks and proposes `constraint` and `symbol_note` candidate cards.
4. Candidate review items are written to a readable local `.contexttrail/inbox/` backing store.
5. The primary human review experience happens through the MCP-connected agent or harness UI, with CLI fallback available.
6. Near-duplicate rules merge into one candidate review unit with multiple supporting chunks visible.
7. If bootstrap cannot justify a strong candidate, it emits a clarification need instead of weak candidate garbage.
8. Clarification answers may rewrite multiple pending candidates at once and preserve the causal trail.
9. A human accepts, rejects, or edits candidates.
10. Accepted candidates become normal cards in `.contexttrail/cards/` with `authority: accepted`; candidate provenance remains audit metadata, not a retrieval penalty.

The current implementation delivers the bootstrap, inbox, clarification, and acceptance loop directly on the local filesystem and CLI/agent surfaces. The richer week-9 setup loop remains a later product layer above this substrate.

This first slice stays intentionally narrow:

- imported Doc Chunks only
- `constraint` and `symbol_note` only
- local inbox backing store only
- primary review UX through the agent UI
- candidate-level triage, not link-by-link triage
- clarification needs in the same inbox as a different review type
- durable per-card traceability outside bloated card frontmatter

What this means in practice today:

- week 6 is no longer just "generate candidate cards"
- it is a full review loop:
  - generate candidate cards and clarification needs
  - let one clarification answer reshape several pending candidates
  - accept candidates into normal cards with audit-friendly trace linkage

## User Stories

1. As a new ContextTrail user, I want imported docs to produce useful candidate cards, so that I do not start from an empty cards surface.
2. As a maintainer, I want bootstrap to be explicit rather than folded into import, so that AI work stays opt-in and unsurprising.
3. As a maintainer, I want bootstrap to read imported Doc Chunks first, so that the initial cold-start loop builds on existing authoritative text rather than broader speculative sources.
4. As a maintainer, I want candidate cards to stay provisional until I triage them, so that AI suggestions do not silently become accepted truth.
5. As a maintainer, I want accepted cards to land in the normal cards model, so that the long-term substrate stays simple.
6. As a maintainer, I want provenance to record where an accepted card came from, so that I can audit later which accepted cards were bootstrapped.
7. As a maintainer, I want provenance not to weaken normal retrieval once a card is accepted, so that accepted truth behaves consistently regardless of origin.
8. As a maintainer, I want candidate cards stored in a readable local inbox on disk, so that they survive cache or database rebuilds.
9. As a maintainer, I want the inbox to be local-first and gitignored by default, so that provisional AI output does not pollute committed repo truth.
10. As a maintainer, I want the primary review UX to happen through the MCP or agent harness UI, so that the review loop feels integrated into normal agent work.
11. As a maintainer, I want CLI fallback for inbox actions, so that the flow still works outside the richer UI surface.
12. As a maintainer, I want candidate review to happen at the card level, so that I do not need to approve every supporting link separately.
13. As a maintainer, I want bootstrap to prefer a small number of high-leverage review decisions, so that the inbox feels like real leverage rather than generated homework.
14. As a maintainer, I want candidate wording to stay general enough to answer from domain understanding, so that I do not need perfect symbol-by-symbol recall.
15. As a maintainer, I want the inbox to merge near-duplicate rules, so that multiple chunks expressing the same rule do not create duplicate review work.
16. As a maintainer, I want merged candidates to still show multiple supporting chunks, so that fewer decisions do not come at the cost of hidden evidence.
17. As a maintainer, I want bootstrap to choose one canonical wording for a rule, so that wording variants do not multiply the inbox.
18. As a maintainer, I want bootstrap to avoid emitting weak guesses just to avoid silence, so that low-confidence context does not damage trust.
19. As a maintainer, I want low-confidence cases to turn into clarification needs, so that one answer can improve multiple downstream candidates.
20. As a maintainer, I want candidate cards and clarification needs to live in the same inbox, so that I have one review workflow instead of fragmented queues.
21. As a maintainer, I want different review types clearly marked, so that "accept this candidate" and "answer this clarification" are distinct actions.
22. As a maintainer, I want clarification needs to prefer constrained choices, so that the system can propagate answers cleanly across multiple candidates.
23. As a maintainer, I want a custom free-text escape hatch in app and terminal flows, so that suggested choices do not trap me when the real answer differs.
24. As a maintainer, I want clarification answers to rewrite affected candidates automatically, so that I do not need to manually restitch the inbox after each answer.
25. As a maintainer, I want rewritten candidates to preserve the causal trail from the clarification that changed them, so that later audits remain intelligible.
26. As a maintainer, I want clarification answers to be workflow trace rather than durable repo truth by default, so that cards remain the real knowledge objects.
27. As a maintainer, I want accepted cards to stay readable and not become workflow logs, so that the cards surface remains usable over time.
28. As a maintainer, I want per-card traceability outside the card body, so that I can still answer why a card exists and how it became accepted.
29. As a maintainer, I want traceability to preserve the full material path, so that later clarifications and rewrites are not lost behind the original bootstrap candidate.
30. As a maintainer, I want week 6 to leave a workable seam for distinguishing material rewrites from cosmetic edits, so that week 7 can layer deeper systems without needing a perfect algorithm first.
31. As a maintainer, I want clarifications to be able to shape future `evidence` work conceptually, so that week 7 can build on this flow without rewriting it from scratch.
32. As a maintainer, I want the live week-6 implementation to stay focused on `constraint` and `symbol_note`, so that the first bootstrap loop proves one thing well.
33. As a maintainer, I want scope suggestions to stay inside ContextTrail's known scope vocabulary, so that bootstrap does not invent new taxonomy on its own.
34. As a maintainer, I want supporting chunk links to be suggested as part of a candidate review unit, so that accepting the candidate can bring supporting links along without extra micro-approval burden.
35. As a maintainer, I want accepted bootstrap cards to flow into the same retrieval pipeline as hand-authored cards, so that week-7 dogfood can compare real cold-start value instead of a lab-only side path.
36. As a maintainer, I want bootstrap to assume only the proven week-5 structural assembly baseline, so that week-6 value claims do not depend on unresolved broader assembly behavior.
37. As an agent operator, I want a fresh repo to reach a useful Context Pack faster, so that the product feels helpful within minutes rather than after manual card authoring.
38. As an agent operator, I want the review flow to stay inspectable, so that I can understand why a candidate or clarification appeared.
39. As an agent operator, I want the same review history to survive substrate resets, so that setup work does not need to restart from zero after rebuilding the cache.
40. As an evaluator, I want week-6 success measured by accepted candidate quality and time to useful context, so that bootstrap is judged by product value rather than raw extraction count.
41. As an evaluator, I want week-6 tests to prove the candidate and clarification loop externally, so that the system can evolve without tests freezing private helpers.
42. As a future implementer, I want week 6 to define a stable inbox and traceability shape, so that later `evidence`, code/test sources, and audit UX can deepen the product without breaking the trust boundary.

## Implementation Decisions

- Introduce **bootstrap**, **inbox**, **triage**, and **clarification need** as explicit week-6 product concepts, using the glossary language in `CONTEXT.md`.
- Keep bootstrap as an explicit command rather than an implicit side effect of import.
- Keep the first bootstrap source narrow: imported Doc Chunks only.
- Keep the first candidate types narrow: `constraint` and `symbol_note` only.
- Keep `evidence` out of the live week-6 slice while leaving a seam for week-7 layering.
- Store inbox review items as readable local files under a dedicated inbox backing store rather than as database-only state.
- Treat the agent or MCP harness UI as the primary human review surface, with CLI fallback on the same backing store.
- Model the inbox as one queue with multiple review types rather than multiple disconnected queues.
- Make the candidate card the default triage unit, including suggested supporting links as part of that unit.
- Keep supporting links provisional until the human accepts the candidate review unit.
- Merge near-duplicate candidate rules when they express the same underlying rule.
- Preserve multiple supporting chunks on a merged candidate so evidence is visible even when decision count is reduced.
- Emit one canonical wording per candidate rather than multiple phrasings of the same rule.
- Treat low-confidence output as a clarification need rather than as a weak candidate card.
- Prefer constrained clarification answers by default, with a free-text override path.
- Allow one clarification answer to update multiple pending candidates at once.
- Allow the system to rewrite pending candidates automatically after clarification, while preserving the explanation of what changed and why.
- Keep clarification answers as workflow trace rather than durable repo truth by default.
- Keep accepted cards as the durable knowledge objects and avoid turning card frontmatter into workflow logs.
- Preserve provenance and authored-by metadata on cards so bootstrap acceptance has an honest audit surface.
- Keep provenance orthogonal to trust and normal retrieval behavior.
- Keep candidate scope selection inside ContextTrail's existing known scope vocabulary rather than inventing new scope taxonomy.
- Preserve per-card traceability from accepted cards back to the candidate and clarification path that produced or materially changed them.
- Preserve the full material path in trace history, not only the original bootstrap origin.
- Introduce a workable first-pass seam for distinguishing substantive rewrites from cosmetic edits, without blocking week 6 on a perfect algorithm.
- Design the bootstrap and inbox modules as deep modules with small stable interfaces:
  - bootstrap proposal generation
  - inbox item parsing and persistence
  - candidate acceptance into normal cards
  - clarification propagation and trace capture
- Keep retrieval, locking, and structural assembly behavior downstream of accepted cards rather than inventing a separate week-6 retrieval path.

Shipped module shape now matches that intent:

- bootstrap proposal generation is its own seam
- inbox parsing/persistence remains its own seam
- review flow is its own seam
- card materialization is its own seam
- accepted bootstrap cards enter the normal retrieval pipeline rather than a special side path

## Testing Decisions

- Good tests must verify external behavior and contract surfaces, not implementation details.
- The inbox and bootstrap tests should read like product assertions: "accepting a candidate creates a normal accepted card" or "a low-confidence extraction becomes a clarification need," not "helper X called helper Y."
- The deepest new test seams should be:
  - inbox item parsing and validation
  - candidate acceptance into cards
  - clarification item parsing and constrained-answer behavior
  - clarification propagation across multiple pending candidates
  - duplicate candidate merge behavior
  - trace linkage from accepted cards back to review history
  - provenance preservation without retrieval penalty
- The CLI fallback should be tested at the command-behavior seam similarly to the existing card command tests.
- Retrieval-facing tests should confirm that an accepted bootstrap card behaves like any other accepted card in the ranking and locking flow.
- The first-pass material-change seam should be tested only at the level of visible trace behavior, not private diff heuristics.
- Prior art in the codebase includes:
  - card command tests
  - card loader and freshness tests
  - retrieval pack and contract tests
  - MCP schema and presenter tests
  - eval fixture-driven tests that treat behavior as the contract
- Week-6 testing should prefer deep modules with small stable interfaces over shallow helper-focused tests.

## Out of Scope

- `evidence` candidate generation in the live week-6 slice.
- Code, tests, schemas, conversations, or current diff as week-6 bootstrap sources.
- Shared or team-level inbox workflows.
- A database-backed inbox as the primary review system.
- Perfect material-change detection.
- Final end-user audit UX for users who never directly saw the review flow.
- Automatic authority promotion without human triage.
- Candidate cards participating in locked-include by default.
- Broad setup confidence or task readiness work beyond what the week-6 clarification loop needs.
- Broadening week-5 structural assembly behavior beyond the already-proven narrow slice.

## Further Notes

- This PRD is intentionally about the first real cold-start loop, not the forever-definition of setup intelligence.
- Week 6 should prove that ContextTrail can reduce blank-page authoring pressure without weakening the truth boundary.
- The week-6 inbox should stay readable, durable, and inspectable even if the primary human workflow happens in an MCP-connected UI.
- The right measure of success is not raw candidate count. It is whether a fresh repo can reach a useful Context Pack quickly with a small number of high-leverage review decisions.
- Week 7 should build on this loop by measuring cold-start usefulness, accepted candidate quality, and where `evidence` or richer bootstrap sources become necessary.
