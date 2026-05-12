# PRD-0036: Phase 0 Exit Fixes — Bugs Surfaced by the fastapi Pilot

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirty-sixth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0018](../adr/0018-inbox-backed-by-local-files-ui-through-agent-surface.md), [ADR-0022](../adr/0022-setup-readiness-policy.md). Predecessor PRDs: [PRD-0033](0033-setup-readiness-scan-and-confidence-report.md) (introduced setup readiness — B1 and B8 are issues with the shipped surface), [PRD-0009](0009-week-6-bootstrap-inbox-and-triage.md) (shipped bootstrap + inbox — B4 and B5 are issues with that surface), [PRD-0028](0028-code-source-index-for-agent-completion.md) (chunker quality — B3 is an issue from this surface). Evidence: [docs/pilot/phase-0-2026-05/bugs.md](../pilot/phase-0-2026-05/bugs.md), [docs/pilot/phase-0-2026-05/sessions.md](../pilot/phase-0-2026-05/sessions.md), [docs/pilot/phase-0-2026-05/retro-maintainer.md](../pilot/phase-0-2026-05/retro-maintainer.md).
>
> Boundary rule: this PRD fixes **5 specific issues surfaced by Phase 0 pilot on fastapi**. It does NOT add a continuous file watcher, rebuild bootstrap from scratch, or change retrieval scoring. The non-goals section is load-bearing.
>
> **Shipped state (2026-05-11):** all five slices landed. 36.1 = THO-260 (next-step `bootstrap_despite_low_corpus` row + `BOOTSTRAP_MIN_CHUNK_FLOOR=50` + `contexttrail init` writes `.mcp.json` write-only-if-absent). 36.2 = THO-261 (chunker forced-split at `2× max_tokens` for list / table / code with `split_part: {index, total}` traceability metadata). 36.3 = THO-262 (`contexttrail inbox list --limit/--type/--status` + header + footer + pending/candidate-first sort). 36.4 = THO-263 (`isBotEmojiNoise` + `isTranslationGlossaryNoise` filters pre-tone-match in `src/bootstrap/proposals.ts`). 36.5 = THO-264 (this PRD's wrap-up: maintainer retro + OPEN.md verdict + PILOT.md private-repo confirmation).

## Problem Statement

Phase 0 (maintainer self-pilot on the fastapi repo) ran on 2026-05-11. The engine cleared every functional gate — `contexttrail init → setup → import → bootstrap → inbox → MCP retrieve` ran end-to-end and produced four useful agent responses including textbook honest signal_empty on a negative test. The session log (`docs/pilot/phase-0-2026-05/sessions.md`) is the authoritative record.

But the session also surfaced **8 specific bugs** captured in `docs/pilot/phase-0-2026-05/bugs.md`. Two are blocking, four are major. PILOT.md's Phase 0 exit criteria require all blocking bugs to be fixed and the cohort 1 known-issues list to be tightened before external users see the product. PRD-0036 ships the fixes for the 5 most-impactful bugs (B1, B3, B4, B5, B8). The remaining 3 (B2 corpus_coverage denominator, B6 negative probe ambiguity, B7 placeholder paste-bait) are tracked separately and not blocking cohort 1 launch.

## What's broken (the 5 bugs in scope)

| id | severity | summary | shipped fix |
|---|---|---|---|
| **B1** | blocking | After import that gives `scope_coverage: confident`, the next-step recommendation still says "contexttrail import" because `corpus_coverage` divisor is inflated by translations | Decision-table fix: card_coverage:low + chunks≥50 → recommend bootstrap regardless of corpus_coverage label |
| **B8** | blocking | `contexttrail init` doesn't write a per-repo `.mcp.json`, so users finish setup with no way to actually wire the engine to their agent | `contexttrail init` writes `.mcp.json` with the globally-linked `contexttrail` binary |
| **B3** | major | Atomic chunks up to 7344 tokens get kept whole — the agent flagged a budget-omitted chunk in a Phase 0 session | Chunker forced-split: blocks beyond N× max_tokens get split with a "split across N parts" warning, preserving the atomic-block intent where possible |
| **B4** | major | `contexttrail inbox list` dumps all 344 items unfiltered; no `--limit`, `--type`, `--status` flags, no count footer | Add `--limit`, `--type`, `--status` flags + count summary at top + per-line type breakdown |
| **B5** | major | Bootstrap on fastapi produced 342 candidates including ~50 translation-glossary entries and ~20 release-note bot entries | Two specific detectors: bot-emoji titles → skip; translation-glossary pattern → skip |

## What's NOT in scope (deferred to later PRDs)

| id | severity | why deferred |
|---|---|---|
| **B2** | major | The corpus_coverage denominator fix needs language / canonical-docs detection. It's mid-complexity and the B1 decision-table fix handles the immediate pilot friction. B2 becomes a separate PRD if Phase 1 surfaces it as still-friction. |
| **B6** | minor | The `primary_contributors` negative probe returns `uncertain` instead of `signal_empty` on corpora with weak matches. Phase 0 Q4 showed that **agent-level honest signal_empty works** even when the probe-level metric is fuzzy — the product behavior is correct. Fixing the probe is calibration polish, not a pilot blocker. |
| **B7** | nice-to-have | Placeholder paste-bait. Tiny. Could be a one-line doc tweak; doesn't gate cohort 1. |

## Solution

Five slices. Independent surfaces, so 4 of 5 can run in parallel.

### Slice 36.1 — Setup-engine fixes (B1 + B8)

Two changes to the setup surface that together close the "cold-start user gets stuck after setup" loop:

**(a) Next-step decision table (B1).** `src/setup/next-step.ts` currently ranks corpus_coverage above card_coverage. Add a new branch: if `card_coverage: low` AND `imported_chunks ≥ 50` AND `scope_coverage: confident OR partial`, recommend `contexttrail card bootstrap` regardless of corpus_coverage label. The threshold (50 chunks) is the empirical "you have enough useful corpus to start authoring" floor — far below the fastapi import (2120 chunks) and reasonable for a small private repo. Document the threshold inline.

**(b) `contexttrail init` writes `.mcp.json` (B8).** `src/config/init.ts` currently creates `.contexttrail/`, `config.yaml`, and the SQLite cache. Add a 4th file write: `.mcp.json` at the repo root, with content:

```json
{
  "mcpServers": {
    "contexttrail": {
      "command": "contexttrail",
      "args": ["mcp"]
    }
  }
}
```

The file is gitignored alongside `.contexttrail/` (or could be committed — pilot users can decide). If `.mcp.json` already exists, `contexttrail init` should NOT clobber it — write only if absent.

`contexttrail init`'s trailing message gains a line: `wrote .mcp.json (restart your agent to pick up the ContextTrail MCP server)`.

### Slice 36.2 — Chunker forced-split for oversized atomic blocks (B3)

`src/parse/chunker.ts` currently keeps atomic blocks (lists, code, tables) whole when they exceed `max_tokens`, emitting a warning. The Phase 0 fastapi import produced ~70 such warnings with one block at 7344 tokens — that single block consumes 45% of a 16k retrieval budget on its own.

Solution: introduce a **forced split** when an atomic block exceeds `2× max_tokens` (i.e. > 1800 tokens at the default 900 token max). The split preserves boundaries:
- Lists split at list-item boundaries between parts.
- Code blocks split on blank lines or comment-delimited section boundaries.
- Tables split between rows.

Each resulting part inherits the original block's metadata (heading_path, source_path) and gains a `split_part: { index, total }` field for traceability. The warning becomes "Atomic block split across N parts (M total tokens)" rather than "kept as single chunk."

Blocks between `max_tokens` and `2× max_tokens` continue to be kept whole with the existing warning (the cost is bounded and the atomic-block invariant matters there). Only the truly egregious ones (>1800 tokens) get split.

### Slice 36.3 — Inbox list flags + summary (B4)

`src/cli/inbox-cmds.ts` currently dumps the full inbox unfiltered when `contexttrail inbox list` is called. Phase 0 produced a 344-item dump.

Add three flags:
- `--limit N` (default 20). Shows the first N items in sorted order.
- `--type candidate_card|clarification_need` — filter by review type.
- `--status pending|accepted|rejected` — filter by status (probably already partially supported; verify and complete).

Add a header line above the list:
```
Inbox: 344 total — 204 candidate_card, 140 clarification_need
Pending: 344  Accepted: 0  Rejected: 0
Showing 1-20 (use --limit 100 to see more, --type to filter)
```

Add a footer line below the list:
```
Showing 1-20 of 344. More items exist; use --limit or --type to refine.
```

Sort order: deterministic by `(status: pending first, type: candidate before clarification, id ascending)`. Pilot users see candidate cards first because they're the higher-value review items.

### Slice 36.4 — Bootstrap noise filtering: bot-emoji + translation-glossary detectors (B5)

`src/bootstrap/proposals.ts` produces candidates by matching the regex tone patterns (`NORMATIVE_STRONG_PATTERN`, etc.) against sentences from canonical chunks. On fastapi this produced ~50 translation-glossary cards and ~20 release-note-bot cards.

Two narrow, high-precision detectors that **skip** rather than re-route — both fire BEFORE the regex tone match:

**(a) Bot-emoji prefix detector.** Skip any sentence whose first non-whitespace character is one of the bot-tag emojis used in release notes: 👷 📝 🐛 ✨ ♻️ ➖ 📌 🔥 ⬆️ ⚡ 🚀. These are GitHub release-note conventions; they're never genuine codebase rules. Detection is a single Unicode prefix check.

**(b) Translation-glossary pattern detector.** Skip any sentence matching the pattern `^[A-Z][^:]+:\s+[^()]+\s+\(do not translate` (allowing for unicode characters). This catches the fastapi `contributing.md` style guide entries (`"media type: media type (do not translate to ...)"`) without false-positive-hitting genuine docs. Detection is one regex match.

Both detectors get a tiny synthetic-property test verifying they don't false-positive on representative genuine candidates from ContextTrail's own corpus.

The detectors are documented inline as "Phase 0 fastapi findings." When future pilot data surfaces more noise patterns, this is the structural slot to add them. Do NOT generalize to a configurable filter system yet — the pattern is "ship the specific filter for the named noise; expand when more noise is named."

### Slice 36.5 — Phase 0 retro + OPEN.md + PILOT.md updates (HITL)

Wrap-up doc slice. Three actions:

**(a) Write `docs/pilot/phase-0-2026-05/retro-maintainer.md`** — answer the PILOT.md post-pilot retrospective questions (Q1–Q8). Q8 specifically: "in one sentence, what is ContextTrail for, from your perspective?" — the maintainer's own answer is the baseline that cohort 1 results are compared against.

**(b) Update OPEN.md to mark Phase 0 closed.** Add a section under "Pilot usage on real repos" recording: Phase 0 cleared 2026-05-11 on fastapi, evidence at `docs/pilot/phase-0-2026-05/`. PRD-0036 ships the exit fixes. Cohort 1 launches when PRD-0036 lands + the methodology caveat (private-repo requirement) is honored in user selection.

**(c) Confirm PILOT.md update (private-repo cohort 1 requirement) is current.** Already updated in the same commit as this PRD draft — the 2-of-3 private-repo requirement should not silently drift.

## Non-goals (explicit)

* **Rebuilding bootstrap from scratch.** Slice 36.4 is two narrow detectors, not a general filter framework. The bootstrap surface stays the regex + LLM-augment shape from PRD-0034.
* **Auto-fixing the corpus_coverage denominator (B2).** Deferred. The B1 decision-table fix routes around it for the pilot loop.
* **Tightening the negative probe (B6).** Phase 0 Q4 showed agent-level honest signal_empty works. Probe-level calibration polish is not a cohort 1 blocker.
* **Configurable filter system in bootstrap.** Two hardcoded detectors. If Phase 1 surfaces more patterns, the next PRD adds them — don't pre-build a system for hypothetical noise patterns.
* **Changing retrieval scoring or pack composition.** Out of scope.
* **A continuous file watcher.** Still deferred per OPEN.md.
* **Multi-language docs awareness in `corpus_coverage`.** B2 deferred.
* **Adding `.mcp.json` write to `contexttrail import` or other commands.** Only `contexttrail init` writes it. If the user manually deletes the file, that's their choice.

## Risks

* **Chunker forced-split may degrade retrieval quality on specific oversized chunks where the whole block was the right answer.** Mitigation: split only above `2× max_tokens` (the truly egregious blocks); preserve atomic-block invariant up to `2× max_tokens`; the agent still has the source_path metadata to reach the canonical file if needed. The Phase 0 session showed the agent already does this gracefully.
* **Bot-emoji detector may filter genuine cards.** False-positive risk is real if a doc author writes a constraint starting with 👷 or similar. Mitigation: high-precision pattern (start-of-sentence emoji from a specific list). A future ADR amendment can adjust the list if real-corpus data surfaces false positives.
* **`.mcp.json` write may conflict with users who maintain `.mcp.json` for other MCP servers.** Mitigation: write only if absent (do NOT clobber existing files). Document this behavior in `contexttrail init`'s help text.
* **Cohort 1 still hits B2 even though B1 routes around it.** Acceptable — B1's route-around handles the visible friction; B2's underlying issue surfaces only if a pilot user specifically asks "why is corpus_coverage stuck?" That's diagnosable then-not-blocking.

## Acceptance — PRD-level

PRD is complete when:

1. `src/setup/next-step.ts` decision table includes the new branch and a unit test asserts the named scenario (low corpus_coverage + low card_coverage + ≥50 imported chunks → bootstrap recommendation).
2. `src/config/init.ts` writes `.mcp.json` when absent; unit test verifies (a) the file is written on first init, (b) existing files are not clobbered, (c) `contexttrail init`'s output mentions the file write.
3. `src/parse/chunker.ts` forced-split fires above `2× max_tokens`; unit test verifies a 7344-token block splits across at least 4 parts with intact heading_path metadata, and a 1500-token block stays whole (warning, not split).
4. `src/cli/inbox-cmds.ts` accepts `--limit`, `--type`, `--status`; CLI integration test on a 344-item fixture inbox produces the expected header + footer + pagination behavior.
5. `src/bootstrap/proposals.ts` skips bot-emoji and translation-glossary patterns; synthetic-property tests on representative fastapi-style and ContextTrail-style chunks verify no false positives.
6. `docs/pilot/phase-0-2026-05/retro-maintainer.md` exists with answers to PILOT.md post-pilot retrospective questions.
7. OPEN.md "Pilot usage on real repos" item updated with the Phase 0 verdict.
8. Re-running `contexttrail card bootstrap` on the fastapi corpus produces materially fewer candidates than the Phase 0 baseline of 342 (target: ≤200, ideally ≤150 after both detectors fire).

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Will the 50-chunk threshold in B1 fix be tuned to fastapi? | Threshold is documented inline as "minimum useful corpus floor." Fastapi imported 2120 chunks (40× the threshold); a small repo with 60 chunks would also trigger the bootstrap recommendation. The threshold is structural, not corpus-fitted. |
| Will the bot-emoji list be expanded to filter legitimate cards over time? | The detector is a static list documented in source. Adding emojis requires a code commit + PR review — not a runtime configuration that drifts silently. |
| Could the translation-glossary regex false-positive on real rules? | The regex requires `(do not translate` as the literal trigger phrase. That's specific enough to be a high-precision detector. Real codebase constraints don't say "do not translate" — translation-style-guide entries do. |
| Will the chunker forced-split break the atomic-block invariant? | Only above 2× max_tokens. Below that, the invariant is preserved. The 2× threshold is the empirical "this block alone dominates the budget" line; preserving wholeness up to that is honest. |
| Won't fixing B1 mask the real B2 problem? | Yes, intentionally — for cohort 1. If Phase 1 cohort users hit a B2-shaped issue ("why does corpus_coverage stay stuck after I imported everything?"), that's the signal that warrants a separate PRD. Until then, B1's route-around removes the visible friction without committing to a heavyweight fix. |
