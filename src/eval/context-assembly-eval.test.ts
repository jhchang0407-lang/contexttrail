import { describe, expect, it } from "vitest";
import {
  evaluateContextSelection,
  loadContextAssemblyCohort,
  summarizeContextAssembly,
  type ContextRankedChunk,
} from "./context-assembly-eval.js";
import { loadRealCorpusEvalSet } from "./real-corpus-fixture.js";

const chunks: ContextRankedChunk[] = [
  {
    id: "a",
    source: "docs/guide.md",
    contexttrail: "Source: docs/guide.md > Section: Guide > Part: 1/1",
    tokens: 100,
    score: 10,
  },
  {
    id: "b",
    source: "docs/api.md",
    contexttrail: "Source: docs/api.md > Section: API > Part: 1/1",
    tokens: 200,
    score: 9,
  },
  {
    id: "c",
    source: "docs/noise.md",
    contexttrail: "Source: docs/noise.md > Section: Noise > Part: 1/1",
    tokens: 300,
    score: 8,
  },
  {
    id: "d",
    source: "docs/support.md",
    contexttrail: "Source: docs/support.md > Section: Support > Part: 1/1",
    tokens: 400,
    score: 7,
  },
];

function entry() {
  return {
    id: "task",
    task: "wire guide with support API",
    query_intent: "cross_module" as const,
    assembly_need: "cross_module_boundary" as const,
    expected_top_source: "docs/guide.md",
    acceptable_top_sources: ["docs/guide.md", "docs/tutorial.md"],
    must_include_sources: ["docs/support.md"],
  };
}

describe("context assembly eval", () => {
  it("requires one acceptable primary source and every must-include source", () => {
    const top3 = evaluateContextSelection({
      repo: "repo",
      entry: entry(),
      mode: { name: "top3_full", chunkLimit: 3 },
      rankedChunks: chunks,
    });
    expect(top3.primaryCovered).toBe(true);
    expect(top3.supportCovered).toBe(false);
    expect(top3.fullCoverage).toBe(false);

    const top5 = evaluateContextSelection({
      repo: "repo",
      entry: entry(),
      mode: { name: "top5_full", chunkLimit: 5 },
      rankedChunks: chunks,
    });
    expect(top5.primaryCovered).toBe(true);
    expect(top5.supportCovered).toBe(true);
    expect(top5.fullCoverage).toBe(true);
  });

  it("counts distractor sources without penalizing accepted alternatives", () => {
    const row = evaluateContextSelection({
      repo: "repo",
      entry: entry(),
      mode: { name: "top5_full", chunkLimit: 5 },
      rankedChunks: chunks,
    });
    expect(row.extraSources).toEqual(["docs/api.md", "docs/noise.md"]);
  });

  it("summarizes coverage and token mass by fixed pack mode", () => {
    const rows = [
      evaluateContextSelection({
        repo: "repo",
        entry: entry(),
        mode: { name: "top3_full", chunkLimit: 3 },
        rankedChunks: chunks,
      }),
      evaluateContextSelection({
        repo: "repo",
        entry: entry(),
        mode: { name: "top5_full", chunkLimit: 5 },
        rankedChunks: chunks,
      }),
      evaluateContextSelection({
        repo: "repo",
        entry: entry(),
        mode: { name: "top10_full", chunkLimit: 10 },
        rankedChunks: chunks,
      }),
    ];
    const summary = summarizeContextAssembly(rows);
    expect(summary.find((row) => row.mode === "top3_full")?.fullCoverage).toBe(0);
    expect(summary.find((row) => row.mode === "top5_full")?.fullCoverage).toBe(1);
    expect(summary.find((row) => row.mode === "top5_full")?.avgTokens).toBe(1000);
  });

  it("pins the current top-5 full-context miss cohort to existing real-corpus cases", () => {
    const cohort = loadContextAssemblyCohort("context-assembly-top5-misses");
    expect(cohort).toHaveLength(9);
    expect(cohort.map((entry) => `${entry.repo}/${entry.id}`)).toEqual([
      "ralph/ralph-anchored-setup-sync",
      "tanstack/tanstack-cross-module-eslint",
      "trpc/trpc-anchored-router",
      "turborepo/turborepo-unanchored-getting-started",
      "valibot/valibot-broad-pipelines",
      "valibot/valibot-broad-what-is",
      "vitest/vitest-config-set-test-timeout",
      "vitest/vitest-symptom-tests-timing-out",
      "zod/zod-unanchored-readme-v3",
    ]);

    for (const entry of cohort) {
      expect(loadRealCorpusEvalSet(entry.repo).some((fixture) => fixture.id === entry.id)).toBe(true);
    }
  });
});
