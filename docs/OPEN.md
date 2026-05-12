# Open Questions and Deferred Items

> Updated 2026-05-11 after the context-assembly architecture pass and the PRD-0034 LLM-assisted clarification slice. The retrieval engine is no longer the load-bearing risk — single-doc retrieval, workflow assembly, and agent-completion source-file coverage all measure ≥93% across multiple corpora. **But the engine being a validated technical bet is not the same as the product being done.** The remaining work has shifted from core ranking mechanics to recovery behavior, broader validation, onboarding, and shipping posture.

## Advanced by the 2026-05-11 assembly pass

- **Context-assembly architecture shipped** — three universal candidate-expansion levers (markdown link traversal, nav-graph traversal with directory-grouping fallback, code-import-graph traversal forward + reverse). All deterministic; all ADR-0014-clean.
- **Workflow-assembly metric established and measured** — 95.7% on ContextTrail's own Linear-ticket panel, 93.3% on the untuned valibot generalization test. First evidence the architecture generalizes beyond the corpus it was built against.
- **Agent-completion metric established and measured** — 93.9% source-file coverage across 14 commit-grounded cases. Strictly stronger than "is the doc retrieved": grounded in files actually changed in shipping commits.
- **Code-source index (PRD-0028) shipped** — peer kind to `SourceProfile`; TypeScript / JavaScript via the TS compiler API; Python / Go / Rust via regex extractors. `RETRIEVAL_CODE_SOURCE_INDEX` default on.
- **OSS retrieval panel expanded to 13 corpora / 174 cases** — top-5 96.0%, no per-corpus tuning.

## Still genuinely open

The retrieval-engine-as-risk framing is closed. The product-readiness framing is not. The five items below are the honest gates between "validated technical bet" and "shippable to teams."

## No longer open

The repo is past the "must resolve before week 1" phase. Those historical questions are preserved below for context, but they are no longer the active frame for the project.

## Open for the next phase

### 1. Low-signal / `signal_empty` recovery

The main unresolved quality bucket is no longer anchored retrieval. It is low-signal recovery:

- when should the system surface a broad canonical entrypoint?
- when should it explicitly abstain and ask for better anchors?
- what metric matters most here: warning honesty, recovery usefulness, or first-result quality?

Current stance:

- keep warning honesty primary
- do not brute-force `signal_empty` top-1 upward with normal ranking hacks

### 2. Real assembly expansion versus synthetic pressure

PARTIALLY RESOLVED 2026-05-11 by [PRD-0032](prd/0032-budgeted-pack-composition-audit.md). The agent-completion budgeted-final-pack defect named here (62/66 unbudgeted → 16/66 at 16k) was the sharpest open risk. PRD-0032's audit ([`docs/evals/prd-0032-composition-audit.md`](evals/prd-0032-composition-audit.md)) classified 88.5% of the dropped files as `kind_displaced` — chunks dominated the budget before greedy-fit reached any code entry. The kind-balanced packing lever ships in `src/eval/budgeted-pack.ts` (default on; set `RETRIEVAL_PACK_KIND_BALANCED=false` to disable) and raises 16k agent-completion file retention from 50/66 (post-import-sort baseline) to 63/66 (95.5%). Verification at [`docs/evals/prd-0032-verification.md`](evals/prd-0032-verification.md). ADR-0021 ratcheted accordingly.

Workflow retention at 16k unchanged (22/23) and within tolerance.

What remains open:

- **THO-214 always-missed chunk** (PRD-0030 defect D3) is still missed at 16k. Source-local chunk selector audit is the named follow-up.
- **3 `size_skipped` cases** identified by the PRD-0032 audit (THO-224 → `src/parse/chunker.ts`, `src/store/schema.ts`, `src/types/chunk.ts`) are a separate defect class not addressed by kind-balance. Candidate for a future second-pass token-aware packing lever.
- **Production composer kind-balance.** PRD-0032 only changed the eval-side `budgetedRankedEntries`. The production `retrieve_context_pack` path uses `pack.ranked` directly without re-budgeting. If live retrieval should also benefit, that's a separate PRD.

