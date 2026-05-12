# ContextTrail Pilot Plan

> Operational doc, not a PRD. Pilot is the next validation milestone after the engine + setup + sync arc (PRDs 0028 → 0035). It surfaces lived-ambiguity friction that the synthetic + OSS panels can't predict and tells us whether the product as built is actually useful in someone else's hands.
>
> Companion artifacts (created per cohort): `docs/pilot/cohort-N-YYYY-MM/` — pre-pilot answers, weekly check-ins, post-pilot retrospective, quantitative metrics.

## Why now

The engine has reached a state where retrieval + assembly quality is strong (PRDs 28/29/30/31/32), setup is legible (PRD-0033), bootstrap is honest (PRD-0034 regex + LLM augmentation), and sync hygiene catches stale state (PRD-0035). Every named correctness gate either passes or has its falsification verdict committed. The next risk to the project is not "can the engine retrieve the right thing" — it's "is this useful to a stranger." The pilot is the answer to that.

## Two-phase structure

The pilot runs in two distinct phases. Mixing them dilutes the signal from each:

- **Phase 0 — maintainer self-pilot.** The maintainer (Thomas) runs the *full* onboarding + 2 weeks of real use on a non-ContextTrail repo, alone, with full bug-fix privileges. The point is to catch first-run friction and core bugs *before* a stranger sees them. An external user wasting a week on "the install errored" or "contexttrail setup output is confusing on my corpus" is signal we already had access to.
- **Phase 1 — Cohort 1 external pilot.** Three external users (engineer friend + small-OSS maintainer + a third — the third slot is intentionally flexible to fill from Phase 0 learnings). The maintainer is no longer in the user pool here — their feedback is too aligned to count as cohort signal.

Phase 0 clearing is a hard prerequisite for Phase 1.

## Phase 0: Maintainer self-pilot

Solo, 1-2 weeks, on a non-ContextTrail repo. The maintainer is allowed (encouraged) to fix bugs they hit; the point is to find them, not to suffer through them like a pilot user would. Each bug found goes in `docs/pilot/phase-0-YYYY-MM/bugs.md` with reproduction steps; each gets fixed before Phase 1 starts.

### Pick the Phase 0 repo

Must be:
- A repo the maintainer actively edits — not a dead project, not a glance-and-leave repo.
- Has *some* markdown documentation but not perfect documentation. (A repo with zero docs lets ContextTrail be vacuously useful; a repo with perfect docs leaves nothing for it to add.)
- Different language from ContextTrail ideally, or at least different domain. The goal is to surface assumptions the ContextTrail codebase quietly satisfies that other codebases don't.
- Personal / non-secret. The maintainer should be willing to share `contexttrail setup --explain` output in a doc.

Candidates worth considering: a personal side project, a recent contracting codebase the maintainer can re-clone, a forked OSS repo the maintainer has working knowledge of.

### Phase 0 protocol

1. Clone the repo fresh. Treat the working directory as if the maintainer has never used ContextTrail on it before.
2. Walk the onboarding script (below) as if reading it for the first time. Resist the urge to `cd` over to ContextTrail and adjust commands on the fly. Take notes every time you feel the urge.
3. When something errors or confuses, **stop and capture**. Open `docs/pilot/phase-0-YYYY-MM/bugs.md` and write down: command run, what happened, what you expected, the rough impact. Then fix if you want — but the capture is mandatory before the fix.
4. Use ContextTrail for at least 5 real coding sessions in the Phase 0 repo over the 1-2 weeks. Use the same weekly-check-in form on yourself.
5. Aim to reach the "useful moment" threshold from the cohort 1 check-in (≥5 specific useful moments named over the 2 weeks).

### Phase 0 exit criteria (all must hold before Phase 1)

