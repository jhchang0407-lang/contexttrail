# Phase 0 — Bug Capture (fastapi pilot)

> Started 2026-05-11. Repo: `~/Repos/Pilots/fastapi` (depth=1 clone of `fastapi/fastapi`).
>
> Capture every friction point even if minor. Write it down BEFORE fixing it — the capture is the signal; the fix is hygiene. Items marked **blocking** must be fixed before Phase 1 (Cohort 1) starts; non-blocking items get added to the cohort-1 known-issues list.

## Template

```markdown
### <short title>

**Severity:** blocking | major | minor | nice-to-have
**Command:** the exact command that triggered it
**Expected:** what should have happened
**Actual:** what did happen
**Impact:** why this matters for a pilot user (one sentence)
**Fix:** committed as `<commit-hash>` / open / deferred
```

## Bugs

### B1: Next-step recommendation ignores card_coverage when corpus_coverage stuck at "low"

**Severity:** blocking
**Command:** `contexttrail setup` (after `contexttrail import "docs/en/docs/**/*.md" "*.md"`)
**Expected:** After importing 156 files and reaching `scope_coverage: confident (2115/2120)`, the next-step should be `contexttrail card bootstrap` because cards are the missing dimension. The 1519-file denominator is inflated by translation duplicates that don't need to be imported.
**Actual:** Suggested `contexttrail import docs/**/*.md → Most discoverable markdown isn't imported yet.` This pushed the user toward a second `contexttrail import` that pulled in 1365 translated copies (12,976 more chunks of duplicate content in 7 non-English languages), bloating the corpus without adding useful signal.
**Impact:** Pilot user wastes time importing translations they don't need. The decision table in `src/setup/next-step.ts` ranks corpus_coverage above card_coverage when both are `low`, but functionally the corpus is already useful once English docs are in. This is the highest-leverage bug because it directly invalidates the maintainer-named property "setup readiness scan tells you the right next step."
**Fix:** open

### B2: `corpus_coverage` denominator broken on multi-language docs corpora

**Severity:** major (likely blocking for OSS pilot users)
**Command:** `contexttrail setup` on fastapi
**Expected:** corpus_coverage should reflect *useful* discoverable markdown, not raw file count. fastapi's docs are 154 English files plus 1365 translations. After importing the English set, coverage should be "confident" (100% of the useful subset), not "low" (10% of the inflated denominator).
**Actual:** discoverable_markdown = 1519, imported_markdown = 154 → coverage `low (10%)`. The dimension can't distinguish primary docs from translations.
**Impact:** Any repo with translated docs (fastapi, vue, react, etc.) gets a permanently-stuck `corpus_coverage` even after full meaningful import. Likely affects a large fraction of real OSS pilot users.
**Fix:** open — needs a language-aware divisor (default to canonical / primary-language docs) or a manifest-aware import that knows what's canonical vs translated.

### B3: Chunker emits 70+ oversized-chunk warnings, some up to 7344 tokens

**Severity:** major
**Command:** `contexttrail import "docs/en/docs/**/*.md"` then `contexttrail import docs/**/*.md`
**Expected:** Atomic blocks (lists, code, tables) should be summarized or split when they exceed `max_tokens` (900). At minimum, they shouldn't dominate the budget — a single 7344-token chunk eats 45% of a 16k retrieval budget on its own.
**Actual:** First import: 39 oversized-chunk warnings, biggest 7344 tokens. Second import (translations): 33 more warnings, several over 1700 tokens. All "kept as single chunk."
**Impact:** Retrieval on these chunks will either dominate the budget (if surfaced) or be invisible (if not). The PRD-0032 kind-balanced packing doesn't fix this — even with the kind reserve, a 7344-token chunk crowds out everything else in its kind's reserve. Some pages (config-options pages, big code listings) will be effectively unservable.
**Production-surface confirmation (Session 1 / Q2):** the agent's response on the middleware question ended with: *"the most directly relevant doc chunk was budget-omitted from the retrieval, so the canonical `call_next` example is best read from `docs/en/docs/tutorial/middleware.md` directly."* The agent NAMED the budget-omission and compensated by referencing the file directly. The product surface gracefully handles this, but the gap is real.
**Fix:** open — chunker may need a forced split policy for blocks beyond N× max_tokens, even if it breaks the atomic-block invariant.

### B4: `contexttrail inbox list` has no pagination, filter, or summary on large outputs

**Severity:** major
**Command:** `contexttrail inbox list`
**Expected:** A 344-item inbox should show first N, with `--limit`, `--type candidate_card|clarification_need`, `--status pending|accepted|rejected`, or a summary line at the end ("344 total: 204 candidate, 140 clarification — use --type to filter").
**Actual:** Dumped all 344 candidates to terminal with no count, no pagination, no filter flags. A pilot user with this output realistically cannot triage — they'd give up.
**Impact:** Direct usability gate. The product surface for review-and-accept is the inbox, and the inbox is unusable on a real-sized corpus. This is the second-highest-leverage bug after B1.
**Fix:** open — add `--limit`, `--type`, `--status` flags + a summary footer.

### B5: Bootstrap candidate noise is overwhelming on tutorial-tone corpora

