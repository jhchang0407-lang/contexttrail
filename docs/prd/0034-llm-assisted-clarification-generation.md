# PRD-0034: LLM-Assisted Clarification Need Generation

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirty-fourth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0001](../adr/0001-wizard-a-deterministic-setup-only.md) (deterministic-core principle), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md) (authority boundary), [ADR-0018](../adr/0018-inbox-backed-by-local-files-ui-through-agent-surface.md) (inbox file backing), [ADR-0022](../adr/0022-setup-readiness-policy.md) (companion: setup readiness bands). Predecessor PRDs: [PRD-0007](0007-week-9-setup-initialization-and-confidence.md) (parent spec), [PRD-0009](0009-week-6-bootstrap-inbox-and-triage.md) (shipped regex bootstrap), [PRD-0033](0033-setup-readiness-scan-and-confidence-report.md) (shipped readiness scan).
>
> Boundary rule: the LLM operates strictly in the **ask** role, never the **decide** role. It generates clarification questions and provisional candidates. Humans accept truth. ADR-0014 holds throughout. This PRD does NOT add LLM judging, LLM-driven ranking, or LLM-authored authoritative cards — those are explicit non-goals.

## Hypothesis (narrow)

> When regex bootstrap produces nothing or only a hedged clarification draft for a chunk, an LLM invoked with the chunk content can produce a higher-quality candidate card or a better-targeted clarification need *more often than not*, while staying inside the ADR-0014 provisional-only boundary.

This is a measured hypothesis. PRD-0034's first slice is an audit that quantifies the regex bootstrap's miss rate against a human-judged ground truth. If the regex already catches most of the high-leverage candidates and clarifications, an LLM lever may not be worth the cost; the audit will say so.

## Problem Statement

PRD-0009's regex bootstrap ships today (`src/bootstrap/proposals.ts`). It works by pattern-matching three signals:

