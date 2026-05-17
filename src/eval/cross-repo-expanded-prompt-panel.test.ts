import { describe, expect, it } from "vitest";
import {
  renderCrossRepoExpandedPromptPanelReport,
  summarizeCrossRepoExpandedPromptPanel,
  type CrossRepoExpandedPromptRepoSummary,
} from "./cross-repo-expanded-prompt-panel.js";

function repoSummary(args: {
  id: string;
  cases: number;
  basePrompts: number;
  expandedPrompts: number;
  top3Hits: number;
  rankedHits: number;
  robustHits: number;
}): CrossRepoExpandedPromptRepoSummary {
  return {
    repo: {
      id: args.id,
      name: args.id,
      repoRoot: `/repos/${args.id}`,
      minimumTaskPanel: [`${args.id}-panel`],
    },
    caseCount: args.cases,
    summary: {
      basePromptCount: args.basePrompts,
      expandedPromptCount: args.expandedPrompts,
      confidence: 0.99,
      promptTop3: {
        hits: args.top3Hits,
        total: args.expandedPrompts,
        rate: args.top3Hits / args.expandedPrompts,
        lowerConfidenceBound: 0,
      },
      promptRanked: {
        hits: args.rankedHits,
        total: args.expandedPrompts,
        rate: args.rankedHits / args.expandedPrompts,
        lowerConfidenceBound: 0,
      },
      ticketsTop3Robust: {
        hits: args.robustHits,
        total: args.cases,
        rate: args.robustHits / args.cases,
        lowerConfidenceBound: 0,
      },
      misses: [],
    },
  };
}

describe("summarizeCrossRepoExpandedPromptPanel", () => {
  it("aggregates expanded prompt metrics across repos and fails breadth gates explicitly", () => {
    const summary = summarizeCrossRepoExpandedPromptPanel({
      policy: {
        confidence: 0.99,
        minRepos: 3,
        minCases: 10,
        minPromptVariants: 100,
      },
      repos: [
        repoSummary({
          id: "contexttrail",
          cases: 14,
          basePrompts: 42,
          expandedPrompts: 140,
          top3Hits: 136,
          rankedHits: 139,
          robustHits: 12,
        }),
        repoSummary({
          id: "ralph",
          cases: 4,
          basePrompts: 12,
          expandedPrompts: 40,
          top3Hits: 10,
          rankedHits: 10,
          robustHits: 0,
        }),
      ],
    });

    expect(summary.repoCount).toBe(2);
    expect(summary.caseCount).toBe(18);
    expect(summary.expandedPromptCount).toBe(180);
    expect(summary.promptTop3.hits).toBe(146);
    expect(summary.promptTop3.total).toBe(180);
    expect(summary.failedBreadthGates).toEqual(["repo_count"]);
  });

  it("renders aggregate confidence and per-repo top-3 metrics", () => {
    const summary = summarizeCrossRepoExpandedPromptPanel({
      repos: [
        repoSummary({
          id: "contexttrail",
          cases: 14,
          basePrompts: 42,
          expandedPrompts: 140,
          top3Hits: 136,
          rankedHits: 139,
          robustHits: 12,
        }),
      ],
    });

    const rendered = renderCrossRepoExpandedPromptPanelReport(summary);

    expect(rendered).toContain("CROSS-REPO EXPANDED CODE-LANE PROMPT PANEL");
    expect(rendered).toContain("Breadth gates: FAIL");
    expect(rendered).toContain("prompt top-3 useful");
    expect(rendered).toContain("lower99%");
    expect(rendered).toContain("contexttrail");
  });
});
