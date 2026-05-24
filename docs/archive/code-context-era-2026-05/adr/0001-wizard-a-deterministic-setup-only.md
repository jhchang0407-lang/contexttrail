# ADR-0001: v1 ships deterministic setup wizard but not content-reasoning extraction

**Status:** Accepted
**Date:** 2026-05-05

## Context

The v1 onboarding has a real friction problem: users have to manually write `.contexttrail/config.yaml`, classify folders by scope, and decide which docs to import. That work is pure labor — no judgment required, just typing.

A natural impulse is to solve this by having an LLM read the user's existing docs and auto-propose Context Cards too. But that conflates two distinct problems:

1. **Removing setup friction** — config, scope rules, doc classification. The user has the judgment, just doesn't want to write YAML.
2. **Generating new truth** — extracting invariants from prose. The LLM is asked to *infer* what's a constraint vs. a stylistic preference, what's load-bearing vs. incidental.

These look like the same surface area on the outside (a wizard) but are very different products with very different risk profiles.

## Decision

v1 ships **Wizard-A** (deterministic setup) and **defers Wizard-B** (content-reasoning extraction).

### Wizard-A — in v1
- Filesystem walk + folder-pattern heuristics only
- MCP tools: `scan_project`, `suggest_scope_rules`, `apply_setup_choice`, `list_setup_unknowns`, `finalize_setup`
- CLI fallback: `contexttrail setup` (interactive)
- Output: `.contexttrail/config.yaml`, scope mapping, classified imports
- No LLM in the ContextTrail process. The agent client (Claude Code, Codex) supplies the conversational UI; ContextTrail only exposes deterministic tools.

### Wizard-B — deferred post-v1
- Anything that reads prose and proposes card *content*
- `propose_card` MCP tool
- Candidate state machine (`candidates/` directory, accept/reject UX)
- LLM extraction pipeline

A `candidates/` subdirectory is reserved in the v1 layout (unused) so that adding Wizard-B later requires no migration.

## Consequences

### Positive
- v1 scope stays bounded (~3–4 days of incremental work for Wizard-A)
- "accepted card" still means "human-authored truth" — the trust property holds for week-5 measurement
- The locked-include guarantee can be tested against cards a human actually wrote, so a poor week-5 result tells us about the engine, not about LLM proposal quality
- Forward-compatible: Wizard-B can be added later by introducing the candidate state without changing Wizard-A
- Users can use Claude Code (or any agent) as a card-drafting assistant in a side window today — no ContextTrail feature required

### Accepted costs
- Card authoring still requires the user to know the codebase well — raises the bar for dogfood repo selection (the user must be domain expert on the repo)
- Onboarding is "good but not magical" — power users must still author cards by hand
- The reserved `candidates/` directory is mild waste in v1

## Alternatives considered

1. **Ship full propose-loop in v1.** Rejected: ~1.5–2 weeks of scope, changes the trust model before the engine has even been validated, makes week-5 measurement ambiguous (did the engine fail or did the proposals fail?).
2. **Ship neither — manual config only.** Rejected: friction is real and adoption-killing.
3. **Hybrid: Wizard-A + LLM proposal of folder labels only.** Rejected as a halfway point — adds an LLM dependency without proportionate value.

## The decision rule that produced this

> If a feature removes setup friction, include it. If a feature generates new "truth," defer it.

Codified into CORE.md and CONTEXT.md as the friction-vs-truth rule. Applies to future ambiguous features.
