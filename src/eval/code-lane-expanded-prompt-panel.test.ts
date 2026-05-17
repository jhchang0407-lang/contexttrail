import { describe, expect, it } from "vitest";
import type { AgentCompletionDetailedSummary } from "./agent-completion-probe.js";
import {
  expandAgentCompletionPromptPanel,
  renderExpandedPromptPanelReport,
  summarizePromptPanel,
} from "./code-lane-expanded-prompt-panel.js";

describe("expandAgentCompletionPromptPanel", () => {
  it("expands commit-grounded cases to a text-eval-sized prompt panel without dropping originals", () => {
    const cases = [
      {
        ticket: "THO-1",
        commit_sha: "abc123",
        queries: [
          "schema migration chunk reindex",
          "FTS5 table recreation",
          "chunk persistence storage",
        ],
      },
      {
        ticket: "THO-2",
        commit_sha: "def456",
        queries: [
          "source profile import wiring",
          "metadata parser support",
          "source card ranking",
        ],
      },
    ];

    const expanded = expandAgentCompletionPromptPanel(cases, {
      targetPromptVariantsPerCase: 10,
    });

    expect(expanded).toHaveLength(2);
    expect(expanded[0]?.queries).toHaveLength(10);
    expect(expanded[1]?.queries).toHaveLength(10);
    expect(expanded[0]?.queries.slice(0, 3)).toEqual(cases[0]?.queries);
    expect(new Set(expanded[0]?.queries).size).toBe(10);
    expect(expanded[0]?.queries.join("\n")).not.toContain("src/");
  });
});

describe("summarizePromptPanel", () => {
  it("reports prompt count and 99% lower confidence bound for top-3 usefulness", () => {
    const summary = {
      promptVariantSummary: {
        promptCount: 140,
        promptTop1Acceptable: 100,
        promptTop3Useful: 133,
        promptRankedUseful: 140,
        promptSupportUseful: 90,
        promptRankedCodeFileHits: 500,
        promptRankedCodeFileTotal: 700,
        ticketsWithPromptVariants: 14,
        ticketsTop1Robust: 5,
        ticketsTop3Robust: 12,
        ticketsRankedRobust: 14,
      },
    } as AgentCompletionDetailedSummary;

    const panel = summarizePromptPanel({
      basePromptCount: 42,
      expandedPromptCount: 140,
      summary,
      confidence: 0.99,
    });

    expect(panel.basePromptCount).toBe(42);
    expect(panel.expandedPromptCount).toBe(140);
    expect(panel.promptTop3.rate).toBeCloseTo(0.95);
    expect(panel.promptTop3.lowerConfidenceBound).toBeLessThan(0.95);
    expect(panel.misses).toEqual([]);
  });
});

describe("renderExpandedPromptPanelReport", () => {
  it("renders the expanded prompt panel size and confidence-bound warning signal", () => {
    const rendered = renderExpandedPromptPanelReport({
      basePromptCount: 42,
      expandedPromptCount: 140,
      confidence: 0.99,
      promptTop3: {
        hits: 133,
        total: 140,
        rate: 0.95,
        lowerConfidenceBound: 0.9,
      },
      promptRanked: {
        hits: 140,
        total: 140,
        rate: 1,
        lowerConfidenceBound: 0.95,
      },
      ticketsTop3Robust: {
        hits: 12,
        total: 14,
        rate: 12 / 14,
        lowerConfidenceBound: 0.55,
      },
      misses: [
        {
          ticket: "THO-1",
          query: "hard prompt",
          topThreeCodeFiles: ["src/a.ts", "src/b.ts"],
          rankedCodeChangedFiles: ["src/c.ts"],
        },
      ],
    });

    expect(rendered).toContain("EXPANDED CODE-LANE PROMPT PANEL");
    expect(rendered).toContain("Base prompts: 42");
    expect(rendered).toContain("Expanded prompts: 140");
    expect(rendered).toContain("lower99%");
    expect(rendered).toContain("Top misses:");
    expect(rendered).toContain("THO-1");
  });
});
