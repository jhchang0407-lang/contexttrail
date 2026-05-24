# Code Engine Source Archive

This folder quarantines the code-context engine from the previous product
direction.

The source is kept here so the current build and compatibility exports can
still resolve existing imports while the active product focus moves to document
workflow retrieval and evidence-backed extraction.

New work should prefer the document workflow path:

- `src/eval/document-workflow-probe.ts`
- `tests/fixtures/document-workflows/`
- active docs under `docs/`

Only modify this archive when fixing build fallout or intentionally reviving
the code-context lane.
