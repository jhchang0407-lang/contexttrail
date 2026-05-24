# PRD-0042 Second Validation Repo Selection

Date: 2026-05-13

## Decision

The second commit-grounded validation repo for PRD-0042 is:

- `/Users/thomaschang/Repos/Ralph`

## Why Ralph

- It is a real local TypeScript repository with shipped code under `src/`, a working test suite, and durable product docs under `docs/prd/`, `docs/adr/`, and `docs/architecture/`.
- Its domain is meaningfully different from ContextTrail. Ralph is an autonomous Linear queue runner rather than a retrieval engine, so success here says more than "the same maintainer style still works on a sibling retrieval project."
- It stays inside the PRD boundary. Ralph is still TS/JS plus markdown, so PRD-0042 does not need broader language-support expansion just to run the second panel.
- It has recent commit-shaped ticket history that is believable for downstream implementation evaluation.

## Why This Is Operationally Realistic

- The repo is an active git checkout with recent ticket-labeled commits such as:
  - `13e51ae` — `feat(THO-25): markdown summary rendering of JSON artifacts`
  - `1e56bad` — `feat(THO-24): takeover command adopts blocked or in-progress tickets`
  - `ca325d2` — `feat(THO-23): reset command clears stale lock and run state`
  - `b42194d` — `feat(THO-17): validator command runner with failure classification`
- The code surface includes real CLI, runner, validator, Linear, and schema modules rather than toy examples.
- The repo already has `package.json`, `tsconfig.json`, `vitest.config.ts`, and installed `node_modules`, so an AFK agent can continue without repo bootstrapping guesswork.

## Minimum Believable Task Panel

Use this minimum commit-grounded panel for the second repo:

- `THO-25` / `13e51ae`
  - Markdown summary rendering of JSON artifacts
  - Expected core edit surface: `src/artifacts/summaries.ts`
- `THO-24` / `1e56bad`
  - Takeover command adopts blocked or in-progress tickets
  - Expected core edit surface: `src/runner/takeover-run.ts`
- `THO-23` / `ca325d2`
  - Reset command clears stale lock and run state
  - Expected core edit surface: `src/runner/reset-run.ts`
- `THO-17` / `b42194d`
  - Validator command runner with failure classification
  - Expected core edit surface: `src/validate/validate.ts`

These are all real shipped tasks, not synthetic prompts.

## Access Assumptions

- Run cross-repo validation against the local checkout at `/Users/thomaschang/Repos/Ralph`.
- Keep the validation inside TS/JS + markdown. Do not expand chunker scope or language support for this slice.
- Reuse the same paired old-vs-new code-lane harness shape already used on the primary repo.

## Notes

- No local `PRDN` checkout was present under `/Users/thomaschang/Repos`, so Ralph is the strongest available candidate that satisfies the PRD boundary and realism requirements.
- This note is the durable selection record for THO-305 so an AFK agent can continue into THO-306 without reopening repo-choice ambiguity.
