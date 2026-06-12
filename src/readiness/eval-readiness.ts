/**
 * Pack-readiness state vocabulary.
 *
 *   - `ready`         pack is sufficient for the task as-shipped
 *   - `partial`       source is plausible but the chunk set is weak or
 *                     a required source is missing
 *   - `needs_anchors` engine could not anchor the task; better anchors
 *                     would likely recover
 *   - `unsupported`   no useful evidence found; honest abstention
 *
 * The actual readiness decision lives in the orchestrator
 * (`orchestratePackReadiness` in `./orchestrator.ts`), which composes
 * the task-need extractor, source-scoped chunk selector, and pack
 * readiness verifier. This file only owns the shared state vocabulary.
 */

export const PACK_READINESS_STATES = [
  "ready",
  "partial",
  "needs_anchors",
  "unsupported",
] as const;

export type PackReadinessState = typeof PACK_READINESS_STATES[number];