- `contexttrail init` → `contexttrail setup` → `contexttrail import` → `contexttrail card bootstrap` → `contexttrail inbox accept` → MCP `retrieve_context_pack` runs end-to-end on the Phase 0 repo without manual workarounds. (Workarounds the maintainer applied during Phase 0 to fix bugs must have shipped as PRs.)
- The maintainer can name ≥5 specific useful moments from their Phase 0 sessions (same bar as the cohort 1 check-in).
- All Phase 0 bugs marked "blocking" in `bugs.md` are fixed and committed. (Non-blocking ones can be deferred — they get added to the cohort 1 known-issues list.)
- The maintainer answers the post-pilot retrospective for themselves and writes the result in `docs/pilot/phase-0-YYYY-MM/retro-maintainer.md`. Q8 ("in one sentence what is ContextTrail for") gives a coherent answer.
- Install instructions are written and tested on a clean machine (or in a fresh container — VM, fresh repo clone with `node_modules` deleted, equivalent). If install requires "ask Thomas for the right command," cohort 1 cannot start.

If exit criteria fail, extend Phase 0. Do not skip ahead.

## Cohort 1 entry criteria (must hold before kicking off external users)

- Phase 0 exit criteria all cleared.
- All PRD-0035 slices shipped (THO-257 / 258 / 259 closed).
- Production composer kind-balance (delegated agent work) shipped — so live retrieval benefits from the budget lever, not just eval.
- PRD-0016 floor cleanup (delegated agent work) shipped — CI is green.
- Latest release tag exists with a working install path. If install is `git clone + npm i + npm run build`, that is acceptable for a cohort of friends; not acceptable for cold strangers.

If any entry criterion fails, defer the cohort. Do not run a pilot that asks pilot users to debug install or core engine bugs.

## Cohort design

| field | choice | rationale |
|---|---|---|
| Size | **3 pilot users** for the first cohort | Enough variety for signal; small enough that maintainer can read every report personally. Bigger cohorts later if cohort 1 is informative. |
| Duration | **2 weeks** | Long enough for a real work session pattern; short enough that "I'll get back to you" doesn't drag forever. |
| Maintainer commitment | ~3 hours/week | One 30-min onboarding call per user (3×0.5) + reading weekly check-ins (0.5) + ad-hoc Slack support (1). Anything more means the product isn't ready. |
| Hand-holding policy | **Answer setup questions; do NOT silently fix bugs for them.** | A bug they hit is signal. Fixing it for them via a quick patch erases the signal. Capture the bug, mark it, ship a real fix after the cohort. |
| Compensation | None or small ($50 amazon card / coffee) | Friends-of-engineering, not paid testers. |

### Cohort 1 user profile

Three **external** users spanning (maintainer is in Phase 0, not Cohort 1). **Critically: at least 2 of the 3 must be on a private or personal repo the LLM has NO training-data exposure to** — this is the Phase 0 methodology caveat the maintainer surfaced after Session 1. Public OSS repos (especially well-known ones like fastapi) get LLM-backfilled retrieval gaps and produce optimistic-biased results.

1. **One engineer friend on a private / personal repo.** Different language ideally (Python or Go); different problem space (mobile, infra, data eng — anything not "TypeScript markdown context engine"). **The repo must NOT be in the LLM's training set** — internal company code, a recent side project that hasn't been indexed, etc. They will not give polite feedback if recruited correctly.
2. **One OSS maintainer of a small-to-mid repo (50-500 markdown files), repo MUST be small/obscure enough to not be in LLM training data.** Critically: their docs have to be in their head AND in markdown. If they wrote zero docs, the product can't help them; if their docs are perfect, the product won't help them either. Recently-created or low-star repos preferred — a fastapi-tier repo would re-introduce the Phase 0 backfill bias.
3. **One "skeptic" — an engineer who would normally not reach for an AI-context tool.** Someone whose default is grep + reading code. If they get value, the product is reaching outside the AI-enthusiast bubble. If they don't, that's a real boundary signal. Repo training-data status is less critical for this slot (the skeptic test is about UX trust, not retrieval ceiling).

### Why the private-repo requirement is load-bearing

