# PRD-0003: Week 4 — MCP server (read-only)

> Source-of-truth canonical doc. Mirrored to issue tracker as the project's third PRD issue. Slices into independently-grabbable issues via `/to-issues`.
>
> Spec references throughout: `D{n}` = entry in [`docs/DESIGN.md`](../DESIGN.md); `ADR-NNNN` = [`docs/adr/`](../adr/). Glossary: [`docs/CONTEXT.md`](../CONTEXT.md). Predecessor: [PRD-0002](0002-week-3-cards-and-substrate.md).
>
> **No schedule pressure.** Phase boundaries are checkpoints, not deadlines (see Further Notes → Checkpoint discipline).
>
> **Contract revision (2026-05-06):** `rendered_text` is now opt-in via `include_rendered_text: true` (see [ADR-0012](../adr/0012-retrieve-context-pack-rendered-text-opt-in.md)). `omitted` is now a bounded summary object `{ total, by_reason, top, truncated }` rather than an unbounded entry array (see [ADR-0013](../adr/0013-retrieve-context-pack-omitted-becomes-summary.md)). [PRD-0004](0004-mcp-payload-size.md) is the umbrella. The "structural equivalence" requirement still holds; `rendered_text == CLI text` is now conditional on opt-in, and MCP `omitted` is a summary view of the CLI's full omitted list (total matches; top is a subset).

## Problem Statement

Weeks 1–3 deliver a working CLI. The user can build a Context Pack via `contexttrail context` and read it on the terminal. But the *consumer* of the Pack — an AI coding agent like Claude Code or Cursor — never invokes the CLI directly. Agents communicate through the Model Context Protocol (MCP). Until ContextTrail speaks MCP, every retrieval is a copy-paste loop: human runs `contexttrail context`, copies the rendered text, pastes it into the agent's context window. That defeats the entire automation premise.

Week 4 closes the loop by exposing ContextTrail as an MCP server. Agents call `retrieve_context_pack` natively; the result lands in their context with full structure (locked Cards, ranked chunks, omissions, warnings, budget metadata) so the agent can reason about *what* it received, not just paste it blind.

The shape of the MCP response is the contract that downstream agents will depend on. Picking it wrong means either (a) agents only ever paste the rendered text and never use the structure, defeating the purpose of MCP, or (b) the structure is so unstable that every agent reimplements its own renderer and the visible output fragments. Both failure modes erode trust and adoption.

## Solution

Week 4 ships an MCP server with four read-only tools, a stable structured response contract, and explicit error semantics for the common edge cases (no matches, no sources, locked-only, locked-overflow). Three checkpoints structure the work:

- **4a — MCP scaffolding and tool surface.** Server boots, registers four tools, responds to `tools/list` with valid JSONSchema for each. Tools are stubs that return well-formed empty responses. No retrieval logic wired yet.
- **4b — Wired retrieval, contract finalized.** `retrieve_context_pack` calls into the week-3 retrieval pipeline. Structured response matches the locked contract. `get_doc_chunk`, `get_card`, `list_context_sources` are wired. After this checkpoint the contract is locked; no further shape changes.
- **4c — Robustness and integration.** Error semantics tested for every edge case. Cold-install E2E extended with an MCP scenario. Documentation describes how to wire ContextTrail into Claude Code / Cursor.

The four tools:

1. **`retrieve_context_pack`** — the primary surface. Takes a retrieval request (`task`, `files`, `symbols`, `budget`, `explain`) and returns a structured Context Pack. Callers may opt into a `rendered_text` convenience field with `include_rendered_text: true`.
2. **`get_doc_chunk`** — full body and metadata for a single chunk by `version_id` or `stable_key`.
3. **`get_card`** — full body, frontmatter, and link state for a single Card by `id`.
4. **`list_context_sources`** — enumerate imported sources with chunk counts, last index time, scope summary.

Three contract pillars:

- **Bodies are inline.** Every locked / ranked entry carries its full `body`. Agents do not need to follow up with `get_doc_chunk` for the universal "give me everything in the pack" case.
- **`omitted` is part of the response, not optional.** Agents need to know what *almost* made it; that is how they decide whether to ask for a larger budget. Post-dogfood, this stays true via a bounded summary object rather than an unbounded entry list.
- **No-matches is a valid result, not an error.** Empty arrays + structured warning kinds (`no_matches`, `no_sources`). Agents do not have to wrap retrieval in try/catch.

