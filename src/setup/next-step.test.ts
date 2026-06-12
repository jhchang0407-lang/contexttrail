/**
 * Deterministic next-step decision table tests.
 *
 * Table is intentionally small (≤12 rows). Ordering is load-bearing
 * (earlier rows take precedence). Every named scenario from the
 * "suggested next step is deterministic" design requirement has a test.
 */
import { describe, expect, it } from "vitest";
import {
  NEXT_STEP_TABLE,
  NEXT_STEP_TABLE_ROW_CAP,
  suggestNextStep,
  type NextStepInput,
} from "./next-step.js";

const partials: NextStepInput = {
  corpus_coverage: "partial",
  scope_coverage: "partial",
  card_coverage: "partial",
  retrieval_probes: "partial",
  has_pending_inbox_items: false,
};

describe("NEXT_STEP_TABLE size cap (PRD-0033 says ≤12 rows)", () => {
  it("fails if the row count grows past the cap without an ADR amendment", () => {
    expect(NEXT_STEP_TABLE.length).toBeLessThanOrEqual(NEXT_STEP_TABLE_ROW_CAP);
    expect(NEXT_STEP_TABLE_ROW_CAP).toBe(12);
  });

  it("has unique row names (no collision in the table)", () => {
    const names = NEXT_STEP_TABLE.map((r) => r.row_name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("is frozen so callers cannot reorder or mutate rows at runtime", () => {
    expect(Object.isFrozen(NEXT_STEP_TABLE)).toBe(true);
  });
});

describe("suggestNextStep — PRD-0033 named scenarios", () => {
  it("corpus_coverage low + card_coverage low → import docs first", () => {
    const s = suggestNextStep({
      ...partials,
      corpus_coverage: "low",
      card_coverage: "low",
    });
    expect(s.row_name).toBe("import_more_docs");
    expect(s.command).toMatch(/contexttrail import/);
  });

  it("corpus_coverage confident + card_coverage low + NO pending inbox → contexttrail card bootstrap", () => {
    const s = suggestNextStep({
      ...partials,
      corpus_coverage: "confident",
      card_coverage: "low",
      has_pending_inbox_items: false,
    });
    expect(s.row_name).toBe("bootstrap_cards");
    expect(s.command).toBe("contexttrail card bootstrap");
  });

  it("pending inbox items → contexttrail setup questions (agent-guided review before more setup)", () => {
    const s = suggestNextStep({
      ...partials,
      corpus_coverage: "confident",
      card_coverage: "low",
      has_pending_inbox_items: true,
    });
    expect(s.row_name).toBe("review_inbox");
    expect(s.command).toBe("contexttrail setup questions");
  });

  it("all dimensions ≥ partial → suggest contexttrail context as the validation step", () => {
    const s = suggestNextStep(partials);
    expect(s.row_name).toBe("validate_with_context");
    expect(s.command).toMatch(/contexttrail context/);
  });

  it("all dimensions confident → 'ready for agent use' (no command, contexttrail context as the production surface)", () => {
    const s = suggestNextStep({
      corpus_coverage: "confident",
      scope_coverage: "confident",
      card_coverage: "confident",
      retrieval_probes: "confident",
      has_pending_inbox_items: false,
    });
    expect(s.row_name).toBe("all_confident");
    expect(s.command).toBeNull();
    expect(s.message.toLowerCase()).toMatch(/ready/);
    expect(s.message).toMatch(/contexttrail context/);
  });
});

describe("suggestNextStep — PRD-0036 / 36.1 (B1) bootstrap_despite_low_corpus", () => {
  // fastapi-shape: corpus_coverage:low (inflated denominator), scope:confident,
  // card:low, imported_chunks:2120. Without the new row, this routed to
  // `import_more_docs` even though the corpus is already 2120 chunks.
  it("fastapi-shape: low corpus + confident scope + low cards + chunks≥50 → bootstrap", () => {
    const s = suggestNextStep({
      corpus_coverage: "low",
      scope_coverage: "confident",
      card_coverage: "low",
      retrieval_probes: "partial",
      has_pending_inbox_items: false,
      imported_chunks: 2120,
    });
    expect(s.row_name).toBe("bootstrap_despite_low_corpus");
    expect(s.command).toBe("contexttrail card bootstrap");
  });

  it("partial scope is also acceptable for the bootstrap override", () => {
    const s = suggestNextStep({
      ...partials,
      corpus_coverage: "low",
      card_coverage: "low",
      scope_coverage: "partial",
      imported_chunks: 100,
      has_pending_inbox_items: false,
    });
    expect(s.row_name).toBe("bootstrap_despite_low_corpus");
  });

  it("below the chunk floor still routes to import_more_docs", () => {
    const s = suggestNextStep({
      ...partials,
      corpus_coverage: "low",
      card_coverage: "low",
      scope_coverage: "confident",
      imported_chunks: 49,
      has_pending_inbox_items: false,
    });
    expect(s.row_name).toBe("import_more_docs");
  });

  it("pending inbox items take precedence over the low-corpus bootstrap override", () => {
    const s = suggestNextStep({
      ...partials,
      corpus_coverage: "low",
      card_coverage: "low",
      scope_coverage: "confident",
      imported_chunks: 500,
      has_pending_inbox_items: true,
    });
    expect(s.row_name).toBe("review_inbox");
  });

  it("low scope blocks the override (must be confident or partial)", () => {
    const s = suggestNextStep({
      ...partials,
      corpus_coverage: "low",
      card_coverage: "low",
      scope_coverage: "low",
      imported_chunks: 500,
    });
    expect(s.row_name).toBe("import_more_docs");
  });
});

describe("suggestNextStep — additional band routings", () => {
  it("scope_coverage low (with corpus ≥ partial) → contexttrail scope inspect --unknown", () => {
    const s = suggestNextStep({
      ...partials,
      corpus_coverage: "confident",
      card_coverage: "confident",
      scope_coverage: "low",
    });
    expect(s.row_name).toBe("fix_scope_layer");
    expect(s.command).toMatch(/contexttrail scope inspect/);
  });

  it("retrieval_probes low (with everything else ≥ partial) → run contexttrail setup --explain", () => {
    const s = suggestNextStep({
      ...partials,
      corpus_coverage: "confident",
      card_coverage: "partial",
      scope_coverage: "partial",
      retrieval_probes: "low",
    });
    expect(s.row_name).toBe("tune_retrieval");
    expect(s.command).toMatch(/--explain/);
  });
});

describe("suggestNextStep — ordering invariants", () => {
  it("pending inbox is highest priority, even when all dimensions are confident", () => {
    const s = suggestNextStep({
      corpus_coverage: "confident",
      scope_coverage: "confident",
      card_coverage: "confident",
      retrieval_probes: "confident",
      has_pending_inbox_items: true,
    });
    expect(s.row_name).toBe("review_inbox");
    expect(s.command).toBe("contexttrail setup questions");
  });

  it("corpus_coverage low routes to import when there is no pending inbox work", () => {
    const s = suggestNextStep({
      corpus_coverage: "low",
      scope_coverage: "low",
      card_coverage: "low",
      retrieval_probes: "low",
      has_pending_inbox_items: false,
    });
    expect(s.row_name).toBe("import_more_docs");
  });

  it("pending inbox beats fresh bootstrap when both are matching", () => {
    const a = suggestNextStep({
      ...partials,
      corpus_coverage: "confident",
      card_coverage: "low",
      has_pending_inbox_items: true,
    });
    const b = suggestNextStep({
      ...partials,
      corpus_coverage: "confident",
      card_coverage: "low",
      has_pending_inbox_items: false,
    });
    expect(a.row_name).toBe("review_inbox");
    expect(b.row_name).toBe("bootstrap_cards");
  });

  it("returns the validate_with_context fallback for any non-low state that isn't all-confident", () => {
    // partial scope, confident others — no low rows fire
    const s = suggestNextStep({
      corpus_coverage: "confident",
      scope_coverage: "partial",
      card_coverage: "confident",
      retrieval_probes: "confident",
      has_pending_inbox_items: false,
    });
    expect(s.row_name).toBe("validate_with_context");
  });
});

describe("suggestNextStep — deterministic", () => {
  it("returns identical suggestions across repeated calls with identical inputs", () => {
    const inputs: NextStepInput[] = [
      partials,
      { ...partials, corpus_coverage: "low" },
      { ...partials, scope_coverage: "low", retrieval_probes: "low" },
      { ...partials, card_coverage: "low", has_pending_inbox_items: true },
    ];
    for (const inp of inputs) {
      const a = suggestNextStep(inp);
      const b = suggestNextStep(inp);
      expect(b).toEqual(a);
    }
  });
});