Phase 0 ran on fastapi, which is one of the best-represented repos in any LLM training corpus. The maintainer's own session log surfaced that the agent used 21 tool calls over 3m 25s on one question, iterating through partial pack responses — meaning the LLM's prior knowledge of fastapi told it WHAT to search for at each step, and the pack supplied source-cites rather than discovery. On a repo with no training-data prior, the agent has to do all the heavy lifting from the pack alone. Cohort 1 results from another public OSS repo would just confirm the optimistic Phase 0 result without telling us whether the engine works in its harder operating regime.

### Avoid recruiting

- People who'd give empty positive feedback to be nice. (Filter: ask "what's the last tool you used that disappointed you and why?" — if they have nothing, skip.)
- People without an active work codebase. (Filter: "Are you actively writing code in some repo right now?")
- People who'd push back on the AI angle reflexively. (Filter: "Have you used AI coding agents before?" — looking for *some* exposure, not enthusiasm.)

## Pre-pilot screening (sent before the onboarding call)

Send as a Google Form / Notion form. ~7 minutes to complete.

```text
1. What's your primary work repo for the next 2 weeks?
   - Language(s): _____
   - Approximate size (lines or files or both): _____
   - Public or private: _____
   - Does it have markdown docs? Where? (e.g., docs/, README, wiki): _____

2. When you're coding in this repo, where do you currently get context?
   (Check all that apply)
   [ ] Read the code directly
   [ ] grep / IDE search
   [ ] Internal docs (markdown / wiki)
   [ ] Asking colleagues in chat
   [ ] AI coding agents (Cursor / Claude Code / Copilot Chat / etc.)
   [ ] Memory ("I just know")
   [ ] Other: _____

3. What are 3 questions you've asked yourself or a colleague about this
   repo in the last 2 weeks? (Be specific. Not "how does auth work"
   — give the actual question you asked.)
   _____
   _____
   _____

4. What's the LAST tool you tried for repo context (or coding more
   broadly) that disappointed you? What about it disappointed you?
   _____

5. How much time per day do you typically spend in this repo?
   - <30 min / 30 min - 2h / 2-4h / 4+h

6. Are you OK with the pilot writing some metadata to a local
   `.contexttrail/` directory in your repo? (Default: gitignored.
   You can delete it any time.)
   - Yes / No

7. Are you OK with the pilot optionally calling the Anthropic API
   on your behalf? (Only when you explicitly run
   `contexttrail card bootstrap --llm`. Costs ~$0.05-0.30 per run on a
   medium repo.)
   - Yes, use my key
   - Yes, use the pilot's key (capped)
   - No, regex-only bootstrap is fine
```

Discard question 3 answers from people who answer with abstractions ("how the system works"). Keep the ones who answer with specifics ("why does the rate limiter check the redis key BEFORE the request body for /v2/ but AFTER for /v1/"). Those people will give good feedback.

## Onboarding (30-min call per pilot user)

Walk them through:

1. **Install** — verify the latest tag works on their machine. If it doesn't, that's the cohort blocker; pause and ship a fix before continuing.
2. **`contexttrail init`** in their repo. Show them the trailing "Next: run `contexttrail setup`" line.
3. **`contexttrail setup`** — read the dimensional report together. This is the first user-facing moment of insight. If they don't see how to interpret it, that's a doc problem to fix (the inline hints may need more context).
4. **`contexttrail import "docs/**/*.md" "*.md"`** — first import. Watch what happens.
5. **`contexttrail setup` again** — dimensions should improve. If they don't, you have a real bug, not a usability issue.
6. **`contexttrail card bootstrap`** (regex first) — talk through the inbox model. Read 1-2 sample items together.
7. **`contexttrail card bootstrap --llm`** (if they opted in) — read the augmented items. Compare to regex output.
8. **`contexttrail inbox list / show / accept`** for at least one item. Make sure they understand the accept flow + provenance.
9. **MCP setup** — wire `contexttrail mcp` into their AI agent (Claude Code, Cursor, etc.). Verify `retrieve_context_pack` returns a real pack.
10. **Send them the weekly check-in form link** (below).

