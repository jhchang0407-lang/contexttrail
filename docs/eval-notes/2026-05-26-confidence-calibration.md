# 2026-05-26 Confidence Calibration

## Change

Added a dedicated document-workflow confidence calibration eval:

```bash
npm run eval:document-workflow:confidence
```

This eval treats readiness as a safety classifier. It does not ask whether the
engine retrieved a high-quality pack in the normal case. It asks whether the
runtime signal reacts correctly when the pack is intentionally good, weak,
decoy-only, truly absent, or blocked by a missing source class.

## Gold States

The calibration matrix covers:

- `complete`: good required context should be `ready`
- `bad_retrieval`: missing evidence, wrong section, decoy-only, or empty
  retrieval should be `retry_required`
- `true_absent`: missing context after adequate search should be `ready`
- `weak_absence`: missing context without adequate search should be
  `retry_required`
- `source_unavailable`: a required source type absent from the corpus should be
  `blocked`

## Important Fix

The first red run caught a real issue: a required missing-context slot with no
searched-scope proof and no source-type coverage could still become `ready`
because zero searched-scope requirements counted as complete.

The readiness layer now requires absence-only missing-context slots to have
positive absence support:

```text
searched-scope proof complete OR expected source types fully searched
```

Otherwise the slot gets `retry_required` with
`missing_context_search_unverified`. Missing-check slots that already have
positive required evidence can still be `ready` without separate absence proof.

## Current Calibration Result

Current calibration covers `100` distinct scenarios:

- Complete ready cases: `20`
- Bad retrieval cases: `40`
- True absence cases: `15`
- Weak absence cases: `20`
- Source unavailable cases: `5`

Current result:

- Dangerous false-ready on unsafe retrieval: `0/65`
- False retry on ready packs: `0/35`
- Bad retrieval caught: `40/40`
- True absence accepted: `15/15`
- Weak absence caught: `20/20`
- Source unavailable blocked: `5/5`

This is still a mechanism-level calibration, not a statistical proof. It should
run alongside the robust panel so regressions in the confidence signal are
caught before agents can trust a bad pack.
