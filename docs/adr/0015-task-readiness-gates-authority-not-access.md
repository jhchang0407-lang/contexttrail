# ADR-0015: Task readiness gates authority, not access

**Status:** Proposed / Deferred
**Date:** 2026-05-07

## Context

`retrieve_context_pack` is becoming a substrate for more than agent chat context. Future ContextTrail products such as drift detection, PR review, setup diagnostics, and missing-card reports will all depend on the same repo model.

The engine can retrieve strong context when the substrate is well-authored, but setup confidence varies by repo, domain, and task. Users may not know the whole codebase down to symbol-level behavior, especially in AI-written or AI-maintained repos. ContextTrail therefore cannot rely on exhaustive human questioning before use.

The missing concept is task-local readiness:

> Can ContextTrail support this task with the current substrate, and what authority should the agent assign to the returned context?

Without this, agents receive context but cannot tell whether it is authoritative, exploratory, blocked by stale truth, or simply ungrounded.

## Decision

After retrieval-engine quality is hardened and a PRD is accepted, `retrieve_context_pack` should include an additive `task_readiness` block. Internally, readiness should be assessed by a standalone module rather than being buried in ranking or MCP transformation.

This ADR records the product decision for later. It is not an implementation commitment for the current retrieval-engine-hardening slice.

The readiness field classifies the pack as:

- `ready` — locked accepted Cards can be treated as authoritative constraints for this task.
- `exploratory` — useful context may exist, but the agent must verify behavior in code/tests/docs before treating it as truth.
- `blocked` — the task depends on missing, stale, or conflicted authoritative context. The agent should not implement from the pack as authoritative until the listed gap is resolved.
- `signal_empty` — supplied anchors did not ground. The agent should ask for corrected anchors or run setup/import.

Readiness gates authority, not access. Even when blocked, ContextTrail may still return context, warnings, and suggested next actions. The field tells the agent how to use that context safely.

## V0 rules

V0 is intentionally conservative because DomainRegistry and setup confidence do not exist yet.

`signal_empty`:

- If `query_mode === "signal_empty"`, readiness is `signal_empty`.
- Agent should ask for corrected files/symbols/routes or run setup/import.

`blocked`:

- If any `expected_locked` Card is missing, readiness is `blocked`.
- If `locked_overflow` is present, readiness is `blocked`.
- If any locked Card has `freshness_state` of `needs_review` or `potentially_superseded`, readiness is `blocked`.

`ready`:

- Only anchored queries may be ready.
- At least one accepted locked Card must be present.
- No blocking condition may be present.

`exploratory`:

- Unanchored queries are exploratory by default.
- Anchored queries with no locked Cards are exploratory.
- Ranked docs alone never make V0 readiness `ready`; they provide background, not authority.
- Locked Cards with `unverified` or `maybe_affected` freshness keep the pack out of `ready`, but do not hard-block by themselves in V0.

## Agent policy

`task_readiness` must be operational, not just a score. It includes an `agent_policy` with booleans that tell agents what they may do:

- `locked_cards_authoritative`
- `ranked_docs_authoritative`
- `must_verify_in_code`
- `should_ask_for_anchors`
- `should_resolve_setup_gap`

V0 policy:

- `ready`: locked Cards authoritative; ranked docs not authoritative; verify only as normal coding discipline.
- `exploratory`: locked/ranked content not authoritative; must verify in code/tests before behavior changes.
- `blocked`: do not implement from retrieved context as authoritative; resolve the stated setup or freshness gap.
- `signal_empty`: ask for corrected anchors or run setup/import.

## Future extension

When DomainRegistry lands, readiness can incorporate:

- domain risk
- domain classification confidence
- authority hierarchy confidence
- coverage confidence
- retrieval probe pass rate
- evidence confidence
- unresolved conflicts

Risk-based behavior can then become stricter for auth, permissions, migrations, money movement, data deletion, privacy, and schema correctness.

## Sequencing

Task readiness is deliberately deferred until the retrieval pipeline is excellent with curated, accepted data.

The implementation order is:

1. Harden retrieval-engine quality against adversarial fixture cases.
2. Write a PRD for setup intelligence / task readiness.
3. Implement setup confidence and readiness as a separate slice.

This sequencing keeps two problems separate:

- **retrieval-engine quality** — given excellent data, does ContextTrail retrieve the right locked and ranked context?
- **setup/readiness quality** — given imperfect setup, does ContextTrail know whether the current task slice is authoritative, exploratory, blocked, or ungrounded?

Setup intelligence should not mask retrieval defects. Readiness should explain substrate uncertainty only after the retrieval engine itself is trustworthy.

## Consequences

### Positive

- Agents eventually receive context plus instructions for how much to trust it.
- Future products can share the same readiness contract.
- ContextTrail avoids fake confidence when setup is incomplete.
- Retrieval remains useful even when authority is blocked.
- The wire change is additive and backward-compatible.

### Accepted costs

- The MCP response grows slightly.
- Some existing "good enough" packs will now be labeled exploratory.
- Clients that want to use readiness well must respect the agent policy.
- V0 readiness is conservative until DomainRegistry and setup confidence exist.

## Relationship to ADR-0014

ADR-0014 defines adaptive setup confidence and the truth boundary for agent-assisted setup. This ADR defines the runtime contract that connects setup confidence to actual agent work:

> Setup confidence varies by repo. Task readiness tells agents whether the current task slice is safe to treat as authoritative.