End the call with one specific homework: ask them to use ContextTrail for at least one real coding session in the next 24 hours and report back. Not "try it whenever" — first session within 24 hours, definitely.

## Tasks pilot users attempt

Give each pilot user this short list (in writing) and ask them to attempt the marked ones:

1. **`SETUP`** (required, day 1): Reach `contexttrail setup` reporting `confident` on at least `corpus_coverage` and `card_coverage`.
2. **`FIRST QUERY`** (required, day 1): Ask the agent a question whose answer should come from a doc you imported. Did the pack include the right doc?
3. **`REAL SESSION`** (required, by end of week 1): Use ContextTrail during a real ~30-60 min coding session. Track which queries you asked, which were answered well, which weren't.
4. **`CARD ACCEPTANCE`** (encouraged, by end of week 1): Accept at least 3 bootstrap candidates that you actually agree with. Reject any you don't.
5. **`EDGE CASE`** (encouraged, by end of week 2): Ask the agent something it shouldn't know (something not in any doc). Did it abstain honestly, hallucinate, or surface a partial answer?
6. **`SECOND CORPUS UPDATE`** (encouraged, week 2): After editing some docs or code, see what happens. Did the freshness warnings fire? Did you have to re-import?

## Mid-pilot weekly check-in (sent end of week 1)

~10 minutes. Send as a form or doc with shared edit access.

```text
This week with ContextTrail:

1. How many real coding sessions did you use it for? _____

2. List 3 specific moments where it gave you useful context.
   (One sentence each. "Surfaced the audit-log retry policy I'd
   forgotten was in the postmortem doc" — that kind of specific.)
   _____
   _____
   _____

3. List 3 specific moments where it FAILED you.
   (Specific. "Asked about webhook retries; pack had the readme
   but not the actual policy doc which lives under
   docs/decisions/.")
   _____
   _____
   _____

4. Did you fall back to grep / asking a colleague / Stack Overflow
   instead of ContextTrail for any query this week? Which ones?
   _____

5. Of the bootstrap candidates in your inbox, what fraction did
   you accept vs reject vs leave un-triaged?
   - Accepted: _____ items
   - Rejected: _____ items
   - Un-triaged: _____ items

6. What's the BIGGEST friction this week?
   (Be unkind. We can't fix what we don't hear.)
   _____

7. What's the MOST valuable moment this week, if any?
   _____

8. On a scale of 1-10, how likely are you to keep using
   ContextTrail if I stopped reminding you?
   _____ (and a sentence on why)
```

## Post-pilot retrospective (end of week 2)

30-min 1:1 call with each pilot user. Take notes in `docs/pilot/cohort-1-YYYY-MM/retro-<name>.md`. Ask:

1. **Looking back at your week-1 check-in, what changed in week 2?** Did the failures repeat? Did anything that worked stop working?

2. **If you had to pick one thing to fix before this is shippable to a stranger, what would it be?**

3. **Is there a question you tried to ask the agent that you'd consider load-bearing — i.e. if ContextTrail reliably answered it, you'd use the product on its own merit?** What's the question?

