# PRD-0033: Setup Readiness Scan and Confidence Report

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirty-third PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0001](../adr/0001-wizard-a-deterministic-setup-only.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0015](../adr/0015-task-readiness-gates-authority-not-access.md), [ADR-0018](../adr/0018-inbox-backed-by-local-files-ui-through-agent-surface.md), [ADR-0022](../adr/0022-setup-readiness-policy.md) (locks the band table). Predecessor PRDs: [PRD-0007](0007-week-9-setup-initialization-and-confidence.md) (parent spec), [PRD-0009](0009-week-6-bootstrap-inbox-and-triage.md) (shipped substrate).
>
> Boundary rule: this PRD is the **first deterministic slice of PRD-0007**. It makes setup state legible. It does NOT add LLM-assisted clarification, adaptive question selection, or agent-side suggestion writes — those are explicit non-goals reserved for follow-up PRDs.
>
> Follow-up resolved: "LLM-assisted clarification generation" is the focus of [PRD-0034](0034-llm-assisted-clarification-generation.md), which ships the augmentation pass behind a default-off `--llm` flag while preserving ADR-0014's authority boundary. Adaptive question selection and agent-side suggestion writes remain open.

## Problem Statement

`contexttrail init` is mechanical: it creates `.contexttrail/`, writes default config, opens the SQLite cache. After running it on a fresh repo, the user has no answer to:

- **Did I import the right docs?** Maybe the repo has 47 markdown files spread across `docs/`, `README.md`, and embedded ADRs; none are imported yet.
- **Is my scope coverage sufficient?** Most chunks may have `layer: unknown` if frontmatter is sparse.
- **Are there any cards yet?** If bootstrap hasn't run, the cards surface is empty and retrieval is doc-only.
- **Will retrieval actually answer the queries I care about?** No probe runs without an explicit `contexttrail context` invocation.

For the maintainer (the user, this session), all of this is implicit — they know which docs to import, which scope to tag, which cards to author. For a **pilot user**, this is a blank-page problem. They run `contexttrail init`, see "cache ready at ...", and have no idea what to do next.

The engine has reached the point where retrieval and assembly quality are strong (PRD-0028 / PRD-0029 / PRD-0032 closed the named quality risks). Pilot use is the next validation milestone — but pilot is gated on whether a cold-start user can meaningfully reach a useful Context Pack without holding the maintainer's hand. Today they cannot.

PRD-0007 (post-v1 setup initialization) names this as the entire post-v1 productization slot. PRD-0033 is the first tracer-bullet through it — make state legible, recommend next steps deterministically, leave AI-assisted refinement to later PRDs.

## What is shipped today (do not duplicate)

PRD-0009 already shipped:

- `contexttrail card bootstrap` — regex-based candidate generation from imported canonical chunks (`src/bootstrap/proposals.ts`, `src/inbox/bootstrap.ts`).
- `contexttrail inbox list / show / accept / answer` — local inbox review workflow under `.contexttrail/inbox/` (`src/cli/inbox-cmds.ts`).
- Accepted bootstrap cards land in `.contexttrail/cards/` with `authority: accepted`, `provenance: system_derived`, `authored_by: contexttrail-bootstrap`.
- Per-card review trace sidecars under `.contexttrail/review-trace/`.

PRD-0015 already shipped the readiness orchestrator (`src/readiness/orchestrator.ts`) — task-needs + chunk-selector + pack-verifier. Readiness today is computed per-query at retrieval time. PRD-0033 lifts this to a **repo-level** view that aggregates across the deterministic facts about the repo state.

This PRD does **not** rebuild any of the above. It composes them under a single `contexttrail setup` command + report.

## Solution

Add a **deterministic repo-level readiness scan** that runs after `contexttrail init` (or any time) and reports confidence per named dimension, with concrete next-step suggestions.

The command surface is `contexttrail setup` (CLI) and a peer MCP tool `get_setup_readiness` (agent-facing).

### Four readiness dimensions

Each dimension reports a score in `{ low | partial | confident }` plus structured evidence + a single suggested next step.

