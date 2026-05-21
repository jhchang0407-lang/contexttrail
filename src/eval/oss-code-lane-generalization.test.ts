import { describe, expect, it } from "vitest";
import {
  parseOssCodeLaneManifest,
  renderOssCodeLaneGeneralizationReport,
  runOssCodeLaneGeneralizationEval,
  type OssCodeLaneGeneralizationPolicy,
  type OssCodeLaneValidationRepo,
} from "./oss-code-lane-generalization.js";
import type { PairedCodeLaneComparison } from "./code-lane-comparison.js";

const SMALL_POLICY: OssCodeLaneGeneralizationPolicy = {
  confidence: 0.99,
  minRepos: 3,
  minCases: 5,
  minPromptVariants: 15,
  minLanguages: 3,
  minProjectShapes: 2,
  minChangeTypes: 4,
  promptTop3LowerBoundFloor: 0.75,
  ticketTop3RobustLowerBoundFloor: 0.7,
  rankedUsefulLowerBoundFloor: 0.95,
  supportFileHitLowerBoundFloor: 0.5,
};

function repo(args: {
  id: string;
  language: string;
  projectShape: string;
  changeTypes: string[];
}): OssCodeLaneValidationRepo {
  return {
    id: args.id,
    name: args.id,
    repoRoot: `/repos/${args.id}`,
    primaryLanguage: args.language,
    projectShape: args.projectShape,
    minimumTaskPanel: args.changeTypes.map((changeType, index) =>
      `${args.id}-${changeType}-${index}`,
    ),
    whyRealistic: "synthetic test repo shape",
    whyUnfamiliar: "not part of the local training panel",
    accessAssumptions: ["unit test fixture"],
    agentCompletionCases: args.changeTypes.map((changeType, index) => ({
      ticket: `${args.id}-${index}`,
      commit_sha: `${args.id}${index}`,
      queries: [
        `${changeType} implementation query`,
        `${changeType} support query`,
        `${changeType} behavior query`,
      ],
      changeType,
    })),
  };
}

function largeRepo(args: {
  id: string;
  language: string;
  projectShape: string;
  caseCount: number;
  queryCount: number;
  changeTypes: string[];
}): OssCodeLaneValidationRepo {
  return {
    id: args.id,
    name: args.id,
    repoRoot: `/repos/${args.id}`,
    primaryLanguage: args.language,
    projectShape: args.projectShape,
    minimumTaskPanel: [`${args.id}-panel`],
    whyRealistic: "large synthetic certification repo shape",
    whyUnfamiliar: "not part of the local training panel",
    accessAssumptions: ["unit test fixture"],
    agentCompletionCases: Array.from({ length: args.caseCount }, (_, index) => {
      const changeType = args.changeTypes[index % args.changeTypes.length]!;
      return {
        ticket: `${args.id}-${index}`,
        commit_sha: `${args.id}${index}`,
        queries: Array.from(
          { length: args.queryCount },
          (_unused, queryIndex) => `${changeType} query ${queryIndex}`,
        ),
        changeType,
      };
    }),
  };
}

