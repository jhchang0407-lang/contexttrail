# Retrieval eval reference & post-PRD-0005 quality checklist

**Status:** `126`-case deterministic fixture eval passes all `15` gates. Current headline metrics: overall `Ranked useful 91.3%`, overall `Top-1 acceptable 80.2%`, anchored `Top-1 acceptable 95.7%`, unanchored `Top-1 acceptable 94.3%`. The fixture eval is the contract gate. The older 10-query dogfood eval remains historical context only.

**Audience:** Anyone returning to retrieval work needing to understand: what each gate validates, how to interpret a failure, how to add cases without breaking the gate, and why the corpus and cards are shaped the way they are.

> If you only need to run it: `npm run eval:retrieval`. Everything else in this doc is for understanding what the run measures and how to extend it.

## Compression and assembly pressure

The retrieval fixture remains the main correctness gate, but we now also track how well the ranked pack survives aggressive size pressure and synthetic context expansion.

Run:

```bash
npm run eval:compression
npm run eval:assembly-pressure
```

Current read:

| Benchmark | Current finding | Why it matters |
|---|---|---|
| Compression | Quality stays almost flat down to the `compact_500` profile | The current ranking surface is already very compact |
| Assembly pressure | Even `12k_x6` synthetic expansion holds nearly perfectly | The ranked order is stable even when we pretend each kept item expands into much more surrounding context |
| Neighbor-heavy pressure | Neighbor-dependent cases stay at `100%` top-1 retention and `100%` must coverage through the strongest tested setting | The current top-of-pack ordering is not brittle on the harder “needs surrounding context” slice |

Most important implication:

- compression is not the current bottleneck
- the system is already compact enough that shrinking the token budget further does not meaningfully bend quality on this fixture
- if we want to find a real break point later, we likely need more structural expansion pressure: parent sections, sibling sections, and linked ADR/runbook neighbors, not just token multiplication
- the first week-5 assembly pass should stay narrow: anchored implementation tasks first, with low-signal recovery treated as a separate problem

Guardrail summary:

- `compact_500` is currently the tightest budget profile that still stays within the existing quality guardrails
- `12k_x6` is currently the strongest synthetic assembly-pressure profile that still preserves the current ranked surface on both all-case and neighbor-heavy slices

Week-5 direction:

- model structural assembly from one grounded source chunk
- evaluate `primary_only`, `parent`, `siblings`, and `linked_neighbor` as separate stages
- measure minimal sufficient stage and over-expansion, not only final usefulness
- keep `signal_empty` and broad recovery out of the first assembly gate

---

## 1. The two evals

ContextTrail has two retrieval-quality evals serving different purposes:

| Eval | Lives in | Corpus | Cases | Purpose |
|---|---|---|---|---|
| **Fixture eval** (CI gate) | [src/eval/retrieval-fixture.ts](../../src/eval/retrieval-fixture.ts), [tests/fixtures/eval-set.yaml](../../tests/fixtures/eval-set.yaml) | Synthetic, ephemeral | 126 | Deterministic regression gate. Same answer every run. |
| **Dogfood eval** (historical) | Ad-hoc scripts (originally in `tmp/`) | ContextTrail's own `docs/` + `.contexttrail/cards/` | 10 | One-time HITL evaluation of payload reduction + retrieval quality on real content. Originated D47. |

The fixture eval is the gate. The dogfood eval is preserved further down for context — it's why the structural-multiplier and display-order-separation tuning exists.

---

## 2. What the fixture eval validates

For every case, the harness drives a real `retrieve_context_pack` MCP call against an ephemeral corpus and checks the response against the case's expectations. Each case answers eight independent questions:

1. **Mode** — did query-mode classification (anchored / signal_empty / unanchored) come out right?
2. **Locked** — is every expected card actually in `response.locked`, with the right reason?
3. **Forbidden locked** — are *forbidden* cards (cross-domain over-locks) absent from `response.locked`?
4. **Evidence** — did `evidence_covers_locked` promotion fire on the cards we expected, and is `derived_from` populated?
5. **Ranked-useful** — is `expected_top_source` in the top-3 of `response.ranked` chunks?
6. **Forbidden in top-3** — are distractor docs absent from the top-3 chunks?
7. **Agent-answer** — does every entry in `must_include_sources` appear *somewhere* in `response.ranked`?
8. **Omitted** — when chunks were filtered, did `response.omitted.top` populate (so the agent can ask to widen budget)?

These are aggregated into 15 gates (see §6). The point is not to test BM25 in isolation — it's to validate the full retrieval contract a real MCP client would observe.

---

## 3. The fixture corpus

The harness creates a fresh temp directory per run, calls `init(cwd)`, copies fixture docs into `docs/`, writes synthetic cards into `.contexttrail/cards/`, and then drives the normal `runImport` + `runCardImport` pipeline. Nothing is loaded from your real `.contexttrail/` cache.

### 3.1 Docs (19 files: 15 canonical + 4 distractor)

```
tests/fixtures/docs/
├── adr/
│   ├── 0001-idempotency-keys.md          # decision/payments
│   ├── 0002-webhook-idempotency.md       # decision/notifications
│   └── 0003-token-storage.md             # decision/auth
├── auth/
│   ├── sessions.md                       # module/auth/sessions
│   ├── tokens.md                         # module/auth/tokens
│   └── permissions.md                    # module/auth/permissions
├── billing/
│   ├── invoices.md                       # module/billing/invoices
│   ├── subscriptions.md                  # module/billing/subscriptions
│   └── proration.md                      # module/billing/proration
├── notifications/
│   ├── email.md                          # module/notifications/email
│   └── webhooks.md                       # module/notifications/webhooks
├── payments/
│   ├── refunds.md                        # module/payments/refunds
│   ├── audit.md                          # module/payments/audit
│   └── reconciliation.md                 # module/payments/reconciliation
└── general/                              # ── distractor docs ──
    ├── glossary.md                       # project/general · doc_role: example
    ├── release-notes.md                  # project/general · doc_role: example
    ├── style-guide.md                    # project/general · doc_role: example
    └── incident-runbook.md               # project/general · doc_role: example
```

