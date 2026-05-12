import { describe, expect, it } from "vitest";
import {
  evaluateSourceOwnerPair,
  evaluateSourceOwnerPairs,
  type SourceOwnerPairObservation,
  type SourceOwnerPairProbe,
} from "./source-owner-pairs.js";

const probe: SourceOwnerPairProbe = {
  id: "owner-vs-broad",
  repo: "repo",
  case_id: "case",
  owner_source: "docs/owner.md",
  competitor_source: "docs/broad.md",
  reason: "owner should beat broad doc",
};

function obs(
  overrides: Partial<SourceOwnerPairObservation>,
): SourceOwnerPairObservation {
  return {
    repo: "repo",
    id: "case",
    source_candidates: [
      { source_path: "docs/owner.md", rank: 1 },
      { source_path: "docs/broad.md", rank: 2 },
    ],
    source_cards: [
      { source_path: "docs/owner.md", rank: 1 },
      { source_path: "docs/broad.md", rank: 2 },
    ],
    source_selection: {
      selected_sources: [
        { source_path: "docs/owner.md" },
        { source_path: "docs/broad.md" },
      ],
    },
    displayed_top3_sources: ["docs/owner.md", "docs/broad.md"],
    ...overrides,
  };
}

describe("evaluateSourceOwnerPair", () => {
  it("passes when the owner beats the competitor through display", () => {
    const result = evaluateSourceOwnerPair([obs({})], probe)!;
    expect(result.passed).toBe(true);
    expect(result.first_loss_stage).toBe("none");
  });

  it("labels owner_absent before pairwise rank comparisons", () => {
    const result = evaluateSourceOwnerPair(
      [
        obs({
          source_candidates: [{ source_path: "docs/broad.md", rank: 1 }],
        }),
      ],
      probe,
    )!;
    expect(result.first_loss_stage).toBe("owner_absent");
  });

  it("labels candidate-stage inversions", () => {
    const result = evaluateSourceOwnerPair(
      [
        obs({
          source_candidates: [
            { source_path: "docs/broad.md", rank: 1 },
            { source_path: "docs/owner.md", rank: 2 },
          ],
        }),
      ],
      probe,
    )!;
    expect(result.first_loss_stage).toBe("candidate_pairwise_loss");
  });

  it("labels source-card inversions after candidates are correctly ordered", () => {
    const result = evaluateSourceOwnerPair(
      [
        obs({
          source_cards: [
            { source_path: "docs/broad.md", rank: 1 },
            { source_path: "docs/owner.md", rank: 2 },
          ],
        }),
      ],
      probe,
    )!;
    expect(result.first_loss_stage).toBe("source_card_pairwise_loss");
  });

  it("labels source-selection inversions after source-card ordering is correct", () => {
    const result = evaluateSourceOwnerPair(
      [
        obs({
          source_selection: {
            selected_sources: [
              { source_path: "docs/broad.md" },
              { source_path: "docs/owner.md" },
            ],
          },
        }),
      ],
      probe,
    )!;
    expect(result.first_loss_stage).toBe("source_selection_pairwise_loss");
  });

  it("labels display inversions after selection ordering is correct", () => {
    const result = evaluateSourceOwnerPair(
      [
        obs({
          displayed_top3_sources: ["docs/broad.md", "docs/owner.md"],
        }),
      ],
      probe,
    )!;
    expect(result.first_loss_stage).toBe("display_pairwise_loss");
  });
});

describe("evaluateSourceOwnerPairs", () => {
  it("aggregates pass/fail counts by first loss stage", () => {
    const aggregate = evaluateSourceOwnerPairs(
      [
        obs({ id: "pass" }),
        obs({
          id: "fail",
          displayed_top3_sources: ["docs/broad.md", "docs/owner.md"],
        }),
      ],
      [
        { ...probe, id: "pass-probe", case_id: "pass" },
        { ...probe, id: "fail-probe", case_id: "fail" },
      ],
    );
    expect(aggregate.total).toBe(2);
    expect(aggregate.passed).toBe(1);
    expect(aggregate.failed).toBe(1);
    expect(aggregate.stage_counts.display_pairwise_loss).toBe(1);
  });

  it("ignores probes for repos not present in the current capture", () => {
    const aggregate = evaluateSourceOwnerPairs(
      [obs({ id: "pass" })],
      [
        { ...probe, id: "present", case_id: "pass" },
        { ...probe, id: "other-repo", repo: "other", case_id: "missing" },
      ],
    );
    expect(aggregate.total).toBe(1);
    expect(aggregate.results.map((result) => result.probe_id)).toEqual([
      "present",
    ]);
  });
});
