# PRD-0037: Agent-Assisted Setup Conversation

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirty-seventh PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0018](../adr/0018-inbox-backed-by-local-files-ui-through-agent-surface.md), [ADR-0022](../adr/0022-setup-readiness-policy.md). Predecessor PRDs: [PRD-0007](0007-week-9-setup-initialization-and-confidence.md) (parent setup-confidence roadmap), [PRD-0033](0033-setup-readiness-scan-and-confidence-report.md) (repo-level setup readiness), [PRD-0034](0034-llm-assisted-clarification-generation.md) (candidate + clarification generation with human acceptance), [PRD-0036](0036-phase-0-exit-fixes.md) (Phase 0 pilot exit fixes).
>
> Boundary rule: this PRD adds the **first agent-guided setup conversation slice**. It may ask questions, propose setup actions, and write provisional review items. It does NOT let an agent silently accept Cards, rewrite accepted truth, or make candidate context authoritative. Per ADR-0014's 2026-05-14 amendment, an agent should still curate obvious inbox items under human-authored policy and ask humans only high-leverage semantic questions.

## Problem Statement

Phase 0 proved ContextTrail can be useful on a real external corpus when the maintainer knows how to drive the workflow: initialize, import, run setup, bootstrap cards, inspect the inbox, wire MCP, and ask retrieval questions. That is a meaningful product proof.

The remaining setup problem is that a new user still has to understand too much of ContextTrail's internal model before they get to the useful part:

- `contexttrail setup` reports readiness, but it does not conduct a setup conversation.
- The MCP agent can retrieve context, but cannot yet guide the user through import, bootstrap, inbox review, or readiness recovery.
- Bootstrap can produce candidate Cards and clarification needs, but the agent does not have a first-class tool surface for showing the highest-leverage review work.
- User answers can update inbox items today through CLI, but there is no setup-level question planner that decides which 1-3 questions matter most.
- The product promise is "a capable agent helps you set up ContextTrail," while the current product is closer to "the CLI prints the next command."

This is now the highest-leverage product gap. The retrieval engine is strong enough to deserve a better on-ramp.

## Solution

Add a small, deterministic **setup conversation layer** that lets an MCP-connected agent curate setup work, ask a few targeted questions, and turn explicit user answers into durable local setup state.

The first slice is intentionally narrow:

```text
get_setup_readiness
-> propose_setup_questions
-> agent curates obvious inbox items
-> user answers high-leverage questions in agent UI
-> answer_setup_question
-> writes config / inbox state only when the answer is explicit
-> setup readiness updates
```

The agent is the conversation surface. ContextTrail is the durable state machine and authority boundary.

### What the Conversation Should Feel Like

The agent should be able to say something like:

```text
ContextTrail is partly set up. I found enough imported docs and good scope coverage,
but setup is blocked by 2 high-leverage decisions:

1. Should docs/tutorial/** be treated as examples rather than canonical docs?
2. Bootstrap proposed 47 candidate constraints. Do you want to review candidate cards first,
   or answer the 3 clarification questions that affect the most candidates?
```

The user should not need to know what `doc_role`, `authority`, `scope_coverage`, or `review_type` mean before the agent can help.

The agent should not ask the user to grade every individual candidate Card. It should accept or ignore obvious items itself, then summarize what it did and ask only when the answer teaches a reusable repo rule.

## User Stories

