/**
 * PRD-0033 / THO-251 — deterministic next-step decision table.
 *
 * Order matters: earlier rows take precedence. The table is intentionally
 * small (cap = 12 rows). Beyond that, the table should be re-shaped, not
 * extended ad-hoc — see PRD-0033 "Why structural, not data-fitting".
 *
 * No LLM. No adaptive prioritization. Pure mapping from band tuple to a
 * printed suggestion + the single command to run next.
 */
import type { ReadinessBand } from "./readiness-bands.js";

export const NEXT_STEP_TABLE_ROW_CAP = 12;

export type NextStepInput = {
  corpus_coverage: ReadinessBand;
  scope_coverage: ReadinessBand;
  card_coverage: ReadinessBand;
  retrieval_probes: ReadinessBand;
  /** True if the bootstrap inbox has at least one item still in `pending`. */
  has_pending_inbox_items: boolean;
  /**
   * PRD-0036 / 36.1 (B1): count of current imported chunks. Used by the
   * `bootstrap_despite_low_corpus` row to route around the inflated
   * corpus_coverage denominator that B2 has not yet fixed. Optional so
   * existing callers / tests stay valid; treated as 0 when omitted.
   */
  imported_chunks?: number;
};

/**
 * PRD-0036 / 36.1: "useful corpus floor" — minimum imported_chunks for which
 * we recommend bootstrapping cards even when corpus_coverage reports `low`.
 * Documented as a structural floor, not a fastapi-fitted number: the Phase 0
 * fastapi import was 2120 chunks (~40× this floor) and a small private repo
 * with a few dozen imported markdown files easily clears it. The threshold
 * exists to avoid recommending bootstrap on an essentially empty cache.
 */
export const BOOTSTRAP_MIN_CHUNK_FLOOR = 50;

export type NextStepSuggestion = {
  row_name: string;
  /** Command for the user to run next, or null when the repo is already ready. */
  command: string | null;
  message: string;
};

export type NextStepRow = {
  readonly row_name: string;
  readonly match: (s: NextStepInput) => boolean;
  readonly command: string | null;
  readonly message: string;
};

const allConfident = (s: NextStepInput): boolean =>
  s.corpus_coverage === "confident" &&
  s.scope_coverage === "confident" &&
  s.card_coverage === "confident" &&
  s.retrieval_probes === "confident";

export const NEXT_STEP_TABLE: readonly NextStepRow[] = Object.freeze([
  Object.freeze({
    row_name: "review_inbox",
    match: (s: NextStepInput) => s.has_pending_inbox_items,
    command: "contexttrail setup questions",
    message:
      "Open Agent Rule suggestions need review. Run `contexttrail setup questions` so the agent can curate obvious items and ask only high-leverage semantic questions.",
  }),
  Object.freeze({
    row_name: "all_confident",
    match: allConfident,
    command: null,
    message:
      "Repo is ready for agent use. Use `contexttrail context \"<task>\"` as the production retrieval surface.",
  }),
  // PRD-0036 / 36.1 (B1): the corpus_coverage denominator can be inflated
  // by translation / canonical-docs duplication (B2, deferred). When the
  // user already has a useful corpus imported (≥ BOOTSTRAP_MIN_CHUNK_FLOOR
  // chunks) and at least partial scope coverage but no cards yet, the right
  // next step is `contexttrail card bootstrap` — not "import more docs". Must fire
  // BEFORE `import_more_docs` to actually route around the B2 issue.
  Object.freeze({
    row_name: "bootstrap_despite_low_corpus",
    match: (s: NextStepInput) =>
      s.card_coverage === "low" &&
      (s.imported_chunks ?? 0) >= BOOTSTRAP_MIN_CHUNK_FLOOR &&
      (s.scope_coverage === "confident" || s.scope_coverage === "partial") &&
      !s.has_pending_inbox_items,
    command: "contexttrail card bootstrap",
    message:
      "Corpus is imported and scoped, but no cards yet. Propose candidates with `contexttrail card bootstrap`.",
  }),
  Object.freeze({
    row_name: "import_more_docs",
    match: (s: NextStepInput) => s.corpus_coverage === "low",
    command: "contexttrail import docs/**/*.md",
    message:
      "Most discoverable markdown isn't imported yet. Pull docs into the cache before authoring cards.",
  }),
  Object.freeze({
    row_name: "bootstrap_cards",
    match: (s: NextStepInput) => s.card_coverage === "low",
    command: "contexttrail card bootstrap",
    message:
      "No accepted cards yet. Propose candidates from imported chunks with `contexttrail card bootstrap`.",
  }),
  Object.freeze({
    row_name: "fix_scope_layer",
    match: (s: NextStepInput) => s.scope_coverage === "low",
    command: "contexttrail scope inspect --unknown",
    message:
      "Most imported chunks have layer=unknown. Review with `contexttrail scope inspect --unknown` and add scope frontmatter.",
  }),
  Object.freeze({
    row_name: "tune_retrieval",
    match: (s: NextStepInput) => s.retrieval_probes === "low",
    command: "contexttrail setup --explain",
    message:
      "Most probes returned empty/uncertain. Run `contexttrail setup --explain` to see per-probe rationale.",
  }),
  Object.freeze({
    row_name: "validate_with_context",
    match: () => true,
    command: 'contexttrail context "<sample task>"',
    message:
      "All dimensions ≥ partial. Try `contexttrail context \"<sample task>\"` to validate end-to-end retrieval.",
  }),
]);

export function suggestNextStep(input: NextStepInput): NextStepSuggestion {
  for (const row of NEXT_STEP_TABLE) {
    if (row.match(input)) {
      return {
        row_name: row.row_name,
        command: row.command,
        message: row.message,
      };
    }
  }
  // Unreachable — the catch-all row matches everything. Kept defensive so a
  // future table edit that drops the catch-all surfaces immediately.
  throw new Error("NEXT_STEP_TABLE missing catch-all row");
}