| dimension | what it measures | low | partial | confident |
|---|---|---|---|---|
| `corpus_coverage` | Imported markdown vs corpus-shape (markdown count under `docs/` + repo-root README) | <30% of discoverable markdown imported | 30–70% | ≥70% |
| `scope_coverage` | Fraction of imported chunks with non-`unknown` scope layer | <50% | 50–80% | ≥80% |
| `card_coverage` | Cards present + scope distribution | 0 accepted cards | 1–5 cards OR no `constraint` cards | ≥6 cards including ≥1 `constraint` |
| `retrieval_probes` | Built-in probe set against the local corpus; measures `coverage_confidence` distribution | <50% of probes return `confident` | 50–80% | ≥80% |

Thresholds are deterministic constants in `src/setup/readiness-bands.ts` — same convention as `assembly-gate-bands.ts`. Per ADR-0021 Rule 3, future PRDs that change these thresholds amend the ADR-equivalent (a dedicated ADR for setup-readiness bands, to be authored alongside slice 33.1).

### `contexttrail setup` command

```text
$ contexttrail setup
ContextTrail setup readiness for /path/to/repo

  corpus_coverage:     partial    (32 markdown found, 12 imported)
  scope_coverage:      low        (3 / 47 chunks have layer ≠ unknown)
  card_coverage:       low        (0 accepted cards)
  retrieval_probes:    partial    (4 / 6 probes confident)

Suggested next step:
  contexttrail card bootstrap     → propose candidate cards from imported chunks
  (then: contexttrail inbox list  → review and accept the candidates)

Run `contexttrail setup --explain` for per-dimension evidence and per-probe results.
```

The output is plain text by default, with `--json` for agent / scripting consumption and `--explain` for the detailed report. The MCP tool returns the JSON shape unconditionally.

### Suggested next step is deterministic, not aspirational

The "suggested next step" is selected from a fixed decision table over the four dimensions. No LLM. No adaptive prioritization. The table is documented in `src/setup/next-step.ts` and ships with the slice. Examples:

- `corpus_coverage: low` + `card_coverage: low` → suggest `contexttrail import docs/**/*.md` (closest-to-source first)
- `corpus_coverage: confident` + `card_coverage: low` → suggest `contexttrail card bootstrap`
- `card_coverage: low` + bootstrap inbox already has pending items → suggest `contexttrail inbox list`
- All dimensions ≥ partial → suggest `contexttrail context "<sample query>"` to validate retrieval
- All dimensions confident → suggest "repo is ready for agent use" + reference `contexttrail context` as the production surface

The table is small (≤12 rows) and easily extended. It is NOT an inferred recommendation engine; it is a printed mapping.

### Built-in probe set

The `retrieval_probes` dimension requires a probe set — small, fixed, corpus-independent queries that test whether the retrieval engine can find *anything* useful given the current corpus. Initial set (~6 probes):