**About `general/` distractors:** these docs deliberately mention every domain symbol/route in a non-canonical way — release-notes lists `RefundService.processRefund` in version history, the style guide cites `InvoiceService.create` as a naming example, etc. Their purpose is to exercise the engine's ability to **not** surface plausible-but-wrong content for domain queries. They have `scope: { layer: project, project: general }` (so no domain query has scope-match against them) and `doc_role: example` (so the role-multiplier demotes them in scoring). Cases that assert on these use the `forbidden_in_top_3: ["docs/general/"]` field — see §6 and §13.

Each doc has a `scope:` frontmatter block declaring its layer/project/module. Some docs additionally list `files:` and `symbols:` inside `scope:` — those become the doc's chunk-level code anchors when imported.

### 3.2 Cards (20 cards, synthesized in `writeEvalCards`)

The cards include 17 healthy cards plus 3 deliberately adversarial cards (C008, S006, C009) used by the stale/deprecated and budget-overflow tests.

The cards are written inline inside [retrieval-fixture.ts:105](../../src/eval/retrieval-fixture.ts) on every run. Editing them means editing the harness file — they are **not** stored as standalone fixture markdown.

| Card | Type | Scope | Anchors | Locks when… |
|---|---|---|---|---|
| C001 | constraint | project/payments | files: refund.ts, reconciliation.ts, audit.ts | derived scope has `project: payments` |
| C002 | constraint | module/payments/reconciliation | files: reconciliation.ts; symbols: ReconciliationService.reconcileRefund | derived scope has `module: reconciliation, project: payments` |
| C003 | constraint | module/auth/sessions | routes: POST /sessions/:id/renew; symbols: SessionStore.get | derived scope has `module: sessions, project: auth` |
| C004 | constraint | project/billing | files: invoice.ts, subscription.ts, proration.ts | derived scope has `project: billing` |
| C005 | constraint | project/notifications | files: email.ts, webhook.ts | derived scope has `project: notifications` |
| C006 | constraint | module/auth/tokens | files: tokens.ts; symbols: TokenStore.issue, TokenStore.revoke | derived scope has `module: tokens, project: auth` |
| C007 | constraint | project/auth | files: sessions.ts, tokens.ts, permissions.ts | derived scope has `project: auth` |
| S001 | symbol_note | module/payments/refunds | symbol: RefundService.processRefund | query has exact symbol `RefundService.processRefund` |
| S002 | symbol_note | module/payments/audit | symbol: AuditLogger.record | query has exact symbol `AuditLogger.record` |
| S003 | symbol_note | module/billing/invoices | symbol: InvoiceService.create | query has exact symbol `InvoiceService.create` |
| S004 | symbol_note | module/notifications/webhooks | symbol: WebhookDispatcher.dispatch | query has exact symbol `WebhookDispatcher.dispatch` |
| S005 | symbol_note | module/auth/permissions | symbol: PermissionChecker.can | query has exact symbol `PermissionChecker.can` |
| E001 | evidence | module/payments/refunds | covers: [C001] | C001 is locked |
| E002 | evidence | module/billing/invoices | covers: [C004, S003] | C004 *or* S003 is locked |
| E003 | evidence | module/notifications/webhooks | covers: [C005, S004] | C005 *or* S004 is locked |
| E004 | evidence | module/auth/tokens | covers: [C006] | C006 is locked |
| **C008** | constraint | project/billing | files: invoice.ts (DEPRECATED) | **Never** — `authority: deprecated` filters it out. |
| **S006** | symbol_note | module/billing/invoices | symbol: InvoiceService.create (DEPRECATED) | **Never** — `authority: deprecated` filters it out. |
| **C009** | constraint | project/telemetry | files: src/telemetry/collector.ts | derived scope has `project: telemetry`. Body is ~4500 tokens to force budget-overflow on small budget tier. |

**Why C006 has both `files:` and `symbol_anchors:`:** so file-anchored token queries (e.g., `--files src/auth/tokens.ts`) recognize the file *and* derive the `module:auth/tokens` scope. Without `files: tokens.ts` on C006, that file would be unrecognized and the query would fall to signal-empty.

**Why C007 was added:** to give the auth project a project-level constraint analogous to C001 (payments) and C004 (billing). This means symbol-only auth queries lock both the module constraint and the project constraint, mirroring the locked behavior real auth corpora would have.

---

## 4. Locking semantics (per ADR-0011 + locked-include.ts)

### 4.1 Constraint locking — hierarchical scope match

A `constraint` card locks for a query iff the card's scope is an **ancestor or equal** of the derived query scope along the hierarchy `company > team > project > module > feature`.

- **company-scope cards** lock universally (regardless of derived scope) — surfaced via `broad_scope: true`. The fixture has none.
- **project-scope cards** (C001, C004, C005, C007) lock when `card.project === query.project`. The card's `files:` field is *not* checked here — it is only an anchor source for query-mode classification, not a gating predicate.
- **module-scope cards** (C002, C003, C006) lock when `card.project === query.project AND card.module === query.module`. Strict module match — sibling modules don't subsume each other; descendants don't subsume ancestors.
- **decision-scope cards** do not produce locked-includes. ADR docs surface only via ranked.

### 4.2 Symbol-note locking — strict equality

A `symbol_note` card locks iff *any* symbol in the query exactly matches one of the card's `symbol_anchors`. Case-sensitive; no fuzzy matching. This is why `signal-empty-case-sensitive-symbol` (`refundservice.processrefund` lowercase) does not lock S001.

### 4.3 Evidence promotion — one-hop covers traversal

