# PRD-0007: Week 9 setup initialization and confidence-guided onboarding

> Source-of-truth canonical doc. Builds on [ADR-0001](../adr/0001-wizard-a-deterministic-setup-only.md) and [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md). Predecessor: [PRD-0006](0006-fact-finding-quality-and-context-assembly-bridge.md).
>
> **Sequencing rule:** this is the first post-v1 productization slice. It comes after week 8 stabilization, not inside the critical-path v1 build.

## Problem Statement

By the end of week 8, ContextTrail should be able to retrieve and assemble useful Context Packs when the substrate is well-authored. But a new repo still has a real onboarding gap:

- users do not know which docs to import first
- scope rules and authority boundaries start vague
- bootstrap candidates may exist, but the repo is not yet clearly "ready"
- retrieval quality depends on setup quality, yet setup quality is mostly invisible

`contexttrail init` solves only the mechanical first step: create `.contexttrail/`, write config, and open the cache. It does not tell the user whether the repo is actually well-initialized for retrieval.

The product needs a setup-initialization layer that makes readiness legible without promoting agent suggestions into truth automatically.

## Solution

Add a **confidence-guided setup initialization flow** above the existing `contexttrail init` command.

The workflow is:

```text
contexttrail init
-> scan repo and current docs/config state
-> propose deterministic setup choices
-> user confirms high-leverage choices
-> import and probe retrieval
-> optionally bootstrap candidate cards
-> report setup confidence, unknowns, and ready/not-ready areas
```

Week-6 precursor status:

- the bootstrap / inbox / clarification review loop now exists
- accepted bootstrap cards already flow into the normal cards and retrieval surfaces
- what week 9 adds is the higher-level setup loop above that substrate:
  - scan
  - question selection
  - clustering
  - confidence / readiness reporting

This flow should follow the trust boundary from ADR-0014:

- deterministic setup facts may be applied after confirmation
- agent suggestions remain provisional
- candidate Cards stay non-authoritative
- only accepted truth becomes locked/authoritative context

## Product Goals

1. Reduce blank-page setup friction for a new repo.
2. Make setup quality visible as a first-class product surface.
3. Stop asking questions when the remaining uncertainty is low-leverage.
4. Keep retrieval quality and setup quality measurable as separate concerns.
5. Preserve the authority boundary: helpful setup, no silent truth promotion.

## User Stories

1. As a new user, I want ContextTrail to inspect my repo and tell me the likely import roots, so I do not have to guess.
2. As a new user, I want suggested scope rules and authority boundaries, so setup starts from something plausible.
3. As a new user, I want setup to ask a few high-leverage questions instead of making me hand-classify everything.
4. As a new user, I want a visible readiness summary, so I know whether retrieval is trustworthy yet.
5. As a maintainer, I want setup confidence separated from retrieval correctness, so a weak onboarding flow does not hide engine problems.
6. As a maintainer, I want candidate cards and accepted cards kept distinct, so setup help never corrupts authoritative context.
7. As an agent operator, I want low-confidence domains surfaced before a task relies on them, so I know when to trust the pack and when to treat it as exploratory.

## Scope

### In scope

- A dedicated setup-initialization doc and roadmap slot
- Setup status model: domain coverage, authority clarity, conflict status, retrieval probe pass rate
- Deterministic repo scan for likely docs/import roots/path clusters
- Suggested scope-rule generation and unknown-scope surfacing
- A small interactive setup loop that asks high-leverage questions only
- Readiness/status reporting per domain
- Probe-based verification that the imported substrate is useful
- MCP/CLI setup surfaces that can support a conversational agent without making authoritative writes automatically

### Out of scope

- Full agent-authored truth promotion
- Automatic acceptance of candidate Cards
- Collapsing candidate context and accepted truth into one state
- Replacing retrieval evals with setup evals
- Full task-readiness policy
- Drift detection and code-side freshness automation

## Proposed surfaces

### CLI

- `contexttrail setup init` — start or resume setup initialization for the current repo
- `contexttrail setup status` — show confidence, unknowns, and domains that are ready vs exploratory
- `contexttrail setup scan` — inspect repo structure and propose deterministic config/import choices
- `contexttrail setup probe` — run retrieval probes against the current substrate

### MCP

Aligned with ADR-0001's setup direction:

- `scan_project`
- `suggest_scope_rules`
- `list_setup_unknowns`
- `apply_setup_choice`
- `finalize_setup`

The exact naming can still change, but the boundary should not: setup help is allowed, authoritative card writes are not.

## Confidence model

Setup confidence should report at least:

- **coverage** — are the main repo domains mapped?
- **authority clarity** — do we know which docs/cards are authoritative per domain?
- **conflict status** — are important contradictions unresolved?
- **retrieval probe pass rate** — do representative queries retrieve the expected context?

Suggested readiness bands:

- `0-50%` unknown
- `50-70%` weak
- `70-85%` usable
- `85-95%` trusted
- `95-100%` accepted or verified

Initial setup should usually stop when:

- repo domain map confidence is at least `85%`
- authority hierarchy confidence is at least `85%`
- top critical flows are at least `90%`
- retrieval probe pass rate is at least `85%`
- there are no unresolved high-impact conflicts

## Setup readiness calibration

Setup remains confidence-gated, not question-capped. On typical repos, ContextTrail should usually reach an initial ready state in roughly `10-20` high-leverage questions, where "typical" means a small-to-medium codebase with mostly clean docs, moderate domain complexity, and no heavy concentration of high-risk surfaces such as auth, permissions, migrations, money movement, privacy, data deletion, or schema correctness.

This range is a calibration signal for the setup engine, not a ceiling on user experience. The stop condition is confidence and marginal value, not count. Question count alone is not a quality metric: the real failure mode is high question count with low marginal confidence gain per question. A repo that legitimately needs `25` high-leverage questions can still be healthy; a repo that asks `12` low-leverage questions is broken.

## Success Criteria

The setup-initialization slice is successful when:

1. A new repo can reach a first useful Context Pack in under 10 minutes.
2. Setup converges within the readiness calibration band using high-leverage questions rather than long file-by-file review.
3. The user can see which domains are ready, exploratory, or still blocked by setup gaps.
4. Retrieval quality remains measurable separately from setup quality.
5. Candidate suggestions never become authoritative without explicit acceptance.

## Sequencing

This work should sit **after week 8** as the first planned post-v1 slice:

```text
Weeks 1-8: prove retrieval, cards, MCP, assembly groundwork, bootstrap, and dogfood
Week 9: setup initialization and confidence-guided onboarding
v1.5+: drift detection, freshness automation, and broader orchestration layers
```

Why here:

- before week 8, the bigger risk is still engine correctness and Context Pack usefulness
- after week 8, the next product risk is onboarding a new repo without losing the truth boundary
- setup quality matters a lot, but only after the engine itself is good enough to deserve easier onboarding

## Further Notes

- `contexttrail init` remains the mechanical bootstrap. This PRD adds the readiness and confidence layer above it.
- Setup initialization should be judged by user leverage, not by how many questions it can ask.
- Retrieval probes are part of setup because "repo imported" is not the same as "repo ready."
