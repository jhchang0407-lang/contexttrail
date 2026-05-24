# ContextTrail — Glossary

Canonical terms used across the project. When a term here conflicts with how something is named in code, this glossary is the source of truth — fix the code or update this file.

Add a term here only when it is meaningful to a domain expert (i.e. the user, an agent operator, a future contributor reasoning about behavior). Implementation-only names live in code, not here.

---

## Core concepts

### drift
The condition of context being potentially out of sync with the code, specs, or behavior it describes. Drift is a *state*, not a verdict — it does not imply the context is wrong, only that something has changed and the alignment has not been re-verified.

### drift detection
Identifying which context objects (Doc Chunks, Context Cards) are likely affected by a code or spec change. Deterministic in v1 (mention links, scope overlap). Extends to git-diff-driven analysis post-v1.

### drift response
The loop where ContextTrail proposes patches to the context graph in response to a detected change, and a human reviews/accepts/rejects them. AI-assisted. Post-v1.

The CLI surface is `drift review` (or MCP equivalent). See ADR-0001 for why drift response is post-v1; ADR-0002 for the schema choice that keeps it forward-compatible.

---

## Setup model

### Wizard-A — deterministic setup
The agent-led but LLM-free onboarding flow. Scans the repo, classifies folders by filesystem heuristics, asks the user multiple-choice questions to resolve scope and import ambiguity, writes `.contexttrail/config.yaml`. Reduces *configuration friction* without generating new truth. Ships in v1.

### Wizard-B — content-reasoning extraction
The LLM-driven flow where AI reads docs/code prose and proposes Context Cards from inferred invariants. Generates new truth. Deferred post-v1 because it changes what "accepted" means in the trust model.

See ADR-0001.

---

## Trust model

### authority
Where a Context Object sits in the trust hierarchy: `accepted > imported > candidate > inferred > deprecated`. Answers: *should this be trusted as source-of-truth?* v1 card values: `accepted | candidate | deprecated`. Doc Chunks default to `imported`. Bootstrap output is `candidate` until triaged.

**Authority is the same concept as the legacy "status" field on cards.** The card frontmatter field is named `authority`, not `status`. *Avoid:* "status" — it overloaded with freshness and is banned from prose.

### provenance
The *origin of the idea* in a Context Object — distinct from authority. Tracks how the content arrived: hand-authored, imported deterministically from a doc, AI-proposed and human-ratified, etc. v1 values: `human_authored`, `imported_from_doc`, `system_derived`. Post-v1 adds `ai_proposed`, `ai_updated`.

Provenance is not a trust level. An accepted card is trusted regardless of provenance. Provenance lets you later ask *which trusted things came from where*.

Provenance does not change normal retrieval or locked-include behavior by itself. In standard retrieval, `authority` drives trust and locking; provenance is audit metadata unless a future explicit audit-oriented mode chooses to surface or filter on it differently.

See ADR-0002.

### authored_by
Free-form string identifying the actor that wrote the card: a user name, an agent name, or `system`. Not a structured identity primitive in v1 — if multi-agent identity matters later, introduce it as a separate field rather than overloading this one.

