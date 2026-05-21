import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OssCodeLaneValidationRepo } from "./oss-code-lane-generalization.js";
import {
  createJsonlCodeEngineAdapter,
  emitOssCodeEngineQueryJsonl,
  makeOssCodeEngineQueryId,
  normalizeOssCodeEngineCandidates,
  renderOssCodeEngineBakeoffReport,
  runOssCodeEngineBakeoff,
} from "./oss-code-engine-bakeoff.js";

function repo(): OssCodeLaneValidationRepo {
  return {
    id: "demo",
    name: "Demo",
    repoRoot: "/repos/demo",
    primaryLanguage: "TypeScript",
    projectShape: "library",
    minimumTaskPanel: ["DEMO-1", "DEMO-2"],
    whyRealistic: "unit fixture",
    whyUnfamiliar: "unit fixture",
    accessAssumptions: ["unit fixture"],
    agentCompletionCases: [
      {
        ticket: "DEMO-1",
        commit_sha: "abc123",
        changeType: "runtime",
        queries: ["wire auth middleware", "jwt session middleware"],
      },
      {
        ticket: "DEMO-2",
        commit_sha: "def456",
        changeType: "cli",
        queries: ["add config command"],
      },
    ],
  };
}

describe("normalizeOssCodeEngineCandidates", () => {
  it("collapses duplicate absolute and relative paths into ranked repo paths", () => {
    expect(
      normalizeOssCodeEngineCandidates({
        repoRoot: "/repos/demo",
        candidates: [
          "/repos/demo/src/auth.ts",
          { path: "./src/auth.ts", score: 0.3 },
          { source_path: "src/cli.ts" },
          { file: "/other/root/src/nope.ts" },
          "",
        ],
      }),
    ).toEqual([
      { path: "src/auth.ts", score: undefined },
      { path: "src/cli.ts", score: undefined },
      { path: "/other/root/src/nope.ts", score: undefined },
    ]);
  });
});

describe("runOssCodeEngineBakeoff", () => {
  it("scores prompt top-3, ticket robustness, and recall depths against hidden target files", async () => {
    const report = await runOssCodeEngineBakeoff({
      repos: [repo()],
      candidateRecallDepths: [1, 3, 5],
      resolveTargets: (_repo, testCase) => {
        if (testCase.commit_sha === "abc123") {
          return ["src/auth.ts", "src/session.ts", "README.md"];
        }
        return ["src/cli.ts"];
      },
      engine: {
        id: "fixture",
        name: "Fixture Engine",
        async retrieve(args) {
          if (args.query === "wire auth middleware") {
            return [
              { path: "src/decoy.ts" },
              { path: "src/auth.ts" },
              { path: "src/session.ts" },
            ];
          }
          if (args.query === "jwt session middleware") {
            return [
              { path: "src/decoy-a.ts" },
              { path: "src/decoy-b.ts" },
              { path: "src/decoy-c.ts" },
              { path: "src/auth.ts" },
            ];
          }
          return [{ path: "src/cli.ts" }];
        },
      },
    });

    expect(report.aggregate.promptTop3).toMatchObject({
      hits: 2,
      total: 3,
      rate: 2 / 3,
    });
    expect(report.aggregate.ticketsTop3Robust).toMatchObject({
      hits: 1,
      total: 2,
    });
    expect(report.aggregate.candidateRecall.depths).toEqual([
      {
        depth: 1,
        promptUseful: 1,
        promptCount: 3,
        fileHits: 1,
        fileTotal: 5,
      },
      {
        depth: 3,
        promptUseful: 2,
        promptCount: 3,
        fileHits: 3,
        fileTotal: 5,
      },
      {
        depth: 5,
        promptUseful: 3,
        promptCount: 3,
        fileHits: 4,
        fileTotal: 5,
      },
    ]);
    expect(report.rows[1]).toMatchObject({
      query: "jwt session middleware",
      topThreeUseful: false,
      firstUsefulDepth: 4,
    });
  });

  it("renders a compact report with fork decision gates", async () => {
    const report = await runOssCodeEngineBakeoff({
      repos: [repo()],
      candidateRecallDepths: [3, 100],
      resolveTargets: () => ["src/auth.ts"],
      engine: {
        id: "all-hit",
        name: "All Hit",
        async retrieve() {
          return [{ path: "src/auth.ts" }];
        },
      },
    });

    expect(renderOssCodeEngineBakeoffReport(report)).toContain(
      "Fork recommendation: PASS",
    );
    expect(renderOssCodeEngineBakeoffReport(report)).toContain(
      "recall@100: prompts 3/3",
    );
  });
});

describe("JSONL code engine adapter", () => {
  it("matches engine results by query id without exposing target files to wrappers", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "contexttrail-bakeoff-"));
    const queryId = makeOssCodeEngineQueryId({
      repoId: "demo",
      ticket: "DEMO-1",
      commit: "abc123",
      promptIndex: 0,
      query: "wire auth middleware",
    });
    const resultsPath = join(tmp, "results.jsonl");
    writeFileSync(
      resultsPath,
      `${JSON.stringify({
        queryId,
        candidates: [{ path: "/repos/demo/src/auth.ts", score: 0.9 }],
      })}\n`,
    );

    const adapter = createJsonlCodeEngineAdapter({
      id: "octocode-jsonl",
      name: "Octocode JSONL",
      resultsPath,
    });

    await expect(
      adapter.retrieve({
        queryId,
        repo: repo(),
        testCase: repo().agentCompletionCases[0]!,
        promptIndex: 0,
        query: "wire auth middleware",
      }),
    ).resolves.toEqual([{ path: "src/auth.ts", score: 0.9 }]);

    const emitted = emitOssCodeEngineQueryJsonl({ repos: [repo()] });
    expect(emitted).toContain(queryId);
    expect(emitted).not.toContain("src/auth.ts");
    expect(emitted).not.toContain("targetSourceFiles");
  });
});