After primary (constraint + symbol_note) locks resolve, the harness walks the `covers:` lists of every locked primary card. Each evidence card whose `covers:` list contains a locked-primary id is promoted with `lock_reason: evidence_covers_locked` and `derived_from: [primary_ids...]`. Cap: 2 evidence cards promoted per primary (sorted by freshness then coverage breadth). The eval verifies this via `expected_evidence_covers_locked`.

### 4.4 Query-mode classification

For a query providing some combination of `files`, `symbols`, `routes`:

- **anchored** — at least one anchor was *recognized* (matched a card_anchor or code_anchor in the index).
- **signal_empty** — anchors were provided but *all* were unrecognized. Emits `anchors_unrecognized` warning.
- **unanchored** — no anchors provided at all. (Plain `task: ...` query.)

When `anchored` with mixed recognized/unrecognized anchors, the unrecognized ones simply contribute no scope — the recognized ones determine `query_scopes`. No warning is emitted in that mixed case.

### 4.5 Anchor → scope contributors

`AnchorLookup` (the seam introduced for PRD-0005) takes a `{kind, value}` and returns contributors with their scopes:

- **file anchor**: looks in `code_anchors` (kind=file, indexed source) + `card_anchors` (kind=file, from card `files:` fields). The card's scope is the contributor scope.
- **symbol anchor**: looks in `code_anchors` (kind=symbol, indexed source) + `card_anchors` (kind=symbol, from card `symbol_anchors:` fields).
- **route anchor**: looks in `card_anchors` (kind=route) only.

In the fixture there is no source code, so file/symbol anchor recognition flows entirely through card anchors. This is by design — file-anchored queries grow the recognition set as you grow the cards' `files:` lists.

---

## 5. Eval cases (126 total)

[tests/fixtures/eval-set.yaml](../../tests/fixtures/eval-set.yaml) is the single source of truth for cases. Each case has the shape:

```yaml
- id: anchored-refund-idempotency
  task: "make refunds idempotent"
  files: ["src/payments/refund.ts"]
  symbols: ["RefundService.processRefund"]
  budget: default              # small | default | large; default omitted
  expected_query_mode: anchored
  expected_locked: ["C001", "S001", "E001"]
  forbidden_locked: []         # cards that MUST NOT appear in response.locked
  forbidden_in_top_3: []       # path substrings that MUST NOT appear in top-3 chunks
  expected_warning_kinds: []   # warning kinds that MUST be present (e.g. "locked_overflow", "no_matches")
  expected_signal_empty_warning: false
  expected_evidence_covers_locked: ["E001"]
  expected_top_source: "docs/payments/refunds.md"
  acceptable_top_sources: ["docs/payments/refunds.md"] # optional for ambiguous cases
  must_include_sources: ["docs/payments/refunds.md"]
  baseline_ranked_useful: true
  notes: "..."
  fragile: true              # optional watchlist marker for corpus-sensitive passing cases
  anchor_source: doc_frontmatter # optional taxonomy: card | doc_frontmatter | mixed | none
```

`forbidden_locked` and `forbidden_in_top_3` are optional (default `[]`). When set, they assert *negative* properties — see §6 (gates) and §8 (adversarial cases).

`fragile: true` is also optional. It does not weaken pass/fail gates and it does not excuse a regression: a fragile case with a forbidden top-3 hit still fails the normal `forbidden in top-3` gate. It only adds a separate **Fragile passes** watchlist row when the case currently passes, so corpus-sensitive wins remain visible instead of being mistaken for fully solved engine behavior.

`expectation_kind: ambiguous` is for legitimate multi-source or broad-domain tasks where more than one canonical source is acceptable. Prefer adding `acceptable_top_sources` plus a note explaining the ambiguity. Do not use `ambiguous` to hide a deterministic miss: if a task has one objectively canonical source, keep `expectation_kind: deterministic` and fix the engine or fixture substrate.

`anchor_source: doc_frontmatter` marks cases whose query anchor is recognized from imported Doc Chunk code anchors derived from markdown frontmatter (`scope.files`, `scope.symbols`, or `scope.routes`), not from Card anchors and not from real `.ts` source indexing. Real source-code import is out of scope for v1.

### 5.1 Distribution

| Bucket | Count | Subtotals |
|---|---|---|
| **anchored** | 69 | payments (11), auth/sessions (3), auth/tokens (5), auth/permissions (3), cross-auth (1), billing/invoices (5), billing/subs+proration (6), notifications (6), multi-anchor (10), **adversarial (19)** |
| **signal_empty** | 22 | unknown file/symbol/route/mixed anchors, case-sensitive mismatches, wrong HTTP methods |
| **unanchored** | 35 | broad domain queries, ADR queries, subsection-specific queries, **adversarial (3)** |

Adversarial cases break down across six dimensions: cross-domain forbidden_locked (5), distractor forbidden_in_top_3 (5), stale/deprecated/freshness filtering (3), budget overflow (1), code-anchor recognition without card backup (6), vague-query recovery signals (2).

### 5.2 Anchored cases — what to think about

Anchored cases test the lock-derivation path end-to-end. The trick is that `expected_locked` must match exactly what the live locking code produces.

For each anchor you provide, ask:

1. Which card(s) declare this anchor? (file in `files:`, symbol in `symbol_anchors:`, route in `routes:`)
2. What scope does each card contribute to `query_scopes`?
3. Which constraint cards match that scope (per §4.1)?
4. Which symbol_note cards lock from `query.symbols` exact-match?
5. Which evidence cards promote via `covers:` from those primaries?

**Worked example: `anchored-token-route-mix`**

```yaml
routes: ["POST /sessions/:id/renew"]
files: ["src/auth/tokens.ts"]
```

- Route resolves via C003's `routes:` → contributor scope `{project: auth, module: sessions}`.
- File resolves via C006 (`files: [tokens.ts]`) → scope `{project: auth, module: tokens}`.
- File also resolves via C007 (`files: [tokens.ts, ...]`) → scope `{project: auth}`.
- Constraint matches: C003 (module match), C006 (module match), C007 (project match).
- Symbol notes: none queried. None lock.
- Evidence: C006 is locked → E004 promotes (covers C006).
- ⇒ `expected_locked: [C003, C006, C007, E004]`, `expected_evidence_covers_locked: [E004]`.

