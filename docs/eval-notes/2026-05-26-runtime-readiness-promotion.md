# 2026-05-26 Runtime Readiness Promotion

## Change

Promoted the certified document-workflow readiness logic from the eval package
into the runtime readiness package:

```text
src/readiness/workflow-readiness.ts
```

The old eval import path now re-exports the runtime module so the eval harness
and runtime engine cannot drift.

## Runtime Surface

`retrieve_context_pack` now returns a first-class `task_readiness` block:

- pack readiness: `ready | partial | retry_required | blocked`
- pack recovery action: `answer | answer_with_caveat | retry_slot | ask_user | abstain`
- per-slot retrieval confidence
- per-slot adequate search status
- per-slot readiness and retry queries
- blocking, partial, retry, and missing-context slot lists

The existing `recovery_plan` is aligned to `task_readiness`, so agents do not
get split signals such as "answer with caveat" from the old plan while the new
task layer says "retry required".

## Runtime Bridge Caveat

The live retrieval engine does not yet create full workflow-specific context
slots. For now, runtime emits one task-critical slot:

```text
context_pack
```

That slot is backed by the existing runtime pack-readiness signals:

- coverage confidence
- selected/ranked context availability
- satisfied and missing task needs
- warnings
- generated follow-up searches

This is enough to expose the safety mechanism to agents immediately. The next
deepening step is to have runtime planning produce true task slots, then feed
those slot-level evidence and source-type search signals directly into the same
readiness module.

## Verification

The promotion keeps the calibrated eval mechanism intact and adds runtime MCP
coverage for ready, retry-required, and blocked packs. Partial support is now
reported as `retrieval_confidence: "uncertain"` rather than `"weak"`, so agents
can distinguish "some plausible support but incomplete" from "bad/empty
retrieval".
