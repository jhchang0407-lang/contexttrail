/**
 * PRD-0028 / slice 28.3 + 28.4 — RETRIEVAL_CODE_SOURCE_INDEX feature flag.
 *
 * Gates whether the code-source FTS index is mixed into the retrieval
 * ranked output. Default flipped to ON after the slice-28.4 import-graph
 * traversal addition cleared all three promotion gates on the
 * 2026-05-11 measurement:
 *
 *   1. agent-completion source-file coverage:  93.8% (15/16)   vs ≥75% bar ✅
 *   2. real-workflow assembly:                 95.7% (22/23)   no regression ✅
 *   3. 174-case real-corpus top-1/top-3/top-5: 82.8/94.3/96.0  identical to baseline ✅
 *
 * The slice-28.3 verdict (62.5% without import traversal) and the
 * slice-28.4 lift (62.5% → 93.8% via import-graph traversal) are documented
 * in `.out-of-scope/prd-0028-slice-28-3-verdict.md`.
 *
 * Mirrors the `RETRIEVAL_HEADING_ALIASES` flag pattern.
 */
export const CODE_SOURCE_INDEX_DEFAULT_ON = true;

export function codeSourceIndexEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_CODE_SOURCE_INDEX;
  if (raw === undefined) return CODE_SOURCE_INDEX_DEFAULT_ON;
  const lower = raw.toLowerCase();
  if (lower === "on" || lower === "1" || lower === "true") return true;
  if (lower === "off" || lower === "0" || lower === "false") return false;
  return CODE_SOURCE_INDEX_DEFAULT_ON;
}
