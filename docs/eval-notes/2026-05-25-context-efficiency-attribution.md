# 2026-05-25 Context Efficiency Attribution

## Reason

Token budget alone is a weak proxy for product quality. In real office work,
a larger context pack can be correct if the extra tokens are required evidence,
searched-scope proof, or useful supporting context. The real failure is waste:
stale context, decoys, generated noise, or over-budget spillover that does not
help the task.

## Method

Add per-slot token attribution to the document-workflow eval:

- retrieved tokens
- required-evidence tokens
- searched-scope proof tokens
- supporting / unclassified tokens
- excluded or stale tokens
- generated noise tokens
- over-budget excess tokens

The attribution is written into trace packs and aggregated in the rendered eval
report under `Context efficiency`.

## Read

This is observability, not an engine behavior change. It lets us separate two
very different situations:

- the pack is large because the task genuinely needs a lot of evidence
- the pack is large because retrieval or assembly is inefficient

Future tuning should optimize the second case without starving the first.