function comparison(args: {
  cases: number;
  prompts: number;
  top3: number;
  robust: number;
  ranked: number;
  rankedPrompts?: number;
  supportHits: number;
  supportTotal: number;
}): PairedCodeLaneComparison {
  return {
    caseCount: args.cases,
    fileCoverage: {
      old: { mentioned: 0, total: args.supportTotal },
      new: { mentioned: args.supportHits, total: args.supportTotal },
    },
    codeTop1: {
      old: { hits: 0, total: args.cases },
      new: { hits: args.robust, total: args.cases },
    },
    codeRankedUseful: {
      old: { hits: 0, total: args.cases },
      new: { hits: args.ranked, total: args.cases },
    },
    supportClusterUseful: {
      old: { hits: 0, total: args.cases },
      new: { hits: args.robust, total: args.cases },
    },
    oldSummary: {
      caseCount: args.cases,
      rows: [],
      totalSrc: args.supportTotal,
      totalSrcOverlap: 0,
      totalDoc: 0,
      totalDocOverlap: 0,
      codeCaseCount: args.cases,
      topCodeAcceptableCount: 0,
      rankedCodeUsefulCount: 0,
      supportClusterUsefulCount: 0,
      rankedCodeFileOverlap: { mentioned: 0, total: args.supportTotal },
      bodyMentionOnlyFileOverlap: { mentioned: 0, total: args.supportTotal },
      supportClusterFileOverlap: { mentioned: 0, total: args.supportTotal },
      promptVariantSummary: {
        promptCount: args.prompts,
        promptTop1Acceptable: 0,
        promptTop3Useful: 0,
        promptRankedUseful: 0,
        promptSupportUseful: 0,
        promptRankedCodeFileHits: 0,
        promptRankedCodeFileTotal: args.supportTotal,
        ticketsWithPromptVariants: args.cases,
        ticketsTop1Robust: 0,
        ticketsTop3Robust: 0,
        ticketsRankedRobust: 0,
      },
    },
    newSummary: {
      caseCount: args.cases,
      rows: [],
      totalSrc: args.supportTotal,
      totalSrcOverlap: args.supportHits,
      totalDoc: 0,
      totalDocOverlap: 0,
      codeCaseCount: args.cases,
      topCodeAcceptableCount: args.robust,
      rankedCodeUsefulCount: args.ranked,
      supportClusterUsefulCount: args.robust,
      rankedCodeFileOverlap: {
        mentioned: args.supportHits,
        total: args.supportTotal,
      },
      bodyMentionOnlyFileOverlap: { mentioned: 0, total: args.supportTotal },
      supportClusterFileOverlap: {
        mentioned: args.supportHits,
        total: args.supportTotal,
      },
      promptVariantSummary: {
        promptCount: args.prompts,
        promptTop1Acceptable: args.top3,
        promptTop3Useful: args.top3,
        promptRankedUseful: args.rankedPrompts ?? args.ranked,
        promptSupportUseful: args.robust,
        promptRankedCodeFileHits: args.supportHits,
        promptRankedCodeFileTotal: args.supportTotal,
        ticketsWithPromptVariants: args.cases,
        ticketsTop1Robust: args.robust,
        ticketsTop3Robust: args.robust,
        ticketsRankedRobust: args.ranked,
      },
    },
    rows: [],
  };
}

