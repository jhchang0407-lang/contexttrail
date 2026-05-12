/**
 * THO-154 (PRD-0015 / 4): pack readiness verifier.
 *
 * `verifyPackReadiness` is the deep module that decides whether a
 * Context Pack is sufficient for the task. It takes the task's named
 * needs, the source-scoped chunk selection result, the selected sources
 * (incl. must-include coverage), warnings, and coverage confidence, and
 * returns a `PackReadinessResult` with:
 *
 *   - `state`            ready | partial | needs_anchors | unsupported
 *   - `satisfiedNeeds`   needs the pack covers
 *   - `missingNeeds`     needs the pack does not cover
 *   - `reasonCodes`      stable diagnostic codes for inspection
 *
 * The verifier is deterministic and fail-closed (PRD-0015): missing
 * critical evidence lowers readiness rather than being hidden behind a
 * plausible top result, and `unsupported` honesty is preserved.
 */
import { describe, it, expect } from "vitest";
import { verifyPackReadiness } from "./pack-verifier.js";

describe("verifyPackReadiness — healthy pack with no needs", () => {
  it("returns 'ready' with no missing needs when there are no declared needs and a primary chunk exists", () => {
    const result = verifyPackReadiness({
      needs: [],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: ["docs/x.md"],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(result.state).toBe("ready");
    expect(result.missingNeeds).toEqual([]);
    expect(result.satisfiedNeeds).toEqual([]);
  });
});

describe("verifyPackReadiness — top-family ambiguity (THO-165)", () => {
  it("downgrades a clean ready pack to 'partial' with reason 'ambiguous_top_family' when the top pair is genuinely ambiguous", () => {
    const result = verifyPackReadiness({
      needs: [],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
      topFamilyAmbiguous: true,
    });
    expect(result.state).toBe("partial");
    expect(result.reasonCodes).toContain("ambiguous_top_family");
    // The legacy `all_needs_satisfied` reason must NOT also be set —
    // partial means the close call is unresolved, not that everything
    // happened to pass.
    expect(result.reasonCodes).not.toContain("all_needs_satisfied");
  });

  it("does not change state when the pack is already partial for other reasons but adds the ambiguity reason code", () => {
    const result = verifyPackReadiness({
      needs: ["overview_orientation"],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
      topFamilyAmbiguous: true,
    });
    expect(result.state).toBe("partial");
    expect(result.reasonCodes).toContain("ambiguous_top_family");
    expect(result.reasonCodes).toContain("intro_missing");
  });

  it("does not affect ready state when ambiguous flag is false / undefined", () => {
    const ready = verifyPackReadiness({
      needs: [],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
      topFamilyAmbiguous: false,
    });
    expect(ready.state).toBe("ready");
    expect(ready.reasonCodes).not.toContain("ambiguous_top_family");
  });
});

describe("verifyPackReadiness — fail-closed safety", () => {
  it("returns 'unsupported' with reason 'no_evidence' when coverage_confidence is empty", () => {
    const result = verifyPackReadiness({
      needs: ["exact_symbol_behavior"],
      selections: [],
      selectedSources: [],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "empty",
      lockedCount: 0,
    });
    expect(result.state).toBe("unsupported");
    expect(result.reasonCodes).toContain("no_evidence");
  });

  it("returns 'partial' when coverage_confidence is uncertain but anchors are recognized", () => {
    const result = verifyPackReadiness({
      needs: [],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "uncertain",
      lockedCount: 0,
    });
    expect(result.state).toBe("partial");
    expect(result.reasonCodes).toContain("coverage_uncertain");
  });

  it("returns 'needs_anchors' when warnings include anchors_unrecognized", () => {
    const result = verifyPackReadiness({
      needs: [],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: [],
      warnings: ["anchors_unrecognized"],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(result.state).toBe("needs_anchors");
    expect(result.reasonCodes).toContain("anchors_unrecognized");
  });
});

describe("verifyPackReadiness — must-include coverage", () => {
  it("returns 'partial' with reason 'must_include_missing' when a required source is not selected", () => {
    const result = verifyPackReadiness({
      needs: [],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/other.md"],
      mustIncludeSources: ["docs/required.md"],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(result.state).toBe("partial");
    expect(result.reasonCodes).toContain("must_include_missing");
  });

  it("treats every must-include source present as satisfied", () => {
    const result = verifyPackReadiness({
      needs: [],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/a.md", "docs/b.md"],
      mustIncludeSources: ["docs/a.md", "docs/b.md"],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(result.state).toBe("ready");
    expect(result.reasonCodes).not.toContain("must_include_missing");
  });
});

describe("verifyPackReadiness — need-by-need verification", () => {
  it("treats exact_symbol_behavior as satisfied when a primary chunk exists", () => {
    const result = verifyPackReadiness({
      needs: ["exact_symbol_behavior"],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(result.state).toBe("ready");
    expect(result.satisfiedNeeds).toEqual(["exact_symbol_behavior"]);
  });

  it("flags exact_symbol_behavior missing when there is no primary chunk", () => {
    const result = verifyPackReadiness({
      needs: ["exact_symbol_behavior"],
      selections: [],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(result.state).toBe("partial");
    expect(result.missingNeeds).toContain("exact_symbol_behavior");
    expect(result.reasonCodes).toContain("exact_symbol_missing");
  });

  it("treats overview_orientation as satisfied when an intro selection exists", () => {
    const result = verifyPackReadiness({
      needs: ["overview_orientation"],
      selections: [
        { chunkId: "c1", reason: "primary" },
        { chunkId: "c2", reason: "intro" },
      ],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(result.state).toBe("ready");
    expect(result.satisfiedNeeds).toEqual(["overview_orientation"]);
  });

  it("treats overview_orientation missing when only a leaf primary is selected", () => {
    const result = verifyPackReadiness({
      needs: ["overview_orientation"],
      selections: [{ chunkId: "c1", reason: "primary" }],
      selectedSources: ["docs/x.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(result.state).toBe("partial");
    expect(result.missingNeeds).toContain("overview_orientation");
    expect(result.reasonCodes).toContain("intro_missing");
  });

  it("treats setup_install as satisfied only when a sibling chunk is included", () => {
    const ready = verifyPackReadiness({
      needs: ["setup_install"],
      selections: [
        { chunkId: "p", reason: "primary" },
        { chunkId: "s", reason: "sibling" },
      ],
      selectedSources: ["docs/setup.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(ready.state).toBe("ready");

    const partial = verifyPackReadiness({
      needs: ["setup_install"],
      selections: [{ chunkId: "p", reason: "primary" }],
      selectedSources: ["docs/setup.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(partial.state).toBe("partial");
    expect(partial.reasonCodes).toContain("sibling_missing");
  });

  it("treats decision_rationale as satisfied only when a parent chunk is included", () => {
    const ready = verifyPackReadiness({
      needs: ["decision_rationale"],
      selections: [
        { chunkId: "leaf", reason: "primary" },
        { chunkId: "parent", reason: "parent" },
      ],
      selectedSources: ["docs/decision.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(ready.state).toBe("ready");

    const partial = verifyPackReadiness({
      needs: ["decision_rationale"],
      selections: [{ chunkId: "leaf", reason: "primary" }],
      selectedSources: ["docs/decision.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(partial.state).toBe("partial");
    expect(partial.reasonCodes).toContain("parent_missing");
  });

  it("treats cross_module_boundary as satisfied when at least two distinct sources are selected", () => {
    const ready = verifyPackReadiness({
      needs: ["cross_module_boundary"],
      selections: [
        { chunkId: "a1", reason: "primary" },
        { chunkId: "b1", reason: "primary" },
      ],
      selectedSources: ["src/auth/middleware.md", "src/api/handler.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(ready.state).toBe("ready");

    const partial = verifyPackReadiness({
      needs: ["cross_module_boundary"],
      selections: [{ chunkId: "a1", reason: "primary" }],
      selectedSources: ["src/auth/middleware.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });
    expect(partial.state).toBe("partial");
    expect(partial.reasonCodes).toContain("cross_module_boundary_missing");
  });
});
