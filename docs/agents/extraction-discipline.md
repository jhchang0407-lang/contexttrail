# Extraction Discipline

How agents and humans should approach architecture deepening in this repo after the 2026-05 extraction pass.

This file is intentionally based on executed work, not abstract method guidance. It captures what held up across:

- `THO-87` — card materialization
- `THO-88` — bootstrap proposal generation
- `THO-89` — review flow
- `THO-90` — retrieval result deepening in place

## Core rule

Extract only when moving **real policy** and **real callers** in the same change.

If the first commit would be one of these, do not extract yet:

- an empty module
- a stubbed "future home" file
- a wrapper that only renames existing calls
- an interface shaped around hypothetical future callers

In this repo, a seam earns its keep when deleting it would force meaningful product logic to reappear across multiple callers.

## Choose the move from the starting state

Use this split:

- **Clean code + clear seam to add**: deepen **in place** first
- **Tangled code + already-misplaced concerns**: **extract immediately**

This held up in practice:

- `THO-90` retrieval deepening was an in-place move because the code already worked, the main need was a richer shared internal result, and a broad new layer would have been speculative
- `THO-87`, `THO-88`, and `THO-89` extracted immediately because the code already mixed policy that belonged in deeper seams

## Shape interfaces from current callers only

Design the seam from the real callers that exist today.

Do:

- use the two write paths that actually exist to shape card materialization
- use the current bootstrap generator and current inbox materialization path to shape proposal generation
- use the current CLI review actions to shape review flow

Do not:

- pre-shape an interface for a future caller that has not arrived
- add discriminators or mode flags just because a future workflow might want them
- create a repo-wide layer because one module might eventually need peers

## Keep requests in domain shape

Callers should pass domain-shaped requests. The seam should own storage or wire translation.

This held up in all three extracted seams:

- card materialization callers do not prepare YAML/frontmatter objects
- bootstrap generation returns proposal-stage drafts, not inbox-shaped files
- review flow owns review-trace sidecar shaping rather than leaking file structure upward

Good signs:

- callers do not import YAML/frontmatter helpers
- callers do not sort arrays "because the file expects it"
- callers do not construct ids, timestamps, or wire-only bookkeeping that the seam will just rewrite

Bad signs:

- callers pass raw disk-shaped payloads
- the seam just stringifies an object with no real translation work
- behavior differences are controlled by sentinel flags like `mode` or `isTemplate`

### Read-side and write-side shapes are not the same

For write-side seams, the request type matches the **on-disk format**. For read-side returns, the type may include **loader-attached enrichments** that are not part of the disk format. They are different types even when they share most fields.

Example from the 2026-05 pass: `MaterializedWriteRequest.scope` initially used `ChunkScope`, the loader-side type. `ChunkScope` carries a `source` field (`{ frontmatter: true }`) that the loader attaches on read but that does not exist in card YAML on disk. Passing it to a write seam silently smuggled loader metadata into the frontmatter the writer would emit.

The fix was to make the write-side type narrower: `Omit<ChunkScope, "source">`. Same shape on the wire, honest about what belongs on disk.

Rule of thumb:

- write-side request types match the on-disk format
- read-side return types may add loader-synthesized fields the on-disk format does not store
- the same name across both sides is suspicious — verify the fields actually align with each role

## Prefer small seams with deep policy

The goal is not "more modules." The goal is to concentrate the load-bearing policy behind a smaller interface.

The four validated examples:

### `THO-87` Card materialization

What moved:

- next card id / path policy
- file writing for scaffold vs materialized card shape

Why it worked:

- two real callers already duplicated the write-side rules
- the seam stayed small: `nextCardIdentity(...)` and `writeCardFile(...)`
- differences lived in request content, not mode switches

### `THO-88` Bootstrap proposal generation

What moved:

- sentence splitting
- candidate classification
- per-collection dedupe
- canonical wording
- summary accounting

What did not move:

- ids
- timestamps
- inbox persistence defaults

Why it worked:

- generation and materialization were already different jobs
- generation kept two collections because that matched the real policy
- the inbox union still begins at persistence, where it earns its keep

### `THO-89` Review flow

What moved:

- clarification answering
- candidate acceptance
- trace-history interpretation
- review-trace sidecar writing

Why it worked:

- two public operations shared one real state machine
- inbox persistence remained direct CRUD, so no extra adapter was needed
- the seam stayed unified because divergence was at the tail, not the core

### `THO-90` Retrieval result deepening

What moved:

- a richer internal retrieval view/result shared by CLI and MCP

What did not move:

- no broad new application layer
- no repo-wide adapter framework

Why it worked:

- the need was a richer shared internal result, not new topology
- the internal view was made strictly richer than the MCP wire shape
- CLI and MCP both adapted from it without forcing a larger structural split

## Tests should sit at the highest stable interface

The extraction pass held up because each seam was locked by behavior tests at the public surface.

Pattern that worked:

- add one failing test around the seam's observable behavior
- move the minimum policy to make it pass
- keep existing caller-level tests green
- only then widen to the full suite

Examples:

- `src/cards/materialize.test.ts`
- `src/bootstrap/proposals.test.ts`
- `src/review/flow.test.ts`
- `src/retrieve/view.test.ts`

Caller-level regression tests stayed important:

- `src/cli/inbox-cmds.test.ts`
- `src/cli/card-bootstrap.test.ts`
- `src/mcp/presenter.test.ts`
- `src/cli/context.test.ts`

### Add an E2E flow test when multiple extractions integrate

Per-seam tests prove each seam works in isolation. Caller-level regression tests prove each caller still works. Neither catches integration bugs that surface only when the extracted seams compose together as a flow.

When a single product loop walks through multiple extracted seams, add an E2E test that exercises them as one connected scenario. The 2026-05 pass added `src/cli/week-6-e2e.test.ts` for exactly this reason: bootstrap → review → materialize → retrieve is one product flow, and only an end-to-end test surfaces schema drift between seams or trace metadata that survives one transform but breaks under the next.

Pattern that worked:

- one fixture corpus
- one walk through the full flow
- assertions on observable outputs at each transition (inbox state, card on disk, sidecar contents, retrieval response)
- not a substitute for per-seam tests; an additional layer above them

Add the E2E test once, after the seams are individually green. Skip if there is only one extraction in the pass — the integration cost has not been earned yet.

## When not to extract yet

Do not extract when the consumer is still hypothetical.

This is why two adjacent ideas were deferred during the same pass:

- clustering
- confidence computation

They were clearly important, but neither had a real pre-week-9 consumer. Extracting them would have created future-home files rather than real seams.

## Revisit triggers

A seam that is right today can still be wrong later. Revisit when one of these appears:

- shared helpers start accumulating per-operation conditionals
- callers begin passing sentinel flags or null-heavy "skip this part" values
- a seam grows a second materially different caller that does not fit the current interface honestly
- a supposedly "in-place" deepening starts forcing duplicated adapter logic again

## Working summary

Use this checklist before extracting:

- Is there real misplaced policy here, or only naming discomfort?
- Are there real callers to shape the interface from?
- Can I move real policy and real callers in the same change?
- Will callers hand the seam domain data rather than disk/wire-shaped payloads?
- Is the resulting interface smaller and deeper, or just more layered?

If the answer to any of those is "no", stay in place and keep looking.
