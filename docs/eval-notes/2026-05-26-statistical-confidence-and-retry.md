# 2026-05-26 Statistical Confidence And Retry Signals

## Question

Can the document-workflow eval give a stronger confidence claim, ideally a
99%-confidence read, and can the engine know when it should retry?

## Change

The robust document-workflow report now includes Wilson lower bounds at 99%
confidence for core metrics. This separates high observed accuracy from a
statistical certification claim.

The confidence table reports:

- observed pass count and rate
- Wilson lower bound at 99% confidence
- target lower bound, currently `99.0%`
- additional perfect passes needed to reach that lower bound if no new failures
  are observed

## Latest Robust Read

Current robust panel:

- workflows: `55`
- task variants: `155`
- fields: `447`
- slot evidence recall: `470/473`
- required slots satisfied: `176/181`
- evidence section recall: `473/473`
- searched-scope coverage: `86/88`
- field accuracy: `390/390`
- citation validity: `390/390`
- citation authority: `446/447`

Wilson 99% lower-bound read:

| Metric | Observed | Lower99 | Additional perfect passes to certify >=99% |
| --- | ---: | ---: | ---: |
| Slot evidence recall | `470/473` | `97.5%` | `708` |
| Required slots satisfied | `176/181` | `92.1%` | `1308` |
| Evidence section recall | `473/473` | `98.6%` | `184` |
| Searched-scope coverage | `86/88` | `89.2%` | `930` |
| Field accuracy | `390/390` | `98.3%` | `267` |
| Citation validity | `390/390` | `98.3%` | `267` |
| Citation authority | `446/447` | `98.1%` | `399` |

## Read

The observed result is strong, but it is not yet a `>=99%` statistical
certification at 99% confidence. The main blocker is not just question count;
some metrics have real misses, so the eval needs both more independent cases
and continued reduction of miss count.

More task variants alone do not create enough statistical confidence unless
they introduce independent evidence opportunities, searched-scope checks,
fields, citations, and miss modes. Duplicating paraphrases is useful for
wording pressure, but it should not be counted as new proof of evidence recall.

## Retry Signal Attempt

A deterministic pre-answer retrieval-confidence heuristic was tested, using
non-gold signals such as slot fit, field-label coverage, missing-context
signals, stale/decoy ratio, and context thinness.

It did not work well enough to keep:

- sane thresholds recommended retry for only `7/182` slots and caught `0/5`
  unsatisfied required slots
- thresholds high enough to catch all 5 misses would retry roughly `146/181`
  required slots

Read: the actual misses often look confident by retrieval heuristics. They are
wrong-section, retrieved-in-other-slot, or partial-evidence misses. That means a
pre-answer deterministic confidence score is not reliable enough for this broad
engine.

## Safer Retry Design

The safer retry path should be verifier-driven:

1. assemble context normally
2. agent attempts the workflow output
3. deterministic verifier checks whether every requested field has a valid
   citation, quote, authority status, or explicit missing-context explanation
4. if verification fails, retry retrieval using the failed field/slot and the
   verifier reason

This avoids asking the retrieval layer to guess uncertainty before the task has
been attempted. It also matches the observed miss shapes: the engine often has
nearby evidence, but the failure only becomes obvious when validating required
field/citation coverage.
