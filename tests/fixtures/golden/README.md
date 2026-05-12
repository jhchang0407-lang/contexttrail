# Golden corpus (PRD-0002 / Checkpoint 3c)

Hand-curated `(task, files, symbols, budget) → expected Pack` cases.
Each case targets one load-bearing branch in the retrieval pipeline.

The runner is at `src/cli/golden.test.ts`. It:

1. Builds a shared fixture corpus (chunks + cards) into a temp `.contexttrail/`
2. Runs every case through `runContext`
3. Asserts the locked Card set, included items, omitted reasons, and pack warnings
4. Snapshots the explain output for visual diffing

Failure surfaces per-chunk score deltas (BM25, heading_match, scope_match,
mention_overlap, specificity, final_score, included/omitted reason) so a
regression is debuggable from the test output alone.
