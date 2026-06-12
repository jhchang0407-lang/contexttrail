/**
 * Readiness-aware assembly orchestrator.
 *
 * `orchestratePackReadiness` is the single integration seam that ties
 * the task-need extractor, source-scoped chunk selector, and pack
 * readiness verifier together. It accepts retrieval-side primitives
 * (no `RetrievalResult` coupling), so eval and the MCP presenter can
 * call it consistently and present `pack_readiness` diagnostics in
 * explain/eval surfaces.
 */
import { describe, it, expect } from "vitest";
import { orchestratePackReadiness } from "./orchestrator.js";

describe("orchestratePackReadiness — integration", () => {
  it("returns extracted needs, primary selection on the top source, and a 'ready' verifier result for a healthy exact-symbol task", () => {
    const out = orchestratePackReadiness({
      task: "use Bun.Glob to walk files matching a pattern",
      query_mode: "anchored",
      query_intent: "exact_symbol",
      symbols: ["Bun.Glob"],
      sourceCandidates: [
        {
          id: "v1",
          source_path: "docs/runtime/glob.md",
          heading_path: ["Glob", "Usage"],
          heading_level: 2,
          chunk_index: 1,
          chunk_count: 3,
          score: 5,
          tokens: 100,
        },
        {
          id: "v2",
          source_path: "docs/runtime/glob.md",
          heading_path: ["Glob", "API"],
          heading_level: 2,
          chunk_index: 1,
          chunk_count: 1,
          score: 3,
          tokens: 100,
        },
      ],
      selectedSources: ["docs/runtime/glob.md"],
      mustIncludeSources: ["docs/runtime/glob.md"],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });

    expect(out.needs).toContain("exact_symbol_behavior");
    expect(out.selections[0]?.reason).toBe("primary");
    expect(out.selections[0]?.chunkId).toBe("v1");
    expect(out.result.state).toBe("ready");
  });

  it("flags overview_orientation as missing when only a primary chunk is selected for a broad-domain task", () => {
    const out = orchestratePackReadiness({
      task: "what is tRPC",
      query_mode: "unanchored",
      query_intent: "broad_domain",
      sourceCandidates: [
        {
          id: "leaf",
          source_path: "docs/index.md",
          heading_path: ["Advanced", "Edge cases"],
          heading_level: 3,
          chunk_index: 2,
          chunk_count: 5,
          score: 5,
          tokens: 100,
        },
      ],
      selectedSources: ["docs/index.md"],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "confident",
      lockedCount: 0,
    });

    expect(out.needs).toContain("overview_orientation");
    // Only one candidate — no separate intro to add — so verifier flags the gap.
    expect(out.result.state).toBe("partial");
    expect(out.result.missingNeeds).toContain("overview_orientation");
    expect(out.result.reasonCodes).toContain("intro_missing");
  });

  it("preserves unsupported honesty when coverage_confidence is empty", () => {
    const out = orchestratePackReadiness({
      task: "asdfqwerty",
      query_mode: "signal_empty",
      sourceCandidates: [],
      selectedSources: [],
      mustIncludeSources: [],
      warnings: [],
      coverage_confidence: "empty",
      lockedCount: 0,
    });

    expect(out.result.state).toBe("unsupported");
    expect(out.result.reasonCodes).toContain("no_evidence");
  });
});