### 3. Pilot usage on real repos

The retrieval engine is now strong enough for serious pilot use. The next open question is operational, not algorithmic:

- what do real engineers actually ask?
- where does the fixture still miss lived ambiguity?
- how often do low-signal queries appear in practice?

**Phase 0 status (2026-05-11 — maintainer self-pilot on fastapi):** structurally cleared. Engine ran end-to-end (`contexttrail init → setup → import → bootstrap → inbox → MCP retrieve`) and produced honest agent responses across four query shapes, including textbook `signal_empty` abstention on the negative test. Evidence at [`docs/pilot/phase-0-2026-05/`](pilot/phase-0-2026-05/) (sessions log, bugs capture, maintainer retro). [PRD-0036](prd/0036-phase-0-exit-fixes.md) ships the Phase 0 exit fixes (B1 next-step decision-table, B3 chunker forced-split, B4 inbox list flags, B5 bootstrap noise filtering, B8 `.mcp.json` write). Cohort 1 launches when PRD-0036 lands AND the methodology caveat is honored in user selection: ≥2 of 3 users must be on a private or personal repo the LLM has no training-data exposure to (the fastapi result is optimistic-biased without that). See [PILOT.md](PILOT.md) `User profile` for the 2-of-3-private-repo requirement.

### 4. Card bootstrap and onboarding

Retrieval quality is good enough that setup and authoring friction matter more now:

- ~~bootstrap surface~~ **Resolved** by [PRD-0009](prd/0009-week-6-bootstrap-inbox-and-triage.md) (regex-based `contexttrail card bootstrap` + inbox review).
- ~~triage workflow~~ **Resolved** by PRD-0009 (`contexttrail inbox list / show / accept / answer`) and the canonical triage labels documented at [`docs/agents/triage-labels.md`](agents/triage-labels.md).
- **confidence-guided onboarding** — **further advanced 2026-05-11** by [PRD-0033](prd/0033-setup-readiness-scan-and-confidence-report.md) + [ADR-0022](adr/0022-setup-readiness-policy.md): `contexttrail setup` reports four-dimension readiness with locked bands and a deterministic next-step decision table (`contexttrail import` → `contexttrail card bootstrap` → `contexttrail inbox list` → `contexttrail scope inspect` → `contexttrail context`). LLM-assisted clarification generation is **resolved** by [PRD-0034](prd/0034-llm-assisted-clarification-generation.md): the slice-34.1 falsification audit ([`docs/evals/prd-0034-bootstrap-miss-audit.md`](evals/prd-0034-bootstrap-miss-audit.md)) found 11 misses across 5 chunk shapes (gate ≥8/≥3), so the LLM augmentation pass ships in `src/bootstrap/augmentation-run.ts` behind a default-off `--llm` flag and `authored_by: contexttrail-bootstrap-llm` provenance. ADR-0014's authority boundary is preserved structurally — the augmentation flows through the same inbox materialization path as regex output, with the human-acceptance gate unchanged. Still open: **adaptive question selection** and **agent-side suggestion writes** (both explicit non-goals of PRD-0034, reserved for follow-up PRDs of [PRD-0007](prd/0007-week-9-setup-initialization-and-confidence.md)).
- long-run maintenance of cards and stale review state

### 5. Production quality bars and real-corpus eval

PARTIALLY ADVANCED by the 2026-05-11 assembly pass:

- **Real-corpus eval shipped** at 13 corpora / 174 cases (valibot, biome, effect, hono, prisma, trpc, turborepo, tanstack, ralph, zod, drizzle, bun, vitest). Top-5 96.0% across the panel. The "fixture is 4 synthetic domains" gap is closed.
- **Cross-corpus generalization tested** via the valibot workflow probe (15 untuned tickets, 93.3% fully-served). This is the strongest evidence that the architecture is not overfit to ContextTrail's own corpus.

What remains genuinely open:

- ~~**Gate calibration policy** is still unclosed.~~ **Resolved 2026-05-11** by [PRD-0029](prd/0029-gate-calibration-tolerance-bands.md) and [ADR-0021](adr/0021-gate-calibration-policy.md): tolerance bands locked as case-count floors (workflow-assembly 21/23, agent-completion 10/14 commits and 60/66 files), with denominators locked too, enforced in `src/eval/assembly-gate-bands.ts`, emitted by both probes, and run in [`.github/workflows/assembly-gates.yml`](../.github/workflows/assembly-gates.yml). Future baseline changes require an ADR-0021 amendment in the same commit.
- ~~**Residual workflow / agent-completion ceiling** (22/23 = 95.7%, 62/66 = 93.9%) might be liftable by reverse-import traversal hardening.~~ **Resolved 2026-05-11** by [PRD-0031](prd/0031-reverse-import-traversal-structural-hypothesis.md) terminal state A. The miss-shape audit ([`docs/evals/prd-0031-miss-shape-audit.md`](evals/prd-0031-miss-shape-audit.md)) finds that all five residual misses are commit-diff targets not present in today's corpus (rolled back in `1ca58c5` and the PRD-0019 reorg). The ceiling is a fixture / commit-history mismatch, not an engine deficit; reverse-import bounded expansion was not implemented. A future fixture-maintenance pass could prune the rolled-back targets to make the metric track live retrieval more directly.
- **Agent-completion has a small sample**. 14 commit-grounded cases is up from 3, but it's still one engineer's commits on one repo. A second commit-grounded ground truth (a different repo, ideally a different language) is the next confidence step.
- **Agent task success downstream of the Context Pack** is still the deepest unmeasured claim. Retrieval / workflow-assembly / agent-completion all measure "is the right material in the pack." Whether an LLM with the pack actually completes the ticket correctly vs without the pack is the truest end-to-end test — and it is unbuilt. An LLM-judge harness against a small subset of THO commits is the smallest viable form.
- **Real engineers' usage on real repos**. Pilot usage will surface lived-ambiguity patterns the synthetic + untuned-OSS panels can't predict. This is what tells us whether `signal_empty` recovery (item 1 above) bites in practice or stays a theoretical edge.

Pre-v1 ship gate; the technical risk is reduced but not eliminated.

## Historical resolved questions

The sections below remain as historical record of how the product framing got here.

## Genuinely open (must resolve before week 1)

### 1. ~~Does Ralph qualify as the validation dogfood repo?~~ — RESOLVED

Resolved 2026-05-05 by [ADR-0003](adr/0003-layered-dogfood-strategy.md). Ralph rejected as primary product-hypothesis repo (user lacks the domain familiarity needed to author authoritative cards). Layered plan adopted instead:

- **Engineering loop (weeks 1–4):** ContextTrail itself
- **Incident library + product hypothesis (week 7):** fundops
- **Sanity check (week 7, ~1 day):** ContextTrail / Ralph / friend's repo, informal

Load-bearing dependency: the [INCIDENTS.md](../INCIDENTS.md) log must be maintained throughout weeks 1–4.

### 2. ~~The real "agent broke X because it didn't know Y" story~~ — PARTIALLY RESOLVED

Two real fundops incidents captured in [INCIDENTS.md](../INCIDENTS.md): DB-vs-JSON drift and run-pipeline cross-module whack-a-mole. Need 3–6 more before week 1 to round out the failure-mode taxonomy.

### 3. ~~Is the +1 week (4 → 5) acceptable?~~ — RESOLVED

Resolved 2026-05-05. No hard deadline. New plan: 5.5–6 weeks, honest about scope.

- Week 1 expands to "setup + import + chunk + scope" (absorbs Wizard-A per [ADR-0001](adr/0001-wizard-a-deterministic-setup-only.md))
- Weeks 2–5 unchanged from [MVP.md](MVP.md)
- Optional sanity-check on a non-author repo in week 7 (~1 day) per [ADR-0003](adr/0003-layered-dogfood-strategy.md)

Calendar follows scope, not vice versa. Defending an arbitrary 5-week target by cutting week-5 measurement would defeat the point of the MVP.

---

## Open for week-6 grilling (in v1, but specifics not yet locked)