- `NORMATIVE_STRONG_PATTERN` (`must`, `must not`, `never`, `always`, `cannot`, `do not`) → constraint candidate
- `NORMATIVE_WEAK_PATTERN` (`should`, `should not`) → clarification need (the user decides whether it's actually a constraint)
- `SYMBOL_NOTE_HINT_PATTERN` (`coordinates`, `entry point`, `encapsulates`, `represents`, `owns`, `drives`) + a confident symbol anchor → symbol_note candidate

This works well on prose written *like* documentation. It misses everything else. A chunk that says:

> *"The reconciler must be invoked after every successful transfer, but before the audit log is flushed. Skipping this step leaves the ledger in an inconsistent state."*

…is caught (`must` matches). A chunk that says:

> *"Don't ship a webhook without an idempotency key. Every retry would create a duplicate event in the consumer's queue, and we'd have to manually deduplicate from the audit log."*

…is also caught (`don't` matches). But a chunk that says:

> *"The way we handle credential rotation is: every 90 days, the rotation worker reads from KMS and re-writes the secret to Vault. Then the application restarts and picks up the new credentials. The whole thing takes about 12 seconds end-to-end."*

…produces **nothing**. There is no normative word in the chunk. But this is exactly the kind of operational constraint a new engineer would need — "if you're touching credential rotation, the rotation worker is the entry point; there's a 90-day cycle; the restart is required." A human reviewer would mark this as a symbol_note worth authoring. Regex sees no signal.

PRD-0033 shipped `contexttrail setup` which reports `card_coverage: low` when the cards surface is empty or small. The next-step recommendation today is `contexttrail card bootstrap` — but if the regex produces few candidates from a richly-documented repo, the user runs bootstrap, gets a thin inbox, and is stuck. The setup arc loses its momentum exactly at the point where it should be most useful.

The gap is not "regex is bad." The gap is "regex sees only one shape of helpful text." An LLM can see all the shapes — but only if we keep it inside the ADR-0014 boundary (provisional output, no authoritative writes).

## What is shipped today (do not duplicate)

PRD-0009 shipped:

- `generateBootstrapProposals` (`src/bootstrap/proposals.ts`) — regex extractor. Returns `{ candidates, clarifications, summary }`.
- `materializeBootstrapProposals` (`src/inbox/bootstrap.ts`) — writes proposals to `.contexttrail/inbox/`.
- `contexttrail card bootstrap` (`src/cli/card-bootstrap.ts`) — the CLI entry point.
- Clarification need item type with `clarification_choices`, `rewrite_rules`, `clarification_applied` event log (`src/inbox/items.ts`).
- Inbox review CLI: `contexttrail inbox list / show / accept / answer`.

PRD-0033 shipped:

- `contexttrail setup` with `card_coverage` as one of four dimensions.
- Next-step decision table that suggests `contexttrail card bootstrap` when cards are missing.

PRD-0034 does **not** replace any of the above. It adds an LLM-augmentation pass that runs *after* the regex bootstrap, on the same imported chunks, producing additional clarification needs and candidate cards that flow through the same inbox infrastructure.

## Solution

Three slices, falsification-first. The LLM augmentation does not ship unless slice 34.1 produces evidence that regex bootstrap is missing meaningful candidates.

### Slice 34.1 — Bootstrap miss audit (falsification gate)

Hand-author a small ground-truth set: 20 chunks from ContextTrail's own corpus, each labeled with what a human reviewer would consider the *ideal* bootstrap output (candidate card / clarification need / nothing). The labels live in `tests/fixtures/bootstrap-miss-audit.yaml`. Pick chunks that span the regex's known-blind shapes: operational procedures, architectural narrative, decision rationale, parameter documentation, mixed-content sections.

Run the existing regex bootstrap on those chunks and compute:

- **Missed candidates** — chunks where the ground-truth has a candidate card and regex produced nothing
- **Missed clarifications** — chunks where ground-truth has a clarification need and regex produced nothing
- **Spurious output** — chunks where ground-truth says "nothing useful" but regex produced a candidate / clarification anyway
- **Hedged outputs** — chunks where ground-truth has a strong candidate but regex produced only a clarification

Output: `docs/evals/prd-0034-bootstrap-miss-audit.md`. Pure measurement, no LLM, no production changes.

Proceed condition to slice 34.2:

- At least **8 of 20** chunks have a missed candidate or missed clarification, AND
- The miss set is structurally varied (not all the same chunk type)

If fewer than 8, the hypothesis is falsified — regex catches enough of the high-leverage signal that an LLM augmentation is not worth the cost or the new failure modes. PRD-0034 closes with terminal state A.

### Slice 34.2 — LLM clarification generator (conditional)

Only proceeds if slice 34.1 produces ≥8 misses spanning ≥3 chunk shapes.

Add `src/bootstrap/llm-augment.ts` — a pure function that takes a chunk + the existing regex output for that chunk and returns *additional* candidate drafts and clarification need drafts. Architecture:

- **Provider abstraction**: `LlmClient` interface with one method, `generateBootstrapAugmentation(chunk, regexOutput): Promise<AugmentationResult>`. The implementation lives in `src/bootstrap/llm-client.ts` with two providers:
  - `anthropic` — hosted Claude (configured via the existing `ANTHROPIC_API_KEY` env var)
  - `mock` — deterministic test fixture, returns canned augmentation results keyed by chunk hash
- **Mock-by-default in tests**: unit tests use `mock`. Integration tests against the real Anthropic provider live behind an explicit `ANTHROPIC_API_KEY` check and skip otherwise.
- **Selective invocation**: the LLM is only invoked for chunks where the regex produced nothing or only a clarification. Chunks with at least one strong-rule candidate are NOT augmented. This caps cost at roughly `corpus_size × low-signal-fraction` rather than full corpus.
- **Output constraints**: the LLM is prompted to emit at most one candidate card and at most one clarification need per chunk. The system prompt makes the ADR-0014 boundary explicit: "Your output is provisional and reviewed by a human. Do not produce content that would be misleading if accepted verbatim."
- **Constrained-answer clarifications**: when emitting a clarification need, the LLM is required to emit 2–4 multiple-choice options (per the OPEN.md week-6 lock: "clarification needs should prefer constrained answers by default, with free-form answers only when the uncertainty cannot be compressed honestly").

The augmentation function is *pure* in the sense that given the same client, chunk, and regex output, it produces the same result. Real-LLM determinism is provider-dependent (Anthropic doesn't promise bit-exact reproducibility); the determinism property is enforced at the test layer via the mock client, not at the provider layer.

### Slice 34.3 — Inbox integration + cost / opt-in guardrails

Wire the augmentation into `contexttrail card bootstrap`:

- Add a `--llm` flag (or env var `CONTEXTTRAIL_BOOTSTRAP_LLM_AUGMENT=true`). Default **off**. Bootstrap runs regex-only when the flag is off, identical behavior to today.
- When the flag is on, after regex bootstrap completes, the augmentation runs on the qualifying chunks. The augmented outputs flow through the existing `materializeBootstrapProposals` path — they enter `.contexttrail/inbox/` exactly like regex-produced items. Provenance is recorded on each item: `provenance: system_derived` (unchanged), `authored_by: contexttrail-bootstrap-llm` (new value, distinct from `contexttrail-bootstrap`).
- Cost guardrails:
  - Per-run cap: at most 50 LLM invocations per `contexttrail card bootstrap` call. If the qualifying chunk count exceeds 50, bootstrap warns and processes the first 50 in deterministic order (sorted by `stable_key`).
  - Per-chunk timeout: 30 seconds. On timeout, the chunk's augmentation is skipped and a warning is recorded; regex output for that chunk is still surfaced.
  - Cost summary: bootstrap prints `LLM augmentation: N chunks processed, M candidates added, K clarifications added` at the end.
- `contexttrail inbox show` for an LLM-augmented item shows the provenance (`authored_by: contexttrail-bootstrap-llm`) so the reviewer knows the candidate came from the LLM lever, not regex.
- Unit + integration tests cover: flag-off bit-identical to today; flag-on with mock client produces expected augmentations; per-run cap enforcement; timeout handling; provenance recording.

### Slice 34.4 — ADR amendment + OPEN.md update (HITL)

Amend ADR-0014 with a worked example: how LLM-assisted bootstrap stays inside the authority boundary. Update PRD-0033 frontmatter to reference PRD-0034 as the resolved-by for "LLM-assisted clarification generation" (currently listed as still-open in OPEN.md item 4). Update OPEN.md.

This slice is HITL because the ADR amendment is a policy commitment and the OPEN.md update is judgment work about what's resolved vs still open.

## Non-goals (explicit)

* **LLM as judge / picker / ranker.** The LLM cannot decide whether a candidate is "good enough." Acceptance stays in the human triage flow. Per saved feedback: LLM-as-picker is the wrong shape — keep LLM upstream of human decisions, not in them.
* **LLM-authored authoritative cards.** Accepted truth still requires human review. Provenance distinguishes regex vs LLM origin but both go through the same accept-or-reject gate.
* **Multi-turn dialogue.** This PRD ships single-pass augmentation: regex output + chunk → LLM → augmentation. No follow-up prompts based on user responses.
* **Adaptive question selection.** PRD-0007's broader confidence-driven question flow is a separate future PRD.
* **LLM-driven retrieval.** The retrieval engine stays deterministic. This PRD is upstream of retrieval (bootstrap-time only).
* **Local LLM provider in the first slice.** Hosted Anthropic is the default per OPEN.md week-6 lock. Local fallback (Ollama / llama.cpp) is documented as a future addition.
* **Augmenting `evidence` candidates.** PRD-0009 explicitly deferred `evidence` candidates; PRD-0034 stays on the same `constraint` + `symbol_note` surface.
* **Caching or memoization across runs.** Each bootstrap run starts fresh. Caching is a future optimization, not a correctness lever.

## Risks

* **Determinism across runs.** The real Anthropic provider produces output variation even at temperature 0. Mitigation: this PRD's correctness gate is **acceptance rate**, not byte-identical reproduction. Within-run determinism is enforced via mock provider in tests; cross-run variation is acceptable because the human is the gate.
* **Cost runaway.** A large repo with many low-signal chunks could trigger hundreds of LLM calls per bootstrap. Mitigation: per-run cap of 50, per-chunk timeout of 30s, opt-in flag default off. Total worst-case cost per bootstrap is bounded and the user is informed in the summary.
* **LLM produces plausible-but-wrong candidates that get accepted.** The provenance field (`authored_by: contexttrail-bootstrap-llm`) makes origin auditable. The reviewer can re-evaluate accepted-LLM cards as a class if a pattern of bad acceptances emerges. ADR-0014's boundary holds: nothing is truth until a human accepts it, and accepted items carry full review-trace sidecars (per PRD-0009).
* **Provider lock-in.** The `LlmClient` interface keeps the provider abstraction clean. Adding Ollama or another provider is a parallel implementation, not a rewrite.
* **The audit's 20-chunk fixture may not generalize.** Mitigation: slice 34.1's proceed condition requires `≥8 misses spanning ≥3 chunk shapes`, ensuring variety not just volume. The fixture is hand-authored from ContextTrail's own corpus and explicitly documents the chunk-shape selection rationale so a future reader can challenge the sample.

## Acceptance — PRD-level

PRD is complete when **one** of the following terminal states holds:

**A. Audit-only falsified (no LLM code lands).**
1. `tests/fixtures/bootstrap-miss-audit.yaml` exists with 20 ground-truth-labeled chunks.
2. `docs/evals/prd-0034-bootstrap-miss-audit.md` classifies the regex bootstrap's miss rate.
3. The proceed condition (`≥8 misses spanning ≥3 chunk shapes`) is NOT met.
4. PRD-0034 closes with verdict "regex bootstrap is sufficient for the audit's chunk-shape distribution; LLM augmentation is not motivated."
5. OPEN.md item 4 is updated to reflect that the regex/LLM gap is smaller than expected and the next setup-engine lever is something other than LLM augmentation (named in the verdict).

**B. Implementation-attempt falsified (LLM module merged, flag stays off).**
1. Audit produces the proceed condition.
2. Slice 34.2 ships the augmentation module behind the `--llm` flag.
3. Slice 34.3 integration test on ContextTrail's own corpus shows LLM augmentation produces fewer than 5 accepted candidates across 3 maintainer review passes, OR produces an unacceptable rate of bad candidates (>30% reject rate).
4. Flag default stays off. ADR-0014 amendment records the attempt.

**C. Confirmed and shipped.**
1. Audit confirms the proceed condition.
2. Slice 34.2 ships the augmentation module.
3. Slice 34.3 ships with the `--llm` flag, default **off** initially.
4. After one or more maintainer review passes on ContextTrail's corpus, accepted-candidate count and reject rate are both within acceptable bounds (≥5 accepted, ≤30% reject rate). The flag default can be flipped to **on** in a separate commit accompanied by an ADR-0014 amendment.
5. PRD-0033's "LLM-assisted clarification" non-goal is closed. OPEN.md item 4 is updated to reflect this. The next-still-open setup-engine PRD is named (likely adaptive question selection per PRD-0007).

All three terminal states are valid outcomes.

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Will the LLM be tuned to make the audit pass? | The audit (34.1) is regex-only and pre-LLM. The proceed gate measures whether the *regex* misses real candidates — it cannot be tuned by LLM work. The acceptance gate (34.3 → terminal C) measures real human acceptance, not LLM output quality directly. |
| Could the LLM start writing authoritative cards via a side door? | The materialization path goes through `materializeBootstrapProposals` which writes to `.contexttrail/inbox/` with provenance. There is no code path from LLM output to `.contexttrail/cards/` that bypasses human acceptance. The only difference vs regex bootstrap is the `authored_by` field. |
| Will the per-run cap of 50 be tuned to make a particular run pass? | The cap is a fixed structural choice driven by cost, not by quality. The audit doesn't depend on the cap. Raising the cap requires explicit PRD amendment. |
| Why not use the LLM in the production retrieve path too? | Saved feedback explicitly rejects "LLM-as-picker in retrieval." This PRD stays bootstrap-time only — upstream of retrieval — where the LLM is *generating* candidates that humans pick, not *picking* candidates for an agent. Different role, different risk. |
| Why mock-by-default in tests instead of recorded fixtures? | Mock makes the test contract crisp: given chunk X, returns augmentation Y. Recorded fixtures from a real provider drift as the provider updates; mocked fixtures don't. Real-provider integration tests live behind an explicit env check so they don't gate CI on Anthropic availability. |
