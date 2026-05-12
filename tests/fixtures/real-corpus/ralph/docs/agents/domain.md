# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

Single-context repo. Read these before exploring the code:

- **`CONTEXT.md`** at the repo root — Ralph's canonical glossary (Ralph, Managed Repository, LinearProject, Queue Query, Workflow Signal, etc.) plus the relationship rules between them.
- **`docs/adr/`** — architectural decisions:
  - `0001-linear-as-v1-provider.md`
  - `0002-global-tool-per-run-scope.md`
  - `0003-linear-workflow-signals-as-execution-truth.md`
  - `0004-authored-and-lock-config-split.md`
  - `0005-separate-normalization-preflight-and-packet-resolution.md`
- **`docs/architecture/`** — implementation-shaping documents (architecture, machine block schema, runner module layout, phased implementation plan).
- **`docs/prd/`** — product requirements documents.
- **`research/BLUEPRINT.md`** — original planning blueprint (historical / inspiration; superseded by `CONTEXT.md` and architecture docs when conflicts arise).

If any of these files don't exist yet, **proceed silently**. Don't flag absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## Source-of-truth order when artifacts disagree

Ralph's own design rules (from `research/BLUEPRINT.md`) apply here too:

1. Linear ticket acceptance criteria
2. ADRs (`docs/adr/`)
3. `CONTEXT.md`
4. PRDs (`docs/prd/`)
5. Older ideation docs (`research/`) — informational only.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

In particular:
- Use **Managed Repository**, not "repo target" or "checkout"
- Use **LinearProject**, not "project" alone (which is ambiguous between Linear projects and software projects)
- Use **Queue Query**, not "queue", "filter", or "view"
- Use **Workflow Signal**, not "status" (which is too broad)
- Use **Run**, not "session" or "execution"
- Use **Machine-owned Ticket Block**, not "metadata block" or "yaml block"

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (Linear workflow signals as execution truth) — but worth reopening because…_
