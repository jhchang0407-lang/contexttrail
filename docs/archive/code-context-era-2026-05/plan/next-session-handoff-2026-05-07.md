# Next Session Handoff — 2026-05-07

## Where we stopped

The repo is in a strong, clean state.

Latest commits:

- `ac078f4` — refresh docs and deepen assembly eval coverage
- `a7a9a04` — add compression and assembly pressure benchmarks
- `8743b0d` — improve unanchored first-read ranking and rebaseline
- `a8b8ee3` — improve anchored first-read ranking heuristics

Working tree status at handoff:

- clean

## What is now true

### Retrieval / ranking

The current retrieval system is strong on the main query shapes we care about:

- anchored coding queries
- cross-module queries
- broad unanchored coding / repo-memory queries
- decision / rationale lookups

Current live fixture metrics (`126` cases):

- overall `Ranked useful`: `91.3%`
- overall `Top-1 acceptable`: `80.2%`
- anchored `Top-1 acceptable`: `95.7%`
- unanchored `Top-1 acceptable`: `94.3%`
- all retrieval gates passing

Remaining weak area:

- `signal_empty` / low-signal recovery

Important interpretation:

- this is not a normal ranking problem anymore
- warning honesty and recovery behavior matter more there than forcing a better top doc

### Compression

We added:

- `npm run eval:compression`
- `npm run eval:assembly-pressure`

Compression result:

- the current fixture is almost untouched by raw budget compression
- even a `500`-token default budget barely moved quality

Assembly-pressure result:

- synthetic surrounding-context expansion also held up unexpectedly well
- neighbor-heavy cases stayed strong under the strongest tested pressure

Current read:

- the system is already compact and stable
- the current fixture is still not exposing a real assembly bend point

## What changed in the eval

The fixture grew from `122` to `126` cases.

Added assembly-heavy cases:

- `anchored-payments-full-context`
- `anchored-billing-upgrade-full-context`
- `anchored-token-rotation-full-context`
- `anchored-webhook-recovery-full-context`

These were added to make the pressure benchmark care more about neighboring context, not just the winning ranked chunk.

We also made eval case counts dynamic, so future corpus growth should not require hand-updating hardcoded `122` references.

## Docs updated

These were refreshed and should now match reality much better:

- `README.md`
- `docs/CORE.md`
- `docs/OPEN.md`
- `docs/evals/post-prd-0005-quality-checklist.md`

## Useful commands

Core checks:

```bash
npm run eval:retrieval
npm run eval:compression
npm run eval:assembly-pressure
npm test
```

Baseline compare:

```bash
node dist/eval/retrieval-eval.js --compare-baseline docs/evals/baselines/retrieval-context-assembly-baseline-2026-05-07-unanchored-top1.json
```

## Recommended next priorities

### Option 1: Real pilot usage

Best next move if we want product truth instead of more synthetic eval work:

- run the system on real repos / real tickets
- log where actual engineers still feel missing context
- especially watch for:
  - low-signal queries
  - cases where neighboring context matters more than ranked chunk quality
  - places where cards are missing or too broad

### Option 2: More realistic assembly expansion

Best next move if we want deeper evaluation before pilots:

build a more structural assembly expansion model rather than just multiplying tokens.

Good candidates:

- include parent section context
- include sibling sections from the same doc
- include linked ADR neighbors
- include linked runbook / glossary neighbors selectively

Why:

- current synthetic pressure is probably too forgiving
- a structural expansion model is more likely to reveal the true pack-size / usefulness bend point

### Option 3: Low-signal recovery mode

Best next move if we want to improve the weakest remaining behavior:

- design `signal_empty` success as recovery, not ranking

Likely directions:

- explicit abstention / low-confidence handling
- better “add these anchors” guidance
- broad canonical entrypoint selection only when confidence is sufficient

## What not to do first

Avoid these as the immediate next step:

- more tiny ranking heuristics for anchored / cross-module
- more token shrinking work on the current packer
- another naive tree-first routing pass in the presentation seam

Why:

- anchored and cross-module are already strong
- raw compression already looks safe
- the tree-first presentation experiment already failed and was documented

## Short recommendation

If the next session wants the highest-value move, do this:

1. choose between pilot usage or deeper structural assembly eval
2. if unsure, prefer structural assembly expansion first
3. keep `signal_empty` as a separate recovery problem, not a normal ranking optimization pass

Follow-up clarification after week-5 grilling:

- the first structural assembly slice is intentionally narrow
- prove the basics on anchored implementation tasks first
- start from one grounded source chunk and evaluate parent context, selective siblings, and linked neighbors before taking on broader widening behavior

Week-6 grilling decisions captured after this handoff:

- bootstrap stays an explicit `contexttrail card bootstrap` step rather than folding into `contexttrail import`
- bootstrap is local-first: candidates live in a gitignored `.contexttrail/inbox/`, accepted cards move into `.contexttrail/cards/`
- hosted provider is the default first bootstrap runtime
- first bootstrap slice proposes `constraint` and `symbol_note` candidates from imported doc chunks only
- keep `evidence` candidates and code/test-driven bootstrap sources visible as likely next follow-ups for week-7 review rather than forcing them into the first bootstrap slice
- week 7 should explicitly dogfood and review retrieval `query_mode` behavior, especially whether `anchored`, `signal_empty`, and `unanchored` are honest enough to shape different agent behavior in practice
- if week-7 dogfood shows real separation value, query mode should become a first-class measurement and product-tuning seam rather than staying only a retrieval-contract detail
