# ADR-0014: Agent-assisted setup preserves the truth boundary

**Status:** Accepted
**Date:** 2026-05-06
**Amended:** 2026-05-11 (PRD-0034 worked example added: LLM-assisted bootstrap)

## Context

Post-PRD-0005 retrieval evals showed that the retrieval engine can be strong when the ContextTrail substrate is well-authored: scopes are correct, Cards are accepted intentionally, anchors exist, and the cache is fresh. That revealed the next product risk:

> Retrieval quality depends on setup quality, and setup is where most user friction lives.

Today setup mostly happens through terminal commands:

- `contexttrail init`
- `contexttrail import`
- `contexttrail card import`
- manual edits to `.contexttrail/config.yaml`
- manual authoring or importing of Cards

The MCP agent then reads the cache through `retrieve_context_pack`. This means the agent benefits from setup, but does not yet guide setup as a first-class workflow.

Earlier design sessions opposed agent-generated recommendations because they can corrupt the truth model: if an agent reads prose, invents a rule, and the system treats it as accepted context, then locked-include becomes dangerous. That concern remains correct. The missing nuance is that *recommendation* and *authority promotion* are separate acts.

## Decision

ContextTrail may use agents to reduce setup friction, but agent output must not become accepted truth automatically.

The setup workflow should distinguish four categories:

1. **Deterministic setup facts** — filesystem layout, import globs, path patterns, missing docs, unknown scopes. These may be applied directly after user confirmation because they do not generate semantic truth.
2. **Agent suggestions** — proposed scope/domain rules, candidate Cards, candidate links, setup warnings. These are hypotheses.
3. **Candidate context** — suggested Cards or links stored with non-authoritative status/provenance, visible for triage but excluded from locked-include by default.
4. **Accepted truth** — Cards/rules a human explicitly accepted or authored. Only this tier can participate in locked-include as authoritative context.

The product should optimize the user experience around triage, not blank-page authoring:

```text
inspect repo -> propose setup -> user confirms -> import -> suggest candidates -> user accepts/edits/rejects -> verify/eval
```

The agent can make the first pass easier. The user remains the authority boundary.

## Adaptive setup confidence

Setup must not use a fixed question cap. Different repos have very different relationships between docs, code, tests, examples, and stale product decisions. A small repo with clean specs may need only a few confirmations; a large repo with mixed examples, meta-docs, generated docs, and stale specs may need more.

The setup loop should be **confidence-gated**, not question-count-gated:

```text
ask high-leverage questions while they materially improve setup confidence
stop when remaining uncertainty is low-impact or isolated
resume when a task touches uncertainty that could change the answer
```

For calibration on typical repos, see [PRD-0007](../prd/0007-week-9-setup-initialization-and-confidence.md).

Questions should usually validate clusters, not individual Cards. One good question should clarify a domain boundary, authority rule, or critical flow that affects many candidate Cards and retrieval scopes.

Examples:

```text
Good:
I found a payments cluster across src/payments/**, docs/payments/**, and Cards C001/C004/C005.
Is this a real product domain, and should docs/examples/payments/** be illustrative only?

Bad:
Is Card C001 true?
Is Card C004 true?
Is Card C005 true?
```

Setup confidence should combine at least four signals:

- **coverage** — whether the main code/doc domains are mapped
- **authority clarity** — whether ContextTrail knows which docs, tests, code, or Cards are authoritative for each domain
- **conflict resolution** — whether high-impact contradictions have been reviewed
- **retrieval probe pass rate** — whether generated or curated probe queries retrieve the expected locked and ranked context

Recommended confidence bands:

- `0-50%` unknown: do not rely on it; ask before using
- `50-70%` weak: useful as background, not truth
- `70-85%` usable: acceptable for exploration and low-risk coding
- `85-95%` trusted: acceptable for normal coding-agent retrieval
- `95-100%` accepted or verified: suitable for locked/authoritative use only when tied to explicit acceptance or deterministic verification

Initial setup should normally stop when:

- repo domain map confidence is at least `85%`
- authority hierarchy confidence is at least `85%`
- top critical flows are at least `90%`
- retrieval probe pass rate is at least `85%`
- there are no unresolved high-impact conflicts

High-risk domains, such as auth, permissions, migrations, money movement, privacy, data deletion, or schema correctness, should require `90-95%` confidence before ContextTrail stops asking about that surface. Lower-risk exploratory surfaces can stop closer to `70-80%`.

The product rule is:

> Confidence can make context useful. Only acceptance makes context authoritative.

## When setup should resume

Setup is not a one-time questionnaire. ContextTrail should ask again when uncertainty becomes relevant, stale, or contradicted.

Ask again when:

- the current task touches a low-confidence domain
- a Context Pack depends on candidate-only facts
- code or docs changed under accepted Cards
- retrieval probes regress for a domain
- a new domain appears in the repo
- authoritative sources conflict
- the task is high-risk and the relevant surface is below its confidence threshold

Do not ask again just because confidence is imperfect. Do not ask about isolated low-impact files. Do not ask about areas unrelated to the current task. Do not ask card-by-card when one domain or authority question would resolve the cluster.

The desired UX is:

```text
Setup status: Ready for normal agent work
Overall confidence: 87%
High-confidence areas: payments, auth, retrieval
Ask again when touched: migrations, billing
Reason for next question: affects 18 candidate Cards, 4 retrieval scopes, and 2 high-risk flows
```

Users should feel that ContextTrail is asking because the answer has leverage, not because it is making them grade generated homework.

## Engine quality versus setup quality

This ADR separates two quality problems:

1. **Retrieval engine quality** — given a high-quality substrate, does ContextTrail retrieve the right locked and ranked context within budget?
2. **Setup quality** — can ContextTrail help users build that substrate with enough confidence and low enough friction?

The retrieval engine should be held to a very high bar against curated or accepted data. Setup confidence may vary across repos and over time, but the engine must be excellent when the data is excellent. Otherwise setup UX improvements will only mask ranking, locking, or packing defects.

Evaluation should therefore report engine quality and setup quality separately:

- curated-fixture retrieval accuracy
- dogfood/stress-corpus retrieval accuracy
- setup-derived retrieval accuracy after candidate triage
- confidence coverage by domain
- failure attribution: engine miss, setup miss, stale truth, missing truth, or ambiguous query

## Sequencing

Setup intelligence is not the next implementation target. ContextTrail should first harden retrieval-engine quality with curated, accepted data.

The reason is simple:

```text
If retrieval is weak with excellent data, setup intelligence cannot save it.
If retrieval is excellent with excellent data, setup intelligence can honestly explain when real project data is insufficient.
```

So the immediate product focus remains retrieval-engine correctness: locking, ranking, packing, distractor resistance, false-positive prevention, and adversarial eval coverage. Adaptive setup confidence comes after that, behind its own PRD.

## Consequences

### Positive

- Preserves the core trust contract: **agents contribute hypotheses; humans promote truth**.
- Makes setup a first-class product surface instead of hidden terminal ceremony.
- Keeps retrieval evals honest: failures can be attributed to engine quality, setup quality, or candidate quality separately.
- Enables an agent-assisted onboarding flow without requiring ContextTrail to trust LLM-generated knowledge.
- Gives MCP a future setup/admin direction without rushing authoritative write tools into the read-only retrieval contract.

### Accepted costs

- Setup UX now needs its own quality bar, separate from retrieval quality.
- Candidate triage becomes a real workflow, not a nice-to-have.
- Users still need to approve truth; full automation is intentionally rejected.
- The product must explain authority clearly so users understand why suggestions are not automatically trusted.

## Non-goals

- Do not expose `accept_card`, `edit_accepted_card`, or other authoritative writes to agents without explicit human review.
- Do not make candidate Cards locked-include by default.
- Do not require AI for deterministic setup. The engine must still function when AI assistance is disabled.
- Do not collapse setup suggestions, candidate context, and accepted Cards into one state.

## Setup quality metrics

Future setup evals should measure:

- time to first useful Context Pack
- number of user decisions before first useful pack
- percentage of suggested Cards accepted after review
- percentage of suggested Cards rejected as wrong or too broad
- wrong-scope rate
- critical missing-card rate after setup
- retrieval pass rate after setup
- user confidence that accepted Cards reflect real project truth
- setup confidence coverage by domain
- number of questions asked before initial ready state
- marginal confidence gained per question
- percentage of setup resumes caused by real task relevance versus generic cleanup

Suggested target before treating setup as product-ready:

- first useful pack in under 10 minutes
- no fixed question cap; stop by confidence threshold and marginal value
- wrong-scope suggestions under 10%
- critical missing Cards under 10%
- anchored retrieval pass after setup at or above 90%
- curated-fixture retrieval remains high enough to prove the engine works with excellent data

## Relationship to ADR-0001

ADR-0001 rejected Wizard-B for v1 because content-reasoning extraction changes the trust model. This ADR does not reverse that decision. It clarifies the safe path:

- setup friction reduction can be agent-assisted
- content recommendations can exist as candidates
- authority promotion remains human-only

The original warning was correct: agent recommendations ruin truth if they are silently accepted. They are safe when they are visibly provisional and routed through triage.

## Worked example: LLM-assisted bootstrap (PRD-0034)