1. As a new ContextTrail user, I want the MCP-connected agent to tell me what setup decision matters next, so that I do not have to learn every command before getting value.
2. As a new ContextTrail user, I want setup questions limited to the highest-leverage 1-3 decisions, so that onboarding feels guided rather than like generated homework.
3. As a maintainer, I want user answers written to durable local files, so that setup survives cache rebuilds and agent restarts.
4. As a maintainer, I want agent suggestions to stay provisional until they are accepted explicitly or through my documented curation policy, so that ContextTrail does not corrupt the truth model.
5. As an agent operator, I want to see whether a setup question affects import coverage, scope coverage, card coverage, retrieval probes, or pending inbox items, so that I know why the question matters.
6. As a pilot user, I want the agent to notice pending inbox items and route me to candidate cards or clarification needs, so that I do not stare at hundreds of unprioritized review items.
7. As a CLI-first user, I want the same setup question planner available from the terminal, so that MCP and CLI behavior stay testable and equivalent.
8. As a project maintainer, I want answers that change config to be explicit and previewable, so that setup does not surprise-edit `.contexttrail/config.yaml`.
9. As a project maintainer, I want answers that accept truth to continue through inbox/Card triage, so that accepted Cards remain intentional and traceable.
10. As a future contributor, I want setup-question logic to live in a small testable module, so that new question types can be added without turning MCP handlers into policy code.

## Implementation Decisions

### Decision 1: Add a Setup Question Planner

Create a deep module that consumes current setup state and returns at most 3 setup questions.

Inputs:

- setup readiness report from PRD-0033
- pending inbox counts and top review items
- imported source summaries
- config state and discoverable markdown facts
- freshness warnings when available

Output shape:

```ts
type SetupQuestion = {
  id: string
  kind:
    | "import_docs"
    | "review_inbox"
    | "doc_role_choice"
    | "scope_recovery"
    | "mcp_wiring"
    | "validate_context"
  prompt: string
  reason: string
  impact: {
    dimensions: Array<"corpus_coverage" | "scope_coverage" | "card_coverage" | "retrieval_probes">
    affected_items?: number
  }
  choices: Array<{ id: string; label: string; description?: string }>
  free_text_allowed: boolean
  command_preview?: string
}
```

The planner is deterministic for this PRD. LLM-generated setup questions are explicitly out of scope.

### Decision 2: MCP Tool Surface

Add two MCP tools:

| tool | purpose |
|---|---|
| `propose_setup_questions` | Returns the current setup readiness plus 0-3 highest-leverage setup questions. Safe on session start. No writes. |
| `answer_setup_question` | Applies an explicit answer to a known setup question. Writes only to approved local setup surfaces. |

The existing `get_setup_readiness` remains. `propose_setup_questions` builds on it rather than replacing it.

### Decision 3: CLI Equivalence

Add CLI equivalents:

```bash
contexttrail setup questions
contexttrail setup answer <question-id> --choice <choice-id>
contexttrail setup answer <question-id> --text "<answer>"
```

The CLI and MCP paths should call the same planner and answer-handler modules. MCP should not carry unique setup policy.

### Decision 4: Answer Effects Are Narrow and Typed

`answer_setup_question` can perform only these actions in this PRD:

- mark an inbox clarification as answered through the existing review flow
- recommend a command without executing it when the action is operational (`contexttrail import`, `contexttrail card bootstrap`, `contexttrail context`)
- write a proposed config patch to a review item, not directly to accepted config, unless the question kind is deterministic and the user explicitly chose "apply"
- route the user to `contexttrail inbox list --type candidate_card` or `--type clarification_need`

Authoritative Card acceptance remains outside this tool. Existing `contexttrail inbox accept` remains the explicit acceptance path, whether driven directly by a human or by an agent following a human-authored curation policy.

### Decision 5: Reuse Inbox for Durable Questions Where Possible

Setup questions that ask for semantic judgment should materialize or reference `.contexttrail/inbox/` review items. ADR-0018 already establishes that review state belongs on disk and can surface through the agent UI.

For this PRD, avoid inventing a second durable question store unless a question cannot honestly fit the inbox model. If a separate setup-session state file is needed, it should store only operational state: generated question ids, timestamps, and command previews. It must not store accepted truth.

### Decision 6: Prioritization Rules

The planner ranks questions by leverage:

