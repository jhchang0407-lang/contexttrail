# ContextTrail — Idea Vault

The MVP and VISION docs hold the locked decisions. This file holds **everything else** — every rich detail, alternative model, scoring formula, schema, flow, and tangent that came up in the design conversation but didn't fit cleanly into the scoped product.

Use this as the place to wander when you're ideating on the next phase, or when an MVP decision needs to be reconsidered and you want the full design space back.

Organized by topic. Skim the table of contents first.

## Table of contents

1. [The original integrity-layer framing](#1-the-original-integrity-layer-framing)
2. [Three product visions in tension](#2-three-product-visions-in-tension)
3. [Full bootstrap source catalog](#3-full-bootstrap-source-catalog)
4. [Bootstrap candidate UX](#4-bootstrap-candidate-ux)
5. [The first 30-minute walkthrough](#5-the-first-30-minute-walkthrough)
6. [Detailed retrieval scoring](#6-detailed-retrieval-scoring)
7. [Retrieval modes](#7-retrieval-modes)
8. [Capability tiers and `contexttrail doctor`](#8-capability-tiers-and-contexttrail-doctor)
9. [Full MCP tool I/O examples](#9-full-mcp-tool-io-examples)
10. [Extended CLI surface](#10-extended-cli-surface)
11. [Authority levels with full examples](#11-authority-levels-with-full-examples)
12. [Link types, weights, and trigger rules](#12-link-types-weights-and-trigger-rules)
13. [Test-derived link categorization](#13-test-derived-link-categorization)
14. [Semantic change detection — the full original model](#14-semantic-change-detection--the-full-original-model)
15. [Risk scoring and alert budget](#15-risk-scoring-and-alert-budget)
16. [Per-card-type lifecycle rules — full table](#16-per-card-type-lifecycle-rules--full-table)
17. [The capture loop / inbox](#17-the-capture-loop--inbox)
18. [Original SQL data model](#18-original-sql-data-model)
19. [Original three-phase plan](#19-original-three-phase-plan)
20. [Falsification criteria — extended](#20-falsification-criteria--extended)
21. [Distribution and ambition path — extended](#21-distribution-and-ambition-path--extended)
22. [Killer demo script](#22-killer-demo-script)
23. [Tangents and rejected ideas](#23-tangents-and-rejected-ideas)

---

## 1. The original integrity-layer framing

The conversation began with ContextTrail framed as an **integrity layer for AI-assisted software development**:

> When code changes, ContextTrail tells you which behavior surfaces changed, whether those surfaces are covered by requirements or evidence, and what needs attention.

The core loop:

```
git diff
  → semantic change surfaces
  → coverage check
  → requirement/evidence impact
  → actionable report
```

Three signals were proposed:

1. **Semantic change surfaces** — meaningful changes at symbol/module boundary
2. **Coverage state** — `covered_by_requirement` / `covered_by_evidence` / `tracked_but_no_evidence` / `untracked` / `ignored` / `out_of_scope`
3. **Drift state** — `proven_consistent` / `unknown` / `proven_inconsistent`

This framing was **inverted** during the grilling: drift detection became a downstream feature of the context engine, not the product itself. But the original mechanics survive:

- The semantic change detector becomes the **freshness signal generator** for cards (D7).
- The coverage states map onto card retrieval coverage warnings (`coverage.status` in Context Pack output).
- The drift states reduce to card freshness states (`verified` / `needs_review` / `potentially_superseded` / etc.).

If the context engine ever needs to add an integrity-layer feature on top, this original model is the blueprint. See [archive/v0-original-spec.md](archive/v0-original-spec.md) for the full original document.

---

## 2. Three product visions in tension

The user identified three intertwined visions during grilling:

| Vision | What it is | Status |
|---|---|---|
| **Integrity layer** | Detect spec-vs-code contexttrail, dispatch agents to fix it, close the verification loop | Downstream feature |
| **Context engine** | Capture, structure, retrieve precise context per task | ✅ The substrate (chosen) |
| **Orchestration layer** | Parallel agent execution platform built on shared context | Long-horizon ambition |

The chosen ordering:

```
context engine → drift detection (as freshness signal)
context engine → orchestration (as shared memory layer)
context engine → better code generation
context engine → better ticket execution
```

The **orchestration layer** vision deserves more development when MVP validates:

- Multiple agents (Claude Code, Codex, Cursor, custom) running in parallel against the same repo
- Each agent retrieves Context Packs scoped to its task
- Agents propose new cards as they learn → human inbox
- A coordinator can dispatch agents based on detected drift / uncovered changes
- Team-level dashboards show context coverage and agent activity

This is the Anthropic-shaped end state: a context engine becomes the substrate for safe, scalable, multi-agent software development.

---

## 3. Full bootstrap source catalog

VISION condensed this to a list. Here's the full breakdown of each source with example extractions.

### Tier 1 — deterministic, no LLM

#### Source 1: Code structure
Read: files, directories, modules, exports, classes, functions, API routes, schemas, migrations, config files.
Generates: `symbol_note` candidates, `feature_intent` candidates, surface maps.

Example: `src/payments/refund.ts` containing `RefundService.processRefund`, `RefundQueue.enqueueRefund`, `RefundWorker.processRefund` →
```
Type: feature_intent (candidate)
Title: Refund processing flow
Body: Refunds appear to flow through RefundService → RefundQueue → RefundWorker.
Source: code_structure
```

#### Source 2: Comments and docstrings
Read: docstrings, JSDoc, inline comments, TODO/FIXME/HACK, public API comments, README inline examples.
Generates: `symbol_note`, `constraint`, `decision`, unresolved-question candidates.

Example: `// Must be idempotent because Stripe may retry webhook delivery.` →
```
Type: constraint (candidate, high confidence)
Title: Stripe webhook handling must be idempotent
Linked symbol: StripeWebhookHandler.handle
Source: code_comment
```

#### Source 3: Tests
Read: test names, describe blocks, assertions, test commands, snapshot names, mock names, fixtures, direct calls, route invocations.
Generates: `evidence`, `requirement`, `constraint`, `symbol_note` candidates.

Example: `test("canceling paid order enqueues refund")` →
```
Type: requirement (candidate, medium-high)
Title: Canceling a paid order enqueues a refund
Evidence: refund-cancel.test.ts
```

**Rule:** Tests can generate candidate requirements and evidence cards, but never accepted requirements.

#### Source 4: Git history
Read: commit messages, PR titles, merge commits, changed files, historical co-change clusters, revert commits, bugfix commits.
Generates: `decision` candidates, `feature_intent` candidates, risk hints, link suggestions.

Example commit `"Make refunds async to avoid checkout timeout"` →
```
Type: decision (candidate, medium)
Title: Refunds processed asynchronously to avoid timeout
Source: git_commit
```

#### Source 5: Existing docs
Read: README, docs/**, architecture docs, API docs, OpenAPI specs, ADR files, product specs, markdown notes.
Generates: `feature_intent`, `decision`, `requirement`, `constraint` candidates.

ADR files can become accepted decision cards faster but still require explicit import/confirmation.

#### Source 6: Type/schema definitions
Read: database schema, Prisma schema, Drizzle schema, SQL migrations, Zod schemas, OpenAPI schemas, GraphQL schemas, TypeScript interfaces, domain enums, validation schemas.
Generates: `constraint` candidates, feature vocabulary, symbol links.

Examples:
- `refundStatus: "pending" | "succeeded" | "failed"` → requirement candidate (states are pending/succeeded/failed)
- `UNIQUE(order_id, refund_type)` → constraint candidate (refunds unique per order/type)

**Underrated:** constraints often live in schemas, not prose.

#### Source 7: Runtime / API surfaces
Read: routes, controllers, RPC handlers, queue workers, cron jobs, CLI commands, webhook handlers, public SDK functions.
Generates: `feature_intent`, `symbol_note`, entrypoint maps.

Example: `POST /orders/:id/cancel → OrderController.cancel → OrderService.cancel` becomes a feature_intent candidate.

#### Source 8: Error messages and assertions
Read: `throw new Error(...)`, `assert(...)`, `invariant(...)`, validation messages, guard clauses.
Generates: `constraint` candidates, edge-case requirements, `symbol_note`.

Example: `if (!order.paid) throw new Error("Cannot refund unpaid order")` →
```
Type: constraint (candidate, medium)
Title: Unpaid orders cannot be refunded
Linked symbol: RefundService.processRefund
```

This often captures business logic not documented anywhere else.

#### Source 9: Config and environment
Read: feature flags, env vars, payment provider config, auth config, queue config, rate limits, timeouts, retry settings.
Generates: `decision` candidates, `constraint` candidates, operational assumptions.

Example: `REFUND_WORKER_CONCURRENCY=1` →
```
Type: constraint (candidate, low-medium)
Title: Refund worker runs with limited concurrency
Body: Possibly to avoid provider rate limits or ordering issues.
```

#### Source 10: Current working diff
For active coders, bootstrap should also inspect the current uncommitted diff.
Read: changed files, changed symbols, new/deleted code, modified tests.
Generates: immediate Context Pack, candidate cards for changed surfaces, uncovered surface alerts.

This makes first use feel relevant: *"You are currently editing RefundService.processRefund. Generated 6 candidate cards for this area."*

### Tier 2 — LLM-assisted (later)

- Commit message interpretation beyond simple subject-line parsing
- Freeform comment summarization
- Card body rewriting and deduplication
- Conversation/ticket import as candidate cards
- Decision extraction from planning docs
- Auto-merging near-duplicate candidates

### Confidence by source

```
High confidence:
  explicit comments
  test names + assertions
  schemas / unique constraints
  OpenAPI / GraphQL contracts
  ADR files

Medium confidence:
  commit messages
  route maps
  direct function usage
  co-located docs

Low confidence:
  LLM summaries
  git co-change
  naming conventions
  indirect call inference
```

The inbox ranks candidates by source confidence × scope relevance × symbol centrality × recency × user focus.

### Bootstrap source priority for v1.5+

```
Tier A (build first): comments, test names, test files, schemas, routes, README/docs markdown
Tier B (next):        commit messages, direct call extraction, assertions, config/env
Tier C (later):       full call graph, cross-file semantic inference, conversation import,
                      ticket import, git co-change clusters
```

---

## 4. Bootstrap candidate UX

Every generated candidate must show:

```
why it exists
where it came from
what symbols/files it links to
confidence
what would happen if accepted
```

No mystery meat. Example inbox entry:

```
Candidate: Refund processing must be idempotent

Why generated:
- Comment mentions "Stripe may retry"
- Test name includes "idempotent"
- Unique index found on refund_attempts.provider_event_id

Accepting this will:
- create constraint card C04
- link it to StripeWebhookHandler.handle
- link evidence refund-webhook-idempotency.test.ts

[accept] [edit] [reject]
```

### First-card heuristic

The first accepted card is likely a symbol note, constraint, or evidence card — **not** a requirement. Requirements are easy to hallucinate from code; constraints and evidence are more grounded.

### Bulk acceptance — careful

Allowed:
```bash
drift accept --type evidence --confidence high
```

Discouraged:
```bash
drift accept all
```

Pollution risk is high. Bulk accept should be type+confidence scoped.

---

## 5. The first 30-minute walkthrough

The user-facing first-time UX, minute by minute. Captured in detail because it's the make-or-break adoption moment.

### Minute 0–3: Init and scope

```bash
contexttrail init
contexttrail scope add src/payments/**
contexttrail scope add src/orders/**
contexttrail bootstrap src/payments/** src/orders/**
```

ContextTrail asks:
```
Analyze tests, docs, git history, schemas, and comments in this scope? yes
```

### Minute 3–10: Bootstrap scan

```
Bootstrap complete.

Found:
- 42 symbols
- 11 tests
- 4 API routes
- 3 schema constraints
- 27 relevant commits
- 6 documentation sections

Generated:
- 12 symbol note candidates
- 8 requirement candidates
- 5 constraint candidates
- 4 decision candidates
- 7 evidence cards
- 3 feature intent candidates
```

### Minute 10–20: Inbox triage

```bash
contexttrail inbox --top 15
```

User reviews top candidates. Accepts 8–12 cards.

### Minute 20–25: First Context Pack

```bash
contexttrail context "modify cancellation flow to support partial refunds" \
  --files src/orders/cancel.ts src/payments/refund.ts
```

Output:

```
Context Pack

Must read:
- Constraint: Refund processing must be idempotent
- Decision: Refunds are processed asynchronously
- Symbol note: RefundService.processRefund owns provider refund creation

Should read:
- Feature intent: Order cancellation flow

Evidence:
- refund-cancel.test.ts
- refund-idempotency.test.ts

Warnings:
- No accepted card covers partial refunds yet.
```

This is the first "aha." First time the product feels like a product.

### Minute 25–30: Add one missing card

System suggests creating a card for the gap:

```
No accepted context exists for partial refunds.
Create candidate card?
```

User creates or accepts. Now the graph improves from real use.

---

## 6. Detailed retrieval scoring

The deterministic scorer used in step 5 of the retrieval pipeline. Crude, but explainable.

```
score =
  + 100 if guaranteed_include
  + 40  exact symbol match
  + 30  direct file match
  + 25  accepted constraint
  + 22  accepted requirement
  + 18  accepted decision
  + 16  symbol_note
  + 14  evidence
  + 12  feature_intent
  + 20  active drift overlap
  + 15  recent edit overlap
  + 0–20 embedding similarity
  - 30  stale (unless included as warning)
  - 40  candidate authority
  - 20  weak link only
```

Output should always include why each card was scored as it was:

```
Why included:
- exact symbol match
- accepted constraint
- linked evidence
```

User trust depends on this transparency.

### Pack budget defaults

```yaml
max_must_read: 8
max_should_read: 8
max_evidence: 6
max_candidates: 5
max_total_tokens: 6000
```

When too many cards match:

```
Too many matching constraints: 14.
Showing top 8 by specificity.
6 additional constraints omitted; run --expand constraints.
```

For agents, optionally include all constraints if token budget allows.

---

## 7. Retrieval modes

| Mode | Default cards | Use case |
|---|---|---|
| `implementation` | Accepted only | Active coding |
| `planning` | Accepted + candidates | Designing changes, exploring options |
| `audit` | Accepted + stale + candidates + conflicts | Coverage audit, governance review |

Mode is set per call:
```bash
contexttrail context "..." --mode planning
```

### Feedback loop on retrieval

```bash
contexttrail context mark C14 irrelevant --for "partial refunds"
contexttrail context mark D04 useful
```

Updates retrieval weights for similar future tasks. Important for retrieval quality compounding over time.

### Failure modes and mitigations

**Too few cards:** guaranteed constraints + exact symbol notes + scope expansion + embedding fallback + warnings when coverage thin. Output should say `"Low context coverage: no accepted requirement or decision cards found for this scope."`

**Too many cards:** hard card budget + type prioritization + LLM rerank + specificity scoring + expand flags.

**Wrong cards:** explain why included + LLM ignore bucket + user feedback marks + ranking updates over time.

**Stale cards:** staleness metadata + surface as warnings + never as accepted truth + evidence refresh path.

---

## 8. Capability tiers and `contexttrail doctor`

```bash
contexttrail doctor
```

Output:

```
ContextTrail capabilities:

Core structural analysis:     enabled
Markdown card index:          enabled
Keyword retrieval:            enabled
Local embeddings:             enabled
Cloud LLM extraction:         disabled
Local LLM extraction:         disabled
LLM rerank:                   disabled

Mode: local-basic
```

Setup commands:
```bash
contexttrail setup embeddings    # downloads tiny local embedding model with permission
contexttrail setup llm           # walks through provider config (Anthropic/OpenAI/Ollama)
```

### Provider abstraction

```ts
interface LLMProvider {
  extractCandidateCards(input: ExtractionInput): Promise<CandidateCard[]>
  rerankContext(input: RerankInput): Promise<RerankResult>
  summarizeCard(input: SummarizeInput): Promise<string>
}

interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}
```

Providers: `none`, `local-embedding`, `anthropic`, `openai`, `ollama`, `custom-command`. `none` is a first-class option, never an error state.

### Embedding model candidates

- `Xenova/all-MiniLM-L6-v2` (~25MB, transformers.js — leading default)
- `bge-small`
- `nomic-embed-text-v1.5`

Choose empirically once retrieval quality is measurable.

---

## 9. Full MCP tool I/O examples

### `retrieve_context_pack`

Input:
```json
{
  "task": "Modify cancellation flow to support partial refunds",
  "files": ["src/orders/cancel.ts", "src/payments/refund.ts"],
  "symbols": ["OrderService.cancel", "RefundService.processRefund"],
  "mode": "implementation",
  "include_candidates": false,
  "max_tokens": 6000
}
```

Output:
```json
{
  "must_read": [...],
  "should_read": [...],
  "evidence": [...],
  "warnings": [...],
  "omitted": [...],
  "coverage": {
    "status": "partial",
    "notes": ["No accepted card covers partial refunds yet."]
  }
}
```

### `list_warnings_for_scope`

Input:
```json
{
  "files": ["src/payments/refund.ts"],
  "symbols": ["RefundService.processRefund"]
}
```

Returns: stale cards, potentially-superseded decisions, unverified constraints, uncovered areas. Useful before or after edits.

### `get_card`

Input: `{ "id": "C09" }`. Returns full card. For when an agent wants to inspect a card referenced in the context pack.

### `propose_card` (post-v1)

Input:
```json
{
  "type": "symbol_note",
  "title": "RefundService.processRefund must remain idempotent",
  "body": "This method may be called repeatedly for the same order during provider retries.",
  "scope": {
    "symbols": ["RefundService.processRefund"],
    "files": ["src/payments/refund.ts"]
  },
  "source": {
    "kind": "agent_observation",
    "reason": "Observed while modifying refund retry handling"
  }
}
```

Output: `{ "candidate_id": "X42", "status": "created", "review_required": true }`

### `propose_link` (post-v1)

```json
{
  "card_id": "C09",
  "target": "src/payments/refund.ts::RefundService.processRefund",
  "target_type": "symbol",
  "reason": "This symbol emits refund audit events."
}
```

### `propose_evidence` (post-v1)

```json
{
  "covers_card_id": "C09",
  "type": "test",
  "command": "npm test -- refund-audit.test.ts",
  "reason": "This test appears to verify audit logging for refund attempts."
}
```

### `mark_context_gap` (post-v1, important)

```json
{
  "task": "Add partial refunds",
  "gap": "No accepted context card defines expected behavior for partial refunds.",
  "scope": { "files": ["src/payments/refund.ts"] }
}
```

The agent says: *"I could not find the context I needed."* This is a gold-standard signal for what to write next.

### Permission config

```yaml
mcp:
  tools:
    read: true
    propose: true                    # post-v1
    authoritative_write: false       # never default

inbox:
  default_location: local
  allow_shared_candidates: false
```

Future opt-in:

```yaml
mcp:
  authoritative_write:
    enabled: true
    require_git_branch: true
    require_commit_message: true
```

---

## 10. Extended CLI surface

```bash
# Setup
contexttrail init
contexttrail scope add <pattern>
contexttrail bootstrap [--scope X]
contexttrail doctor
contexttrail setup llm
contexttrail setup embeddings

# Cards
contexttrail card add
contexttrail card list
contexttrail card show <id>
contexttrail inbox [--top N] [--type T] [--confidence high|medium|low]
drift accept <id>
drift accept --type evidence --confidence high
drift reject <id>
drift edit <id>
drift merge <id> <id>
contexttrail card mark-needs-review <id>
contexttrail card verify <id>

# Retrieval
contexttrail context "task" --files X --symbols Y [--mode] [--rerank] [--json]
contexttrail context mark <card-id> irrelevant --for "task description"
contexttrail context mark <card-id> useful
drift warnings --files X
contexttrail explain <pack-or-card-id>

# Lifecycle
contexttrail index
drift evidence run <id>
drift evidence run --affected
drift confirm <id>
drift dismiss <id>
drift decision supersede <old-id> --with <new-id>

# Linking
drift link <card-id> <symbol> --weight 0.95 --source manual

# Noise control
drift ignore path <pattern>
drift ignore symbol <symbol>
drift ignore change <change-id>

# Status
drift status
```

`drift status` example output:

```
Cards:
- accepted constraints: 18
- accepted symbol_notes: 22
- accepted decisions: 7
- evidence: 14
- candidates pending: 31

Freshness:
- verified: 47
- needs_review: 8
- maybe_affected: 4
- potentially_superseded: 2

Coverage:
- scoped surfaces with ≥1 accepted card: 73%
- high-risk uncovered surfaces: 2
```

---

## 11. Authority levels with full examples

### Human-authored (most authoritative)
Examples:
- accepted requirements written by hand
- accepted decisions written by hand
- accepted constraints written by hand
- feature intent crafted by hand
- manual symbol notes

These can directly guide agents without further confirmation.

### Human-confirmed machine drafts (also authoritative after confirmation)
Example flow:
1. LLM proposes a decision card from a planning conversation
2. Human accepts or edits it
3. Card promoted from `candidate` → `accepted`

This is the **best capture workflow** because humans don't want to author cards manually all day. The human's job becomes: accept, edit, reject, merge, deprecate. Not write everything from scratch.

### Machine-generated candidates (useful but non-authoritative)
Examples: conversation fragments, LLM-suggested requirements, LLM-suggested symbol notes, auto-extracted code summaries.

These can appear in retrieval **only if clearly labeled** as candidates. They must never be silently treated as truth.

### Acceptance UX flow

When a card is accepted:

```
.contexttrail/local/candidates/X42.md  →  .contexttrail/cards/symbol-notes/S042-...md
```

The promotion is a real file move. Visible in git as a meaningful commit:

```
"Accept symbol note: RefundService.processRefund idempotency"
```

---

## 12. Link types, weights, and trigger rules

```
Link types:
  manual           — user explicitly created the link
  user_confirmed   — system suggested, user confirmed
  test_direct      — test calls the symbol directly
  test_indirect    — test exercises the symbol transitively
  llm_suggested    — LLM proposed the link
  git_cochange     — symbol historically changed alongside another
```

### Link weights

```
manual:           0.95
user_confirmed:   0.95
test_direct:      0.7–0.85
test_indirect:    0.3–0.6
llm_suggested:    0.2–0.5
git_cochange:     0.2–0.5
```

### Trigger rules

Only these can trigger high-confidence requirement drift / staleness:

```
manual
user_confirmed
test_direct
```

Weak links produce **suggestions**, not hard state transitions. This prevents noisy auto-staleness from destroying trust.

### Link storage

Three storage classes:

1. **Accepted links** — in card frontmatter, committed to git
2. **Suggested links** — local, gitignored (`.contexttrail/local/suggested-links.yaml`)
3. **Derived links** — recomputed during indexing, in cache

---

## 13. Test-derived link categorization

Tests are useful but noisy. Conservative bias.

### Strong test signals (accept as `test_direct`)

- Direct function call
- Method call on constructed object
- Explicit spy/mock target
- API route invocation when route map is known
- Assertion involving returned value from direct call

### Weak / ignored test signals (do NOT auto-link strongly)

- Import only
- Fixture only
- Helper only
- Factory only
- Broad service import
- Mock setup without invocation
- Indirect integration test without known route map

### Test link categories

```
direct_test_link
integration_surface_link
inferred_downstream_link
```

Only `direct_test_link` becomes high-confidence automatically.

---

## 14. Semantic change detection — the full original model

This was the heart of the original spec. It survives in ContextTrail as the **freshness signal generator**, not as the product. Capturing the full model here for when it gets built (week 5+ of original phase 1).

### Honest constraint

AST fingerprinting is not easy. The MVP cannot assume tree-sitter / Python `ast` / ts-morph alone solves semantic change detection. Hard cases:

- Name resolution
- Overloaded imports
- Cross-file symbol resolution
- Decorators, closures
- Generated code
- Dynamic Python dispatch
- Generic / templated TypeScript
- Type-only changes
- Runtime-equivalent refactors
- Aliasing
- Dependency injection
- Framework magic

→ Implement a **conservative, scoped** detector. Don't promise perfect semantic understanding.

### Language priority

```
TypeScript first
Python second (experimental)
```

TypeScript has better project-level symbol info via the TS compiler API / ts-morph. Python is more dynamic and harder to resolve accurately.

### TypeScript detection targets

- Changed function declarations
- Changed method declarations
- Changed exported symbols
- Changed interfaces / types
- Changed imports
- Changed call expressions inside tracked symbols
- Changed return statements
- Changed branch structure
- Changed API route handlers (when framework conventions configured)

### Python detection (experimental)

- Changed function definitions
- Changed class methods
- Changed imports
- Changed return structure
- Changed branch structure
- Changed function calls by local textual name

### Fingerprint set

For each tracked symbol, compute:

```
signature_fingerprint
export_surface_fingerprint
control_flow_fingerprint
call_shape_fingerprint
return_shape_fingerprint
literal_shape_fingerprint
import_dependency_fingerprint
```

These are **change classifiers**, not proofs of semantic equivalence.

### Change tiers

| Tier | What changed | Examples |
|---|---|---|
| `SAFE` | No relevant fingerprints changed | Formatting, comments, whitespace, non-semantic ordering |
| `LOW` | Minor internal change, public surface unchanged | Local variable rename, equivalent expression rewrite, type-only changes (when configured non-runtime) |
| `MEANINGFUL` | At least one important fingerprint changed | Signature, exported type, branch structure, return shape, called dependency, runtime import, route handler, DB migration |
| `HIGH-RISK` | Likely affects many downstream surfaces | Public API signature, shared type/interface, migration, auth/payment/security code, central service method, runtime config |

These tiers map directly onto card freshness state transitions:

```
SAFE       → no card freshness change
LOW        → no card freshness change
MEANINGFUL → linked symbol_notes/constraints → needs_review
             linked requirements → maybe_affected
HIGH-RISK  → linked requirements → needs_review
             linked feature_intent → needs_review
```

---

## 15. Risk scoring and alert budget

From the original noise-control work. Re-emerges when ContextTrail adds back uncovered-change alerts.

### Risk score inputs

```
change_kind
symbol_exported
path_importance
file_centrality
manual critical-path match
diff_size
dependency fanout (if available)
```

### Risk thresholds

```
risk >= 0.7  → high attention
risk >= 0.4  → report only
risk <  0.4  → ignore unless --all
```

### Alert budget

```yaml
max_high_attention_alerts: 5
```

If more than 5 uncovered changes are detected:

```
High-attention alerts:
1. PaymentService.capturePayment — public method changed
2. AuthMiddleware.verifySession — branch structure changed

Additional uncovered changes:
7 hidden lower-priority changes
```

### Dormant code rule

Untracked dormant code is **not** constantly reported. It is reported only when it changes meaningfully **AND** is inside configured scope **AND** risk exceeds threshold.

### Watchlist

```yaml
watchlist:
  - src/orders/**
  - src/payments/**
  - src/auth/**
```

Uncovered semantic changes outside the watchlist are summarized, not alerted:

```
3 meaningful changes outside watchlist hidden. Run `drift analyze --all` to view.
```

### Ignore rules

```bash
drift ignore path scripts/**
drift ignore symbol src/debug/devTools.ts::seedTestUser
drift ignore change CHG-abc123
```

Stored in config:

```yaml
ignored_paths: []
ignored_symbols: []
ignored_change_patterns: []
```

---

## 16. Per-card-type lifecycle rules — full table

```
Constraints:
  meaningful linked change → needs_review
  passing evidence or human confirm → verified

Symbol notes:
  meaningful linked symbol change → needs_review
  human confirm or evidence → verified

Requirements:
  high-risk linked change → needs_review
  meaningful linked change → maybe_affected
  passing evidence or human confirm → verified

Decisions:
  never auto-stale
  contradictory code/signals → potentially_superseded
  only humans can supersede / deprecate

Feature intent:
  major flow change → needs_review
  local related change → maybe_affected

Evidence:
  covered surface changed → stale_until_run
  passing command at current SHA → verified

Conversation fragments:
  candidate / historical only
  never authoritative unless promoted
```

### Freshness state semantics

```
verified:
  Accepted card has been confirmed manually or by evidence against current relevant code.

unverified:
  Accepted card exists but has no current evidence/confirmation.

needs_review:
  Linked meaningful/high-risk change likely affects this card.

maybe_affected:
  Related change may affect card, but confidence is lower.

potentially_superseded:
  Mostly for decisions; code or newer card may contradict historical rationale.

deprecated:
  Human marked it obsolete.
```

### Re-verification paths

**Evidence re-verification (for evidence-backed cards):**
```bash
drift evidence run C09
```
Passing → `C09` becomes `verified`, `last_verified_sha = current_sha`.

**Human re-confirmation (for non-evidence cards):**
```bash
drift confirm C09
drift review D04
```
Possible actions: confirm still valid, edit, split, supersede, deprecate, link evidence.

**Superseding (for decisions):**
```bash
drift decision supersede D04 --with D09
```
D04 remains historically available but no longer ranks as active guidance.

### Retrieval treatment by freshness state

| State | Retrieval treatment |
|---|---|
| `verified` | Include normally |
| `needs_review` | Include as warning + context |
| `maybe_affected` | Include if budget allows, usually under warnings or should_read |
| `potentially_superseded` | Include under warnings |
| `deprecated` | Excluded by default (override: `--include-deprecated`) |

Example warning text:
```
C09 needs review because RefundService changed.
Do not blindly rely on it.
```

---

## 17. The capture loop / inbox

The seed of the orchestration layer. The full flow:

```
1. Agent retrieves Context Pack before task
2. Agent does work, observes new constraints/notes
3. Agent calls propose_card with what it learned
4. Candidate lands in human inbox
5. Human accepts/edits/rejects
6. Graph improves; next agent task gets richer context
```

### Inbox sources

Whenever new input comes in — ticket, planning doc, conversation, agent work summary, PR description, code comments — the system can propose candidate cards.

### Inbox UX

```bash
contexttrail inbox
```

```
Candidate cards:

1. Decision: Refunds should remain async
   Source: planning conversation
   Suggested authority: candidate
   [accept] [edit] [reject]

2. Constraint: Refunds require audit logging
   Source: ticket AA-102
   Suggested authority: candidate
   [accept] [edit] [reject]

3. Symbol note: RefundService.processRefund must be idempotent
   Source: code + test analysis
   Suggested authority: candidate
   [accept] [edit] [reject]
```

### Local vs shared candidates

**Local candidates** (gitignored, `.contexttrail/local/candidates/`): bootstrap spam, ad-hoc agent proposals.

**Shared candidates** (committed, `.contexttrail/cards/candidates/`): potentially useful to team / future agents.

Promotion is explicit and visible in git history.

---

## 18. Original SQL data model

From v0 spec. Survives in modified form in [SCHEMA.md](SCHEMA.md). Original tables for reference:

```sql
CREATE TABLE requirements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  requirement_state TEXT NOT NULL DEFAULT 'candidate',
  drift_status TEXT NOT NULL DEFAULT 'unknown',
  critical BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  symbol_type TEXT,
  exported BOOLEAN DEFAULT FALSE,
  start_line INTEGER,
  end_line INTEGER,
  last_fingerprint TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE symbol_fingerprints (
  symbol_id TEXT PRIMARY KEY,
  signature_fingerprint TEXT,
  export_surface_fingerprint TEXT,
  control_flow_fingerprint TEXT,
  call_shape_fingerprint TEXT,
  return_shape_fingerprint TEXT,
  literal_shape_fingerprint TEXT,
  import_dependency_fingerprint TEXT,
  computed_at TEXT NOT NULL
);

CREATE TABLE requirement_links (
  requirement_id TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  weight REAL NOT NULL,
  source TEXT NOT NULL,
  confirmed BOOLEAN DEFAULT FALSE,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (requirement_id, symbol_id)
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  command TEXT NOT NULL,
  last_status TEXT,
  last_run_at TEXT,
  last_passed_at TEXT
);

CREATE TABLE change_events (
  id TEXT PRIMARY KEY,
  git_sha TEXT,
  diff_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE semantic_changes (
  id TEXT PRIMARY KEY,
  change_event_id TEXT NOT NULL,
  symbol_id TEXT,
  file_path TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  risk_score REAL NOT NULL,
  is_uncovered BOOLEAN DEFAULT FALSE,
  is_ignored BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE impact_events (
  id TEXT PRIMARY KEY,
  change_event_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  semantic_change_id TEXT,
  impact_score REAL NOT NULL,
  impact_level TEXT NOT NULL,
  reason TEXT,
  user_decision TEXT,
  created_at TEXT NOT NULL
);
```

These map onto the new context-engine model:
- `requirements` → `cards` (any type, status accepted)
- `symbol_fingerprints` → cache table for staleness detection
- `requirement_links` → `card_links` + symbol/file mapping tables
- `evidence` → evidence-type cards
- `change_events` / `semantic_changes` → freshness change log (week 5+)
- `impact_events` → audit log of card freshness transitions

---

## 19. Original three-phase plan

From v0 spec. Pre-grilling. Re-shaped during scope reduction but worth preserving as a reference.

### Phase 1: Scope + Diff + Structural Change Detection (1–2 weeks)

Build:
- config scope
- git diff reader
- TypeScript symbol extraction
- TypeScript fingerprinting
- semantic change classification
- safe/meaningful/high-risk distinction
- noise controls

Success: distinguish formatting/comment changes from meaningful behavior-surface changes on the target codebase.

### Phase 2: Coverage Graph (1 week)

Build:
- accepted requirements
- manual links
- evidence commands
- requirement drift state
- uncovered semantic change alerts

Success: meaningful change to linked symbol marks requirement unknown; meaningful change to unlinked high-risk symbol reports uncovered semantic change.

### Phase 3: Link Suggestions (1 week)

Build optional weak suggestions from:
- direct test calls
- LLM suggestions
- git co-change

Success: suggestions reduce manual linking effort without creating high-confidence false positives.

### Why this got reordered

The grilled MVP starts with **manual cards** rather than scope+diff+detection. Reasoning: the hypothesis to prove is "do scoped Context Packs help agents," which doesn't require detection at all in week 1. Detection (this Phase 1) becomes the freshness-signal generator in week 5+.

---

## 20. Falsification criteria — extended

### Continue if (after dogfooding)

- It catches at least 3 issues or coverage gaps you act on
- High-attention false positives stay under 20%
- You do not ignore the tool for 3 consecutive working days
- Setup takes less than 30 minutes for a useful scoped area
- Scope/noise controls prevent alert spam

### Kill or redesign if

- Most alerts are obvious or irrelevant
- Uncovered semantic change becomes noise
- AST change classification is too inaccurate
- Manual linking feels worse than writing tests
- You stop checking the report

### Context-engine reframing of falsification

After grilling, the real falsification criteria for the **context engine** product:

- Agents do not measurably behave better with Context Packs vs. without
- Manually authoring cards feels worse than writing tests or comments
- Bootstrap candidates are mostly noise after Tier 1 implementation
- Users stop checking the inbox within 2 weeks
- Most warnings are obvious or irrelevant
- Setup takes more than 5 minutes for a useful first pack

Both lists matter. The first applies if/when integrity-layer features ship. The second is for the v1 product.

---

## 21. Distribution and ambition path — extended

### Now (v1, OSS dev tool)

Hook: *"Tell your AI coding agent what not to break."*
ICP: solo TypeScript devs using Claude Code / Cursor / Codex.
Distribution: npm.
Validation: dogfood + recruit 1–3 external alpha users.

### 6–12 months (team mode)

Pitch: *"Your team's coding rules, retrievable by AI agents."*
Audience: small AI-native teams (2–10 devs).
Features:
- Shared candidate workflows (PR-able cards)
- GitHub PR integration: post Context Pack as comment, highlight cards touched by diff
- CI hook that fails when changes touch a constraint marked `needs_review` and no evidence has run
- Multi-author attribution (`accepted_by`, `proposed_by`)
- Per-team config and overrides

### 12+ months (orchestration / commercial)

Pitch: *"Shared memory layer for multi-agent coding."*
Audience: teams running parallel agents.
Features:
- Hosted layer for multi-repo / multi-agent context sharing
- Orchestration: dispatch agents based on detected drift, parallel agent coordination via shared context
- Team analytics on context coverage and agent activity
- Possibly a commercial SaaS layer over the local-first OSS core

The hosted layer is **never required**. Local-first remains the core.

### Positioning rejected for v1

- *"Local-first context engine for AI-assisted software development"* — accurate but emotionally flat
- *"Shared context for parallel AI agents"* — strategically right but audience is too small in 2026
- *"Your team's coding rules, retrievable by AI agents"* — better B2B pitch but team adoption needs bottom-up pull first

### Cost of defensive positioning

"Don't break things" framing is easier to demo but harder to monetize than enabling positioning ("ship faster"). Acceptable trade for adoption velocity.

---

## 22. Killer demo script

The README opens with this demo:

```md
You ask Claude Code:

> Add partial refunds to the cancellation flow.

Before editing, Claude calls ContextTrail and gets:

Must read:
- Constraint: Refunds must remain async.
- Constraint: Every refund attempt must emit an audit event.
- Symbol note: `RefundService.processRefund` must be idempotent.
- Evidence: Run `refund-cancel.test.ts` and `refund-audit.test.ts`.

Now the agent knows the rules before touching the code.
```

### Recommended demo card set

For one project, create:

```
5–8 constraints
8–12 symbol notes
3–5 evidence cards
```

Examples:

**Constraints:**
- Do not bypass audit logging
- Payment provider calls must be idempotent
- User auth and admin auth must remain separate
- Do not store raw provider tokens
- Refunds must remain async

**Symbol notes:**
- `RefundService.processRefund` owns provider refund creation
- `OrderService.cancel` should enqueue refund, not execute it
- `AuthMiddleware.verifySession` must reject expired sessions before DB lookup
- `WebhookHandler.handleStripeEvent` must tolerate duplicate events

**Evidence:**
- `refund-cancel.test.ts`
- `webhook-idempotency.test.ts`
- `auth-session-expiry.test.ts`

If those don't help agents, the product is in trouble.

### What to measure during dogfood

For every agent task, log:

```
Task:
Cards retrieved:
Cards agent explicitly referenced:
Mistake prevented?
Would agent likely have missed this without card?
Human judgment:
Outcome:
```

Examples of "clear save":

```
Agent preserved async refund path because constraint said not to make it sync.
Agent added audit logging because constraint was in must_read.
Agent avoided changing idempotency behavior because symbol note warned it.
Agent ran the right test because evidence card was returned.
```

### The missing demo anchor

The most important open item: your real "agent broke X because it didn't know Y" story. Format:

```
Task I asked the agent to do:
Code it changed:
Rule it broke:
What the rule should have said:
Consequence (bug / bad architecture / wasted time):
```

This story becomes:
1. README opening example
2. First three sample cards in the demo
3. First retrieval test fixture
4. The "why this exists" paragraph in docs

---

## 23. Tangents and rejected ideas

Interesting threads that surfaced and were either rejected or deferred:

### Rejected outright

- **TTL-based card decay** — time doesn't change truth; trains users to ignore staleness
- **SQLite as source of truth** — kills mergeability, reviewability, portability
- **CLI as primary agent interface** — slow, no persistent index, MCP is native
- **LLM rationale as state-changing evidence** — LLM output never becomes accepted truth
- **Pure embedding retrieval** — confuses topical similarity with applicability
- **Pure symbol-graph retrieval** — misses cards not yet linked
- **`likely_consistent` as a status** — weak status easy to misuse, simpler states harder to fool
- **Auto-acceptance of any card** — even bulk accept needs scoping (`--type evidence --confidence high`)
- **Agent authoritative writes** — never default; agents propose, humans accept

### Deferred but interesting

- **`contexttrail bootstrap` from current diff** — generate candidates for symbols you're actively editing; first-use feels relevant
- **Context Pack feedback loop** — `contexttrail context mark <id> useful` updates retrieval weights
- **Mode-shifted retrieval** — implementation vs planning vs audit changes default candidate inclusion
- **Decision supersession workflow** — `drift decision supersede D04 --with D09` preserves history
- **`mark_context_gap` MCP tool** — agent says "I needed context here and didn't find it"; gold for inbox
- **Hosted multi-agent context sync** — for teams running parallel agents on the same repo
- **CI integration** — fail build when changes touch unverified critical constraints
- **GitHub PR comment with Context Pack** — show what the agent saw before editing
- **`contexttrail index --watch`** — file watcher for live cache updates
- **Card embedding-based clustering** — auto-suggest near-duplicate candidates for human merging
- **Conversation transcript import** — `contexttrail import conversation slack-export.json` → candidate cards

### Things to revisit when MVP validates

- Should agents ever get authoritative writes? (Currently no, never.)
- Should decisions ever auto-stale? (Currently no, only `potentially_superseded`.)
- Should constraint guarantee-include be overridable? (Currently locked.)
- Should bootstrap candidates be committed to git? (Currently `local/` is gitignored.)
- Should there be a card "version" concept for breaking change tracking?
- Should retrieval log be committed for team auditability or stay local?

---

## How to use this file

When you're back in design mode for the next phase:

1. Skim the table of contents
2. Pick the topic relevant to what you're considering
3. Read the captured detail
4. Cross-reference [DESIGN.md](DESIGN.md) for what was actually locked in v1
5. Check [OPEN.md](OPEN.md) for what was explicitly deferred

When you want the **original starting point**, read [archive/v0-original-spec.md](archive/v0-original-spec.md). It's the integrity-layer spec that this conversation grew out of.

This vault is append-only. Don't delete from it — when an idea proves wrong, mark it as such with a note. The history of *why we didn't do X* is as valuable as the record of what we did.

---

# Round 2 Appendix — Docs-First Reframing Detail

A second grilling round (May 2026) reframed the product from cards-first to docs-first. The locked decisions live in [DESIGN.md](DESIGN.md) (D15–D22). This appendix preserves the rich detail from that conversation.

## R2.1 The two-primitive model

```
DocChunk: imported from existing prose
  source: existing prose
  authority: imported
  structure: weak / section-based
  retrieval: ranked
  guaranteed include: no

ContextCard: curated hard rule or local note
  source: authored or accepted
  authority: accepted
  structure: typed
  retrieval: scoped + ranked
  guaranteed include: yes for constraints
```

Agent treats them differently:
- A doc chunk is **context**.
- A constraint card is an **instruction**.

## R2.2 Detailed chunking algorithm

### Step 1: Parse Markdown into heading tree
```
H1 Refund Spec
  H2 Refund Lifecycle
    H3 Async Processing
    H3 Failure Handling
  H2 Partial Refunds
    H3 Edge Cases
```
Each node owns content until the next heading of same-or-higher level.

### Step 2: Apply token cap
```
If section <= 900 tokens:
  chunk = whole section

If section > 900 tokens:
  split by paragraph groups into ~500-token subchunks
  include ~80-token overlap only when necessary
```

Numbers chosen because:
- 500 tokens is digestible and retrieval-friendly
- 900 tokens lets coherent sections stay intact
- 80-token overlap preserves continuity without too much duplication

### Step 3: Splitting rules

Keep intact:
- fenced code blocks
- markdown tables
- numbered procedures
- list item groups
- blockquote blocks

If a single block exceeds max tokens, keep it as one chunk and mark `oversized: true`. Better to return one oversized table than a broken table.

### Step 4: Local context header

Every chunk body delivered to the agent prepends a generated header:

```
Source: docs/payments/refunds.md
Section: Refund Spec > Partial Refunds > Edge Cases
Part: 1/2
```

Then content. Prevents orphaned prose.

### Step 5: Sibling boost

If retrieval selects chunk 2/3 of a split section, give a small boost to chunks 1/3 and 3/3 — the agent may otherwise get the middle of an argument. Don't auto-include all siblings; just bias their score upward.

## R2.3 Default `doc_scopes` rules in v1

```yaml
doc_scopes:
  - id: docs-project-default
    pattern: "docs/**/*.md"
    scope:
      layer: project

  - id: root-readme-project
    pattern: "README.md"
    scope:
      layer: project

  - id: module-readmes
    pattern: "src/**/README.md"
    scope:
      layer: module
      module_from_path_after: src

  - id: package-readmes
    pattern: "packages/*/README.md"
    scope:
      layer: module
      module_from_path: 1

  - id: adr-docs
    pattern: "{docs,doc}/**/{adr,ADR,adrs,ADRs,decisions,Decisions}/**/*.md"
    scope:
      layer: decision
```

Principle: minimal magic. Anything beyond this is user config.

## R2.4 Scope precedence detail

```
1. Frontmatter scope (overrides everything)
2. Config glob rule (sets layer + structured fields)
3. Built-in path inference (fallback for layer)
4. Mention extraction (augments code anchors only)
5. Unknown (still indexed, ranks lower)
```

**Important nuance:** mention extraction never overrides layer scope. It augments code-level anchors (files, symbols, routes).

Example:
- Config-derived: `layer: project, project: payments`
- Body mentions: `RefundService.processRefund`, `src/payments/refund.ts`
- Final: project=payments + files+symbols populated, with `mention_extraction: true` flag

## R2.5 Mention extraction rules

V1 conservative extraction. Prefer precision over recall.

**Extract:**
- Explicit file paths (`src/payments/refund.ts`)
- Exact dotted/class symbols (`RefundService.processRefund`)
- Routes (`POST /orders/:id/cancel`)
- Env vars (`REFUND_WORKER_CONCURRENCY`)
- Test filenames (`refund-cancel.test.ts`)
- Markdown code spans
- Fenced code references

**Do NOT extract:**
- "refund service" → RefundService (semantic inference)
- "cancel flow" → OrderService.cancel (semantic inference)

False positives in scope are worse than missing weak links because scope affects ranking.

### Symbol mention confidence

Build a symbol index from the codebase first. Then scan chunks:

```
exact fully qualified symbol mention:
  high

class + method nearby:
  medium-high

bare method name only:
  low unless unique in repo

file path mention:
  high
```

Store per-anchor:
```yaml
code_mentions:
  - kind: file
    value: src/payments/refund.ts
    confidence: high
    source: explicit_path
  - kind: symbol
    value: RefundService.processRefund
    confidence: high
    source: exact_symbol
  - kind: symbol
    value: processRefund
    confidence: low
    source: bare_identifier
    ambiguous: true
```

Retrieval uses confidence:
- High confidence mention → strong boost
- Low confidence mention → weak boost
- Ambiguous mention → maybe ignore unless no better candidates exist

## R2.6 Detailed packing algorithm

```
1. Locked items
   - accepted constraints with scope overlap (capped at max_locked_constraints)
   - exact accepted symbol_notes for scoped symbols (capped at max_locked_symbol_notes)
   - stale overlapping cards as warnings (capped at max_stale_warnings)
   These items take their budget unconditionally.
   If cap is hit, system loudly says: "14 matching constraints found. Showing 8 most specific. 6 omitted."

2. Linked evidence for locked items (capped at max_evidence)
   Compact form by default:
     Evidence: refund-audit.test.ts
     Command: npm test -- refund-audit.test.ts
     Covers: C09

3. Compute remaining budget
   remaining = max_total_tokens - locked - evidence - warnings - metadata_overhead
   If locked items consume too much:
     "Context Pack is constraint-heavy. No doc chunks included under current budget. Use --max-tokens 10000 or narrow scope."

4. Global rank remaining candidates (cards + chunks together)
   utility = packing_score / sqrt(token_count)
   Penalizes huge chunks without over-rewarding micro-chunks.

5. Greedy pack by utility until budget exhausted

6. Sectioned output (despite global ranking)
```

## R2.7 Ranking formula

```
base_score =
  0.30 × scope_score
+ 0.25 × code_anchor_score
+ 0.20 × keyword_score
+ 0.10 × link_score
+ 0.10 × specificity_score
+ 0.05 × recency_score

final_score =
  base_score
  × type_bias
  × authority_weight
  × freshness_weight
```

Don't obsess over perfect weights. Make them visible (`contexttrail explain`) and tunable (config).

### Type priority bias

```yaml
type_priority:
  constraint: 1.4      # if not already locked
  symbol_note: 1.25
  evidence: 1.1
  doc_chunk: 1.0
  decision: 1.05       # post-v1
  feature_intent: 1.0  # post-v1
  candidate: 0.65
```

Locked constraints and exact symbol notes bypass this (they're already in the locked set).

### Freshness weights

```yaml
freshness_weights:
  verified: 1.0
  unverified: 0.85
  needs_review: 0.75
  maybe_affected: 0.85
  potentially_superseded: 0.6
  deprecated: 0.0
```

`needs_review` cards still appear (boosted into warnings section) but ranked lower in the main pool.

## R2.8 Chunk identity scheme

Two-key identity:

```
stable_key = hash(source_path + heading_path + chunk_index)
version_id = hash(stable_key + chunk_content_hash)
```

**Stable key:** survives content edits. Says "this is still the Partial Refunds > Edge Cases section."

**Version ID:** pins exact content. Says "this exact body changed."

Cards that depend on chunk content link via version_id (so content drift triggers `needs_review`).

Retrieval logs reference version_id (so historical packs remain debuggable).

## R2.9 Chunk lifecycle on doc edit

Old chunk:
```
stable_key: refunds-edge-cases
version_id: v1
content_hash: aaa
```

New chunk after edit:
```
stable_key: refunds-edge-cases
version_id: v2
content_hash: bbb
```

System:
1. Mark v1 tombstoned
2. Insert v2 current
3. Find cards linked to (stable_key=refunds-edge-cases, version_id=v1)
4. Mark those cards `needs_review`
5. Emit warning naming affected cards

Warning text:
```
Doc section changed:
docs/payments/refunds.md > Refunds > Partial Refunds > Edge Cases

Cards linked to the previous version may need review:
- C09 Refund audit logging
- S12 RefundService idempotency note

Run: drift review C09
```

## R2.10 Implicit-on-retrieve indexing

Default mode:

```yaml
indexing:
  mode: implicit
```

On every `contexttrail context` call:
1. `stat` indexed source files (cheap; ms even for hundreds)
2. Skip if `mtime_ms + size` match cached
3. Otherwise compute `source_content_hash`
4. Re-parse if hash changed
5. Then retrieve

User never has to remember `contexttrail index` before queries.

Manual mode for large repos / CI:

```yaml
indexing:
  mode: manual
```

In manual mode, retrieval warns if source mtime differs from cached:
```
Index may be stale. Run `contexttrail index`.
```

## R2.11 Tombstone retention

V1: indefinite (no cleanup command). Keeps things simple.

Post-v1:
```yaml
indexing:
  tombstone_retention_days: 30
  # or
  tombstone_retention_reindex_cycles: 3
```

Cleanup command:
```bash
contexttrail index vacuum
```

## R2.12 The 5-week MVP rationale

Why +1 week vs cards-first 4-week plan:

The docs-first product surface is meaningfully larger:
- Two primitives instead of one (chunk + card)
- Layered scope schema (5 layers vs flat)
- Mention extraction
- Two staleness axes (chunk content + linked card)
- More config (doc_scopes, chunking, indexing modes)

Pretending the same 4 weeks covers both shapes is dishonest scheduling.

If you want to compress back to 4 weeks:
- Cut week 3 (cards overlay) entirely → ship doc retrieval only as v0.5 → loses locked-include differentiator
- Cut week 5 dogfood depth → fewer tasks → declare success without evidence (risky)
- Cut MCP, ship CLI-first → saves week 4 → delays adoption signal

## R2.13 The dogfood split rationale

ContextTrail alone is **insufficient** because:
- Docs were just authored by you in this conversation
- You have full context on every line
- The "agent drowning in unfamiliar layered docs" pain doesn't exist

ContextTrail validates:
```
import works
chunk parsing works
MCP returns packs
schemas hold
packing runs
```

Ralph (or OSS fallback) validates:
```
docs-first retrieval actually helps
layered scope works
unfamiliar context retrieval works
agent behavior with vs without packs
```

## R2.14 Validation protocol per task

For each of ≥10 tasks during week 5:

```
1. Write task prompt
2. Run contexttrail context with files/symbols if known
3. Save Context Pack
4. Estimate naive docs you would have shown manually
5. Compare token count: pack vs naive
6. Score subjective correctness 1–5
   5 = exactly what I would have supplied
   4 = useful, minor misses/noise
   3 = mixed, usable but flawed
   2 = mostly wrong/noisy
   1 = harmful or useless
7. Note omissions and noise
```

For 3 of those tasks, also run **behavior parity**:
```
8. Run agent with ContextTrail pack
9. Run comparable agent without pack (or with naive doc dump)
10. Compare outcome
```

Look for:
- Same quality with less context
- Better quality with similar context
- Strongest: agent avoided wrong edit because pack included relevant doc/card

## R2.15 Updated MCP tool surface

Read-only in v1:
- `retrieve_context_pack` — primary retrieval
- `get_doc_chunk` — fetch one chunk by version_id
- `get_card` — fetch one card by id
- `list_context_sources` — what sources are indexed (for agent debugging)

Post-v1 (capture loop):
- `propose_card`
- `propose_link`
- `mark_context_gap` — agent says "I needed context here and couldn't find it"

Never default:
- `accept_card`, `mark_verified`, etc. — human-only via CLI

## R2.16 Round-2 rejected ideas

- **Pure live re-parse on every read** — too slow; snapshot + change detection wins
- **Fixed section quotas** — arbitrary; some tasks need only constraints, some only docs
- **Tiered budget floors** — unnecessary complexity; locked-first + global ranker covers it
- **Manual `--scope` flag as primary mechanism** — too much friction; config rules + frontmatter wins
- **Aggressive semantic mention extraction** — too many false positives; conservative wins
- **Doc chunks tracking rich freshness states** — chunks are current source views, not commitments; only cards have freshness
- **External doc sync in v1** — each source needs its own design pass; defer
- **Embeddings as v1 requirement** — BM25 + heading + scope + mentions is enough for v1; embeddings are quality boost
- **File watcher in v1** — implicit-on-retrieve covers it; watcher is QoL improvement

## R2.17 The killer demo (revised for docs-first)

```md
You ask Claude Code:

> Add partial refunds to the cancellation flow.

Before editing, Claude calls ContextTrail and gets:

Locked rules:
- Constraint: Refunds must remain async.
- Constraint: Every refund attempt must emit an audit event.

Symbol notes:
- RefundService.processRefund must be idempotent.

Relevant docs:
- docs/payments/refunds.md > Partial Refunds > Edge Cases (project)
- docs/payments/provider.md > Retry Policy (project)
- docs/teams/backend/api-conventions.md > Error Handling (team)

Evidence:
- Run npm test -- refund-cancel.test.ts

Now Claude has the right slice — without reading 4,000 words of payment docs.
```

The two-section punch:
1. *"Stop dumping entire docs"* (the docs-first hook)
2. *"And the rules it must obey are pinned"* (the cards overlay)

This is a stronger pitch than cards-first because it directly addresses the visible pain.

---

## R2.18 — Why competitors went graph-heavy, and what to borrow

A natural question once the docs-first design is locked: *why did Microsoft GraphRAG, Mem0, Cognee, Zep, LlamaIndex KG mode, etc. all go the agent-built-knowledge-graph route, and is ContextTrail missing something?*

This section captures the analysis so we don't relitigate it later.

### What they're doing

The pattern across these products:

1. Agent reads each document
2. LLM extracts entities (concepts, people, systems) and relations (X depends on Y, A is a type of B)
3. Stores them as a property graph (Neo4j, custom store)
4. Retrieval traverses the graph — multi-hop, community detection clustering, entity resolution

Variants exist (vector + graph hybrid, temporal graphs, ontology overlays) but the core bet is the same: an LLM-built relational structure beats keyword/vector retrieval for synthesis-heavy queries.

### Real technical reasons they chose this

- **Use case is open-ended Q&A or synthesis**, not "agent editing code." Questions like *"summarize what we know about customer churn across all our research"* require cross-doc reasoning that BM25 and even pure embeddings can't do.
- **No pre-existing structure to ride.** Their corpora are unstructured prose — meeting notes, research, chat logs, support tickets. There's no code graph underneath.
- **Conceptual entities matter more than file paths.** "Refund processing" as a *concept* spans 12 docs that don't reference each other; the graph reveals the overlap.
- **Memory for long-running agents** needs entity state tracking across sessions — "user said X about Y on date Z, then changed to W on date V." Graphs fit this natively.
- **One-time indexing cost is acceptable** because reads vastly outnumber writes in their use cases.

These are real reasons. The graph approach is the right tool for *their* problem.

### Non-technical reasons (also real, less talked about)

- **VC funding makes expensive indexing affordable.** $30M Series A means LLM-extracting every doc on import is a cost line, not a blocker. A solo project has different math.
- **Engineering complexity becomes the moat.** A graph pipeline is harder to replicate than BM25 + good scoping, even if the retrieval quality is similar. The complexity itself is the differentiator they're selling.
- **"Knowledge graph" demos better than "lightweight retrieval"** in sales pitches and conference talks.
- **Buzzword pull.** "GraphRAG" gets attention; "scope-aware BM25" doesn't.
- **Research credibility.** Microsoft Research's GraphRAG paper carries institutional weight even when the underlying retrieval quality is comparable to simpler baselines on real workloads.

The deeper truth: many of these products are over-engineered relative to actual user need because the engineering complexity itself is the differentiator they're selling, not the end-user value.

### Why ContextTrail's situation is different

The "graph" already exists — and it's the code itself.

```
symbol → file → module → package → repo
imports → call graph → dependency graph
test → exercises → symbol
type → used-by → symbol
```

This graph is:
- **Deterministic** (no LLM hallucination)
- **Free** (parser extracts it)
- **Always current** (lives in the code itself)
- **Already what the agent cares about** because the agent is editing code

ContextTrail rides this graph. Doc-to-code attachment happens via mention extraction, scope tagging, and heading hierarchy — *all deterministic, all free, all auditable*.

So ContextTrail isn't *graphless* — it's using the cheap, accurate graph (code structure + heading hierarchy + scope) instead of the expensive, error-prone graph (LLM-extracted entity relations across prose).

### Where the simpler approach is genuinely weaker

Honest gaps where graph approaches do something we don't:

1. **Cross-doc conceptual retrieval without code anchors.** "Show me everything related to refunds" without naming a symbol or file. BM25 hits keyword "refund" but misses a doc titled "Voiding transactions" that discusses the same concept.

2. **Multi-hop semantic synthesis.** "What constraints from team-level docs apply to payment retries?" requires hopping team → payment-domain → retry-related decisions. ContextTrail's scope hierarchy supports this *if* docs are tagged correctly, but graph traversal would surface non-obvious connections.

3. **Disambiguation across naming drift.** Doc A calls it "refund processor." Doc B calls it "RefundService." Doc C calls it "refund worker." Entity resolution would unify them. Mention extraction only catches explicit symbol references.

### What's borrowable without becoming a graph product

Three concrete additions live in the [post-MVP priorities](MVP.md):

**1. Embeddings (post-MVP #2).** Solves most of gaps 1 and 3 at fraction of the cost. Cosine similarity over chunk embeddings approximates "these concepts are related" cheaply and deterministically. No LLM extraction step.

**2. Scope-graph debugging view (post-MVP #8).** Just *show* that the heading + scope + code-mention structure already forms a deterministic graph. `drift graph show --task "..."` renders the traversal. Defensive against "but you don't have a knowledge graph" critique without actually building one — because we already have one, it's just implicit.

**3. Optional LLM-built concept-link overlay (post-MVP #9, maybe-never).** Only build if embeddings prove insufficient. One-time LLM pass to extract concept-level links between chunks. Stored separately as `concept_links`. Used as a signal, not primary retrieval. Treat as the propose-loop for chunks: LLM suggests, human curates.

### What to reject

**Agent-built graph as primary retrieval mechanism.** Too expensive (LLM call per doc, re-run on every change), too variable (hallucinated relations create false retrievals), and it solves a problem (open-ended Q&A) that isn't ContextTrail's problem (scoped agent context for code edits).

### The strategic frame for a solo project

For a solo project, the right move is almost always:

```
pick the simplest approach that could work
ship it
measure honestly
add complexity only if measurement says you need it
```

ContextTrail's deterministic-first design is a *feature*, not a limitation, given the project shape:

- Hobbyist budget can't afford LLM-extracts-every-doc on every change
- One person can't maintain a complex pipeline reliably
- Defensive simplicity means the product can survive context-switching gaps
- "It works without an API key" is a real differentiator in the OSS market

The complexity that VC-backed competitors carry is partly a moat *they* need because their valuations require differentiation. A solo project's moat is different: shipping at all, ergonomic install, focused use case, predictable behavior.

### When to revisit

Revisit the graph question if any of these become true:

- Embeddings (post-MVP #2) prove insufficient for cross-doc concept matching
- User feedback consistently mentions "it didn't find docs that should have matched"
- The product expands beyond code-editing context into open-ended Q&A
- A clear funding/team scale-up changes the cost math
- A specific killer feature (e.g., temporal reasoning, cross-codebase synthesis) requires it

Until then: the implicit graph is the right graph. Don't build a second one.

---

## R2.19 — Competitive landscape (May 2026 sweep)

A focused look at four similar projects surfaced during round-3 research. Goal: extract honest learnings, name what's borrowable vs. what to reject, and pin down whether ContextTrail's positioning is differentiated enough to bother shipping.

### The four

| Project | Stars | License | Approach | Primary input |
|---|---|---|---|---|
| [zilliztech/claude-context](https://github.com/zilliztech/claude-context) | 10.7k | MIT | Vector embeddings → Zilliz/Milvus; "Your entire codebase as Claude's context" | Code |
| [m1rl0k/Context-Engine](https://github.com/m1rl0k/Context-Engine) | 0 | MIT | Self-hosted Docker stack (Qdrant + cross-encoder rerank + LLM decoder + adaptive learning + memory K/V) | Code + memory |
| [probelabs/probe](https://github.com/probelabs/probe) | 579 | Apache-2.0 | AST via tree-sitter + ripgrep speed; boolean queries; **zero indexing, zero embeddings** | Code |
| [advatar/prune.codes](https://github.com/advatar/prune.codes) | 0 | **None (no LICENSE file)** — read-only, not legally usable | Rust workspace; structure-aware retrieval; budgeted packing; AST import graph; recipe memory; connected-subgraph packing | Code |

All four are **code-first.** None ingest markdown docs as the primary input. None have typed cards with locked-include semantics. None have an authority/freshness trust model. None solve drift detection — that remains a real future opportunity if the v1 wedge proves out.

### Borrowable patterns

- **probe's "AI agents don't need embeddings" argument.** When the consumer is an AI agent, the LLM already does vocabulary translation (`"authentication" → "verify_credentials OR auth_handler"`) and emits boolean queries itself. probe gives the LLM a query language and lets it drive. This is a credible critique of "embeddings as table stakes." Doesn't change ContextTrail's plan (embeddings opt-in is fine) but informs how to talk about it: *we don't require embeddings because the LLM handles vocabulary translation; we use BM25 + scope + heading and let the agent's own attention do semantic matching*.
- **prune.codes's "support closure" / "No Unbound Names."** If a chunk references a symbol, also include the chunk that *defines* the symbol. Goes beyond top-K ranking. Real retrieval improvement ContextTrail doesn't yet have. Add as v1.5+ candidate.
- **prune.codes's connected-subgraph packing** (Steiner-ish/beam selector). Prefer chunks that form a connected explanation over a flat top-K. v1.5+ candidate; only build if measurement shows top-K leaves gaps.
- **prune.codes's "Recipe Memory."** Stored fix patterns that retrieve on similar failures. Conceptually closer to ContextTrail's evidence cards than evidence cards are to anything else. Worth re-reading in the v1.5 timeframe to inform how evidence cards extend.
- **Context-Engine's micro-chunking + cross-encoder rerank.** Their headline pitch is "5–50 line chunks, not whole files," with cross-encoder rerank on top of hybrid search. Worth reading their `splitter.ts`–equivalent for chunking ideas, but their architecture (Docker + Qdrant + multi-service) is fundamentally different from ContextTrail's single-CLI design — patterns transfer, code doesn't.
- **claude-context's MCP scaffolding** (`packages/mcp/src/handlers.ts`, `index.ts`). Standard MCP server pattern, well-implemented in TypeScript, MIT-licensed. ~30 minutes of reading saves figuring out the SDK quirks for week-4 work. Reference material, not paste-in code — ContextTrail's tool surface is different.

### What to reject

- **claude-context's cloud-vector-DB-first architecture.** Zilliz Cloud + OpenAI keys breaks the local-basic default (D9). Their stack is solving a different problem.
- **Context-Engine's Docker-stack onboarding.** Heavyweight; fights ContextTrail's "npm install contexttrail" promise.
- **Code-first framing across all four.** The competitors collectively confirm docs-first is genuinely under-served; do not pivot to code-first.
- **Vector-DB indexes.** None of the competitors' use cases (~100k+ chunks across enterprise codebases) match ContextTrail's v1 scale (hundreds-to-thousands of chunks per repo). Linear cosine over BLOB stays the right call; revisit only if scale demands it.
- **Generic K/V memory** like Context-Engine's `store`/`find`. Typed cards (constraint, symbol_note, evidence) with locked-include semantics are the differentiator; generic memory is a flatter version that loses the trust and scope discipline.

### Code reuse legality

- **claude-context (MIT) and probe (Apache-2.0) and Context-Engine (MIT)**: copying code is legal with attribution. *But* — for a small, well-specified codebase like ContextTrail, reading and re-implementing is usually faster and cleaner than adapting. Reuse only the small bits where the wheel is actually round (e.g., MCP scaffolding boilerplate).
- **prune.codes**: no license. Source-available, not open source. Reading for ideas is fine (ideas aren't copyrightable). Copying any code is not legal, even with edits — it's still derivative work.
- The ideas in EPIC.md (support closure, connected subgraph, recipe memory, signal extraction, skeletonization) are concepts; re-implement them from scratch and there's no legal exposure.

### ContextTrail's differentiated position (sharpened by this sweep)

The current CORE.md tagline — *"a better way to give AI coding agents the right slice of existing project knowledge"* — overlaps too much with claude-context's *"Your entire codebase as Claude's context."* That's positioning risk.

The genuinely unique sentence:

> **Hand-authored constraints, decisions, and operational rules that ALWAYS reach the agent — never silently dropped because BM25 didn't match. Cards committed to the repo, version-controlled, with locked-include guarantees and an authority/freshness trust model.**

Doc retrieval is *supporting infrastructure* for the cards layer, not the wedge itself. None of the four competitors have typed cards with locked-include. That's the moat.

### When to revisit this entry

- A new competitor surfaces that *does* have typed cards / locked-include
- One of the four pivots toward drift detection or trust modeling
- Measurement in week 7 shows the deterministic core lags too far behind probe's AST-aware approach (would suggest pulling AST work earlier)
- Bar-2 v1 ships and the "isn't this just claude-context?" objection comes up repeatedly in OSS feedback (would suggest the positioning sharpening above needs to land in the README, not just IDEAS.md)
