# Week 7 — Baseline + Experiments

## Frame

Baseline-then-experiment. No calendar limit. Per-experiment exit criteria replace the calendar as the discipline.

The week-6 handoff named three candidate priorities (pilot usage, structural assembly expansion, signal_empty recovery) and the week-6 grilling deferred two more (`evidence` candidates, code/test-driven bootstrap). Week 7 unifies these by establishing a measurement substrate first, then running each candidate as an experiment scored against that substrate.

## Baseline approach (tiered)

| Surface | Role | Vote in ship decision |
|---|---|---|
| Synthetic 126-case eval | Hard regression gate. Already strong; known too forgiving to confer ship power. | Hard veto on regression. No positive ship power. |
| Real-corpus frozen seed (this week's deliverable) | Primary truth check. Hand-curated, frozen, reproducible. | See per-repo weighting below. |
| Wild-queries log | Directional sanity check. Captured organically during real sessions. | Non-contradictory required; no ship power; can veto if clearly worse. |

Not in scope this week: agent-task-success harness. Deferred.

## Real-corpus surfaces (2 repos, asymmetric trust)

| Repo | Corpus size | Confidence | Role | Ship vote |
|---|---|---|---|---|
| Ralph | small | highest (self-authored) | self-mirror test (closest to design north star) | primary |
| Prisma | large | medium | shape diversity (framework topology, ICP-fit) | veto-only |

Originally planned as 3 repos including **fundops** (product-hypothesis anchor per ADR-0003). Dropped during Phase 1 setup: fundops has effectively no markdown doc corpus (only 2 README files), so the engine has nothing to retrieve from. ADR-0003 amendment captures the deferral. Ops-shape coverage is now an OPEN.md item for later (when fundops grows organic docs, or when ContextTrail's bootstrap helps generate them).

ADR-0003 amendment: Ralph promoted from informal sanity-check to a frozen-seed surface. Fundops's frozen-seed slot deferred.

## Frozen seed shape

10 queries per repo. Distribution `3/2/2/2/1` (anchored impl / unanchored broad / signal_empty / cross-module / decision-rationale). Ralph allowed to flex to `4/2/2/1/1` due to small corpus.

Fixture location: `tests/fixtures/real-corpus/{ralph,prisma}.yaml` (seeds) and `tests/fixtures/real-corpus/{ralph,prisma}/docs/` (snapshotted doc corpora). Snapshots freeze the corpus at week-7 time so the eval doesn't bit-rot if external repos evolve.

Schema is a subset of `EvalCase` — Card-bearing fields (`expected_locked`, `expected_evidence_covers_locked`) are dropped because external repos have no Cards yet. The seed measures retrieval over docs only.

## Wild-queries logging

- Mechanism: env-var-gated. `CONTEXTTRAIL_WILD_LOG=1` enables. `CONTEXTTRAIL_SESSION_TAG=...` buckets entries.
- Storage: append-only JSONL at `.contexttrail/wild-queries.jsonl`. Gitignored.
- Off by default — test/eval runs do not pollute the log.
- Not a gate — directional evidence only.

## Phased experiment plan

| Phase | Contents | Routing |
|---|---|---|
| 1 — Setup | Seed authoring (1.1: ralph + prisma), corpus snapshots (1.1.5 ralph, 1.1.6 prisma clone+snapshot), real-corpus runner (1.2.5), wild-log mechanism (1.2), baseline freeze (1.3), per-experiment template (1.4), decision-rule (1.5) | Prerequisite for all later phases |
| 2 — Diagnostics | 2.1 `query_mode` honesty audit · 2.2 synthetic-vs-real disagreement audit · 2.3 ranking-vs-assembly split · 2.4 cross-mode consistency probe | Routes 3.1, 3.4, 5.x |
| 3 — Constructive | 3.1 `signal_empty` recovery shape *(conditional on 2.1)* · 3.2 `evidence` card candidates in bootstrap · 3.3 code/test-driven bootstrap source · 3.4 `query_mode` first-classing *(conditional on 2.1)* | — |
| 4 — Tuning sweep | Joint grid sweep across BM25/heading split, scope_boost, mention_boost, specificity, heading-path weight, accepted_card_bias | — |
| 5 — Assembly depth | 5.1 deeper structural widening · 5.2 payload ceiling per query mode · 5.3 linked-neighbor source policy *(conditional on 2.3)* | — |
| 6 — Hygiene | As-found: mention extraction precision/recall, distractor robustness, re-import dedupe, card-overlap pack assembly | Opportunistic |
| 7 — Synthesis | Per-experiment writeups consolidated · ADR-0018 calibration policy · OPEN.md update · ship/rollback/defer call per experiment | — |
| 8 — Broader OSS panel | Add a couple more OSS projects to the real-corpus panel — explicitly **mixing well-documented and sparsely-documented** repos so correctness is tested in both shapes (well-doc'd surfaces test ranking; sparse-doc surfaces test signal_empty honesty and recovery) · re-run shipped experiments + tuning against the broader surface · capture continued-benchmarking findings · feed back into calibration policy | End-of-week final eval |

## Decision rule (bar-by-experiment-type)

- **Diagnostic (Phase 2):** ship a *clear directional finding*. A "couldn't tell" outcome counts as a finding worth recording.
- **Constructive (Phase 3):** must move targeted cells positively on Ralph or fundops, no regression on the 3 anchored regression-detector cells, no synthetic regression, wild queries non-contradictory. Two attempts to converge before parking.
- **Tuning sweep (Phase 4):** best joint config wins on aggregate movement. Same hard gates.
- **Hygiene (Phase 6):** ships if it fixes a named bug. Same hard gates.

Ship vehicle: mainline, one commit per shipped experiment. Rollback = `git revert`. No feature flags.

## Per-experiment writeup template

Each experiment lands as a sub-section in this doc with the following fields:

- **Hypothesis** — one sentence.
- **Predicted deltas** — which surface, which cells, expected direction and rough magnitude.
- **Method** — what was actually changed and how it was tested.
- **Result** — observed deltas per surface.
- **Decision** — ship / rollback / park, with reasoning.
- **Exit criterion fired** — if parked, why.

## Items flagged for confirmation at phase entry

1. Phase 2.1 method — honesty audit primary (test whether mode labels are correct), behavior audit secondary. Re-confirm at Phase 2.1 entry.
2. Phase 3.2 verification — evidence candidates cite source chunk; human triage validates link (same pattern as week-6 constraint candidates). Re-confirm at Phase 3.2 entry.

## Source decisions

- Q1–Q11 grilling output (this conversation, 2026-05-08).
- ADR-0003 (layered dogfood strategy).
- Week-6 grilling outcomes captured in [next-session-handoff-2026-05-07.md](next-session-handoff-2026-05-07.md).
- OPEN.md §1, §2, §5.
- README.md §ICP, §Stack.

## Per-experiment sub-sections

*(populated as experiments run)*

### Phase 1.3 — Ralph baseline (frozen 2026-05-08)

**Run:** `npm run eval:real-corpus -- --repo ralph --baseline-out docs/evals/baselines/real-corpus/ralph-2026-05-08.json`

**Corpus:** 17 markdown files (root README/CONTEXT/CLAUDE + `docs/adr/`, `docs/architecture/`, `docs/agents/`, `docs/prd/`). Snapshotted from `/Users/thomaschang/repos/Ralph` at `tests/fixtures/real-corpus/ralph/`.

**Headline metrics (10 cases):**

| Metric | Value | Notes |
|---|---|---|
| Ranked useful (in top-3) | 7/10 (70%) | |
| Top-1 acceptable | 5/10 (50%) | |
| Query mode correct | 4/10 (40%) | All 4 file_anchored cases failed the mode check |
| signal_empty honest | 4/10 (40%) | Both signal_empty cases failed |
| Agent answer pass (must_include in ranked anywhere) | 10/10 (100%) | Engine surfaces the right doc *somewhere* in every case |

**By query intent:**

| Intent | Cases | Ranked useful | Top-1 acceptable | Mode correct |
|---|---|---|---|---|
| broad_domain | 2 | 50% | 50% | 100% |
| cross_module | 1 | 100% | 100% | 100% |
| decision_lookup | 1 | 100% | 100% | 100% |
| file_anchored | 4 | 100% | 50% | **0%** |
| signal_empty | 2 | 0% | 0% | **0%** |

**Per-case behavior (key observations):**

- All 4 `file_anchored` cases pointed at `src/...` paths. Ralph is a pre-implementation repo with no `src/`, so anchors did not resolve. Engine fell back to `signal_empty` mode, but task-text-driven retrieval still produced the right doc on 2 of 4. The "wrong mode" cases are recovery-shaped, not retrieval-shaped.
- Both `signal_empty` cases (`ralph-kubernetes-deployment`, `ralph-database-migration`) — corpus has no relevant content for either — engine returned `unanchored` mode + a top doc from `docs/prd/0001-ralph-v1.md`. The `anchors_unrecognized` warning did not fire. **This is the engine's most concrete honesty failure on the seed.**
- `cross_module` and `decision_lookup` cases hit the right top doc (`ADR-0005`, `ADR-0004`) cleanly. Decision-rationale retrieval is strong.
- `broad_domain` "run scope" landed on `ADR-0002` perfectly. "workflow signal failures" missed `ADR-0003` and landed on a PRD section.

**Synthetic-vs-real disagreement (Phase 2.2 first datapoint):**

Synthetic fixture (126 cases) anchored top-1 acceptable: **95.7%**.
Ralph file_anchored top-1 acceptable: **50%**.
Synthetic fixture signal_empty honesty: **100%** (per existing gates).
Ralph signal_empty honesty: **40%** (2 of 5 cases honest, all 2 dishonest were the explicit signal_empty cases).

The disagreement direction is "synthetic is too generous." This was predicted by the handoff (`compression and assembly-pressure benchmarks barely move on the current fixture`) and is now measured directly.

**Implications already routed into Phase 2/3:**

- **Phase 2.1 (`query_mode` honesty audit):** The label is dishonest in two distinct ways — (i) anchored cases get labeled `signal_empty` when anchors don't resolve to indexed docs, and (ii) genuinely empty-corpus queries get labeled `unanchored` rather than `signal_empty`. Both are surfaced, both deserve targeted investigation.
- **Phase 2.2 (synthetic-vs-real audit):** First confirmed datapoint that synthetic is too generous. ADR-0018 calibration policy will need to track this gap explicitly.
- **Phase 3.1 (`signal_empty` recovery shape):** Conditional on Phase 2.1; given the dishonest-signal_empty finding, this experiment is now strongly indicated rather than speculative.

**Caveat on the seed:**

The 4 file_anchored cases use `files: ["src/..."]` paths that don't resolve in Ralph's snapshotted corpus (Ralph is pre-implementation). This makes those cases dual-purpose: they test (a) "what does the engine do when anchors don't bind" and (b) "can task-text retrieval recover." Both are honest questions. The seed expectations were drafted as if anchors *should* resolve; the result is a known false-fail on `query_mode` for those 4 cases. Decision: keep the seed expectations as ideal behavior, score the gap as a finding, do not weaken the seed to make the baseline look better.

### Phase 1.3 — Prisma baseline (frozen 2026-05-08)

**Run:** `npm run eval:real-corpus -- --repo prisma --baseline-out docs/evals/baselines/real-corpus/prisma-2026-05-08.json`

**Corpus:** 64 markdown files (1.2M). Snapshotted from `github.com/prisma/docs` at 2026-05-08, subset:
- `docs/index.md` (intro)
- `docs/orm/index.md`
- `docs/orm/core-concepts/` (9 files)
- `docs/orm/prisma-schema/` (22 files)
- `docs/orm/prisma-migrate/` (18 files)
- `docs/orm/reference/` (13 files)

`.mdx` was renamed to `.md` (ContextTrail v1 imports markdown only; embedded JSX becomes inert text).

**Headline metrics (10 cases):**

| Metric | Value | Ralph for comparison |
|---|---|---|
| Ranked useful (in top-3) | 6/10 (60%) | 70% |
| Top-1 acceptable | 3/10 (30%) | 50% |
| Query mode correct | 7/10 (70%) | 40% |
| signal_empty honest | 7/10 (70%) | 40% |
| Agent answer pass | 10/10 (100%) | 100% |

**By query intent:**

| Intent | Cases | Ranked useful | Top-1 acceptable | Mode correct |
|---|---|---|---|---|
| broad_domain | 2 | 100% | 50% | 100% |
| cross_module | 2 | 50% | 50% | 100% |
| decision_lookup | 1 | **0%** | **0%** | 100% |
| file_anchored | 3 | 100% | 33% | 67% |
| signal_empty | 2 | **0%** | **0%** | **0%** |

**Per-case key observations:**

- **`prisma-decision-why-shadow-database` failed (T1✗ RU✗).** The engine returned `prisma-cli-reference.md` (a CLI reference page) for "why does prisma migrate need a shadow database." This is the engine being distracted by literal "shadow database" string mentions in the CLI reference rather than the conceptual `shadow-database.md` doc that explicitly addresses the why-question. **Worth flagging — this is the same `decision_lookup` intent that scored 100% on Ralph.** The difference: Ralph's corpus is small enough that the conceptual ADR is the only real match. Prisma's corpus has multiple "shadow database" mentions across reference docs that compete with the concept doc. → Phase 4 tuning candidate (heading-path weight, decision-rationale boost, or specificity).
- **Both `signal_empty` cases failed.** Same dishonesty mode as Ralph: engine returns `unanchored` + a top doc rather than admitting the corpus has no answer. Top-1 was `prisma-config-reference.md` and `prisma-client-reference.md` for blockchain and graph-database queries — clearly off-topic. **Phase 3.1 strongly indicated.**
- **`prisma-cross-module-migrate-vs-schema` failed.** Engine returned a `prisma-client-reference.md` filter-conditions section instead of `mental-model.md`. Cross-module pack assembly is weak when the same key terms appear in unrelated reference sections.
- **3 file_anchored cases worked when anchors used realistic paths** (`prisma/schema.prisma`, `prisma/migrations/...`). Query mode correct on 2 of 3 (vs 0 of 4 on Ralph). Anchors that *look* file-shaped get treated more gracefully even when they don't resolve to the snapshotted corpus.
- **`prisma-anchored-many-to-many` ranked useful (the right doc was in top-3) but top-1 was a MongoDB-specific page.** Suggests scope/database-specificity ranking penalizes the canonical `many-to-many-relations.md` against a MongoDB-specific variant.

**Cross-repo comparison (first Phase 2.2 datapoints):**

| Axis | Ralph | Prisma | Synthetic (126) |
|---|---|---|---|
| Anchored top-1 acceptable | 50% | 33% | 95.7% |
| signal_empty honesty | 40% | 70% | (effectively 100% on contract gates) |
| Query mode correct overall | 40% | 70% | passing |
| Decision-rationale top-1 | 100% | 0% | gate-passing |

**Disagreement directions:**
- **Synthetic >> Ralph + Prisma on top-1 across the board.** Confirms the "synthetic too forgiving" hypothesis from the handoff.
- **Prisma's signal_empty honesty (70%) >> Ralph's (40%).** Plausibly because Prisma signal_empty queries ("blockchain", "graph database") use words that have *no* match in the corpus, while Ralph's "kubernetes" and "database migration" partially match (Ralph docs contain "database" and "deployment" type words in unrelated contexts).
- **Ralph's decision_lookup (100%) >> Prisma's (0%).** Inverse of corpus size effect — small corpus = canonical doc is the only candidate; large corpus = noise from string-similar reference pages dominates.

**Implications routed into Phase 2/3/4:**

- Phase 2.1 (`query_mode` honesty audit) is now richly seeded. Two distinct dishonesty patterns confirmed across both repos: (i) anchored→signal_empty when paths don't resolve; (ii) genuinely-empty→unanchored with arbitrary top doc.
- Phase 2.2 (calibration audit): synthetic-vs-real disagreement confirmed at 65+ percentage points on top-1 acceptable. ADR-0018 must lock this gap explicitly.
- Phase 3.1 (`signal_empty` recovery shape): conditional gate is now overwhelmingly satisfied — both repos agree the engine is dishonest on empty-corpus queries. Recovery design (abstention, anchor guidance, canonical-entrypoint) is justified.
- Phase 4 (tuning sweep): the Ralph-vs-Prisma `decision_lookup` divergence (100% vs 0%) suggests heading-path weight or decision-rationale-specific boost is a high-leverage tunable. Cross-module distractor resistance is also weak on Prisma — `min_final_score` or specificity scoring is a candidate.

### Phase 1 sidebar — Cross-week retrieval invariance check (2026-05-08)

**Question:** Is the synthetic-vs-real gap a regression introduced by week-6 changes, or has the retrieval pipeline always behaved this way on real corpora?

**Method:** Replay the real-corpus eval against three commits via git worktree:
- `d5502d9` (week-4 endpoint, pre-context-assembly)
- `bf2e2fa` (week-5 endpoint, context-assembly added)
- current week-7 HEAD

Copied the runner (`src/eval/real-corpus-fixture.ts`, `real-corpus-eval.ts`) and the snapshotted seeds (`tests/fixtures/real-corpus/`) into each worktree, built, and ran. Patched the runner to remove `ASSEMBLY_STAGES`/`AssemblyStage` imports for the week-4 build (those were added in week 5).

**Result:**

| Repo | Week 4 (d5502d9) | Week 5 (bf2e2fa) | Week 7 (HEAD) |
|---|---|---|---|
| Ralph (10 cases) | 50% / 40% / 40% | 50% / 40% / 40% | 50% / 40% / 40% |
| Prisma (10 cases) | 30% / 70% / 70% | 30% / 70% / 70% | 30% / 70% / 70% |

Numbers are top-1 acceptable / query mode correct / signal_empty honest. **Per-case top-1 docs were identical across all three commits** — not just the aggregate metrics, the specific document chosen for every case.

**Conclusion:** The retrieval pipeline's behavior on real corpora has been invariant from week 4 through week 7. Week 5's structural assembly addition (parent/sibling/linked_neighbor expansion) did not change top-1 / query-mode / signal_empty behavior on these queries — which is consistent with assembly being an *expansion* of surrounding context, not a change to ranking. Week-6 changes were entirely bootstrap/inbox/review (post-retrieval) plus presentation refactors; they did not touch scoring or ranking logic.

**Implication:** The synthetic-vs-real disagreement is not a regression. The engine has consistently scored 95.7% on the synthetic 126-case fixture while scoring 50%/30% top-1 on real corpora — the gap predates week 6 and predates week 5's assembly work. Setup discipline gaps in earlier weeks (e.g., fundops docs never authored, INCIDENTS.md not fully populated) hid the gap; they didn't cause it.

**Conclusion-of-the-conclusion:** Phase 2.2's calibration ADR (planned as ADR-0018) should explicitly document the gap as a *measurement defect of the synthetic fixture*, not as a regression. The synthetic eval needs adversarial expansion (Phase 6.2 distractor / conflicting-chunk robustness is well-aligned), or the gates need to track real-corpus performance with a small headroom rather than the synthetic floor.
