# Archived Code Engine

This folder contains the archived experimental code-context engine.

It is intentionally separated from the document/text context engine so the
core retrieval path can keep evolving toward document-heavy workflows without
being coupled to code-specific parsing, code-source metadata, package fanout,
or OSS code-lane evals.

## Boundary

- `facts/`: code-role, package, and co-change metadata.
- `parse/`: language-specific code-source extraction.
- `retrieve/`: code-lane candidate generation, evidence, fanout, and ranking.
- `store/`: code-source, code-chunk, and code-graph persistence helpers.
- `types/`: code-engine-specific persisted and wire-adjacent types.

The old `src/parse/code-source*`, `src/retrieve/code-*`,
`src/store/code-*`, and `src/types/code-source.ts` paths are thin
compatibility exports. The active product direction should not import new code
from this archive unless the code-context lane is intentionally revived.

## Product Posture

The code engine remains useful for dogfooding and developer workflows, but it
is no longer the main product wedge. The document/text engine should be allowed
to optimize for real operational workflows: policies, claims, forms,
procedures, contracts, audits, and other paperwork-heavy systems.
