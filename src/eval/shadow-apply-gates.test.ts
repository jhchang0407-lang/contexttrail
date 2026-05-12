import { describe, expect, it } from "vitest";
import { decidePolicy } from "./shadow-apply-gates.js";

type PolicyContext = Parameters<typeof decidePolicy>[1];

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  const entry = {
    id: "case",
    task: "explain browser mode",
    query_intent: "broad_domain",
    assembly_need: "overview_orientation",
    expectation_kind: "deterministic",
    capabilities: ["canonical_source_ranking"],
    expected_query_mode: "unanchored",
    expected_signal_empty_warning: false,
    expected_top_source: "docs/browser/index.md",
    acceptable_top_sources: ["docs/browser/index.md"],
    must_include_sources: ["docs/browser/index.md"],
    notes: "fixture",
  } as PolicyContext["entry"];
  const result = {
    query_mode: "unanchored",
  } as PolicyContext["result"];
  const selection = {
    fail_closed: false,
    top1_top2_margin: 0.1,
    top1_top3_margin: 0.2,
    selected_sources: [
      {
        source_path: "docs/browser/index.md",
        rank: 1,
        score: 1,
        aboutness_label: "covers",
        reason_codes: ["covers_label"],
      },
      {
        source_path: "docs/browser/component-testing.md",
        rank: 2,
        score: 0.5,
        aboutness_label: "partial",
        reason_codes: [],
      },
    ],
  } as PolicyContext["selection"];
  return {
    entry,
    result,
    baseline_ranked: [],
    acceptable_sources: ["docs/browser/index.md"],
    current_top_source: "docs/browser/component-testing.md",
    current_top3_sources: [
      "docs/browser/component-testing.md",
      "docs/browser/index.md",
      "docs/browser/why.md",
    ],
    selection,
    selected_top: selection?.selected_sources[0],
    aboutness_by_source: new Map([
      [
        "docs/browser/index.md",
        {
          source_path: "docs/browser/index.md",
          rank: 2,
          label: "covers",
          reason_codes: [],
          title_token_coverage: 0.4,
          path_token_coverage: 0.4,
          heading_token_coverage: 0.4,
          combined_token_coverage: 0.6,
        },
      ],
      [
        "docs/browser/component-testing.md",
        {
          source_path: "docs/browser/component-testing.md",
          rank: 1,
          label: "partial",
          reason_codes: [],
          title_token_coverage: 0.2,
          path_token_coverage: 0.2,
          heading_token_coverage: 0.2,
          combined_token_coverage: 0.2,
        },
      ],
    ]),
    ...overrides,
  };
}

describe("shadow apply-gate policies", () => {
  it("applies covers-over-non-covers only when the selected V3 top is already displayed in top-3", () => {
    expect(decidePolicy("v3_covers_over_non_covers", context()).apply).toBe(true);
    expect(
      decidePolicy(
        "v3_covers_over_non_covers",
        context({ current_top3_sources: ["docs/browser/component-testing.md"] }),
      ).apply,
    ).toBe(false);
  });

  it("rejects unique-cover policy when another displayed top-3 source is also covers", () => {
    const ctx = context({
      aboutness_by_source: new Map([
        ...context().aboutness_by_source,
        [
          "docs/browser/why.md",
          {
            source_path: "docs/browser/why.md",
            rank: 3,
            label: "covers",
            reason_codes: [],
            title_token_coverage: 0.4,
            path_token_coverage: 0.4,
            heading_token_coverage: 0.4,
            combined_token_coverage: 0.5,
          },
        ],
      ]),
    });
    expect(decidePolicy("v3_unique_top3_cover", ctx).apply).toBe(false);
  });

  it("marks the oracle rescue separately from deployable policies", () => {
    const out = decidePolicy("oracle_v3_top3_rescue", context());
    expect(out.apply).toBe(true);
    expect(out.oracle).toBe(true);
  });
});