1. MCP wiring missing or broken blocks agent use.
2. No imported corpus blocks retrieval.
3. Pending inbox items route to curated triage; clarifications with many affected candidates beat raw single-item review.
4. Low card coverage with enough imported chunks routes to bootstrap.
5. Low scope coverage routes to scope inspection / config proposal.
6. All dimensions at least partial routes to a sample context validation question.

This ranking is a small decision table, not an LLM picker.

## Testing Decisions

Tests should focus on observable setup behavior, not internal planner implementation details.

Required coverage:

1. Planner returns no more than 3 questions.
2. Empty repo after `contexttrail init` proposes import/setup recovery before card review.
3. Imported repo with low card coverage proposes `contexttrail card bootstrap`.
4. Repo with pending inbox items proposes inbox review before more bootstrap.
5. Repo with many candidate cards and clarification needs prioritizes curated candidate-card review or high-impact clarification review deterministically.
6. `propose_setup_questions` MCP output validates against schema and is byte-equivalent in shape to CLI JSON output.
7. `answer_setup_question` refuses unknown question ids and invalid choices.
8. Semantic answers do not write accepted Cards directly.
9. Single clarifications with no affected candidates do not surface as top-level setup questions when there is broader curated inbox work to do.
10. Operational answers either return command previews or write only the explicit approved local state.
11. Existing `get_setup_readiness`, `contexttrail setup`, `contexttrail inbox`, and `contexttrail card bootstrap` tests keep passing.

Useful prior art:

- PRD-0033 setup readiness tests for band and next-step behavior.
- PRD-0036 inbox list tests for large review-item surfaces.
- PRD-0034 bootstrap clarification tests for human-answer flow.
- MCP schema tests for contract validation.

## Acceptance

PRD is complete when:

1. A new `setup-question` module exists with deterministic planning and answer application.
2. `propose_setup_questions` MCP tool exists and returns setup readiness plus at most 3 questions.
3. `answer_setup_question` MCP tool exists and can answer supported setup questions without accepting Cards automatically.
4. CLI equivalents exist under `contexttrail setup questions` and `contexttrail setup answer`.
5. Setup question schemas include `id`, `kind`, `prompt`, `reason`, `impact`, `choices`, `free_text_allowed`, and optional `command_preview`.
6. The planner routes the main cold-start states correctly: import missing, bootstrap needed, inbox pending, scope low, context validation ready.
7. User answers that affect semantic truth go through inbox review state, not direct authoritative writes.
8. Tests cover MCP schema validation, CLI/MCP equivalence, answer rejection, and authority-boundary preservation.
9. README or CORE gets a short "Agent-guided setup" note after implementation lands.

## Out of Scope

- LLM-generated setup questions.
- Full adaptive confidence scoring.
- Unreviewed automatic card acceptance.
- Direct agent edits to accepted Cards.
- A rich TUI wizard.
- Continuous file watching.
- Corpus-language canonicalization / translation denominator fixes.
- Multi-repo or monorepo setup orchestration.
- Replacing `get_setup_readiness`; this PRD layers on top of it.

## Risks

| risk | mitigation |
|---|---|
| Setup questions become noisy or too numerous | Hard cap at 3 questions and deterministic ranking by setup leverage |
| The MCP agent appears to have authority it does not have | Tool descriptions and outputs must distinguish suggestions, candidates, and accepted truth |
| Users expect `answer_setup_question` to accept Cards | Keep Card acceptance on existing inbox accept flow; answers may update clarification state only |
| Planner duplicates `next-step.ts` logic | Planner may call the next-step module, but owns question rendering and prioritization |
| Config patching becomes risky | First slice should prefer command previews and review items; direct config writes require explicit deterministic apply |

## Further Notes

This PRD is the first concrete "agent asks questions" slice. It intentionally stops short of the full PRD-0007 confidence-guided onboarding vision.

The success question is:

> Can a capable MCP agent guide a maintainer from "repo initialized" to "first useful Context Pack" without the maintainer knowing ContextTrail's internal model?

If yes, setup becomes a product surface instead of a pile of commands.
