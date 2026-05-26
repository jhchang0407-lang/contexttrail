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

Current calibration covers `3,500` distinct scenarios, sized so every primary
confidence bucket has at least `700` perfect cases. With Wilson lower bounds at
99% confidence, that is enough for the per-bucket lower bound to clear `99.0%`.

- Complete ready cases: `700`
- Bad retrieval cases: `700`
- True absence cases: `700`
- Weak absence cases: `700`
- Source unavailable cases: `700`

Current result:

- Dangerous false-ready on unsafe retrieval: `0/2100`
- False retry on ready packs: `0/1400`
- Bad retrieval caught: `700/700`, lower99 `99.1%`
- True absence accepted: `700/700`, lower99 `99.1%`
- Weak absence caught: `700/700`, lower99 `99.1%`
- Source unavailable blocked: `700/700`, lower99 `99.1%`

The aggregate unsafe-not-ready gate is `2100/2100`, lower99 `99.7%`.

This is now a statistical mechanism calibration over generated adversarial
slot states. It should still run alongside the robust retrieval panel, because
the robust panel tests whether the engine creates the right context in the
first place, while this calibration tests whether the readiness signal reacts
correctly once slot evidence/search signals are present.