The first concrete deployment of this ADR's "agents contribute hypotheses; humans promote truth" rule is [PRD-0034](../prd/0034-llm-assisted-clarification-generation.md): an opt-in LLM augmentation pass that runs after the regex bootstrap of [PRD-0009](../prd/0009-week-6-bootstrap-inbox-and-triage.md).

The example is worth tracing carefully because it tests the boundary in the riskiest plausible direction — an LLM generating *content* (constraint candidates, clarification needs) drawn from imported doc chunks. If this ADR's framing fails anywhere, it would fail here.

**What the LLM can do.**

- Read a single doc chunk that the regex bootstrap caught nothing in (no normative word, no symbol anchor).
- Propose **at most one** candidate card per chunk: a `constraint` or `symbol_note` draft with title, body, scope, and (for `symbol_note`) at least one symbol anchor.
- Propose **at most one** clarification need per chunk, including **2–4 multiple-choice options** (constrained-answer is the default; free-form answers only when uncertainty cannot be compressed honestly).

**What the LLM cannot do.**

- Write to `.contexttrail/cards/`. The augmentation flows through the same `materializeBootstrapProposals` path the regex bootstrap uses, which only writes to `.contexttrail/inbox/`. The acceptance gate is `contexttrail inbox accept`, which a human runs.
- Decide whether a candidate is "good enough." Acceptance lives in human triage.
- Pick between candidates. LLM-as-picker in retrieval is rejected here too — the LLM is generating drafts upstream of the human's pick, not picking from a slate.
- Rewrite accepted cards. The provenance field `authored_by: contexttrail-bootstrap-llm` is recorded on the inbox item; after acceptance, the card retains its full review-trace sidecar showing the LLM origin.

**Why this stays inside the boundary.**

1. **Materialization path is shared.** Augmented drafts use the same writer the regex pass uses (`writeInboxItem`). There is no second code path. A reviewer auditing what reaches the cards surface can read one function.
2. **Provenance is structural, not advisory.** The `authored_by` field is required-on-write for new items; existing items load with the regex-bootstrap default. The reviewer can re-evaluate accepted-LLM cards as a class if a bad-acceptance pattern emerges (e.g., `grep authored_by .contexttrail/cards/*/*.yaml`).
3. **Default off.** The `--llm` flag (or `CONTEXTTRAIL_BOOTSTRAP_LLM_AUGMENT=true` env var) is required to invoke augmentation. The first-run promise is unchanged: `contexttrail import` and `contexttrail card bootstrap` without flags do no AI work, need no API key, and incur no surprise spend.
4. **Cost is bounded.** A per-run cap of 50 invocations and a per-chunk timeout of 30s mean worst-case spend per `contexttrail card bootstrap` call is fixed. Cap-exceeded and chunk-failed cases emit warnings to the cost summary; regex output for those chunks is unaffected.
5. **Selective invocation.** The LLM is only called for chunks where the regex produced *no* candidate. Chunks regex already caught are skipped — the LLM adds at the margin, never replaces.

**Where the boundary would fail (and how the design forbids it).**

- *If acceptance could happen without a human action.* It cannot. `contexttrail inbox accept` is the only acceptance code path; nothing in the LLM provider, validator, or materialization pipeline calls it.
- *If the prompt could leak authority words like "do not review" or "accept directly".* The system prompt explicitly states the output is provisional and reviewed by a human, and asks for constrained-answer clarifications when uncertain. Validation rejects clarifications outside the 2–4 choice range and `symbol_note` candidates without anchors. The structural enforcement does not depend on the prompt — even a malicious provider would be rejected at the validator.
- *If LLM-authored content could enter the retrieval pack without acceptance.* The retrieval engine reads `.contexttrail/cards/`, not `.contexttrail/inbox/`. Inbox items never participate in `retrieve_context_pack` until accepted.

**Why this PRD doesn't move "agent suggestions" into category-3 candidate context automatically.**

Categories 2 and 3 in the decision section above are distinct on purpose. The LLM augmentation only produces category-2 (suggestions visible for triage). Promotion to category 3 (candidate context with non-authoritative provenance) requires a human action — specifically, `contexttrail inbox accept`, which writes the card with `authority: accepted` (currently the only authority value v1 supports). This is the same gate the regex bootstrap uses; LLM augmentation does not loosen it.

The takeaway is structural: **the boundary is enforced by the materialization path and the acceptance gate, not by anything the LLM might say in its output**. Future LLM levers (adaptive question selection, agent-side suggestion writes) can be evaluated against this same test: can the suggestion reach the cards surface without crossing the acceptance gate? If yes, the lever crosses the boundary and is out of scope.