**Severity:** major
**Command:** `contexttrail card bootstrap`
**Expected:** A signal-rich candidate set. ~50 high-quality candidates would be a lot but reviewable.
**Actual:** 202 constraint + 140 clarification = 342 candidates from 15096 chunks. Examples of low-value output:
  - Translation rules captured as repo-wide cards: `"media type: media type (do not translate to ...)"` × 9 different terms.
  - GitHub bot release notes: `"👷 Do not include benchmark tests in coverage"`, `"👷 Always run tests on push to master branch"`, `"📝 Update FastAPI People"`.
  - Tutorial prose mistaken for rules: `"You never call those functions directly"`, `"As you and your crush are busy not letting anything..."`.
  - Translation guidance treated as constraints: `"Do not translate technical terms like path, request, response..."`.
**Impact:** A pilot user reading the inbox top-to-bottom hits noise immediately. They will either (a) reject everything and never trust the bootstrap, or (b) accept noise and pollute their cards surface. Both poison the rest of the loop.
**Fix:** open — bootstrap needs at least: a release-notes / changelog detector, a translation-glossary detector, and a heading-context awareness so tutorial chunks score lower than rules-tone chunks.

### B6: `signal_empty` negative probe returns `uncertain` instead of `signal_empty` when corpus has weak match

**Severity:** minor
**Command:** `contexttrail setup --explain` → `primary_contributors` probe
**Expected:** "Primary contributors" was designed as a negative-test probe — most repos don't have contributor lists in docs, and `signal_empty` was the expected outcome that confirms the probe is calibrated. fastapi has a `FastAPI People` page; the probe should either (a) fire `signal_empty` because the match is weak, or (b) fire `confident` because there's a real answer.
**Actual:** Probe returned `uncertain`, with `[signal_empty]` annotation. Net effect: the negative probe is uninformative because uncertain isn't a clear pass or fail.
**Impact:** The probe set's value is reduced — the negative test doesn't actually validate that the engine returns honest signal_empty on real corpora.
**Fix:** open — either tighten the probe's signal_empty threshold or replace this probe with one more likely to actually return empty (e.g., a deliberately gibberish query).

### B8: No per-repo MCP config bootstrap — pilot user has to know how to wire the server themselves

**Severity:** blocking
**Command:** `claude` from inside `~/Repos/Pilots/fastapi/` after `contexttrail init` + `contexttrail import` + `contexttrail card bootstrap`
**Expected:** Claude Code (or any other agent harness) should automatically pick up the ContextTrail MCP server for the current repo, since `contexttrail init` knows where it is.
**Actual:** The existing `.mcp.json` is at `~/Repos/ContextTrail/.mcp.json` (project-scoped to ContextTrail itself) and uses `npm run drift -- mcp`, which only resolves inside the ContextTrail npm workspace. fastapi has no `.mcp.json`, so Claude Code in that directory has no ContextTrail MCP server. A pilot user finishes the setup loop and then has no way to actually USE the engine through their agent without writing the MCP config by hand.
**Impact:** Highest-leverage bug found in Phase 0 so far. Closes the loop — you can set up ContextTrail perfectly and still end up with "nothing wired to the agent." Cohort 1 cannot ship until this is fixed.
**Fix:** open. Two changes needed: (1) `contexttrail init` should write a per-repo `.mcp.json` with `command: "contexttrail", args: ["mcp"]` so cold-start pilot users get the wiring for free. (2) Document that Claude Code needs to be restarted in the project directory to pick up the new `.mcp.json`. Workaround for this Phase 0 session: hand-wrote `~/Repos/Pilots/fastapi/.mcp.json` with the global `contexttrail` binary.

### B7: CLI placeholder syntax (`<id-from-list>`) is paste-bait

**Severity:** nice-to-have
**Command:** `contexttrail inbox show <id-from-list>` (user pasted the literal placeholder from the docs)
**Expected:** Clear that `<id>` is a stand-in. Maybe show `contexttrail inbox show <id>` and add a hint after `contexttrail inbox list`: "Run `contexttrail inbox show cand-XXX` (use a real id from the list above)."
**Actual:** Shell ate the angle brackets as a redirect / bracketed paste, output garbled.
**Impact:** Tiny — easy to recover. But on cold-start, even small friction matters.
**Fix:** open — improve the hint text on `contexttrail inbox list` to include a real-id example.

---

## Phase 0 day 1 observations (not bugs, but signal)

- **`contexttrail init` worked first-try, output is clean.** No friction.
- **The `scope_coverage` dimension worked surprisingly well** (99.8% on fastapi without any frontmatter) — my prediction (#2 on the friction list) was wrong. Scope must be inferring from path or content effectively.
- **Import + bootstrap commands ran without errors on a 12k-chunk corpus** in reasonable time. The core engine is solid.
- **The MCP wiring step has not yet been attempted** — that's the next session's job.

## Severity rollup

| severity | count | summary |
|---|---:|---|
| **blocking** | 2 | B1 (next-step ignores card_coverage), B8 (no per-repo MCP config bootstrap) |
| **major** | 4 | B2 (corpus_coverage divisor broken on translations), B3 (giant chunks), B4 (inbox pagination), B5 (bootstrap noise) |
| **minor** | 1 | B6 (negative probe ambiguous) |
| **nice-to-have** | 1 | B7 (placeholder paste-bait) |

**Phase 0 cannot exit until B1 and B8 are fixed.** Together they bracket the end-to-end pilot loop:
- B1 sends the user off importing translations they don't need
- B8 leaves them with no way to actually USE the engine through their agent after setup completes

B4 and B5 together come close to blocking too — the inbox loop is unusable on a real corpus in its current state, and that's the load-bearing UX surface for "make pilot users accept cards."