The Bar 2 reframing pulled card bootstrap into v1 week 6. The macro decision is locked (see [ADR-0004](adr/0004-bar-2-scope-with-embeddings-and-bootstrap.md)) but several sub-decisions are deliberately deferred until closer to week 6, when real data from weeks 1–5 informs them better than abstract reasoning now.

### Bootstrap UX surface

- Inline during `contexttrail import` vs. explicit `contexttrail card bootstrap` step?
- Decision for week 6: keep bootstrap as an explicit `contexttrail card bootstrap` step.
- Reason: default import stays deterministic, does no AI work, needs no API key, and creates no surprise spend.

### LLM provider for bootstrap

- Local (Ollama / llama.cpp) vs. hosted (Anthropic / OpenAI key) vs. both?
- Hosted needs a config story for API keys + cost ceilings + rate limits.
- Local is offline-friendly but sets a model-download bar on first use.
- Decision for week 6: ship with hosted as the default bootstrap provider.
- Deferred follow-up: document or add a local fallback later, but do not build both paths in the first week-6 slice.

### Bootstrap candidate storage

- Separate `.contexttrail/inbox/` directory vs. `status: candidate` on cards in `.contexttrail/cards/`?
- Affects whether candidates are committed to git or `.gitignore`'d.
- Decision for week 6: use a separate `.contexttrail/inbox/` directory, gitignored by default.
- Decision for week 6: keep the inbox local-first rather than designing a shared team candidate surface now.
- Reason: provisional AI output should be reviewable without polluting committed project truth or git history.
- Decision for week 6: the primary review UX may be through the MCP/agent harness UI, while `.contexttrail/inbox/` remains the durable readable local backing store.
- Reason: review items should survive cache or database rebuilds, stay inspectable on disk, and avoid being rediscovered from scratch on every substrate reset.

### Bootstrap candidate types and sources

- Decision for week 6: bootstrap should propose `constraint` and `symbol_note` candidates first.
- Deferred for week 7 review: `evidence` candidates are likely valuable, but they need a better verification and link-coverage story than the first bootstrap slice has.
- Decision for week 6: source bootstrap from imported doc chunks only.
- Deferred for week 7 review: code and tests are strong future bootstrap sources, but they add a second extraction problem on top of candidate quality and triage UX.

### Confidence thresholds and dedupe

- LLM emits a constraint candidate with what fields? title, body, suggested scope, confidence?
- Dedupe rule for "this candidate looks like an existing manually-authored card"?
- Decision for week 6: triage should happen at the candidate-card level, not as separate approval steps for each suggested supporting link.
- Product shape: keep the inbox to as few high-leverage review decisions as possible rather than imposing a strict numeric cap. Lower is better when one well-worded candidate resolves many downstream implications.
- Product shape: optimize for closing the meaningful confidence gap, not for asking the fewest questions at any cost.
- Candidate wording should stay general enough that a maintainer can answer from domain understanding without needing exhaustive symbol-by-symbol or variable-by-variable recall.
- Decision for week 6: near-duplicate candidate rules should merge into one review unit when they express the same underlying rule, while still showing multiple supporting source chunks to the reviewer.
- Decision for week 6: bootstrap should emit one canonical wording per candidate rather than several wording variants for the same underlying rule.
- Decision for week 6: do not emit low-confidence garbage just to avoid abstention. If bootstrap cannot justify a good candidate, it should surface a small number of higher-leverage clarification needs rather than a large tail of weak candidate cards.
- Decision for week 6: keep candidate cards and clarification needs in the same local inbox, but mark them as different review types with different actions.
- Decision for week 6: clarification answers should be able to update multiple pending candidates at once.
- Decision for week 6: after a clarification answer, affected pending candidates may be rewritten automatically before re-review, but the updated candidates must show that they changed because of that clarification.
- Decision for week 6: clarification needs should prefer constrained answers by default, with free-form answers only when the uncertainty cannot be compressed honestly.
- UI shape: app or terminal harnesses may present multiple-choice options first, with a custom text answer path when the maintainer needs to override or refine the suggested choices.
- Decision for week 6: clarification answers are workflow trace by default; the durable repo truth is the accepted card that results from them, not the raw answer itself.
- Decision for week 6: keep accepted cards readable and relatively clean, but preserve enough review history elsewhere to explain later why a card exists and how it became accepted.
- Decision for week 6: traceability should be per-card, so each accepted card can be traced back to the candidate and clarification path that produced it.
- Decision for week 6: per-card traceability should preserve the full material path, including later clarifications and rewrites that substantially changed the accepted card.
- Decision for week 6: do not block the core bootstrap loop on a perfect material-change algorithm. A workable first-pass seam is enough as long as week 7 can layer deeper systems like `evidence` on top of it.
- Decision for week 6: clarifications may inform future systems like `evidence`, but the live week-6 slice stays focused on improving `constraint` and `symbol_note` candidates.
- Still open for later product design: what end-user-facing audit UX should look like when the user did not directly see the underlying context or review flow.
- Confidence is not capped by a fixed number of setup questions. Follow [ADR-0014](adr/0014-agent-assisted-setup-without-truth-promotion.md): adaptive questioning should stop when setup confidence crosses the relevant risk threshold and additional questions have low marginal value.
- Future grilling still needs the exact scoring formula for domain confidence, authority confidence, conflict severity, retrieval probe pass rate, and question value.