### 5.3 Signal-empty cases — what to think about

For mode = `signal_empty`, *every* provided anchor must be unrecognized. The tricks are:

- Use a file/symbol/route that's **not** in any card's anchor list.
- Avoid accidental code_anchor recognition — there's no source code in the fixture, so file anchors never come from code chunks.
- Case-sensitivity bites: `RefundService.processrefund` (lowercase `r` on processRefund) ≠ `RefundService.processRefund`.

Signal-empty cases set `must_include_sources: []` because there's nothing meaningful for the agent to do with the response — the correct agent behavior is "ask user to provide valid anchors." `agentAnswerPass` is trivially true (empty list ⇒ all entries match ⇒ true).

### 5.4 Unanchored cases — what to think about

Unanchored = no anchors at all. `query_scopes` is empty, so no constraint locks (except company-scope, which we don't have). The ranking is BM25 + scope-match (always 0 here) + card-type bias.

The 100% unanchored ranked-useful gate is the strictest in the eval. To make it reliable:

- Pick `expected_top_source` only when the target doc has **highly specific terms** from your task that no other doc shares. "TOKEN_REVOKED" appears only in tokens.md. "HMAC-SHA256" appears only in webhooks.md. "Marketing emails require" appears only in email.md.
- Avoid generic terms ("authentication", "service", "request") — those match many docs and the doc you want may not win.
- For ADR queries, prefer the ADR's title text in your task (the ADR will then reliably outscore the implementation doc).

If the top source is genuinely ambiguous (multi-domain query, generic vocabulary), set `baseline_ranked_useful: false` — but this counts against the unanchored bucket, which still requires 100%. The cleanest answer is to make the task more specific.

### 5.5 Budget cases

`budget: small` (4k tokens) and `budget: large` (10k tokens) cases test the locked-include guarantee at the extremes. Locked correctness must hold (no overflow at small budget — if it ever did, an `locked_overflow` warning would fire). The ranked tier is harder to predict at large budget because more candidates fit; we use `baseline_ranked_useful: false` for the large multi-file cases where the top source is genuinely variable.

---

## 6. The 15 gates

Each gate is a single boolean. The harness exits non-zero if any gate fails. Gates 2, 4, 5, and 7 were added in the adversarial slices (2026-05-07) — they assert negative properties or specific signals, distinct from the other gates that assert positive ones.

| # | Gate | Bar | Computed from | Why it exists |
|---|---|---|---|---|
| 1 | eval cases | =126 | `rows.length` | Catches accidental case loss/duplication during edits. |
| 2 | **query mode exactness** | =100% | `actual_query_mode === expected_query_mode` per case | Mode classification (anchored/signal_empty/unanchored) is the engine's primary contract — no "approximately" allowed. |
| 3 | locked correctness | =100% | `expected_locked` ⊆ `response.locked` per case | Locking semantics must be exact, not "approximately." |
| 4 | **forbidden locked** | =100% | no entry in `forbidden_locked` appears in `response.locked` | Catches over-locking (engine locking cross-domain cards it shouldn't). |
| 5 | **forbidden in top-3** | ≥95% | no entry in `forbidden_in_top_3` appears as substring of any top-3 chunk drift | Catches distractor docs winning the ranker. ≥95% (not 100%) leaves headroom for the lexical-dense unanchored distractor case (§13.1). |
| 6 | evidence provenance | =100% | every entry in `expected_evidence_covers_locked` has `lock_reason: evidence_covers_locked` + non-empty `derived_from` | Evidence promotion must be observable, not inferred. |
| 7 | **expected warnings** | =100% | every entry in `expected_warning_kinds` appears in `response.warnings.kind` | Specific warnings (`locked_overflow`, `no_matches`) must fire when the eval expects them. |
| 8 | baseline ranked useful | =100% | cases with `baseline_ranked_useful: true` must have `expected_top_source` in top-3 chunks | Cases I declared as "this should always work" must always work. |
| 9 | anchored ranked useful | ≥80% | same check, scoped to `expected_query_mode: anchored` | Most retrieval value is in anchored queries; high but not strict bar. |
| 10 | anchored agent answer | ≥80% | every `must_include_sources` entry appears anywhere in `response.ranked` | Locked + ranked together must give the agent the answer. |
| 11 | signal-empty warning | =100% | `anchors_unrecognized` warning emitted iff `expected_signal_empty_warning: true` | Honest signaling — agent must know when its anchors didn't ground. |
| 12 | signal-empty answer | ≥50% | `must_include_sources` check on signal_empty bucket | Floor; signal_empty cases mostly have empty must_include and trivially pass. |
| 13 | unanchored ranked useful | =100% | top-3 check on unanchored bucket (vacuously true for cases expecting `no_matches`) | Strict bar — unanchored is the hardest case and we want it tight. |
| 14 | unanchored agent answer | =100% | must_include check on unanchored bucket | Same. |
| 15 | omitted useful | ≥95% | `omitted.total === 0` OR `omitted.top.length > 0` per case | When omitted, the agent must see the top of the omitted set. |

**A note on cardinality:** `expected_locked: [C001, S001, E001]` does *not* mean "exactly these three are locked." It means "at least these three are locked." Adding more locks to the response (e.g., a new card that newly applies) does not fail gate 2. This is intentional — eval cases stay valid as the corpus grows, as long as the *expected* lock set still locks.

---

## 7. Reading the eval output

A passing run looks like:

```
Retrieval fixture eval: PASS
Fixture: tests/fixtures/eval-set.yaml
Cases: 126

Gate                      Bar    Result  Status
eval cases                126    126     PASS
locked correctness        100%   100%    PASS
...
unanchored agent answer   100%   100%    PASS
omitted useful            >=95%  100%    PASS

Bucket        Cases  Locked  Ranked  Answer  Omitted  Avg bytes
all           126    100%    91.3%   100%    100%     42041
anchored      69     100%    98.6%   100%    100%     41105
signal_empty  22     100%    54.5%   100%    100%     41313
unanchored    35     100%    100%    100%    100%     44343
```

**`Ranked` column for `signal_empty` is expected to stay low** — those cases set `baseline_ranked_useful: false` by definition (there is often no meaningful grounded first doc when anchors do not ground). The `Answer` column for signal_empty is 100% because `must_include_sources: []` is trivially satisfied. Both are intentional.

A failing run adds a `Misses:` section listing the cases that failed and which checks (`locked` / `evidence` / `ranked` / `answer` / `omitted` / `warning`) fired. The output also includes the actual top-3 IDs so you can compare against `expected_top_source`.

### 7.1 Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `locked` miss on a card you expected to lock | Wrong scope-match prediction in §4.1; or you used a file/symbol/route the cards don't anchor | Trace the worked-example flow in §5.2; check the card's anchors. |
| `evidence` miss | The evidence's `covers:` list doesn't actually contain a card that locked | Check `covers:` on the evidence card definition. |
| `ranked` miss (top-3) | Your `expected_top_source` doc didn't make top-3 — usually because BM25 picked a different doc | Use more domain-unique terms in the task; or set `baseline_ranked_useful: false` for that case. |
| `answer` miss (must_include not in ranked) | The doc didn't appear *anywhere* in ranked — it scored below `min_final_score` | Make the task text closer to the doc's wording, or remove the entry from `must_include_sources`. |
| `warning` miss on signal_empty | One of your "unknown" anchors actually matched a card_anchor | Check spelling/case; try a name that's clearly not in any card. |

### 7.2 What `Misses:` lines look like

```
- anchored-billing-large: ranked — Large budget anchored case across all billing files.
  expected_top_source=docs/billing/invoices.md
  top3=chunk:f4b57fc738083497, card:S003, chunk:e8aabe8df9e36300
```

The `top3` shows IDs of the actual top-3 entries. Cards always have `kind: card` (their id is the card_id). Chunks have `kind: chunk` and a chunk hash. To resolve a chunk hash to a doc, run a local probe with `--json` and grep the contexttrails.

---

## 8. Adversarial cases

Most cases are happy-path: "if I provide these anchors, the right cards lock and the right doc surfaces." Ten cases (added 2026-05-07) deliberately test failure modes the engine could plausibly exhibit. They use `forbidden_locked` and `forbidden_in_top_3` to assert *what should not happen.*

### 8.1 Cross-domain non-locking (5 cases, `forbidden_locked`)

Pattern: "anchor scoped to domain X must not lock cards from domain Y." Catches the class of bug where a constraint card's scope-match logic over-fires (e.g., a billing query that incorrectly locks payments cards because both projects exist in the same query).

- `adv-billing-no-cross-domain-locks` — billing anchors must not lock C001/C002/C003/C006/C007.
- `adv-payments-no-cross-domain-locks` — refund query must not lock sibling reconciliation module (C002) or any non-payments card.
- `adv-tokens-no-sessions-lock` — token query must not lock C003 (sibling auth/sessions).
- `adv-permissions-no-tokens-lock` — permissions query must not lock C006 (sibling auth/tokens).
- `adv-webhook-no-cross-domain-locks` — notifications query must not lock auth/payments/billing.

All 5 currently pass at 100%. Tightens the locking contract: a regression that broadens which cards lock would fail one of these immediately.

### 8.2 Distractor docs (5 cases, `forbidden_in_top_3`)

The `general/` distractor docs (glossary, release-notes, style-guide, incident-runbook) mention every domain symbol/route in non-canonical contexts. Cases assert that for domain queries, no `general/` chunk surfaces in top-3.

- `adv-distractor-refund-anchored` (anchored, file+symbol) — passes via D47 structural demotion + role-multiplier.
- `adv-distractor-invoice-anchored` (anchored, file+symbol) — passes.
- `adv-distractor-token-anchored` (anchored, file+symbol) — passes.
- `adv-distractor-webhook-anchored` (anchored, file+symbol) — passes.
- `adv-distractor-refund-unanchored` (**unanchored**, no anchors) — **fails**. See §13.

The first 4 demonstrate that anchored queries reliably keep distractors out of top-3 because two demotion mechanisms compound: (a) D47's structural multiplier drops candidates with no scope-match to 0.10–0.15× when anchored, and (b) `doc_role: example` on every `general/` doc applies the role-multiplier penalty.

The 5th — unanchored, where neither demotion fires the same way — fails. This is real engine signal; see §13.

### 8.3 Stale / deprecated card filtering (2 cases, `forbidden_locked`)

Pattern: place adversarial cards (deprecated authority, stale freshness state) sharing anchors with healthy cards. Assert the healthy ones lock and the adversarial ones don't.

- `adv-deprecated-cards-filtered` (file + symbol billing query) — asserts `forbidden_locked: [C008, S006]`. Both pass.
- `adv-deprecated-symbol-still-locks-healthy` (symbol-only billing query) — same forbidden_locked. Passes.

The fixture has C008 (deprecated billing constraint sharing C004's project) and S006 (deprecated symbol_note for `InvoiceService.create`, sharing S003's anchor). Both are filtered by the engine's `authority === "deprecated"` gate in `resolvePrimaryLocks`. C004 and S003 still lock normally despite the deprecated cards being adjacent in the index.

**Finding — see §13.2:** the `freshness_state: potentially_superseded` filter in `promoteEvidenceFromLocks` is unreachable from the standard card pipeline. We removed E005 from the fixture once we discovered this.

### 8.4 Budget pressure (1 case, `expected_warning_kinds: ["locked_overflow"]`)

- `adv-budget-overflow-locked` (small budget + telemetry file anchor) — locks C009 alone, whose body is ~4500 tokens, exceeding the 4000-token small budget. Engine emits `locked_overflow` warning. Passes.

C009 is intentionally fat — its body is ~90 paragraphs of telemetry-domain text — and lives in an isolated `telemetry` project so its presence doesn't affect any other test case's expected lock set. This is the only fixture mechanism for forcing locked-overflow without polluting other tests.

### 8.5 Code-anchor recognition without card backup (3 cases)

Pattern: query a symbol that's declared in a doc's frontmatter `scope.symbols` but **not** in any card's `symbol_anchors`. The recognition must flow through `code_anchors` (populated from doc frontmatter via `persistChunkWithAnchors`), not `card_anchors`.

- `adv-code-anchor-invoice-capture` — `InvoiceService.capture` in invoices.md frontmatter only. Passes.
- `adv-code-anchor-subscription-cancel` — `SubscriptionService.cancel` in subscriptions.md frontmatter only. Passes.
- `adv-code-anchor-proration-compute` — `ProrationCalculator.compute` in proration.md frontmatter only. Passes.

All three derive `module:billing/<module>` scope correctly, lock C004 (project:billing), and promote E002 via covers. Confirms code_anchor path is robust for symbols declared in doc frontmatter.

### 8.6 Vague-query "ask for anchors" signal (1 case, `expected_warning_kinds: ["no_matches"]`)

- `adv-vague-no-matches` (gibberish unanchored task: "xyz frob baz quux nonexistent gibberish") — query produces empty `ranked`, engine emits `no_matches` warning. Passes.

`no_matches` is the existing engine signal for "I have nothing useful for you." The warning's hint is "try a broader budget, different `files`/`symbols`, or rephrasing the task" — the agent should treat this as a request to provide anchors. The gate-side mechanic: when `expected_warning_kinds` includes `no_matches`, the case's `rankedUseful` is treated as vacuously true (since empty ranked is the *expected* outcome).

**Finding — see §13.3:** `no_matches` only fires when `ranked.length === 0`. For middle-ground vague queries that produce weak-but-nonzero matches above `min_final_score: 0.05`, the warning doesn't fire. Tightening that threshold or adding a "low-confidence" signal would catch more vague-query cases.

### 8.7 What the adversarial slices did and didn't catch

- **Did catch (pre-`doc_role: example`):** the original distractor docs without role tagging surfaced in 3 anchored cases. Adding `doc_role: example` recovered 2 of those — confirming the role-multiplier path works.
- **Did catch (deprecated authority):** C008 + S006 are correctly filtered. The engine's authority gate is solid.
- **Did catch (locked overflow):** when locked content exceeds budget, `locked_overflow` warning fires with per-card token breakdown. Works.
- **Did catch (code_anchor scoping):** symbols declared only in doc frontmatter `scope.symbols` correctly route through code_anchors and contribute correct scopes. Works.
- **Did catch (no_matches):** truly vague queries (gibberish task with no corpus overlap) get `no_matches` warning. Works.
- **Surfaced gap (§13.1):** unanchored queries with high lexical-density distractors can still beat the canonical doc on pure BM25.
- **Surfaced gap (§13.2):** `freshness_state: potentially_superseded` filter exists in evidence promotion but no code path writes that state, so the filter is dead code from the card pipeline.
- **Surfaced gap (§13.3):** `no_matches` only fires on truly empty ranked; mid-vague queries with weak matches don't get a "please provide anchors" signal.
- **Did not test (real .ts code import):** `runImport` parses every file as markdown — there is no source-code import path in v1. The closest existing alternative (doc frontmatter `scope.symbols`) is what §8.5 tests. Real .ts file indexing is post-v1 work.

---

## 9. Adding new cases

The fixture is designed to be extended. Two things to think about before adding a case:

### 8.1 If the case needs a card or doc that doesn't exist yet

You'll need to either:

- **Add a new card** — edit `writeEvalCards` in [retrieval-fixture.ts:105](../../src/eval/retrieval-fixture.ts). Pick the next ID in sequence (e.g., S006, C008, E005). Make sure `covers:` references exist for evidence cards.
- **Add a new doc** — drop a markdown file under `tests/fixtures/docs/...`. Include a `scope:` frontmatter block. The harness picks it up automatically via `runImport('docs/**/*.md')`.

After adding cards/docs, run `npm run eval:retrieval` to confirm no existing case breaks (e.g., a new project-level constraint that newly co-locks would silently *strengthen* expected_locked, which is fine; but a new symbol_note for a symbol some existing case uses would break that case).

### 8.2 If the case uses existing cards and docs

Add a new entry to [eval-set.yaml](../../tests/fixtures/eval-set.yaml). Group it into the matching `# ── ...` section. Use the worked-example flow in §5.2 to compute `expected_locked`.

### 8.3 Update the gate count

[retrieval-fixture.ts:545](../../src/eval/retrieval-fixture.ts) has `gate("eval cases", "100", rows.length, rows.length === 100)`. Bump the literal to your new total.

### 8.4 Pitfalls when adding cases

- **Don't reuse an existing case's anchors with only the task text changed.** The retrieval response is identical, so it doesn't add coverage.
- **Don't set `baseline_ranked_useful: true` if you're not confident.** That gate is 100% — one miss fails the run.
- **Symbols are case-sensitive.** Type them exactly as they appear in card `symbol_anchors:`.
- **For file anchors, the path must be exact** — including the `src/` prefix and the file extension. E.g., `src/billing/invoice.ts`, not `billing/invoice.ts`.
- **For routes, the pattern must match exactly** — including HTTP method case and parameter form. `POST /sessions/:id/renew` is recognized; `post /sessions/:id/renew` is not (case mismatch on method); `POST /sessions/{id}/renew` is not (parameter form mismatch).

---

## 10. Reproducing

```bash
# Deterministic fixture eval gate (CI-friendly, exits non-zero on failure)
npm run eval:retrieval

# Machine-readable JSON output
npm run eval:retrieval -- --json

# Optional: rebuild fresh corpus cache before running (the gate doesn't use it,
# but a fresh build catches schema migration regressions early)
npm run build
rm -f .contexttrail/cache/contexttrail.db*
node dist/cli/main.js import 'docs/**/*.md'
node dist/cli/main.js card import
node dist/cli/main.js verify
```

The fixture eval runs against an ephemeral in-memory corpus; it does not depend on the live `.contexttrail/` cache. Running it on a clean checkout is sufficient.

---

## 11. Historical: the 10-query dogfood eval (pre-D47 baseline + post-D47)

The fixture eval did not exist when PRD-0005 shipped — only this 10-query HITL eval against ContextTrail's own docs and cards. The dogfood eval is what surfaced the meta-doc-noise problem that D47 fixed. Numbers here are kept as the "why" for D47.

### 11.1 Eval set (10 queries)

10 queries spanning symbol-heavy, constraint-heavy, vague/broad, evidence-relevant, and budget-sensitive cases. Run against the live `.contexttrail/cache` populated from `docs/**/*.md` + `.contexttrail/cards/`.

### 11.2 Original baseline results (pre-D47)

Kept as a historical record — these numbers are why D47 existed.

| # | Query | Budget | Mode | Locked (count) | Critical lockeds present | Top-3 character | Before payload | After payload | Notes |
|---|---|---|---|---|---|---:|---:|---|
| Q01 | RefundService.processRefund idempotency | default | anchored | 8 | C002+S001+E001 ✓ | meta-doc (ADR-0011) | ~252k | 51,756 | Symbol lock + evidence promotion both fire. Locked has the answer. |
| Q02 | Modify src/payments/refund.ts | default | anchored | 7 | C001+C002+E001 ✓ | weak BM25 (~0.077) | ~252k | 49,352 | `code_scopes:` fallback grounds the file anchor. Ranked top-3 is irrelevant ContextTrail meta-doc. |
| Q03 | What must I not break if I change audit logging for refunds? | default | anchored | 9 | C003+C004+S002 ✓ | S001 card surfaced as #1 | ~252k | 53,733 | Strongest ranked pass. |
| Q04 | How should I reason about AuditLogger.record? | default | anchored | 6 | S002+C004 ✓ | meta-doc (ARCHITECTURE) | ~252k | 50,266 | Locked carries the answer. |
| Q05 | What constraints apply to session expiry behavior? | default | unanchored | 1 | per-contract ✓ | meta-doc (ADR-0011) | ~252k | 50,854 | Documented broad-query gap. |
| Q06 | Money.add currency handling | default | anchored | 4 | S005+E003+C001 ✓ | meta-doc (ADR-0007) | ~252k | 56,109 | Locked answers; ranked is corpus self-reference. |
| Q07 | What evidence should I check before changing refund retry behavior? | default | anchored | 8 | E001 ✓ | meta-doc (substrate runbook) | ~252k | 52,710 | Evidence promotion does the work. |
| Q08 | I'm working on a broad payment task | default | unanchored | 1 | per-contract ✓ | meta-doc | ~252k | 56,181 | Documented broad-query limit. |
| Q09 | RefundService.processRefund with small budget | small | anchored | 8 (no overflow) | C002+S001+E001 ✓ | meta-doc (ADR-0010) | ~252k | **37,876** | Locked-include guarantee at small budget. |
| Q10 | Vague refund task | default | unanchored | 1 | per-contract ✓ | C002 ranked at #2 | ~252k | 52,321 | Best of unanchored cases. |

### 11.3 D47 patch

After observing the meta-doc top-3 noise pattern, two targeted changes shipped:

1. **Structural multiplier in [src/retrieve/score.ts](../../src/retrieve/score.ts)** — anchored candidates with `scope_match > 0` keep `multiplier = 1.0`. With only `mention_overlap > 0` they drop to `0.15`. With neither (lexical-only matches like meta-doc ADRs) they drop to `0.10`. Gated on `query_mode === "anchored"` so unanchored isn't affected.
2. **Display-order separation in [src/retrieve/render.ts](../../src/retrieve/render.ts)** — wire `ranked` is ordered by `final_score` (relevance), not `packing_score` (density). Universal change, affects all modes.

### 11.4 Post-D47 results

| # | Mode | Locked | Top-3 character (post-D47) | Pre-D47 payload | Post-D47 payload | Δ payload |
|---|---|---|---|---:|---:|---:|
| Q01 | anchored | 8 | C004 + S002 + S003 (payments-domain cards) | 51,756 | 36,340 | **−30%** |
| Q02 | anchored | 7 | S001 + C005 + S005 | 49,352 | 24,709 | **−50%** |
| Q03 | anchored | 9 | S001 + S003 + C005 | 53,733 | 13,295 | **−75%** |
| Q04 | anchored | 6 | S003 + C003 + eval-doc | 50,266 | 15,063 | **−70%** |
| Q05 | unanchored | 1 | **S004 + C006** + IDEAS | 50,854 | 46,573 | −8% |
| Q06 | anchored | 4 | C004 + S002 + S003 | 56,109 | 10,852 | **−81%** |
| Q07 | anchored | 8 | C005 + S003 + C004 | 52,710 | 24,303 | **−54%** |
| Q08 | unanchored | 1 | S004 + IDEAS + VISION | 56,181 | 56,570 | +1% |
| Q09 | small / anchored | 8 | eval-doc + ADR-0007 + VISION | 37,876 | 29,323 | −23% |
| Q10 | unanchored | 1 | **C002 + S001** + eval-doc | 52,321 | 50,618 | −3% |

**Aggregate (post-D47 vs pre-D47):**

| Metric | Pre-D47 | Post-D47 | Δ |
|---|---:|---:|---:|
| avg total_bytes | 51,116 | 30,765 | **−40%** |
| avg locked_bytes | 3,349 | 3,349 | 0% (locked unchanged ✓) |
| avg ranked_bytes | 46,685 | 26,289 | **−44%** |
| avg used_tokens | 5,790 | 4,020 | **−31%** |

**Tally vs criteria:** locked correctness 10/10, ranked-useful 8/10 (Q08, Q09 residual misses), agent-answer 9/10, omitted summary 10/10, payload reduction every case. Q08 (broad unanchored) and Q09 (corpus self-reference at small budget) are documented residual misses with known causes.

---

## 12. Out of scope (deferred)

- **Broad-query widening** for unanchored queries with no scope alignment (Q08-style). PRD-0006 territory.
- **Customer-corpus eval** — the dogfood corpus has a meta-doc noise floor that wouldn't exist in a real customer repo. Worth building if we sign customer #1.
- **Embeddings or LLM rerank** — would reduce ranked top-3 noise on this corpus, but complexity-vs-value is wrong before customer signal.

---

## 13. Known engine weaknesses (surfaced by adversarial cases)

The fixture eval explicitly tracks failure modes the engine can plausibly exhibit. Three weaknesses have been surfaced and documented. None currently brick the gate — `forbidden in top-3` is at 100% as of the latest run, but the underlying lexical-distractor gap (§13.1) remains real and could re-surface with corpus changes.

### 13.1 Lexical-dense distractors fool unanchored ranking (fragile pass)

- **Case:** `adv-distractor-refund-unanchored`
- **Task:** "refund duplicate provider retry idempotent"
- **Expected top-3:** must NOT contain `docs/general/`. Currently passes (`forbidden in top-3` at 100%).
- **Actual top-3 (after C009 added to corpus):** `card:S001`, `chunk:refunds.md`, `card:C006` (Token rotation — tangentially matches "idempotent"). The release-notes distractor dropped to position 4+.
- **What changed:** before C009 was added to the fixture (for the budget-overflow test), this case **failed** — `chunk:9482060...` (`docs/general/release-notes.md`) sat at position 3 because release-notes contains the near-exact phrase "Added RefundService.processRefund retry guard on duplicate provider callbacks." Adding C009 (a fat unrelated card) shifted the BM25 IDF for the corpus enough that the distractor lost position 3 to C006.
- **Implication:** the pass is **legitimate but fragile**. The engine is correctly preferring the canonical refund doc over the distractor at positions 1–2; position 3 is contested between mid-relevance cards and the distractor, and the outcome depends on corpus-wide IDF. A small corpus shrink could easily flip this back to failing.
- **Engine fix candidates** (still relevant):
  - Stronger role-multiplier penalty for `doc_role: example` in unanchored mode.
  - Soft canonical-role bias in unanchored ranking.
  - LLM rerank for unanchored top-N.

If `forbidden in top-3` ever drops back to 99.1% (one miss), this is the case to look at first.

### 13.2 `freshness_state: potentially_superseded` is reachable from authored cards

- **Filter location:** [src/cards/locked-include.ts:289](../../src/cards/locked-include.ts) — `promoteEvidenceFromLocks` filters `card.freshness_state !== "potentially_superseded"` before promoting evidence.
- **Writer path:** authored Card frontmatter may set `freshness_state: potentially_superseded` with `freshness_reason: version_drift`. The card loader persists that state, and freshness materialization preserves it as an explicit author signal.
- **What this means:** the evidence-promotion filter is now reachable through the standard card import path. A stale evidence card can remain accepted for auditability while being ineligible for `evidence_covers_locked` promotion.
- **What we tested:** `adv-stale-evidence-filtered` adds E005, an accepted invoice evidence card covering the same primaries as healthy E002, but marked `potentially_superseded`. E005 must not promote; E002 still must promote. Deprecated-authority filtering remains covered by C008 + S006.

### 13.3 Weak non-empty ranked output emits `low_confidence`

- **Filter location:** [src/mcp/transform.ts:190](../../src/mcp/transform.ts) — `no_matches` warning only fires when `ranked.length === 0`.
- **Threshold:** `min_final_score: 0.05` (config). Very low — most vague queries produce at least *some* chunk that clears it, even with weak relevance.
- **Implication:** queries like "what should I think about" can produce non-empty but low-quality ranked output. This must stay distinct from `no_matches`, because the engine did find something, but confidence is too low to treat it as strong guidance.
- **What we tested:** `adv-vague-no-matches` uses gibberish ("xyz frob baz quux") to ensure ranked is empty and the `no_matches` warning fires. `adv-vague-low-confidence` uses a vague natural query with non-empty ranked output and expects `low_confidence`.
- **Engine fix candidates:**
  - Tune the `low_confidence` threshold as the fixture grows.
  - Surface `top-3 score percentile` in explain so agents can decide on their own.
  - Tighten `min_final_score` to a higher value, accepting more cases land in `no_matches`.

---

## 14. Files

- [src/eval/retrieval-eval.ts](../../src/eval/retrieval-eval.ts) — entrypoint (24 lines, just calls fixture + renders)
- [src/eval/retrieval-fixture.ts](../../src/eval/retrieval-fixture.ts) — harness, card definitions, gates
- [tests/fixtures/eval-set.yaml](../../tests/fixtures/eval-set.yaml) — 100 case definitions
- [tests/fixtures/docs/](../../tests/fixtures/docs/) — 14 fixture markdown docs
- [.contexttrail/config.yaml](../../.contexttrail/config.yaml) — `code_scopes:` fallback rules (used by dogfood eval, not fixture)
- [src/cards/locked-include.ts](../../src/cards/locked-include.ts) — `resolveLockedInclude`, `constraintMatchesScope`, evidence promotion
- [src/retrieve/query-scope.ts](../../src/retrieve/query-scope.ts) — `compileQueryScopes`, `AnchorLookup` seam
- [docs/adr/0011-locked-include-matching-rules.md](../adr/0011-locked-include-matching-rules.md) — locking rules canonical reference