## User Stories

### MCP scaffolding and discovery

1. As an agent operator, I want `contexttrail mcp` to start an MCP server over stdio so I can wire it into Claude Code via a subprocess command.
2. As an agent integrating with ContextTrail for the first time, I want `tools/list` to return four tools (`retrieve_context_pack`, `get_doc_chunk`, `get_card`, `list_context_sources`) with valid JSONSchema input/output schemas so I can introspect the surface programmatically.
3. As an agent, I want each tool's input and output validated by `@modelcontextprotocol/sdk` against the published JSONSchema so malformed calls fail fast with structured errors.
4. As a ContextTrail maintainer, I want a single source-of-truth schema (zod) for tool inputs and outputs that mirrors to JSONSchema for MCP and to TypeScript for the implementation, so the contract can't drift between layers.

### `retrieve_context_pack` — the primary surface

5. As an agent given a coding task, I want to call `retrieve_context_pack` with `{ task, files, symbols, budget, explain }` and receive a structured Pack so I can reason about what's locked, what's ranked, and what was omitted.
6. As an agent that just wants context to paste, I want to be able to opt into `rendered_text` matching the CLI's text output so I can use it without parsing the structure.
7. As an agent that wants to introspect, I want every locked Card and every ranked entry to carry its full `body` inline so I don't have to make a follow-up `get_doc_chunk` call for the common case.
8. As an agent receiving locked Cards, I want each one to carry `lock_reason` (`constraint_scope_match` or `symbol_note_exact`) and a `broad_scope` flag (true when locked via `company:`-scope match) so I can audit why a Card fired.
9. As an agent receiving locked Cards, I want each one's `freshness_state` and `freshness_warnings` array surfaced so I can detect stale-but-still-locked content per [ADR-0006](../adr/0006-authority-as-trust-freshness-as-verification.md).
10. As an agent receiving ranked entries, I want each to carry `kind` (`chunk` or `card`), `score`, `tokens`, `scope`, `contexttrail`, and a `type_bias_applied` flag so I can introspect the ranker's contributions per D42.
11. As an agent that hits a budget ceiling, I want the response's `omitted` summary to surface the full omitted count, a reason histogram, and a bounded top-N sample so I can decide whether to call again with a larger budget without paying payload cost proportional to corpus size.
12. As an agent, I want the response's `budget` block to surface `requested`, `used`, and `locked_overhead` so I know exactly how much context window the Pack consumed (D37, [ADR-0010](../adr/0010-locked-include-overflow-policy.md)).
13. As an agent, I want `explain: true` in the request to populate an `explain` block in the response with per-chunk score decomposition; otherwise the field is absent so the wire stays small.
14. As an agent that requests a no-matches result, I want empty `locked` / `ranked` arrays + populated `omitted` summary + `warnings: [{ kind: "no_matches", message, hint }]` — NOT an error — so I can surface "no relevant context" to the user without try/catch.
15. As an agent in a repo with no imported docs, I want `warnings: [{ kind: "no_sources", hint: "run contexttrail import docs <glob>" }]` so I can tell the user how to fix the configuration.
16. As an agent receiving a Pack that fits within budget but consists entirely of locked Cards (no docs above threshold), I want the locked Cards to still be returned with a structured warning — locked-include is a hard guarantee independent of doc availability.
17. As an agent in a locked-overflow scenario, I want `warnings: [{ kind: "locked_overflow", message }]` plus `budget.locked_overhead > budget.requested` plus all locked Cards in the response, so I can tell the user the requested budget was exceeded by authored content.

### `get_doc_chunk`, `get_card`, `list_context_sources`

18. As an agent that received a chunk in a Pack and wants more context around a specific one, I want to call `get_doc_chunk` with its `version_id` (or `stable_key`) and receive the full body + scope + code anchors + freshness so I don't reload the entire Pack.
19. As an agent, I want `get_doc_chunk` to round-trip: the body returned by this tool is byte-identical to the body that appeared in `retrieve_context_pack`'s response.
20. As an agent that received a locked Card and wants to know its links, I want `get_card` to return body, frontmatter, `linked_chunks` with their `version_pin`s, `freshness_state`, and `author_review_state`.
21. As an agent introspecting a fresh repo ("what context is even available here?"), I want `list_context_sources` to enumerate every source from `contexttrail import` with chunk counts, scope summary, and last index time.
22. As an agent, I want `list_context_sources` to be cheap (no full retrieval) so I can call it on session-start without burning latency.

