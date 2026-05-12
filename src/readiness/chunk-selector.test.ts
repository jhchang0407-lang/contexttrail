/**
 * THO-153 (PRD-0015 / 3): source-scoped chunk selector.
 *
 * The selector turns a set of source-local chunk candidates plus the
 * task's named needs into an ordered chunk selection with structured
 * reasons. PRD-0015 frames this as the deep module that owns
 * source-local chunk choice, so the test surface is the public function
 * `selectSourceScopedChunks` and the stable reason vocabulary.
 */
import { describe, it, expect } from "vitest";
import {
  selectSourceScopedChunks,
  type SourceChunkCandidate,
} from "./chunk-selector.js";

function chunk(
  overrides: Partial<SourceChunkCandidate> & Pick<SourceChunkCandidate, "id" | "score">,
): SourceChunkCandidate {
  return {
    source_path: "docs/x.md",
    heading_path: ["Section"],
    heading_level: 2,
    chunk_index: 1,
    chunk_count: 1,
    tokens: 100,
    ...overrides,
  };
}

describe("selectSourceScopedChunks — primary", () => {
  it("picks the highest-scoring candidate as the primary chunk", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/x.md",
      candidates: [
        chunk({ id: "a", score: 1 }),
        chunk({ id: "b", score: 5 }),
        chunk({ id: "c", score: 3 }),
      ],
      needs: [],
    });

    expect(result.selections[0]).toEqual({ chunkId: "b", reason: "primary" });
  });

  it("returns a single primary selection when no needs justify additions", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/x.md",
      candidates: [chunk({ id: "a", score: 5 })],
      needs: [],
    });

    expect(result.selections).toEqual([{ chunkId: "a", reason: "primary" }]);
    expect(result.omitted).toEqual([]);
  });

  it("returns an empty selection when there are no candidates", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/x.md",
      candidates: [],
      needs: ["overview_orientation"],
    });
    expect(result.selections).toEqual([]);
    expect(result.omitted).toEqual([]);
  });
});

describe("selectSourceScopedChunks — overview_orientation adds an intro chunk", () => {
  it("adds the source intro (lowest heading_level / earliest section) when need = overview_orientation", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/x.md",
      candidates: [
        chunk({
          id: "intro",
          score: 1,
          heading_path: ["What is X"],
          heading_level: 1,
          chunk_index: 1,
          chunk_count: 1,
        }),
        chunk({
          id: "leaf",
          score: 5,
          heading_path: ["Advanced", "Edge cases"],
          heading_level: 3,
          chunk_index: 2,
          chunk_count: 5,
        }),
      ],
      needs: ["overview_orientation"],
    });

    const reasons = result.selections.map((s) => s.reason);
    expect(reasons).toContain("primary");
    expect(reasons).toContain("intro");
    const introSel = result.selections.find((s) => s.reason === "intro");
    expect(introSel?.chunkId).toBe("intro");
  });

  it("does not duplicate when the primary IS the intro", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/x.md",
      candidates: [
        chunk({
          id: "intro",
          score: 5,
          heading_path: ["What is X"],
          heading_level: 1,
          chunk_index: 1,
          chunk_count: 1,
        }),
      ],
      needs: ["overview_orientation"],
    });
    expect(result.selections).toEqual([{ chunkId: "intro", reason: "primary" }]);
  });
});