describe("runOssCodeLaneGeneralizationEval", () => {
  it("fails certification when the repo panel is too small or homogeneous", async () => {
    const report = await runOssCodeLaneGeneralizationEval({
      policy: SMALL_POLICY,
      repos: [
        repo({
          id: "alpha",
          language: "TypeScript",
          projectShape: "cli",
          changeTypes: ["parser", "storage"],
        }),
        repo({
          id: "beta",
          language: "TypeScript",
          projectShape: "cli",
          changeTypes: ["parser"],
        }),
      ],
      runComparison: async () =>
        comparison({
          cases: 1,
          prompts: 3,
          top3: 3,
          robust: 1,
          ranked: 1,
          supportHits: 3,
          supportTotal: 3,
        }),
    });

    expect(report.manifest).toMatchObject({
      repoCount: 2,
      caseCount: 3,
      promptVariantCount: 9,
      languages: ["TypeScript"],
      projectShapes: ["cli"],
      changeTypes: ["parser", "storage"],
    });
    expect(report.verdict.pass).toBe(false);
    expect(report.verdict.failedGates).toEqual(
      expect.arrayContaining([
        "repo_count_floor",
        "case_count_floor",
        "prompt_variant_floor",
        "language_diversity_floor",
        "project_shape_diversity_floor",
        "change_type_diversity_floor",
      ]),
    );
  });

  it("uses 99% lower confidence bounds instead of trusting tiny perfect samples", async () => {
    const report = await runOssCodeLaneGeneralizationEval({
      policy: {
        ...SMALL_POLICY,
        minRepos: 1,
        minCases: 1,
        minPromptVariants: 3,
        minLanguages: 1,
        minProjectShapes: 1,
        minChangeTypes: 1,
      },
      repos: [
        repo({
          id: "tiny",
          language: "TypeScript",
          projectShape: "cli",
          changeTypes: ["parser"],
        }),
      ],
      runComparison: async () =>
        comparison({
          cases: 1,
          prompts: 3,
          top3: 3,
          robust: 1,
          ranked: 1,
          supportHits: 3,
          supportTotal: 3,
        }),
    });

    expect(report.aggregate.promptTop3.rate).toBe(1);
    expect(report.aggregate.promptTop3.lowerConfidenceBound).toBeLessThan(
      SMALL_POLICY.promptTop3LowerBoundFloor,
    );
    expect(report.verdict.failedGates).toContain(
      "prompt_top3_confidence_floor",
    );
  });

  it("can expand each OSS case into a larger prompt-robustness panel before scoring", async () => {
    const seenPromptCounts: number[] = [];
    const report = await runOssCodeLaneGeneralizationEval({
      policy: {
        ...SMALL_POLICY,
        minRepos: 1,
        minCases: 2,
        minPromptVariants: 20,
        minLanguages: 1,
        minProjectShapes: 1,
        minChangeTypes: 1,
      },
      targetPromptVariantsPerCase: 10,
      repos: [
        repo({
          id: "expanded",
          language: "TypeScript",
          projectShape: "cli",
          changeTypes: ["parser", "storage"],
        }),
      ],
      runComparison: async (validationRepo) => {
        seenPromptCounts.push(
          validationRepo.agentCompletionCases.reduce(
            (sum, testCase) => sum + testCase.queries.length,
            0,
          ),
        );
        return comparison({
          cases: 2,
          prompts: 20,
          top3: 20,
          robust: 2,
          ranked: 2,
          rankedPrompts: 20,
          supportHits: 6,
          supportTotal: 6,
        });
      },
    });

    expect(seenPromptCounts).toEqual([20]);
    expect(report.manifest.promptVariantCount).toBe(20);
    expect(report.manifest.caseCount).toBe(2);
  });

  it("passes certification when a large diverse panel clears every lower-bound gate", async () => {
    const report = await runOssCodeLaneGeneralizationEval({
      policy: {
        ...SMALL_POLICY,
        minRepos: 3,
        minCases: 600,
        minPromptVariants: 3000,
        minLanguages: 3,
        minProjectShapes: 3,
        minChangeTypes: 4,
      },
      repos: [
        largeRepo({
          id: "alpha",
          language: "TypeScript",
          projectShape: "cli",
          caseCount: 200,
          queryCount: 5,
          changeTypes: ["parser", "storage", "workflow", "ranking"],
        }),
        largeRepo({
          id: "beta",
          language: "Python",
          projectShape: "web-service",
          caseCount: 200,
          queryCount: 5,
          changeTypes: ["parser", "storage", "workflow", "ranking"],
        }),
        largeRepo({
          id: "gamma",
          language: "Go",
          projectShape: "library",
          caseCount: 200,
          queryCount: 5,
          changeTypes: ["parser", "storage", "workflow", "ranking"],
        }),
      ],
      runComparison: async () =>
        comparison({
          cases: 200,
          prompts: 1000,
          top3: 900,
          robust: 160,
          ranked: 200,
          rankedPrompts: 1000,
          supportHits: 150,
          supportTotal: 200,
        }),
    });

    expect(report.manifest).toMatchObject({
      repoCount: 3,
      caseCount: 600,
      promptVariantCount: 3000,
      languages: ["Go", "Python", "TypeScript"],
      projectShapes: ["cli", "library", "web-service"],
      changeTypes: ["parser", "ranking", "storage", "workflow"],
    });
    expect(report.aggregate.promptTop3.lowerConfidenceBound).toBeGreaterThan(
      0.75,
    );
    expect(report.verdict).toMatchObject({
      pass: true,
      failedGates: [],
    });
  });

  it("renders a certification report with corpus breadth, confidence metrics, and gates", async () => {
    const report = await runOssCodeLaneGeneralizationEval({
      policy: SMALL_POLICY,
      repos: [
        repo({
          id: "alpha",
          language: "TypeScript",
          projectShape: "cli",
          changeTypes: ["parser", "storage"],
        }),
      ],
      runComparison: async () =>
        comparison({
          cases: 2,
          prompts: 6,
          top3: 5,
          robust: 1,
          ranked: 2,
          rankedPrompts: 6,
          supportHits: 3,
          supportTotal: 4,
        }),
    });

    const rendered = renderOssCodeLaneGeneralizationReport(report);

    expect(rendered).toContain("OSS CODE-LANE GENERALIZATION EVAL");
    expect(rendered).toContain("Outcome: FAIL");
    expect(rendered).toContain("Confidence: 99%");
    expect(rendered).toContain("Repos: 1");
    expect(rendered).toContain("Languages: TypeScript");
    expect(rendered).toContain("prompt top-3");
    expect(rendered).toContain("lower99%");
    expect(rendered).toContain("repo_count_floor");
    expect(rendered).toContain("Repo: alpha");
  });

  it("renders diagnostic sections for relaxed smoke runs and OSS miss triage", async () => {
    const report = await runOssCodeLaneGeneralizationEval({
      policy: {
        ...SMALL_POLICY,
        minRepos: 1,
        minCases: 1,
        minPromptVariants: 3,
        minLanguages: 1,
        minProjectShapes: 1,
        minChangeTypes: 1,
        promptTop3LowerBoundFloor: 0,
        ticketTop3RobustLowerBoundFloor: 0,
        rankedUsefulLowerBoundFloor: 0,
        supportFileHitLowerBoundFloor: 0,
      },
      repos: [
        repo({
          id: "alpha",
          language: "TypeScript",
          projectShape: "monorepo",
          changeTypes: ["runtime"],
        }),
      ],
      runComparison: async () => {
        const base = comparison({
          cases: 1,
          prompts: 3,
          top3: 0,
          robust: 0,
          ranked: 1,
          rankedPrompts: 1,
          supportHits: 0,
          supportTotal: 2,
        });
        return {
          ...base,
          newSummary: {
            ...base.newSummary,
            rows: [
              {
                ticket: "alpha-runtime",
                commit: "abc1234",
                changedFiles: ["packages/core/src/missing.ts", "packages/core/src/helper.ts"],
                mentionedFiles: [],
                srcOverlap: 0,
                srcTotal: 2,
                docOverlap: 0,
                docTotal: 0,
                topCodeFiles: ["packages/core/src/decoy.ts"],
                topThreeCodeFiles: ["packages/core/src/decoy.ts"],
                topThreeCodeChangedFiles: [],
                rankedCodeFiles: [
                  "packages/core/src/decoy.ts",
                  "packages/core/src/missing.ts",
                ],
                rankedCodeChangedFiles: ["packages/core/src/missing.ts"],
                supportClusterFiles: [],
                supportClusterChangedFiles: [],
                topCodeAcceptable: false,
                rankedCodeUseful: true,
                supportClusterUseful: false,
                promptVariants: [
                  {
                    query: "runtime implementation",
                    mentionedFiles: [],
                    topCodeFiles: ["packages/core/src/decoy.ts"],
                    topThreeCodeFiles: ["packages/core/src/decoy.ts"],
                    topThreeCodeChangedFiles: [],
                    rankedCodeFiles: ["packages/core/src/decoy.ts"],
                    rankedCodeChangedFiles: [],
                    supportClusterFiles: [],
                    supportClusterChangedFiles: [],
                    srcOverlap: 0,
                    topCodeAcceptable: false,
                    topThreeCodeUseful: false,
                    rankedCodeUseful: false,
                    supportClusterUseful: false,
                    candidateRecall: [
                      {
                        depth: 30,
                        codeFiles: ["packages/core/src/decoy.ts"],
                        changedFiles: [],
                        fileHits: 0,
                        fileTotal: 2,
                        useful: false,
                      },
                      {
                        depth: 100,
                        codeFiles: [
                          "packages/core/src/decoy.ts",
                          "packages/core/src/missing.ts",
                        ],
                        changedFiles: ["packages/core/src/missing.ts"],
                        fileHits: 1,
                        fileTotal: 2,
                        useful: true,
                      },
                    ],
                  },
                  {
                    query: "missing helper",
                    mentionedFiles: [],
                    topCodeFiles: ["packages/core/src/decoy.ts"],
                    topThreeCodeFiles: ["packages/core/src/decoy.ts"],
                    topThreeCodeChangedFiles: [],
                    rankedCodeFiles: ["packages/core/src/missing.ts"],
                    rankedCodeChangedFiles: ["packages/core/src/missing.ts"],
                    supportClusterFiles: [],
                    supportClusterChangedFiles: [],
                    srcOverlap: 0,
                    topCodeAcceptable: false,
                    topThreeCodeUseful: false,
                    rankedCodeUseful: true,
                    supportClusterUseful: false,
                  },
                  {
                    query: "changed source path",
                    mentionedFiles: [],
                    topCodeFiles: ["packages/core/src/decoy.ts"],
                    topThreeCodeFiles: ["packages/core/src/decoy.ts"],
                    topThreeCodeChangedFiles: [],
                    rankedCodeFiles: ["packages/core/src/helper.ts"],
                    rankedCodeChangedFiles: ["packages/core/src/helper.ts"],
                    supportClusterFiles: [],
                    supportClusterChangedFiles: [],
                    srcOverlap: 0,
                    topCodeAcceptable: false,
                    topThreeCodeUseful: false,
                    rankedCodeUseful: true,
                    supportClusterUseful: false,
                  },
                ],
              },
            ],
            missShapeSummary: {
              caseBuckets: {
                top1_hit: 0,
                top3_hit_top1_miss: 0,
                ranked_hit_top3_miss: 1,
                ranked_miss_body_only: 0,
                ranked_miss: 0,
              },
              fileBuckets: {
                rankedHits: 1,
                topThreeHits: 0,
                supportHits: 0,
                bodyOnlyHits: 0,
                missingFromRanked: 1,
                totalSrc: 2,
              },
            supportBuckets: {
              useful: 0,
              couldPromoteTop1Miss: 0,
              missingWhenTop1Missed: 1,
            },
          },
            candidateRecallSummary: {
              depths: [
                {
                  depth: 100,
                  promptUseful: 1,
                  promptCount: 1,
                  fileHits: 1,
                  fileTotal: 2,
                },
              ],
              methodFamilies: [
                {
                  depth: 100,
                  family: "repo_family",
                  promptUseful: 1,
                  promptCount: 1,
                  fileHits: 1,
                  fileTotal: 2,
                },
              ],
              diagnostics: {
                usefulShadowFiles: 1,
                usefulAdmittedFiles: 1,
                uselessAdmittedFiles: 2,
                usefulBuriedFiles: 1,
                topThreeUselessFiles: 1,
              },
            },
          },
        };
      },
    });

    const rendered = renderOssCodeLaneGeneralizationReport(report);

    expect(rendered).toContain("Metric floors: RELAXED");
    expect(rendered).toContain("Weakest repos:");
    expect(rendered).toContain("alpha: top3=0/3");
    expect(rendered).toContain("Miss taxonomy:");
    expect(rendered).toContain("ranked_hit_top3_miss: 1");
    expect(rendered).toContain("Target diagnostics:");
    expect(rendered).toContain("Diagnostic slices:");
    expect(rendered).toContain("recall@100=1/1");
    expect(rendered).toContain("Method-family recall:");
    expect(rendered).toContain("repo_family@100");
    expect(rendered).toContain("Candidate diagnostics:");
    expect(rendered).toContain("useful_shadow_files: 1");
    expect(rendered).toContain("Representative misses:");
    expect(rendered).toContain("packages/core/src/missing.ts");
  });
});