### Error semantics and stability

23. As an agent author, I want the response shape to be locked at the end of checkpoint 4b so I can build against a stable contract; any later breaking change requires a new ADR.
24. As an agent in a malformed-request scenario, I want a structured MCP error with a clear validation message so I can fix my call rather than guess.
25. As an agent, I want every warning kind to be enumerated in the JSONSchema (`no_matches`, `no_sources`, `locked_overflow`, etc.) so I can switch on it programmatically rather than parsing strings.
26. As a developer, I want a snapshot test for ≥10 representative MCP responses so the contract can't regress silently.

### Integration with Claude Code

27. As a user wiring ContextTrail into Claude Code, I want documented `claude_desktop_config.json` snippets so I can copy-paste a working MCP server entry.
28. As a user verifying my install works, I want documented expected first-call behavior + troubleshooting (server didn't start, no tools listed, retrieval returned no_sources) so I can self-diagnose.
29. As a user running a real Claude Code session against my repo, I want `retrieve_context_pack` to return a sensible Pack within ≤2 seconds for my repo's size so the agent doesn't stall.

## Implementation Decisions

### Architecture and scope

- **Read-only in v1.** No `propose_card` tool, no write-side surface. Agents contribute hypotheses post-v1 (ADR-0006); v1 stays purely retrieval.
- **stdio transport only.** HTTP / SSE is post-v1. v1's deployment model is "Claude Code subprocess on the user's machine"; remote multi-tenant servers are a different problem we don't have yet.
- **Substrate is the canonical read path.** PRD-0003 reads through `context_objects` + extension tables, NOT the flat schema. This means PRD-0003 cannot start until PRD-0002 checkpoint 3b (substrate migration) is fully accepted.
- **Single source-of-truth tool schemas.** Tool inputs and outputs are defined once in zod and mirrored to JSONSchema for MCP and to TypeScript types for the handler implementations. This avoids contract drift between the wire format and the implementation.
- **No implicit-on-retrieve indexing inside MCP calls.** Indexing remains a CLI/import-time concern. If a session calls `retrieve_context_pack` and the cache is stale, the response surfaces `no_matches` (with a hint) rather than triggering a slow re-index in-band.
- **The contract finalizes at checkpoint 4b.** After 4b, any breaking change to the response shape requires its own ADR. This is the same discipline PRD-0001 applied to `contexttrail context --json`.

### Modules

The deep modules:

- **Tool schema definitions.** zod schemas for every tool input and output, plus a transformation that emits JSONSchema for MCP registration and TypeScript types for the handlers. Surface: `schemas.retrieveContextPack.input`, `.output`, etc. The single source of truth for the wire format. Rarely changes after 4b.
- **`retrieve_context_pack` handler.** Converts MCP input into a retrieval request, invokes the week-3 retrieval pipeline, converts the resulting Pack into the MCP response shape (with bodies inline, structured `omitted`, warning kinds, optional `explain`). Pure transformation given the pipeline as a dependency. Surface: `handle(input, deps) → output`.
- **`get_doc_chunk` handler / `get_card` handler / `list_context_sources` handler.** Thin lookups against the substrate; pure transformations from DB rows to MCP response shapes.
- **MCP response shape contract test.** A test fixture that runs every golden task from PRD-0002 against the MCP server and asserts: structural equivalence with `contexttrail context --json`, bodies inline, `omitted` always present (even when empty), `rendered_text` matching CLI output when explicitly requested. The contract test is the artifact that locks the wire shape.

The shallow modules:

- **MCP server entrypoint.** Wires `@modelcontextprotocol/sdk` to stdio transport, registers tool handlers. Thin orchestration.
- **`contexttrail mcp` CLI command.** Starts the server. Documented in README.
- **Tool registration glue.** Maps zod schemas → JSONSchema → MCP tool registrations.
- **Edge-case behavior tests.** No-matches, no-sources, locked-only, locked-overflow — each one is a separate test fixture; together they lock the warning-kind taxonomy.

### Response contract for `retrieve_context_pack`

The locked response shape (schema canonical in zod; below for narrative reference):

- `rendered_text?: string` — sectioned markdown matching CLI output (`Locked rules` → `Symbol notes (locked)` → `Relevant docs` → `Evidence` → `Warnings` → `Omitted`) when the request includes `include_rendered_text: true`.
- `locked: Array<{ id, kind: "card", card_type, scope, tokens, body, contexttrail, lock_reason, broad_scope, freshness_state, freshness_warnings }>`.
- `ranked: Array<{ id, kind: "chunk" | "card", scope, tokens, score, body, contexttrail, type_bias_applied }>`.
- `omitted: { total, by_reason, top, truncated }` — present even when empty. `top` carries a bounded sample of omitted entries; `total` and `by_reason` preserve the full omitted picture. `by_reason` behaves like a sparse map on the wire: missing keys imply zero.
- `warnings: Array<{ kind, message, hint? }>` — kinds enumerated in the schema (`no_matches`, `no_sources`, `locked_overflow`, future kinds added by ADR).
- `budget: { requested, used, locked_overhead }`.
- `explain?: { per_chunk: [...] }` — only when `explain: true` in the request.

Two new DESIGN entries land during checkpoint 4b as the canonical record of the contract:

- [`D-week4-1`](../DESIGN.md#d-week4-1-retrieve_context_pack-mcp-response-shape) — `retrieve_context_pack` response shape (structured primary, opt-in `rendered_text`, bodies inline, `omitted` always present in summary form, `explain` optional). ✅ Locked.
- [`D-week4-2`](../DESIGN.md#d-week4-2-mcp-no-matches-semantics-valid-result-structured-warnings) — MCP no-matches semantics (valid result, structured warnings, locked Cards still returned when present). ✅ Locked.

These DESIGN entries are deliberately not written before checkpoint 4b — the contract gets locked when the implementation has touched it. After 4b.3, any subsequent change to the response shape requires its own ADR.

### CLI contracts (additive)

- `contexttrail mcp` — starts the MCP server on stdio.

### Glossary discipline

The MCP tool surface uses canonical terms from [`CONTEXT.md`](../CONTEXT.md):

- Carried from PRD-0001 / PRD-0002: `Context Pack`, `Doc Chunk`, `Card`, `code anchor`, `link`, `version_pin`, `scope`, `query anchors`, `locked-include`, `freshness`, `author_review_state`, `locked_overflow`, `broad_scope`.
- Banned in MCP responses: "status," "reference," "stored mention." Same rules as CLI.

## Testing Decisions

Tests are organized in three layers:

1. **Contract tests** assert that every MCP response matches the locked schema. Bodies inline. `omitted` present even when empty. Warning kinds drawn from the enumerated set. The contract test runs every golden task from PRD-0002 against MCP and against `contexttrail context --json`, then asserts structural equivalence (same chunks, same scores, same locked set, identical `rendered_text` when `include_rendered_text: true` is requested).
2. **Edge-case behavior tests** lock the warning-kind taxonomy: a separate test fixture for each of `no_matches`, `no_sources`, `locked_only`, `locked_overflow`. Each asserts the exact response shape and warning content for that case, including the bounded omitted-summary semantics.
3. **End-to-end integration tests** extend PRD-0002's cold-install E2E: after `contexttrail import` and Card authoring, start `contexttrail mcp` in a subprocess, send a `retrieve_context_pack` request via stdio, assert the response structure. Manual dogfood acceptance with a real Claude Code session is the final gate, not an automated test.

What makes a good test in this layer:

- **MCP tests assert wire shape, not handler internals.** Every test sends an MCP request and asserts the JSON response; no test pokes at handler functions directly.
- **Contract equivalence is the load-bearing assertion.** "MCP response is structurally equivalent to `contexttrail context --json` for every golden task, with `rendered_text` identical when explicitly requested" is the single test that prevents most contract drift.
- **Snapshot tests guard the long tail.** ≥10 representative MCP responses are snapshotted; running locally produces zero diffs unless the wire shape genuinely changed.
- **No-matches tests are positive tests.** They assert that a no-matches response is well-formed, NOT that the call throws. The contract is "no matches is a valid result," and the omitted summary still explains what was excluded.

Modules nominally targeted for tests:

- **Tool schema definitions** — exhaustive (every tool's zod schema validates a positive fixture and rejects each malformed-fixture per error path)
- **`retrieve_context_pack` handler** — covered by the contract equivalence test against PRD-0002's golden corpus
- **`get_doc_chunk` / `get_card` / `list_context_sources` handlers** — round-trip integration tests using the cold-install fixture
- **Edge-case behavior** — exhaustive (no_matches, no_sources, locked_only, locked_overflow each get a dedicated test)
- **Snapshot tests** — exhaustive over ≥10 representative golden cases
- **End-to-end** — single cold-install run extending PRD-0002's E2E, asserting the full chain through MCP

Prior art: PRD-0002 establishes the golden-corpus and snapshot-test conventions. PRD-0003 reuses both — the MCP layer's job is to surface PRD-0002's pipeline output without reshaping it.

## Out of Scope

- `propose_card` MCP tool and any other write-side tool — agents are read-only in v1
- HTTP / SSE transport — stdio only in v1; remote servers are post-v1
- Authentication / multi-tenant identity — single-user local server in v1
- Context assembly groundwork (week 5)
- Card bootstrap (week 6)
- Implicit-on-retrieve indexing inside MCP calls — kept as a CLI/import-time concern in v1
- Multi-repo / monorepo cross-context — post-v1
- CI / GitHub PR integration — post-v1
- AST symbol resolution / rename tracking — v1.5+

## Further Notes

### Checkpoint discipline

Three checkpoints. Do not advance past a checkpoint until its acceptance is satisfied.

**Checkpoint 4a — MCP scaffolding. Done when:**

- `contexttrail mcp` starts a server over stdio that responds to `tools/list` with four tools.
- Every tool's input and output schemas are valid JSONSchema and validated by `@modelcontextprotocol/sdk`.
- A test client can invoke each stub tool and receive a well-formed empty response.

**Checkpoint 4b — Wired retrieval. Done when:**

- For every golden task in PRD-0002's expanded corpus, `retrieve_context_pack` over MCP returns the same logical Pack as `contexttrail context --json` on the CLI. Structural equivalence is asserted; `rendered_text` matches CLI output when the request opts into it.
- `get_doc_chunk` round-trips: every chunk surfaced in a Pack can be re-fetched by `version_id` and is byte-identical.
- `get_card` round-trips: every Card surfaced in a Pack can be re-fetched by id; `linked_chunks`, `freshness_state`, `author_review_state` all present.
- `list_context_sources` returns every source from `contexttrail import` with correct chunk counts.
- The response contract is locked. `D-week4-1` and `D-week4-2` are written into [DESIGN.md](../DESIGN.md). Any subsequent change to the response shape requires a new ADR.

**Checkpoint 4c — Error semantics and integration. Done when:**

- The four edge-case behavior tests (`no_matches`, `no_sources`, `locked_only`, `locked_overflow`) pass byte-identically across runs.
- Cold-install E2E runs `contexttrail init` → `contexttrail import` → `contexttrail card add` → start `contexttrail mcp` → MCP retrieve → assert structure, all in <60 seconds.
- A real Claude Code session, configured per the documented setup, makes a `retrieve_context_pack` call against ContextTrail's own docs and receives a sensible Pack. (Manual dogfood acceptance, not automated.)
- Snapshot tests cover ≥10 representative MCP responses; running them locally produces zero diffs.

### Dependencies

- [PRD-0002](0002-week-3-cards-and-substrate.md) must be fully accepted, including the substrate migration (4b reads through `context_objects` + extension tables).
- D37–D42 implemented (locked semantics and bias must be wired before MCP exposes them).
- New DESIGN entries to write during 4b: `D-week4-1` (response shape) and `D-week4-2` (no-matches semantics).
- Memories: `feedback_usable_over_correct` (favor low-friction over correctness-demo); `contexttrail_project` (no schedule pressure; checkpoint discipline).

### How this PRD lands in code

After the PRD is accepted, `/to-issues` slices it into independently-grabbable tickets. Expected slicing:

- ~5 tickets for checkpoint 4a (MCP server entrypoint, `contexttrail mcp` CLI, tool schemas, tool registration, stub handlers)
- ~6 tickets for checkpoint 4b (`retrieve_context_pack` handler, `get_doc_chunk` handler, `get_card` handler, `list_context_sources` handler, contract equivalence test, `D-week4-1` + `D-week4-2`)
- ~7 tickets for checkpoint 4c (no_matches test, no_sources test, locked_only test, locked_overflow test, cold-install MCP E2E, Claude Code wiring docs, snapshot tests)

### What "done" looks like

When this PRD is fully implemented:

- A user adds `{"command": "contexttrail", "args": ["mcp"]}` to their `claude_desktop_config.json`, restarts Claude Code, and sees ContextTrail's four tools listed in the MCP panel.
- The user gives Claude Code a coding task; the agent calls `retrieve_context_pack` natively; the response carries locked Cards as a hard guarantee plus ranked chunks; the agent primarily uses the structured fields and can opt into `rendered_text` when it specifically wants a ready-made dump.
- The user runs the snapshot tests locally; zero diffs.
- The user can swap any other MCP-aware agent (Cursor, Codex) by following the same documented setup — the contract is universal.

Week 5 (context assembly groundwork) is unblocked.

### Triage label and routing

This PRD will be published with the `needs-triage` label per the project's `/to-prd` skill convention once the issue tracker is configured. After triage acceptance, the label flips to `Feature` and `/to-issues` slices the PRD into tickets.

## Outcome

**Status (2026-05-06):** All three checkpoints shipped. Six Linear issues (THO-38 through THO-43) closed in dependency order across six commits. Post-dogfood payload-reduction work surfaced as a follow-up PRD ([PRD-0004](0004-mcp-payload-size.md)) and landed two contract revisions on top of the locked v1 contract.

**Tickets closed:**

| Checkpoint | Linear | Commit | What landed |
|---|---|---|---|
| 4a — Scaffolding | [THO-38](https://linear.app/thomaschang/issue/THO-38) | `15e48d8` | `contexttrail mcp` over stdio; four tool stubs; zod → JSONSchema → TypeScript single-source contract |
| 4b.1 — `retrieve_context_pack` wired | [THO-39](https://linear.app/thomaschang/issue/THO-39) | `aa292f5` | Pure transform `toMcpResponse(query, result, opts)` from RetrievalResult → wire shape; contract equivalence test against PRD-0002 golden corpus |
| 4b.2 — Lookup tools | [THO-40](https://linear.app/thomaschang/issue/THO-40) | `e13a504` | `get_doc_chunk` / `get_card` / `list_context_sources`; round-trip property asserted |
| 4b.3 — Contract locked | [THO-41](https://linear.app/thomaschang/issue/THO-41) | `6da50d2` | `D-week4-1` (response shape) + `D-week4-2` (no-matches semantics) written into DESIGN.md |
| 4c.1 — Warning taxonomy | [THO-42](https://linear.app/thomaschang/issue/THO-42) | `8babe7e` | Four edge-case fixtures (`no_sources`, `no_matches`, `locked_only`, `locked_overflow`) + 12 representative snapshots |
| 4c.2 — Cold-install E2E + wiring docs | [THO-43](https://linear.app/thomaschang/issue/THO-43) | `4394a7a` | StdioClientTransport spawn of real `contexttrail mcp`; full handshake; README documents Claude Code / Desktop / Cursor / Codex / Continue / Cline / Zed wiring |

**Measured impact:**

- **Test count:** 211 (pre-week-4) → ~250+ at end of 4c (every checkpoint added behavior tests + snapshots; no regressions in week-2 or week-3 acceptance suite).
- **Cold-install MCP E2E:** ~1.5s on the fixture corpus, well under the 60s budget.
- **`list_context_sources`:** asserted under 50ms (no retrieval pipeline invocation).
- **Contract equivalence:** every golden task from PRD-0002 returns structurally-identical Packs via MCP and `contexttrail context --json` (same locked set, same ranked, same omitted, byte-identical `rendered_text` when opted-in). This is the artifact preventing silent contract drift.

**Contract revisions landed (post-dogfood):**

The v1 contract was locked at end of 4b. Subsequent dogfood found that even with `budget: "small"`, total wire payload could exceed 200kB because `rendered_text` duplicated included content and `omitted` serialized hundreds of below-threshold candidates. PRD-0004 spun out as the post-dogfood stabilization umbrella. Two ADRs revised the contract:

- [ADR-0012](../adr/0012-retrieve-context-pack-rendered-text-opt-in.md) — `rendered_text` is opt-in via `include_rendered_text: true` (default false). Halves payload for the common case.
- [ADR-0013](../adr/0013-retrieve-context-pack-omitted-becomes-summary.md) — `omitted` becomes a bounded summary `{ total, by_reason, top, truncated }` rather than an unbounded entry array. Caps payload growth as corpora scale.

Combined effect on the dogfood query: **−80% on default budget, −85% on small budget** (full table in [PRD-0004 Outcome](0004-mcp-payload-size.md#outcome)). The structural equivalence test from 4b still passes; `rendered_text == CLI text` is now conditional on opt-in, and MCP `omitted` is a summary view of the CLI's full omitted list.

**Bug surfaced *during* the work, fix landed in-slice:**

- `no_matches` detection caught the pipeline's "zero-signal safety net" case (`pack.ts ~L115`) — when every candidate scored below `min_final_score` and the pipeline filled `ranked` anyway, the wire flips to `no_matches` and shifts those entries to `omitted` with reason `below_threshold`. Agents get a clean signal even though the renderer is showing best-effort text. Fixed in [`8babe7e`](https://github.com/) / [`src/mcp/transform.ts`](../../src/mcp/transform.ts).

**Architecture review (post-week-3, pre-week-4):**

The architecture-review pass before week 4 (`8f99870`) deepened three modules (scope codec, Card discriminated union, freshness keeper) — captured in PRD-0002's Outcome. Those refactors made `transform.ts`'s mapping cleaner: discriminated `PackedTrace` removed several non-null assertions in the wire transform.

**Deferred / known follow-ups:**

- **`get_card` returns frontmatter re-parsed from the markdown source** rather than a derived view. Authors see their own front-matter exactly as written. If a derived view (computed `freshness_label`, contexttrails) becomes useful for agent ergonomics, add a separate `get_card_view` tool rather than mutating `get_card`'s contract.
- **Manual Claude Code dogfood remains a manual gate.** The cold-install MCP E2E exercises the full handshake against `InMemoryTransport` and `StdioClientTransport`, but the "real Claude Code session against ContextTrail's own docs" gate from the acceptance criteria is operator-driven, not automated. PRD-0004 dogfood satisfied this for one query; broader coverage waits for week 7's measurement protocol.
- **`rendered_text` may evolve** as a derived view rather than a literal mirror of CLI text once compression schemes are explored. ADR-0012 deliberately scoped the v1 revision to "opt-in" without committing to any further shape changes.

**Out-of-scope observations surfaced during the work:**

- **Locked-include matching potentially under-firing on real-corpus dogfood.** PRD-0004's eval-prep noted only 2 of 15 cards locked on the refund/idempotency dogfood query — specifically C002 (refund idempotency constraint) did not auto-lock when arguably it should. May be a matching-rule bug under [ADR-0011](../adr/0011-locked-include-matching-rules.md), or correct behavior with a too-narrow scope tag — not investigated. Flagged for retrieval correctness work in [PRD-0005](0005-retrieval-correctness-and-observability.md).
- **MCP `error` mapping is consistent but minimal.** `InvalidParams` is the only structured failure agents see (e.g., from `get_doc_chunk` not-found). Internal pipeline failures still surface as MCP server errors with stack traces. Worth tightening to a finite enum if production telemetry shows agent-confusing failures.
- **Snapshot maintenance cost.** 12 representative MCP snapshots cover the contract's surface; float scores normalized to 4 decimals. Adding a new field to the wire requires regenerating every snapshot — manageable today, but a `--update-snapshots` workflow may be worth standardizing if the snapshot count grows past ~30.
- **No bandwidth measurement on the wire itself.** PRD-0004 measured serialized JSON byte counts. Real MCP transport (stdio JSON-RPC framing) adds protocol overhead. Not measured; assumed negligible at v1 scale. Worth instrumenting once a real production session exposes a latency tail.

PRD-0004 (payload reduction) shipped on top of this PRD's locked contract and is itself accepted. Week 5 (context assembly groundwork) and the retrieval-correctness work in [PRD-0005](0005-retrieval-correctness-and-observability.md) are now unblocked.