### Triage UX scaling

- First 30 minutes solved by `contexttrail import` + bootstrap. But months 3–12 with churned codebase, many cards `needs_review`, doc imports re-running with duplicates — this UX is unsolved.

---

## Week-5 grilling result (context assembly specifics)

Week 5 now focuses on context assembly rather than embeddings. The first full pass of decisions is captured in [week-5-context-assembly-groundwork-2026-05.md](plan/week-5-context-assembly-groundwork-2026-05.md).

Current stance:

- evaluator-first, then production pack changes only after the eval exposes a named sufficiency defect
- anchored implementation questions are the first product slice
- expansion starts from one grounded source chunk
- expansion ladder is `primary_only` -> `parent` -> `siblings` -> `linked_neighbor`
- sufficiency is fixture-defined first, with `assembly_need` and `minimal_sufficient_stage` kept as separate axes
- over-expansion is a real failure at the stage level
- `signal_empty` remains a separate recovery problem, not a normal ranking or assembly target
- week 6 bootstrap and week 7 measurement build on this narrower structural baseline rather than assuming broader assembly behavior is complete
- the readiness subset now includes live stage-checked cases for `parent`, `siblings`, and `linked_neighbor`, so week 6 and week 7 can measure against a real runtime baseline rather than a lab-only claim
- if the narrow offline eval clearly wins, week 5 should promote that behavior into live `retrieve_context_pack` behavior rather than stopping at a lab-only result
- this rollout should not add a new user-facing config burden; the narrow slice becomes default once proven
- live structural assembly must stay inspectable through explicit explain/reporting fields rather than invisible pack growth
- contract shape should stay mixed: minimal always-on assembly stage summary, detailed assembly reasoning under `explain`
- `assembly_stage_reached` should distinguish `not_applicable` from `primary_only`
- ADR-0017 records the live rollout and response-contract choice
- the first neighbor policy is intentionally conservative and expected to deepen after week-5 proof and week-7 evidence

Still open for review:

- exact fixture field shape for assembly expectations
- linked-neighbor source policy
- payload ceiling for the anchored implementation slice
- exact bootstrap candidate field shape and dedupe rule
- when `evidence` candidates should enter after the first local bootstrap loop proves useful
- when code/test-driven bootstrap should enter after the doc-chunk-only slice proves useful
- whether week-7 dogfood should treat retrieval `query_mode` as a first-class product seam, especially for separating honest `signal_empty` recovery from ordinary broad unanchored search

---

## Next retrieval-engine hardening PRD

PRD-0006 should focus on **fact-finding quality with curated substrate**, not setup intelligence or full Context Pack assembly.

Direction agreed 2026-05-07:

