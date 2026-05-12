# Real-Corpus Eval Runbook

Anchored from [week-7 plan](../plan/week-7-baseline-and-experiments-2026-05.md) (Phase 1.2.5).

The real-corpus eval runs the retrieval engine against snapshotted external repos (Ralph, Prisma, ...) under `tests/fixtures/real-corpus/<repo>/`. It is **the primary truth check** for week-7 experiments and continues into pre-v1 ship readiness.

It is **complementary to** the synthetic 126-case eval (`npm run eval:retrieval`):

- Synthetic eval = hard regression gate. Already strong; known too forgiving to confer ship power.
- Real-corpus eval = primary truth check. Reveals synthetic-vs-real disagreement (Phase 2.2 finding).

## Quick start

```bash
# Run all real-corpus seeds, render to stdout
npm run eval:real-corpus

# Just one repo
npm run eval:real-corpus -- --repo ralph

# Freeze a baseline JSON
npm run eval:real-corpus -- --repo ralph --baseline-out docs/evals/baselines/real-corpus/ralph-YYYY-MM-DD.json

# JSON output (for scripting / diffing)
npm run eval:real-corpus -- --repo ralph --json
```

## Layout

```
tests/fixtures/real-corpus/
├── ralph.yaml                  # frozen seed (10 queries, 4/2/2/1/1 distribution)
├── ralph/                      # snapshotted doc corpus
│   ├── README.md
│   ├── CONTEXT.md
│   ├── CLAUDE.md
│   └── docs/
│       ├── adr/
│       ├── architecture/
│       ├── agents/
│       └── prd/
├── prisma.yaml                 # (pending Phase 1.1.6)
└── prisma/                     # (pending Phase 1.1.6)
```

The runner enumerates repos by matching `<repo>.yaml` + `<repo>/` directory pairs under `tests/fixtures/real-corpus/`.

## Adding a new real-corpus repo

1. **Snapshot** the docs into `tests/fixtures/real-corpus/<repo>/`. Preserve original tree (root files at root, `docs/` subtree as-is). Snapshots freeze at decision time so the eval doesn't bit-rot.
2. **Author the seed** `tests/fixtures/real-corpus/<repo>.yaml` using the schema in `src/eval/real-corpus-fixture.ts` (`RealCorpusEvalCase`). Card-bearing fields are intentionally absent — external repos have no ContextTrail Cards.
3. **Distribution**: default `3/2/2/2/1` (anchored impl / unanchored / signal_empty / cross-module / decision-rationale). Small corpora may flex (e.g., Ralph uses `4/2/2/1/1`).
4. **Run + freeze the baseline**: `npm run eval:real-corpus -- --repo <repo> --baseline-out docs/evals/baselines/real-corpus/<repo>-YYYY-MM-DD.json`.

## Seed authoring rules

- Each query is hand-curated. The author must be confident in the correct top doc.
- `expected_top_source` and `acceptable_top_sources` are matched by `contexttrail.includes(source)` — they are path substrings.
- For corpora where the author has medium confidence (e.g., Prisma), each query must still be confidently judgable on **clear regression detection** even if positive deltas are noisier (per Q9 — Prisma is veto-only).
- Drop a query if you can't confidently say "this top doc is wrong." A noisy seed makes the baseline meaningless.

## Wild-queries log

`CONTEXTTRAIL_WILD_LOG=1` enables append-only JSONL capture of every `retrieve_context_pack` call. Optional `CONTEXTTRAIL_SESSION_TAG=<tag>` buckets entries.

```bash
CONTEXTTRAIL_WILD_LOG=1 CONTEXTTRAIL_SESSION_TAG=ralph-tuesday-session your-mcp-harness ...
cat .contexttrail/wild-queries.jsonl | jq 'select(.session_tag == "ralph-tuesday-session")'
```

The log is gitignored. It is **directional evidence**, not a gate (per the week-7 plan decision rule): treat it as the truth check on whether the frozen seed is calibrated honestly.

## Decision rule recap (per week-7 plan Q9)

| Surface | Role in ship decision |
|---|---|
| Synthetic 126-case eval | Hard regression gate. Any regression on existing gates → automatic rollback. No positive ship power. |
| Ralph frozen seed | Primary ship vote. Must move targeted cells positively, no regression on regression-detector cells. |
| Prisma frozen seed | Veto-only. Clear regressions → closer look. Doesn't add ship power. |
| Wild queries | Directional sanity check. Non-contradictory required; can veto if clearly worse. |

See [the week-7 plan](../plan/week-7-baseline-and-experiments-2026-05.md) for the full bar-by-experiment-type rule.

## Known eval characteristics (as of 2026-05-08)

- Ranking and assembly behavior on the synthetic fixture is at `Top-1 acceptable: 80.2%` overall (anchored: 95.7%). The synthetic gate already passes.
- The Ralph baseline at `2026-05-08` shows much lower numbers (Top-1: 50%, query mode correct: 40%) — that is the synthetic-vs-real disagreement which Phase 2.2 is designed to investigate, not engine breakage.
- Anchored cases on a pre-implementation repo (no `src/`) will fall back to `signal_empty` mode even when retrieval is recoverable from task text. This is honest engine behavior; the seed expectations record the gap as a Phase 2.1 finding.
