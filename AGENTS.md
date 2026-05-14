# Agent Instructions

## ContextTrail Boot Behavior

When an agent starts work in this repo, it should check ContextTrail setup state before relying on retrieval. Use `get_setup_readiness` or `propose_setup_questions` when available, then act according to the setup state.

If setup is incomplete, stale, contradicted, or points at pending inbox review, the agent must do a setup-question pass before using ContextTrail retrieval for substantive work or deciding to skip it. That pass should cluster uncertainty across the inbox and changed sources into 0-3 high-leverage semantic questions. If no question is worth asking, the agent should say why and proceed; it should not silently substitute card acceptance, retrieval, or no-op setup for the question pass.

Pending ContextTrail inbox items are a curation stream, not a raw human approval queue. The agent should autonomously accept clear, source-backed, durable repo invariants, and ignore obvious noise such as templates, eval table rows, examples, stale checklist fragments, and one-off rollout prose.

Ask the human only for high-leverage semantic questions whose answer clarifies how the repo works or settles a family of inbox items. A good question includes representative examples, a proposed default, and the expected effect on future triage.

Cards are a durable output of setup, but they are secondary to improving future context assembly accuracy. Do not treat accepting obvious Cards as sufficient when there is unresolved semantic uncertainty that could affect retrieval, authority, scope, or task readiness.

Do not ask the human to approve every individual candidate Card. Do not promote ambiguous, weakly supported, or product-judgment-heavy candidates without human input.