| probe | what it tests |
|---|---|
| "project overview" | unanchored README-style query |
| "configuration options" | anchored on `config` keyword |
| "test setup" | anchored on `test` keyword |
| "build deployment" | anchored on build / deploy keywords |
| "architecture decisions" | unanchored ADR-style query |
| "primary contributors" | unanchored signal_empty test (most repos don't have this in docs) |

Each probe runs through the existing `retrieve_context_pack` and reports its `coverage_confidence` (`confident` / `partial` / `uncertain`). Probes are corpus-agnostic — they don't reference ContextTrail-specific paths or scopes. The probe set ships as a config-style constant in `src/setup/probes.ts`.

The `signal_empty` probe is deliberately included as a *negative* test: it expects `signal_empty` for most repos, and a corpus that returns `confident` for "primary contributors" is unusual (suggests `AUTHORS.md` or contributor lists are heavily indexed). Either way, the result is informative.

## Out of scope

* **LLM-assisted clarification generation.** Bootstrap currently uses regex; clarification needs are a manual review item. _Resolved 2026-05-11 by [PRD-0034](0034-llm-assisted-clarification-generation.md): LLM augmentation ships behind a default-off `--llm` flag with per-run + per-chunk cost guardrails, and items carry `authored_by: contexttrail-bootstrap-llm` provenance. ADR-0014's authority boundary holds — augmented items go through the same human-acceptance gate as regex items._
* **Adaptive question selection.** PRD-0007 talks about a confidence-driven question flow. This PRD ships static next-step suggestions only — no per-user question routing.
* **Auto-accepting bootstrap cards.** Authority boundary holds. Setup reports state; humans accept cards.
* **Scope auto-derivation.** If `scope_coverage` is low, the suggestion is "review scope frontmatter on the listed chunks" — not "let setup write scope tags for you." That's an authority promotion this PRD does not make.
* **Probe set tuning.** The initial 6 probes are deliberately corpus-independent. If a probe is poorly chosen for some repos, that's a future amendment — not a per-corpus tuning lever.
* **MCP-first interactive flow.** The MCP tool returns structured JSON; it does not orchestrate a multi-turn conversation. Interactive flow belongs in the agent surface (Claude Code, etc.), not in ContextTrail's API.
* **Cross-repo / monorepo setup heuristics.** One repo = one setup report.

## Risks

* **Probe results may vary across runs.** The same non-determinism that PRD-0032 found in `fg.sync` could surface in the probe set. The probes go through `retrieve_context_pack`, which uses `pack.ranked` directly — not subject to PRD-0032's `budgetedRankedEntries` flag drift. Mitigation: probe set is small (~6); per-probe rank can be reported in `--explain` mode for debug; cross-run stability tested in slice 33.4 acceptance.
* **Bands may be miscalibrated against real repos.** The thresholds (`<30%`, `<50%`, etc.) are chosen from inspection of ContextTrail's own corpus state and PRD-0009's bootstrap evidence — not from a panel of real repos. Mitigation: bands live in `src/setup/readiness-bands.ts` as a frozen constant per the ADR-0021 convention; first pilot use surfaces miscalibration as named feedback for an amendment.
* **`contexttrail setup` adds a fifth top-level CLI command.** Cold-start users have to discover that `contexttrail setup` is the right starting point, not `contexttrail import`. Mitigation: `contexttrail init` prints "Next: run `contexttrail setup`" as its final line (single-line change). The command name follows the `drift <verb>` pattern already established for `init / import / index / context / mcp / verify`.
* **Reports could over-recommend** if e.g. `corpus_coverage: confident` is satisfied trivially on a repo that only has one README. Mitigation: bands check both fraction AND absolute count (`< 5 imported chunks → always low` as a floor).

## Acceptance — PRD-level

PRD is complete when:

1. `src/setup/` module exists with:
   - `readiness-bands.ts` — frozen `SETUP_READINESS_BANDS` constant matching the four-dimension table.
   - `readiness-scan.ts` — pure function `scanSetupReadiness(cwd)` returning a structured report.
   - `next-step.ts` — deterministic decision table for next-step suggestion.
   - `probes.ts` — the ~6 corpus-independent probe set.
2. `contexttrail setup` CLI command exists. Prints plain-text by default, `--json` for structured, `--explain` for per-dimension evidence.
3. `get_setup_readiness` MCP tool exists, returns the structured JSON shape.
4. `contexttrail init` prints "Next: run `contexttrail setup`" as the trailing line.
5. The ADR-equivalent for setup-readiness bands is authored alongside the bands module (analogous to ADR-0021 for assembly-gate bands).
6. Unit tests cover: per-dimension band edge cases, next-step decision table for the named scenarios, probe set stability across 3 sequential runs on ContextTrail's own corpus, MCP tool output schema validation.
7. The OPEN.md item "Card bootstrap and onboarding" is updated to reference this PRD.

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Will the bands be tuned to ContextTrail's own corpus state? | The bands are initial estimates derived from inspection of one repo. The PRD says so explicitly. Amendment via the parallel ADR is the documented update path — same as ADR-0021. |
| Could the next-step decision table grow into a heuristic-laden hairball? | The table is a printed mapping with ≤12 rows. Beyond that size, it should be re-shaped — not extended ad-hoc. Slice 33.3 includes a "size cap" test that fails if the table exceeds 12 rows without an explicit ADR amendment. |
| Why not infer next-step via LLM? | ADR-0014 + memory feedback "LLM-as-picker is wrong shape" both bite against putting an LLM in this path. Deterministic next-step is debuggable and reproducible across runs. LLM-assisted clarification (a different lever) is reserved for a future PRD. |
| Why not probe with the real-corpus eval's 174-case panel? | That panel measures retrieval quality at a benchmark level. The setup probe set measures whether the *current repo* has enough imported substrate for the engine to do anything. Different question, different tool. |
| Won't this duplicate the readiness orchestrator at `src/readiness/`? | The readiness orchestrator is *per-query, per-pack* readiness. PRD-0033 is *per-repo, per-setup-state* readiness. They share no logic. The PRD's `retrieval_probes` dimension consumes the orchestrator's per-query output as one input, but does not replicate it. |
