# PRD-0031 / slice 31.3 — Verification + Terminal-State Decision

Source-of-truth verification artifact for [PRD-0031](../prd/0031-reverse-import-traversal-structural-hypothesis.md).

## Terminal state

**Terminal state A — audit-only falsified. No production code lands.**

Decided at slice 31.1. The bounded reverse-expansion lever in slice 31.2 was not implemented (closed as "not applicable") and the flag-on / flag-off case-level verification table this slice was originally framed to publish is unnecessary.

## Why terminal A

The slice-31.1 audit (`docs/evals/prd-0031-miss-shape-audit.md`) classifies all five residual misses as **commit-diff targets that no longer exist in today's corpus**:

| ticket | target | shape |
| --- | --- | --- |
| THO-225 | `src/retrieve/structural-chunk-context-flag.ts` | rolled back in commit `1ca58c5` |
| THO-224 | `src/cli/reindex.ts` | rolled back in commit `1ca58c5` |
| THO-224 | `src/store/reindex.ts` | rolled back in commit `1ca58c5` |
| THO-223 | `src/parse/chunk-structural-context.ts` | rolled back in commit `1ca58c5` |
| THO-185-stub | `docs/prd/0019-task-facet-harness-and-deterministic-evidence-policy.md` | rolled-back doc |

The audit's load-bearing predicate `target_imports_surfaced_seed` is `n/a` for every row — there is no live target to compute outgoing imports against. The corollary: no retrieval lever, forward or reverse, bounded or unbounded, can lift a target that is not indexed.

The PRD-0028 slice-28.4 verdict note's earlier phrasing — that `structural-chunk-context-flag.ts` "has no incoming or outgoing import edges" — was a downstream symptom: a file not present in the corpus naturally has no edges in the import graph derived from the corpus.

## Verification table (placeholder — N/A under terminal A)

| case | shape from 31.1 | before (flag off) | after (flag on) |
| --- | --- | --- | --- |
| THO-225 (workflow) | rolled-back file | miss | N/A — flag never built |
| THO-224 → reindex.ts (x2) | rolled-back files | miss | N/A — flag never built |
| THO-223 → chunk-structural-context.ts | rolled-back file | miss | N/A — flag never built |
| workflow-assembly aggregate | — | 22/23 | N/A |
| agent-completion per-file aggregate | — | 62/66 | N/A |
| OSS top-5 (174-case) | — | 96.0% | N/A |

Under terminal A the slice-31.3 verification matrix is intentionally vacuous. Reproducing the before-side numbers is sufficient evidence that the residual ceiling is structurally bounded, not a hardening opportunity.

## Implications recorded in PRD-0028 + OPEN.md

- `docs/prd/0028-code-source-index-for-agent-completion.md` § slice-28.4 verdict note is amended to point at this audit. The "no incoming or outgoing import edges in the current codebase" framing is updated to "the file is not in today's corpus."
- [OPEN.md](../OPEN.md) item 5 records that the residual workflow/agent-completion ceiling is fixture / commit-history misalignment, not an engine deficit. PRD-0031 closes this thread.

## What this leaves open

PRD-0031 is closed. The follow-on questions named in the PRD's non-goals stay deferred:

- **Query rewriting** as a separate PRD. Not motivated by these specific misses (they are unrecoverable) but remains a valid lever for *future* misses where the target is in-corpus but lexically distant from the user query.
- **Fixture maintenance.** A future, very small slice could prune commit-diff-vs-current-corpus mismatches from the agent-completion / workflow fixtures so the gates measure live retrieval rather than historical noise. Out of scope for PRD-0031; tracked as a follow-up posture choice rather than a defect.