4. **The honesty / authority boundary** — ContextTrail keeps LLM-generated cards as provisional candidates that you accept or reject. Did you find that:
   - Useful (kept bad cards out)
   - Friction (extra acceptance ceremony for low-value cards)
   - Neither (didn't really notice)

5. **Setup readiness** — did `contexttrail setup`'s next-step recommendation actually match what you needed to do next, or did it feel mechanical / wrong?

6. **Stale data** — did the freshness warnings ever fire? Were they useful or noise?

7. **Would you recommend this to a colleague today, in its current state?** Why / why not.

8. **In one sentence: what is ContextTrail for, from your perspective?** (This is the hard one. If three pilot users give three completely different sentences, the product positioning is unclear. If they converge, you've got the message.)

## Quantitative metrics (tracked per cohort)

Maintainer fills in a row per user at end of week 2 in `docs/pilot/cohort-1-YYYY-MM/metrics.md`:

| metric | what it measures | how to capture |
|---|---|---|
| Setup completion | Did they reach `contexttrail setup` confident across all dimensions? | Check `contexttrail setup --json` output at end of pilot |
| Time-to-first-useful-pack (TTFUP) | Minutes from `contexttrail init` to first retrieve_context_pack the user calls "useful" | Self-reported on week-1 check-in |
| Sessions used | Count of real coding sessions ContextTrail was active in | Self-reported on weekly check-ins |
| Inbox accept rate | % of bootstrap candidates accepted vs total reviewed | Self-reported on week-1 check-in |
| Useful moments named | Count of specific items from check-in Q2 | Read off check-in answers |
| Failure moments named | Count of specific items from check-in Q3 | Read off check-in answers |
| Fall-back queries | Count of "I gave up and grep'd" instances | Self-reported on check-in Q4 |
| Recommendation score | Q8 from week-1 + Q7 from retro (combined) | Direct from forms |
| Net Promoter analog | "Would you recommend this to a colleague today?" yes/no/with-caveats | Direct from retro Q7 |

These metrics are not gate-able CI numbers. They are read for *direction*, not *certainty*. A score of 6/10 from one user and 3/10 from another tells you something completely different than (6, 5, 7).

## Decision matrix (what results trigger what next step)

After cohort 1, sit with the data for one day before deciding. Then:

| signal | next action |
|---|---|
| ≥2 of 3 users name >5 useful moments AND would recommend with caveats | Ship cohort 2 with one round of fixes. Pilot is working. |
| ≥2 of 3 users have <2 useful moments OR <3 sessions used | Pilot is not working. Read the specific failure moments — there will be a pattern. Author a follow-up PRD targeting that pattern before cohort 2. |
| Setup completion fails for any user (didn't reach `confident` across dimensions on their corpus) | This is a setup-engine gap. Either adaptive question selection (PRD-0007's deferred bit) or a fixture / corpus-shape issue. Author a follow-up PRD. |
| ≥1 user names a specific "load-bearing question" the product can't yet answer | Highest-leverage next PRD: build for that question shape. This is the kind of signal the synthetic + OSS panels couldn't predict. |
| Pilot users converge on the same 1-sentence "what ContextTrail is for" | The product positioning is real. Time to think about distribution polish. |
| Pilot users diverge wildly on "what ContextTrail is for" | Positioning is unclear. This is a strategy problem more than an engineering one. |
| LLM cost was prohibitive for any user | Cap the `--llm` per-run further OR make it explicitly opt-in-per-run instead of opt-in-per-config. |
| The freshness warnings were noise / annoying | Tune the threshold OR consider auto-reindex as the default after all. |

## What this pilot is NOT trying to do

- Validate that the engine retrieves accurately (already validated via PRD-0028 / PRD-0032 / PRD-0034).
- Discover all bugs (only the ones pilot users hit during normal use).
- Test the product's scaling properties (pilot is small N).
- Generate marketing testimonials.
- Replace the OSS panel or commit-grounded eval (those keep running).

This pilot is trying to do exactly one thing: **find out whether ContextTrail as currently built is useful to someone other than the maintainer.** If the answer is yes, scope grows. If no, the failure modes are the next PRD's brief.

## After cohort 1

If signals are positive: cohort 2 with N=5, including at least 2 people the maintainer doesn't know well. Possibly soft-launch on Hacker News or a small mailing list if Cohort 2 also clears its bar.

If signals are mixed: tighten the lever the cohort named (whichever PRD that becomes), then cohort 1.5 with the same 3 users to confirm the fix.

If signals are negative: do not run a second cohort immediately. Step back and ask whether the product framing itself is right. The retrospective Q8 ("what is ContextTrail for") is the load-bearing question here — if three users gave three different answers, that's the diagnosis.