### lifecycle (Doc Chunk only)
A separate, two-value field on Doc Chunks — `current | tombstoned` — that tracks whether the chunk still exists in its source document. Distinct from **authority** (which doesn't apply to chunks; chunks are always `imported`) and from **freshness** (which applies to cards). Stored as `doc_chunks.status` in v1 SQL for SQL-convention reasons; do not call it "status" in prose.

### freshness
Lifecycle state of a Context Object relative to recent changes: `verified | unverified | needs_review | maybe_affected | potentially_superseded`. Answers: *is this trusted thing still verified against current code?* v1 mechanically marks linked cards as `needs_review` when their linked chunks rotate `version_id`.

**Freshness is orthogonal to authority.** A card can be `authority: accepted, freshness: needs_review` — it stays locked-include eligible (authority unchanged) but a warning surfaces in the Context Pack and the `freshness_weights` multiplier in scoring drops to 0.75. Authority changes only by explicit human action (accept / deprecate / mark candidate). Freshness changes mechanically.

**Freshness is a materialized view over canonical truth.** The `freshness_state` column is normally written by the indexer and MUST be reproducible from `(links.version_pin, current chunk version_ids, tombstones)`. Import may preserve authored `potentially_superseded` as an explicit stale-evidence signal; other freshness writes stay out of authoring paths. Manual author review (`contexttrail card verify`, `contexttrail card mark-needs-review`) lives in a separate `author_review_state` column on `card_ext`. See D41, ADR-0006.

### author_review_state
The manual review state for a Card, stored on `card_ext` and distinct from materialized freshness. Values: `unreviewed | verified | needs_review_manual`. Toggled only by `contexttrail card verify` and `contexttrail card mark-needs-review`. Use this term when talking about the human override; do not overload `freshness_state` for that purpose.

---

## Object model and retrieval

### retrieval pipeline
The staged process that turns a retrieval request into a Context Pack. v1 stages: query parse → eligibility filter → score → pack → render. Use this noun when discussing the pipeline as a whole or any stage boundary.

### Retrieval Engine V2
The source-first retrieval architecture gated by Slice 0 ceiling probes before implementation. Supersedes ADR-0019 for future high-ceiling retrieval work while preserving deterministic-core and locked-include guarantees.

### Retrieval Engine V3
The source-selection/aboutness layer that comes after V2.5 measured high candidate recall and honest abstention but remaining source-scoring losses. V3 chooses which candidate source is actually about the task, preserves required sources through pack/display, and treats `must_include_sources` coverage as distinct from merely showing any acceptable sibling source.

### Slice 0 ceiling probes
The measurement-only first slice of Retrieval Engine V2. It diagnoses pre-pack source recall, oracle rerank ceiling, unsupported separability, synthetic regression safety, and assignment-level coverage without changing production retrieval behavior.

### source-first retrieval
A doc-side retrieval-pipeline shape that identifies the most relevant source files before selecting Doc Chunks from those sources. Use this when distinguishing V2 from v1's chunk-first doc ranking; it does not require every retrieval lane in the pack to share the same unit shape.

### SourceProfile
Rebuildable retrieval index metadata for one imported markdown source. It may influence ranking and verification, but it is not a Context Object and agents do not cite it as authority.

### source card
A V3 retrieval metadata record that represents one candidate source for comparison. It may combine SourceProfile fields, candidate-path evidence, top Doc Chunk evidence, coverage/aboutness signals, and source relationship hints. A source card is not a Context Object and is never cited as authority.

### source selection decision
A V3 decision over top-N source cards that chooses the source or source set most about the task, with structured reasons and margins. It feeds doc chunk packing/display order while preserving locked Card semantics and fail-closed confidence.

### source-scoped chunk selection
The retrieval/assembly step that chooses which Doc Chunks to include once the engine has already selected the relevant source or source set. It answers a different question than source selection: not "which source is about the task?" but "which sections inside that source make the Context Pack sufficient without adding noise?"

Source-scoped chunk selection may choose a primary chunk plus limited structural neighbors such as an intro, parent, sibling, or directly linked chunk when they satisfy a named task need. It should remain grounded, deterministic, and budget-aware.

### critical-source recall
Whether all sources required for a task are present in the candidate or assembled context, regardless of whether the first ranked result is perfect. This is the north-star retrieval metric for context assembly because multiple retrieval misses compound.

### critical-source set
The complete set of sources required for a task to be safely grounded. Distinct from the top-ranking target, which asks which source should be the best first read.

Card correctness is measured separately from critical-source recall unless a fixture explicitly declares a Card as a critical Context Object. This keeps authored operational knowledge from hiding doc retrieval failures.

### honest abstention
The engine explicitly reports that context is partial, unsupported, or needs stronger anchors instead of returning a confident wrong Context Pack. This is paired with critical-source recall as the Retrieval Engine V2 success condition.

### retrieval request
The structured input to a retrieval pipeline. Shape in v1: `{ task, query_anchors, budget, explain }`, where `task` is free text, `query_anchors` are file paths and symbols, `budget` is `small | default | large`, and `explain` controls whether the pipeline emits a trace. Both `contexttrail context` and `retrieve_context_pack` build a retrieval request before calling the retrieval pipeline.

### retrieval
A single execution of the retrieval pipeline from request to Context Pack. Use this noun for telemetry, caching, freshness checks, and any other "one pull of context" concept. Avoid using it interchangeably with the verb alone when you need to talk about a discrete event.

### freshness check
The pre-assembly pass that detects indexed sources whose on-disk content has drifted since the last `contexttrail import` (PRD-0035). Default behavior is **detect-and-warn**: stale sources emit a `stale_source` warning, deleted-but-still-indexed sources emit `missing_source`, and the Context Pack assembles from cached data anyway so retrieval latency stays predictable. Content-hash comparison (not mtime) so a save-without-change does not warn. Opt-in `CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX=true` reindexes the stale set inline before assembly — accepts unbounded latency in exchange for guaranteed-fresh results. Distinct from the per-Card `freshness_state` materialized view (above): that one is a property of an individual Card across imports; this one is a per-retrieval read-time check that the cache reflects disk.

### pack entry
One item in a Context Pack's `locked`, `ranked`, or `omitted` lists. A pack entry may be an authority-bearing Context Object (Doc Chunk or Card) or a code entry that points the agent at implementation context. Distinct from **Context Object**, which remains the narrower trust-bearing term.

### Context Pack
The bundled, ranked, budget-limited set of pack entries returned for a single retrieval query. Has a token budget, structured fields (`locked` / `ranked` / `omitted` / `warnings` / `budget`), and an optional `explain` trace. The packer selects non-locked context by budget-aware `packing_score`, but rendered / wire `ranked` entries are displayed by relevance so cheap chunks do not masquerade as the best answers. The structured fields are the primary surface; agents may opt into a `rendered_text` field (CLI-style markdown — sections labeled Locked / Relevant docs / Symbol notes / Evidence / Warnings / Omitted) via [ADR-0012](adr/0012-retrieve-context-pack-rendered-text-opt-in.md) when they want pre-rendered prose instead of consuming structure directly.

### context assembly
The act of putting *every doc and file an engineer needs to do real work* into a single Context Pack. Strictly stronger than retrieval (which only asks "did the right doc surface"). Context assembly succeeds only when the foundational chain, the substrate files, and the cross-references are all present in the pack. Measured by the workflow-assembly probe (`src/eval/real-workflow-probe.ts`) on real Linear-ticket-shaped tasks, and by the agent-completion probe (`src/eval/agent-completion-probe.ts`) which grounds the metric in shipped commits — "is the file the engineer actually edited in the pack?".

### assembly lever
A retrieval-time candidate-expansion pass that surfaces docs/files related to the raw retrieval hits. Assembly levers run after direct retrieval has already surfaced the primary winners; they are augmentation, not the primary retrieval unit itself. The levers are **markdown link traversal** (walks `[text](path)` references), **nav-graph traversal** (walks vitepress / mkdocs / docusaurus nav structure with a universal directory-grouping fallback), and **code-import-graph traversal** (forward + reverse edges from TypeScript AST imports). All three feed `assembleContextPackWithLinks` as the engine-native entry point above `retrieve()` + `presentContextPack()`.

### workflow assembly
The metric for context assembly on engineer-shaped queries. Each fixture case carries multiple natural queries plus a hand-authored `required_primary` doc and `required_support` any-of groups. A ticket is "fully served" only when the assembled source set covers every primary doc and satisfies every support group. Measured on the 23-ticket ContextTrail Linear panel (95.7%) and the 15-ticket valibot untuned-generalization panel (93.3%).

### agent-completion source-file coverage
The end-to-end context-assembly metric grounded in shipped engineering work. For each completed Linear ticket, we know the queries an engineer would issue plus the files actually changed in the implementation commit. The metric asks whether the pack points the engineer at the files they actually needed to edit — not merely whether the right doc surfaced. Measured on 14 commit-grounded cases (93.9%).

### code-source index
The peer of `SourceProfile` for code files (PRD-0028). Per-file `CodeSourceFacts` captures structural identity only — paths, exported symbols, signatures, file purpose comment, imports — never code bodies. It is the file-identity layer for code retrieval, not the packed code-body layer. Supports TypeScript / JavaScript via the TypeScript compiler API; Python / Go / Rust via deterministic regex extractors (no native toolchain required). Indexed in a `code_sources_fts` virtual table with principled fixed BM25F weights (`exported_symbols` 2.5, `file_path` 2.5, `file_purpose` 1.2, `exported_signatures` 1.0).

### import graph
The directed graph of "file X imports file Y" relationships captured by the code-source extractor at index time. Used as a file-level structural neighbor surface, not the primary code-identity retrieval unit. Walked at retrieval time by `expandCodeImportsKHops` (forward edges) and `buildImportersResolver` + `resolveImporters` (reverse edges) so substrate files (`db.ts`, `chunks.ts`, etc.) can surface in the pack when the direct winners need bounded structural support.

### persistence substrate
Code files that define or operate the durable storage backing for a retrieval feature. Includes schema/table definitions, database open or migration helpers, persisted record stores, and chunk/source-profile/code-source storage helpers.

Persistence substrate is narrower than generic "storage." Browser/session/cache helpers, passive reports, evals, examples, and CLI runner state are not persistence substrate unless the task explicitly concerns persisted retrieval data. A persistence substrate file may be admitted as implementation support when the primary owner or query is persistence-shaped, even when the query does not name every schema or database file.

Persistence substrate belongs in the support cluster by default. It should compete in the first code slate only when the retrieval request directly anchors it by file, symbol, or specific schema/database/storage wording. Implied persistence should not displace the primary implementation owner.

For persistence-substrate evals, support-cluster lift is the safest near-term acceptance signal, but top-3 usefulness remains the ultimate product goal. Support-only improvements should be treated as stepping stones toward a first useful implementation slate, not as a final success definition.

### support necessity
The retrieval-time judgment that a non-primary code file is needed to safely implement the task, not merely related by tokens or graph proximity. Support necessity consumes family evidence, the primary owner, query anchors, and exclusion rules, then decides whether a file belongs in support, can compete in the first slate, or should stay out.

Support necessity is distinct from family evidence. Family evidence answers "what kind of implementation file is this?" Support necessity answers "does this task need that file now?"

### nav graph
The directed graph of "doc X is in section Y" relationships captured by the per-format nav parsers (vitepress, mkdocs, docusaurus, frontmatter) at import time (PRD-0027). Walked at retrieval time by `expandNavSiblings` so docs in the same section surface together. Falls back to **directory-grouping** when no nav config is present — a hard filesystem fact (two docs in the same directory are siblings), distinct from the structural-inference heuristic that PRD-0023 correctly rejected.

### fact-finding quality
Whether the retrieval pipeline identifies the right authoritative and canonical Context Objects for a task before broader context assembly decisions complicate the picture.

Fact-finding quality asks:

- Did the expected locked Cards lock?
- Did forbidden Cards stay unlocked?
- Did the expected canonical Doc Chunk or Card appear near the top?
- Did distractor objects stay out of the top results?
- Did signal-empty queries honestly report that anchors did not ground?

Fact-finding quality is the next engine-hardening target. It is narrower than full Context Pack quality: it proves ContextTrail can find the right objects with curated substrate, but does not yet prove the final pack gives an agent all surrounding context needed to implement safely.

Fact-finding quality is considered excellent when deterministic and contract gates are perfect, while ambiguous cases are labeled honestly instead of forced into a fake single-answer ranking:

- expected locked Cards present: `100%`
- forbidden locked Cards absent: `100%`
- evidence provenance correct: `100%`
- query mode exactness: `100%`
- signal-empty warning correctness: `100%`
- deterministic expected top source in top-3: `100%`
- forbidden top-3 distractors absent: `100%`
- ambiguous multi-anchor / broad cases documented outside deterministic gates

### Context Pack quality
Whether a Context Pack is sufficient, bounded, authority-aware context for the task. Context Pack quality includes fact-finding quality, then adds assembly concerns: enough surrounding context, not too much irrelevant context, useful ordering, budget behavior, omission summaries, and recovery signals.

Optimize fact-finding quality before Context Pack quality. If ContextTrail cannot reliably identify the right objects, pack assembly tuning will only hide retrieval defects.

Fact-finding work must be reusable substrate for Context Pack quality, not fixture overfitting. A retrieval-engine change should either improve a named fact-finding capability, add reusable eval taxonomy/coverage, or expose diagnostics needed for future context assembly. Avoid ranking hacks that only satisfy the current fixture.

Named fact-finding capabilities:

- **anchor recognition** — determine which query anchors correspond to known code anchors and which are unrecognized
- **scope inference** — derive the task's relevant scope from recognized anchors
- **locked authority retrieval** — lock accepted constraints, symbol_notes, and evidence according to ADR-0011
- **over-lock prevention** — keep sibling, cross-domain, stale, or non-applicable Cards from locking
- **canonical source ranking** — rank the authoritative Doc Chunk or Card near the top for deterministic queries
- **distractor resistance** — keep term-overlapping but non-authoritative docs out of top results
- **signal-empty honesty** — surface ungrounded anchors instead of pretending the retrieval is grounded
- **ambiguity labeling** — mark broad or multi-anchor cases as ambiguous when no single top source is objectively correct
- **explainability** — expose enough trace detail to understand why objects were recognized, locked, ranked, omitted, or filtered

Fact-finding hardening is eval-first. Production retrieval changes are allowed only when a failing or newly added case exposes a named capability defect. Arbitrary weight tweaking, special-case path handling, expectation weakening, setup/readiness features, and context-assembly expansion algorithms are out of scope for fact-finding hardening.

### structural assembly
The narrow first slice of Context Pack quality: starting from the right grounded source object, add the minimum structural neighbors needed for a safe implementation change.

Week 5 structural assembly is intentionally narrower than general context assembly. It focuses on anchored implementation questions and deterministic neighbor classes such as parent section context, selective same-document siblings, and direct linked neighbors. It does not include low-signal recovery, broad-query widening, or semantic neighbor discovery.

Structural assembly is judged by sufficiency and over-expansion together. A pack fails if it stops before the minimal useful structural context, and it also fails if it climbs to later neighbor classes after an earlier class was already sufficient.

### low-signal recovery
The retrieval-and-pack behavior for requests where grounding is weak, missing, or unrecognized. Includes `signal_empty`, abstention, confidence signaling, and guidance about which anchors would make the request more actionable.

Low-signal recovery is not the same problem as structural assembly. Structural assembly assumes ContextTrail already found the right grounded source object; low-signal recovery begins where that assumption breaks.

### pack readiness verifier
The module that decides whether a retrieved Context Pack is actually sufficient for the current task. It consumes the task shape, selected sources, selected Doc Chunks, locked Cards, warnings, and retrieval evidence, then classifies the pack as something like `ready`, `partial`, `needs_anchors`, or `unsupported`.

Pack readiness is about sufficiency, not only ranking quality. A pack can contain a useful source and still be partial if it is missing the section, sibling, rationale, or setup context required to act safely.

### Context Object
The trust-bearing retrieval object types in ContextTrail. In v1 there are exactly two kinds: **Doc Chunk** and **Card**. A **SourceProfile** is not a Context Object; it is rebuildable index metadata that helps retrieve the right Doc Chunks and Cards. A code entry may appear in a Context Pack, but it is not a Context Object unless a future substrate decision explicitly promotes it. Substrate-level term (see [ARCHITECTURE.md](ARCHITECTURE.md)); worth knowing because the retrieval pipeline treats Doc Chunks and Cards uniformly under the same scoring formula.

### Doc Chunk
A single retrieval unit derived from an imported markdown source: a heading section (or a split of one) with contexttrail, body, **scope**, and **code anchors**. Identity = `stable_key` (durable across content edits) + `version_id` (rotates when body changes). Status: `current` or `tombstoned`. Stored in the SQLite cache; rebuildable from source via `contexttrail index`.

### Card
A hand-authored (or candidate) Context Object stored as a markdown file with YAML frontmatter under `.contexttrail/cards/`. v1 types: `constraint`, `symbol_note`, `evidence`. Cards are *operational knowledge committed to the repo*; Doc Chunks are *imported reflections of source docs*. The two are distinct — never collapse them.

### constraint
A Card type that asserts an invariant the agent must respect. Form: "X must / must not Y." Scope-bound (project / module / files / symbols). When a constraint's scope matches a retrieval request, it is **locked-include**. Examples: "All refund attempts must emit an audit event," "Database is the single source of truth — no parallel handoff mechanisms."

### symbol_note
A Card type that captures local semantics of a specific code symbol (function, class, method) that aren't visible from its signature. Form: "this symbol behaves this way." Symbol-bound. When the symbol appears in query anchors, the symbol_note is **locked-include**. Example: "RefundService.processRefund must be idempotent — providers may retry it; return the existing refund rather than creating a duplicate."

### evidence
A Card type that records a runnable command (test, script) which verifies one or more **constraints** or **symbol_notes** via `links` of type `covers`. Form: "this command demonstrates X." Used post-v1 to refresh **freshness** automatically when the command passes. v1 evidence is a structured record; running it is manual.

### bootstrap
Cold-start candidate generation from existing project residue, producing candidate cards for **inbox** **triage**. v1 week-6 source is imported Doc Chunks; future sources may include code comments, tests, schemas, conversation logs. Distinct from `contexttrail import`, which is deterministic and never produces cards. Output always lands at `authority: candidate`. CLI surface in v1 is `contexttrail card bootstrap`; mechanism specifics (LLM provider, prompt design, confidence thresholds) live in MVP.md / DESIGN.md.

Bootstrap should not fill the inbox with weak guesses that the system itself does not believe. When confidence is too low to justify a candidate, the right fallback is not silent failure or misleading context, but a higher-leverage clarification need that can improve multiple downstream candidate decisions at once.

### triage
The human workflow that reviews bootstrap candidates (and, post-v1, agent-proposed candidates) and either accepts them (move from `inbox/` into `cards/`, set `authority: accepted`), rejects them (delete or mark `deprecated`), or edits them (modify body/scope and accept). The primary user experience may be through an MCP-connected agent UI even when the underlying review items are stored locally.

The normal unit of triage is the candidate card, not each individual suggested link. A bootstrap candidate may carry suggested supporting links, but the default review action is one candidate-level decision with an optional edit path rather than many micro-approvals.

When multiple source chunks support the same underlying rule, the inbox should prefer one merged candidate over many near-duplicate candidates. The merged candidate should still keep its multiple supporting chunks visible so decision count drops without hiding evidence.

When bootstrap is unsure between multiple phrasings of the same rule, it should prefer one canonical candidate wording rather than emitting several wording variants. Uncertainty can be surfaced in candidate notes or supporting evidence without multiplying inbox decisions.

When bootstrap cannot justify a good candidate, triage should prefer a small number of high-leverage clarification needs over a long tail of low-confidence candidate cards. The goal is still to close the confidence gap, but without pretending weak guesses are good context.

When a clarification answer resolves multiple pending candidates, the system may rewrite those candidates automatically before they are shown again, as long as the updated candidates clearly preserve the causal trail from the clarification that changed them.

Clarification needs should prefer constrained answers such as yes/no, choose-one, or short structured choices whenever possible. Free-form answers are the fallback when the uncertainty cannot be compressed honestly without losing the meaning of the question.

In UI terms, the normal shape is constrained choices first with a custom text escape hatch when needed. In an agent app this may appear as multiple choice plus a text field; in a terminal flow it may appear as numbered choices plus the ability to type a custom answer.

Clarification answers are workflow inputs, not durable repo truth by default. The durable knowledge outcome is the accepted card or rewritten candidate that results from the answer, while the raw answer itself remains review history unless a later product need promotes it into a first-class object.

Accepted cards should stay readable and not double as a workflow log. The system still needs durable traceability, though, so a future maintainer can answer "why does this rule exist?" or "how did this card become accepted?" without reconstructing the decision from memory. That trace should live in review history and provenance surfaces rather than in bloated card frontmatter.

Traceability should be per-card. Even when review history lives outside the card file itself, each accepted card should retain a stable way to trace back to the candidate and clarification path that created it or materially changed it.

That trace should preserve the full material path, not just the original bootstrap candidate. If clarifications or rewrites substantially reshape the card before acceptance, the later steps remain part of the explanation for why the accepted card looks the way it does.

Week 6 does not need a perfect "material change" algorithm before the core bootstrap loop exists. It does need a workable seam: the system should be able to mark substantive clarification-driven rewrites differently from obvious cosmetic edits well enough for week-7 layering and evaluation, even if the first pass is heuristic or review-assisted.

Clarifications may shape later systems conceptually, including future `evidence` generation, but the live week-6 implementation stays focused on improving `constraint` and `symbol_note` candidates first.

See ADR-0018.

### inbox
The durable local queue for review items awaiting triage: `.contexttrail/inbox/`, gitignored by default. Distinct from `.contexttrail/cards/` (accepted, committed) so candidate noise never enters git history. Holds readable local files so review items survive cache or database rebuilds and do not need to be rediscovered every time the substrate is recreated.

The product goal is to keep the inbox to a small number of high-leverage review decisions, not a large queue of narrow confirmations. There is no hard numeric cap, but lower is better when the candidate wording is strong enough to resolve multiple downstream implications at once.

The inbox may contain more than one review type, such as candidate cards and clarification needs, but it remains one local backing store. Review type should be explicit so "approve this candidate" and "answer this clarification" are distinct actions inside the same workflow. The primary presentation surface may be an MCP or agent harness UI rather than direct manual file browsing, but the stored items should remain readable on disk.

See ADR-0018.

### setup confidence
The degree to which ContextTrail understands the repo substrate well enough for downstream products: domain boundaries, authority hierarchy, coverage, freshness, evidence, and retrieval probe behavior. Setup confidence is not a single truth score and does not make candidate context authoritative.

Setup confidence is adaptive and task-relevant. ContextTrail should ask high-leverage setup questions only while they materially improve confidence across meaningful repo areas, then stop when remaining uncertainty is low-impact or isolated. See ADR-0014.

Question count is a means, not the goal. The product should minimize the number of human review decisions needed to close the meaningful confidence gap, but confidence matters more than hitting a fixed numeric limit. Good questions stay general enough to resolve multiple downstream implications at once rather than depending on perfect recall of narrow variable-level implementation details.

The setup inbox is a curation stream, not a raw approval queue. Agents should autonomously accept clear supported invariants, ignore obvious noise, and ask humans only when the answer teaches a reusable repo rule or settles a family of pending items.

### task readiness
A proposed, deferred runtime classification for whether a Context Pack is safe to use as authoritative for the current task. Possible states: `ready`, `exploratory`, `blocked`, `signal_empty`.

Task readiness gates authority, not access: ContextTrail may still return context when exploratory or blocked, but agents should treat it differently. This is post-retrieval-engine-hardening work and should not be implemented before a PRD. See ADR-0015.

### locked-include
A property of certain matched Cards that bypass score-based packing and are guaranteed-included. Retrieval pipeline is *locked-first, then global ranker*.

Matching rules (D38, D39):
- **constraint**: locks when card's `scope` is the request's inferred scope **or any ancestor** of it (hierarchical-down). A `project: fundops` constraint locks for `module: fundops/ledger`. A `module: fundops/ledger` constraint does NOT lock for `module: fundops/billing` (no sibling matching) or for a project-level task (no descendant→ancestor leak). `company:`-scope constraints lock universally and surface a `broad_scope` reason in `contexttrail explain`.
- **symbol_note**: locks under **strict equality** between the card's declared `symbol_anchors` and the request's `query_anchors`. Class-level and member-level coverage is achieved by declaring multiple anchors in frontmatter (`symbol_anchors: [LedgerEntry, LedgerEntry.post]`), not by implicit chain matching.

Budget interaction: locked Cards are pulled into the pack first regardless of total token cost (D37). When `sum(locked_tokens) > requested_budget`, the pack emits a `locked_overflow` warning and the global ranker runs under whatever budget remains (possibly zero).

### omitted
Candidates the retrieval pipeline considered but did not include in the Context Pack. Three reasons taxonomy (`OMITTED_REASONS` in [src/retrieve/pack.ts](../src/retrieve/pack.ts)):

- `below_threshold` — final score under the relevance floor
- `budget` — would have fit but the token budget filled first
- `tombstoned` — a newer version of the same chunk superseded it

On the MCP wire (post-[ADR-0013](adr/0013-retrieve-context-pack-omitted-becomes-summary.md)), `omitted` is a bounded summary `{ total, by_reason, top, truncated }`, not the full list. Agents read `total` and `by_reason` to decide whether to widen the budget; `top` (≤10 highest-scoring) is the sample for inspection. The CLI's `contexttrail context --json` keeps the unbounded list for local debugging.

`omitted` is diagnostic, not primary context. *Avoid:* treating `omitted` as something the agent must read to answer the task — it is a budget-tuning signal.

### card link
An author-declared row in the `links` table connecting a Card to one or more Doc Chunks (`from_object_id = card_id`, `to_object_id = chunk_version_id`). Pinned `version_pin` powers the freshness materialization in D41.

Link creation is **always author-declared, never auto-derived**. `contexttrail card add` surfaces inline candidates (ranked by anchor overlap and scope_match) and accepts them with one keystroke; the selected `version_id`s are written to the card's `linked_chunks:` frontmatter. Cards may save with zero links — no card type is gated on link presence. Evidence cards with zero links surface an `unlinked` cue in `contexttrail card list`.

See D40, ADR-0008.

### scope
A property of a Doc Chunk or Card: where in the project taxonomy it belongs. Shape:

```
{ layer, company?, team?, project?, module?, feature?, files?, symbols?, routes?, domains? }
```

Set at import time from frontmatter > config rules > path inference > `unknown`. *Avoid:* "placement," "address," "locale" — pick "scope" and stick to it.

Scope is **only** the object-side property. Do not use "scope" for the query-time concept (see *query anchors*).

### layer
The taxonomic level of a scope: `company > team > project > module > symbol > decision`. More specific layers (module) win over less specific (project) in retrieval scoring (`specificity_weight`). *Avoid:* "scope layer" — just "layer" when the context is scope.

### code anchor
The stored noun. A `(kind, value, confidence, source)` tuple attached to a Doc Chunk or Card. `kind ∈ {file, symbol, route, env_var, test}`, `source ∈ {frontmatter, mention_extraction, manual, config_rule}`. Stored in the `code_anchors` table.

> "This chunk is anchored to `src/payments/refund.ts` and `RefundService.processRefund`."

*Avoid:* "reference," "mention" (as a noun), "stored mention." Use **code anchor** for the stored thing.

### mention extraction
The *process* (not the noun) that produces code anchors from chunk body text via the precision-first regex table (D32). One of the possible `source` values on a code anchor.

> "We **extracted mentions** from this chunk's body and produced two code anchors."

The word "mention" only appears inside the phrase "mention extraction." Anywhere else, say **code anchor**.

### link
A typed edge between two Context Objects, stored in the `links` table. Distinct from code anchors:

- **code anchor** = object → external code string
- **link** = object → object

> "This `evidence` Card has a `covers` link to two `constraint` Cards."

v1 link types:

- **`covers`** — an `evidence` Card asserts that running its `command` verifies one or more `constraint` or `symbol_note` Cards. Powers post-v1 automated freshness refresh; in v1 the command is run manually.
- **`evidences`** — a Card → Doc Chunk link declared by the author (typically on `evidence` Cards) marking the chunk as the source the Card cites. Pinned `version_id` flips the Card's `freshness_state` to `needs_review` when the chunk rotates.
- **`mentions`** — a Card → Doc Chunk link declared by the author for non-evidence reference (e.g., a `constraint` Card pointing at the design doc that introduced the rule). Same pinning behavior as `evidences`; the type carries authorial intent, not behavioral difference in v1.

Future types (post-v1): `supersedes`. Reserved on the schema; not emitted in v1 paths.

All Card → Doc Chunk links are author-declared (D40, ADR-0008); the system never auto-generates them. Suggestion helpers in `contexttrail card add` propose candidates that the author accepts explicitly.

*Avoid:* "reference" — it's ambiguous between code anchor and link.

### query anchors
The file paths and symbols carried by a retrieval query (typically `--files` and `--symbols` on `contexttrail context`). Used to compute `mention_overlap` against a chunk's code anchors and to infer a query-time scope for `scope_match`. *Avoid:* "query scope" — that conflates the two distinct concepts at retrieval time.

### scope_match
A retrieval signal in [0, 1] measuring alignment between a chunk's **scope** and the query's inferred scope (derived from query anchors). Hierarchical: 1.0 exact, 0.6 same project different module, 0.3 same layer different project, 0 otherwise. Multi-anchor queries OR matches via `max(...)`. Missing query scope → 0 (neutral).

### mention_overlap
A retrieval signal in [0, 1] measuring intersection between a chunk's **code anchors** and the query's **query anchors**. `matched_query_anchors / query_anchors`. Missing query anchors → 0 (neutral).

---

## Pack signals

### locked_overflow
A warning emitted on the Context Pack when `sum(locked_tokens) > requested_budget` — the locked-include Cards alone exceed the requested token budget. The pack still includes every locked Card (locked-include is a hard guarantee per ADR-0010); doc chunks may receive zero or reduced budget. The pack's `budget` block surfaces `locked_overhead` so the actual context consumption is visible.

`locked_overflow` is a *signal*, not a defect. Chronic overflow on a project is a tagging-discipline issue (scope rules too broad, or `company:`-tagging the default), not a tool bug. Authors triage overflow by tightening scope on offending Cards rather than by changing the pack policy.

### broad_scope
A flag surfaced in `contexttrail explain` on every Card that locks via `company:`-scope match (D38). Company-scope Cards lock universally — that is intentional for genuine global invariants ("never log PII") but easily over-used as a default tag. The flag is a passive audit surface so authors can spot when a "broad lock" was deliberate vs. accidental.

`broad_scope` does not change pack behavior. It is purely diagnostic.

---

## Relationships

- A **Context Pack** contains 0..N **pack entries**.
- A **pack entry** may be a **Context Object** or a code entry that points at implementation context.
- A **Context Object** is either a **Doc Chunk** or a **Card**.
- **Doc Chunks** and **Cards** are ranked by the same scoring formula (D34); accepted Cards carry a 1.2× type-bias.
- **Locked-include** Cards take priority over score-ranked candidates within the budget.
- A **Card** MAY link to one or more **Doc Chunks**; when a linked chunk's `version_id` rotates while its `stable_key` holds, the linked Card transitions to **freshness** = `needs_review`.
- **Doc Chunks** are imported from markdown sources outside `.contexttrail/`. **Cards** are authored under `.contexttrail/cards/`. The two never collide on disk.
- Every **Context Object** has exactly one **scope**, zero-or-more **code anchors**, and one **freshness** state.

## Decision rules

### the v1 cut rule (existing — see CORE.md)
> Does this help the agent get better context for a task right now? If no, cut it.

### the friction-vs-truth rule
> If a feature removes setup friction, include it. If a feature generates new "truth," defer it.

A test for ambiguous features that pose as one thing but contain another. Friction reduction (Wizard-A: scope rules, doc classification, config writing) is additive — it changes nothing semantic. Truth generation (Wizard-B: extracting invariants from prose) is architecturally load-bearing — it alters what "accepted" means and adds a precision/recall optimization problem to the engine.

See ADR-0001.

---

## Flagged ambiguities (resolved)

- **"scope"** was previously used for three distinct things — the object property, the retrieval query's target, and the layer hierarchy. Resolved 2026-05-05: object property = **scope**; query side = **query anchors** (with scope inferred from them); the hierarchy levels = **layer**.
- **"mention" vs "anchor" vs "reference"** were used interchangeably for the same data. Resolved 2026-05-05: **code anchor** is the stored noun; **mention extraction** is the process that produces anchors from text; **link** is an object→object edge. "Reference" is banned in prose — pick anchor or link.
- **"status" vs "authority"** were two names for the same trust concept on cards. Resolved 2026-05-05: collapsed to **authority**. The card frontmatter field is `authority`, not `status`. Authority and **freshness** are orthogonal — authority asks *should we trust this?*, freshness asks *is the trusted thing still up to date?*. Authority changes by human action; freshness changes mechanically.