describe("parseOssCodeLaneManifest", () => {
  it("loads a frozen OSS manifest and rejects cases without change-type labels", () => {
    const parsed = parseOssCodeLaneManifest({
      repos: [
        {
          id: "chalk",
          name: "chalk",
          repoRoot: "/repos/chalk",
          primaryLanguage: "TypeScript",
          projectShape: "library",
          minimumTaskPanel: ["chalk-123"],
          whyRealistic: "popular OSS library",
          whyUnfamiliar: "not a local training repo",
          accessAssumptions: ["local checkout exists"],
          agentCompletionCases: [
            {
              ticket: "chalk-123",
              commit_sha: "abc123",
              queries: ["add color parser"],
              changeType: "parser",
            },
          ],
        },
      ],
    });

    expect(parsed.repos[0]).toMatchObject({
      id: "chalk",
      primaryLanguage: "TypeScript",
      projectShape: "library",
    });
    expect(parsed.repos[0]?.agentCompletionCases[0]).toMatchObject({
      ticket: "chalk-123",
      changeType: "parser",
    });

    expect(() =>
      parseOssCodeLaneManifest({
        repos: [
          {
            id: "broken",
            name: "broken",
            repoRoot: "/repos/broken",
            primaryLanguage: "TypeScript",
            projectShape: "library",
            minimumTaskPanel: ["broken-1"],
            whyRealistic: "fixture",
            whyUnfamiliar: "fixture",
            accessAssumptions: ["fixture"],
            agentCompletionCases: [
              {
                ticket: "broken-1",
                commit_sha: "def456",
                queries: ["missing label"],
              },
            ],
          },
        ],
      }),
    ).toThrow(/changeType/);
  });

  it("allows frozen manifests to override certification policy thresholds", () => {
    const parsed = parseOssCodeLaneManifest({
      policy: {
        minRepos: 2,
        promptTop3LowerBoundFloor: 0.8,
      },
      repos: [],
    });

    expect(parsed.policy).toMatchObject({
      confidence: 0.99,
      minRepos: 2,
      minCases: 600,
      promptTop3LowerBoundFloor: 0.8,
    });
  });
});