- eval-first, production fixes only when a named fact-finding capability defect is exposed
- add reusable eval taxonomy: `query_intent`, `assembly_need`, and deterministic-vs-ambiguous expectations
- report pass/fail by intent, assembly need, capability, and bucket
- protect exact contract gates: locked correctness, forbidden locks, evidence provenance, query mode, signal-empty warning
- harden adversarial coverage: distractors, over-lock prevention, source-code anchors, cross-domain ambiguity
- defer setup confidence and task readiness to later PRDs; bring first-pass context assembly into week 5

Guardrail: avoid ranking hacks that only satisfy the current fixture. See [CONTEXT.md](CONTEXT.md#fact-finding-quality).

---

## Deferred beyond v1 (post-v1, decisions still open for later)

### Setup initialization and confidence-guided onboarding

Now promoted out of "someday" status and given a concrete post-v1 slot: week 9. See [PRD-0007](prd/0007-week-9-setup-initialization-and-confidence.md).

Open items:

- how much of setup should be pure CLI vs MCP-first
- the first confidence formula worth shipping
- which retrieval probes are representative enough for setup readiness
- whether setup status should be per-domain only or also include a single top-line repo state

### `propose_card` MCP tool

Closes the capture loop: agent learns something while editing → proposes a candidate card → human triages. Requires inbox/triage CLI to exist first.

Deferred to post-MVP. Same permission model as in [DESIGN.md D8](DESIGN.md#d8-agent-interface-mcp-server-primary-cli-fallback): candidates only, never authoritative writes.

### External doc sources

Notion, Confluence, Google Docs, PDF. Each is a real product with auth, API limits, delta sync, format conversion. Ship one at a time, validated separately.

Open: which source first (likely Notion given prevalence), one-shot import vs continuous sync, how scope tagging works for external sources without `doc_scopes` paths.

### File watcher mode

Implicit-on-retrieve covers v1 UX. Watcher is a quality-of-life improvement for active development.

PRD-0035 ships the **detection half** as a pre-retrieve freshness check: every `retrieve_context_pack` call compares on-disk content hashes against the index and emits `stale_source` / `missing_source` warnings into the pack. Default is detect-and-warn (latency stays predictable); `CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX=true` opts into inline reindex.

A continuous file watcher remains a v1.5+ quality-of-life item — different mechanism (push, not pull), different cost profile (background process, debounce, cross-platform watcher library), and not load-bearing for pilot UX now that pilots see honest warnings on every request.

Open: cross-platform watcher library, debounce strategy, watcher off when running in CI.

### Decision and feature_intent card types

Once constraint/symbol_note workflow is proven, expand card taxonomy. Decisions especially valuable for "why was this designed this way" context that prevents agent over-simplification.

### AST fingerprinting (the original Phase 1)

Automatic card freshness signaling on meaningful code change. Original spec's heart, now a downstream feature. ts-morph–based, week 5+ of round-1 plan. Probably real v1.5 or v2 work.

### Multi-repo / monorepo cross-context

Currently one `.contexttrail/` per repo. Real teams have multiple repos that should share company/team-level context.

Open: shared cards across repos, per-package config in monorepo, how MCP serves cross-repo queries.

### Triage UX scaling

First 30 minutes solved by `contexttrail import` + (eventually) bootstrap. But months 3–12 with churned codebase, many cards `needs_review`, doc imports re-running with duplicates — this UX is unsolved.

### Card editing workflow by agents

`propose_card` is for new cards. What about *edits* to accepted cards? Probably needs `propose_card_update` tool with diff review.

### Versioning of cards / breaking changes

When a constraint becomes obsolete and is replaced, what about cached agent retrievals, evidence linked to old version, etc.? Decisions have `potentially_superseded`; constraints and symbol_notes need similar.

### Authority / identity

Who accepted a card? Who proposed it? Solo dev: irrelevant. Team mode: critical. Add `accepted_by`, `proposed_by` fields.

### CI integration

Fail CI build when changes touch a constraint marked `needs_review` and no evidence has run. Per-org tolerance varies.

### GitHub PR integration

Show retrieved Context Pack as a PR comment; highlight cards/chunks the diff touched.

### Embedding model selection

Once embeddings ship: Xenova/all-MiniLM-L6-v2 (~25MB), bge-small, nomic-embed-text-v1.5. Choose empirically.

### Tombstone retention policy

Currently indefinite in v1. Eventually want `contexttrail index vacuum` and configurable retention.

---

## Sub-questions answered but worth re-grilling later

- Should agents ever get authoritative writes? (Currently no, never.)
- Should decisions ever auto-stale? (Currently no, only `potentially_superseded`.)
- Should constraint guarantee-include be overridable? (Currently locked.)
- Should bootstrap candidates be committed to git? (Currently `.contexttrail/local/` is gitignored.)
- Should retrieval log be committed for team auditability or stay local?
- Should `accepted_card_bias = 1.2` be tunable per-task? (Currently global config.)
- Is `default = 6000 tokens` the right size or should it scale with codebase?

---

## Resolved during round 3 (Bar 2 grilling, 2026-05-05)

- ✅ Scope: Bar 2, ~7–8 weeks, context assembly groundwork + bootstrap in v1
- ✅ Schema phasing: flat `doc_chunks` weeks 1–2, substrate migration week 3
- ✅ Tokenizer: `gpt-tokenizer` + `cl100k_base`
- ✅ Markdown parser: `remark` + `unified` + `remark-gfm` + `gray-matter`
- ✅ Chunking algorithm: no-merge / greedy-fill / preserve-and-warn / contexttrail-only / overlap_tokens=0
- ✅ Chunk identity: `hash(source_path + heading_path + chunk_index_within_section)`
- ✅ Mention extraction: precision-first regex table, no AST, no LLM
- ✅ Scope tagging: per-field frontmatter override; no auto-derive of project name from `docs/<segment>`
- ✅ Forward-compat scaffolding: cut everything except WAL pragma
- ✅ Project scaffold: single package, `commander`, domain folders, vitest colocated
- ✅ Embeddings plan recorded as optional later work, not part of the v1 critical path
- ✅ Scoring formula: `(0.7 BM25 + 0.3 heading) × scope_boost × mention_boost × specificity`
- ✅ Deterministic-core principle: week-7 dogfood must still test the core apart from assembly-enabled widening

## Resolved during round 2 (no longer open)

- ✅ Storage model: markdown source + SQLite cache (D5, unchanged in round 2)
- ✅ Agent interface: MCP-first (D8, extended with `get_doc_chunk` etc.)
- ✅ Tech stack: Node.js + TypeScript + npm (D11, unchanged)
- ✅ Ambition: OSS first, commercial upside (D13, unchanged)
- ✅ Product framing: docs-first context engine with cards overlay (D15)
- ✅ Chunking: heading-based with size cap (D16)
- ✅ Scope tagging: layered precedence with mention extraction (D17)
- ✅ Packing: locked-first then global ranker, 1.2x card bias (D18)
- ✅ Doc lifecycle: snapshot + content-hash + implicit-on-retrieve (D19)
- ✅ MVP plan: 5 weeks, docs-first (D20) — *superseded by Bar 2 plan in round 3*
- ✅ Dogfood: split between ContextTrail (engineering) and Ralph/OSS-fallback (product) (D21)
- ✅ Success criteria: layered (token efficiency + subjective + behavior parity) (D22)

---

## Questions explicitly NOT open

These are locked. Reopening any of them ripples downstream:

- Product framing is **docs-first context engine with cards overlay** (D15)
- Storage is markdown source + SQLite cache (D5)
- MCP is the primary agent interface (D8)
- Tech stack is Node.js + TypeScript (D11)
- Default `contexttrail import` runs without AI — `local-basic` first-run promise; bootstrap remains an explicit opt-in
- v1 supports markdown doc sources only (D19) — no Notion / PDF / etc.
- v1 ships with three card types: constraint, symbol_note, evidence (D10, D20)
- Agents are read-only via MCP in v1 (D8, D20)
- Default budget is 6,000 tokens with locked-first packing (D18)
- Doc chunks don't have rich freshness states; only cards do (D19)
- Scope is Bar 2 — context assembly groundwork + bootstrap in v1, ~7–8 weeks
- Embeddings are an enhancement, not the substrate — the deterministic core must stand alone

If any of these change, redo the dependency analysis from that node down.