describe("selectSourceScopedChunks — setup_install adds same-parent siblings", () => {
  it("adds a sibling chunk that shares the primary's parent heading", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/setup.md",
      candidates: [
        chunk({
          id: "step1",
          source_path: "docs/setup.md",
          score: 5,
          heading_path: ["Install", "Step 1"],
          heading_level: 3,
          chunk_index: 1,
          chunk_count: 1,
        }),
        chunk({
          id: "step2",
          source_path: "docs/setup.md",
          score: 2,
          heading_path: ["Install", "Step 2"],
          heading_level: 3,
          chunk_index: 1,
          chunk_count: 1,
        }),
        chunk({
          id: "unrelated",
          source_path: "docs/setup.md",
          score: 4,
          heading_path: ["Migration", "Up"],
          heading_level: 3,
          chunk_index: 1,
          chunk_count: 1,
        }),
      ],
      needs: ["setup_install"],
    });

    const reasons = result.selections.map((s) => `${s.reason}:${s.chunkId}`);
    expect(reasons).toEqual(expect.arrayContaining(["primary:step1", "sibling:step2"]));
    expect(reasons).not.toContain("sibling:unrelated");
  });

  it("only adds one sibling even with many candidates (PRD-0015 budget discipline)", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/setup.md",
      candidates: [
        chunk({ id: "p", source_path: "docs/setup.md", score: 5, heading_path: ["Install", "Step 1"], heading_level: 3 }),
        chunk({ id: "s1", source_path: "docs/setup.md", score: 4, heading_path: ["Install", "Step 2"], heading_level: 3 }),
        chunk({ id: "s2", source_path: "docs/setup.md", score: 3, heading_path: ["Install", "Step 3"], heading_level: 3 }),
        chunk({ id: "s3", source_path: "docs/setup.md", score: 2, heading_path: ["Install", "Step 4"], heading_level: 3 }),
      ],
      needs: ["setup_install"],
    });
    const siblings = result.selections.filter((s) => s.reason === "sibling");
    expect(siblings).toHaveLength(1);
    expect(siblings[0]!.chunkId).toBe("s1"); // highest-scoring sibling
  });

  it("does not add a sibling when the need is unrelated", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/setup.md",
      candidates: [
        chunk({
          id: "step1",
          source_path: "docs/setup.md",
          score: 5,
          heading_path: ["Install", "Step 1"],
          heading_level: 3,
          chunk_index: 1,
          chunk_count: 1,
        }),
        chunk({
          id: "step2",
          source_path: "docs/setup.md",
          score: 2,
          heading_path: ["Install", "Step 2"],
          heading_level: 3,
          chunk_index: 1,
          chunk_count: 1,
        }),
      ],
      needs: ["exact_symbol_behavior"],
    });

    expect(result.selections).toEqual([{ chunkId: "step1", reason: "primary" }]);
  });
});

describe("selectSourceScopedChunks — decision_rationale adds a parent chunk", () => {
  it("adds the parent section when the primary is a leaf and need = decision_rationale", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/decision.md",
      candidates: [
        chunk({
          id: "parent",
          source_path: "docs/decision.md",
          score: 1,
          heading_path: ["Why we chose X"],
          heading_level: 1,
          chunk_index: 1,
          chunk_count: 1,
        }),
        chunk({
          id: "leaf",
          source_path: "docs/decision.md",
          score: 5,
          heading_path: ["Why we chose X", "Performance"],
          heading_level: 2,
          chunk_index: 1,
          chunk_count: 1,
        }),
      ],
      needs: ["decision_rationale"],
    });
    const reasons = result.selections.map((s) => `${s.reason}:${s.chunkId}`);
    expect(reasons).toEqual(expect.arrayContaining(["primary:leaf", "parent:parent"]));
  });

  it("drops budget-violating additions and reports them in `omitted`", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/setup.md",
      candidates: [
        chunk({
          id: "primary",
          source_path: "docs/setup.md",
          score: 5,
          heading_path: ["Install", "Step 1"],
          heading_level: 3,
          tokens: 80,
        }),
        chunk({
          id: "sibling",
          source_path: "docs/setup.md",
          score: 4,
          heading_path: ["Install", "Step 2"],
          heading_level: 3,
          tokens: 80,
        }),
      ],
      needs: ["setup_install"],
      budgetTokens: 100,
    });

    // Primary fits (80 ≤ 100). Sibling is dropped (would exceed).
    expect(result.selections.map((s) => s.chunkId)).toEqual(["primary"]);
    expect(result.omitted).toEqual([
      { chunkId: "sibling", omitReason: "budget", intendedReason: "sibling" },
    ]);
  });

  it("does not add a parent if the primary has no parent (top-level section)", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/decision.md",
      candidates: [
        chunk({
          id: "top",
          source_path: "docs/decision.md",
          score: 5,
          heading_path: ["Decision"],
          heading_level: 1,
          chunk_index: 1,
          chunk_count: 1,
        }),
      ],
      needs: ["decision_rationale"],
    });
    expect(result.selections).toEqual([{ chunkId: "top", reason: "primary" }]);
  });

  it("adds a same-source rationale section when a decision task's primary is already top-level", () => {
    const result = selectSourceScopedChunks({
      sourcePath: "docs/decision.md",
      candidates: [
        chunk({
          id: "about",
          source_path: "docs/decision.md",
          score: 5,
          heading_path: ["About the system"],
          heading_level: 1,
        }),
        chunk({
          id: "how-it-works",
          source_path: "docs/decision.md",
          score: 2,
          heading_path: ["How the system works"],
          heading_level: 1,
        }),
        chunk({
          id: "permissions",
          source_path: "docs/decision.md",
          score: 4,
          heading_path: ["Manual permissions"],
          heading_level: 1,
        }),
      ],
      needs: ["decision_rationale"],
    });
    expect(result.selections).toEqual([
      { chunkId: "about", reason: "primary" },
      { chunkId: "how-it-works", reason: "parent" },
    ]);
  });
});
