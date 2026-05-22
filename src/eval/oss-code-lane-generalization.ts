#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import {
  runPairedCodeLaneComparisonForRepo,
  type PairedCodeLaneComparison,
} from "./code-lane-comparison.js";
import type {
  AgentCompletionCandidateNoiseAutopsySummary,
  AgentCompletionCandidateRecallSummary,
  AgentCompletionCase,
  AgentCompletionDetailedRow,
  AgentCompletionCandidateNoiseAutopsyRow,
  AgentCompletionPromptVariantRow,
  AgentCompletionTargetFileAutopsyRow,
  AgentCompletionTargetFileAutopsySummary,
} from "./agent-completion-probe.js";
import { expandAgentCompletionPromptPanel } from "./prompt-panel-expansion.js";
import {
  classifyOssCodeLaneTargetFile,
  type OssCodeLaneTargetBucket,
} from "./oss-code-lane-targets.js";
import type { CodeCandidateEvidenceFamily } from "../retrieve/code-candidate-evidence.js";

export type OssCodeLaneCase = AgentCompletionCase & {
  changeType: string;
};

export type OssCodeLaneValidationRepo = {
  id: string;
  name: string;
  repoRoot: string;
  primaryLanguage: string;
  projectShape: string;
  minimumTaskPanel: string[];
  whyRealistic: string;
  whyUnfamiliar: string;
  accessAssumptions: string[];
  agentCompletionCases: OssCodeLaneCase[];
};

export type OssCodeLaneGeneralizationPolicy = {
  confidence: 0.99 | 0.95 | number;
  minRepos: number;
  minCases: number;
  minPromptVariants: number;
  minLanguages: number;
  minProjectShapes: number;
  minChangeTypes: number;
  promptTop3LowerBoundFloor: number;
  ticketTop3RobustLowerBoundFloor: number;
  rankedUsefulLowerBoundFloor: number;
  supportFileHitLowerBoundFloor: number;
};

export const DEFAULT_OSS_CODE_LANE_GENERALIZATION_POLICY: OssCodeLaneGeneralizationPolicy = {
  confidence: 0.99,
  minRepos: 30,
  minCases: 600,
  minPromptVariants: 2000,
  minLanguages: 5,
  minProjectShapes: 5,
  minChangeTypes: 6,
  promptTop3LowerBoundFloor: 0.75,
  ticketTop3RobustLowerBoundFloor: 0.7,
  rankedUsefulLowerBoundFloor: 0.95,
  supportFileHitLowerBoundFloor: 0.5,
};

export type OssCodeLaneManifestSummary = {
  repoCount: number;
  caseCount: number;
  promptVariantCount: number;
  languages: string[];
  projectShapes: string[];
  changeTypes: string[];
};

export type OssCodeLaneGeneralizationMetric = {
  hits: number;
  total: number;
  rate: number;
  lowerConfidenceBound: number;
};

export type OssCodeLaneGeneralizationAggregate = {
  promptTop3: OssCodeLaneGeneralizationMetric;
  ticketsTop3Robust: OssCodeLaneGeneralizationMetric;
  rankedUseful: OssCodeLaneGeneralizationMetric;
  supportFileHits: OssCodeLaneGeneralizationMetric;
  candidateRecall?: AgentCompletionCandidateRecallSummary;
  targetFileAutopsy?: AgentCompletionTargetFileAutopsySummary;
  candidateNoiseAutopsy?: AgentCompletionCandidateNoiseAutopsySummary;
};

export type OssCodeLaneGeneralizationGateName =
  | "repo_count_floor"
  | "case_count_floor"
  | "prompt_variant_floor"
  | "language_diversity_floor"
  | "project_shape_diversity_floor"
  | "change_type_diversity_floor"
  | "prompt_top3_confidence_floor"
  | "ticket_top3_robust_confidence_floor"
  | "ranked_useful_confidence_floor"
  | "support_file_hit_confidence_floor";

export type OssCodeLaneGeneralizationGate = {
  name: OssCodeLaneGeneralizationGateName;
  pass: boolean;
  current: string;
  required: string;
  detail: string;
};

export type OssCodeLaneGeneralizationVerdict = {
  pass: boolean;
  failedGates: OssCodeLaneGeneralizationGateName[];
  gates: OssCodeLaneGeneralizationGate[];
};

export type OssCodeLaneGeneralizationRepoResult = {
  repo: Pick<
    OssCodeLaneValidationRepo,
    | "id"
    | "name"
    | "repoRoot"
    | "primaryLanguage"
    | "projectShape"
    | "minimumTaskPanel"
    | "agentCompletionCases"
  >;
  comparison: PairedCodeLaneComparison;
};

export type OssCodeLaneGeneralizationReport = {
  policy: OssCodeLaneGeneralizationPolicy;
  manifest: OssCodeLaneManifestSummary;
  aggregate: OssCodeLaneGeneralizationAggregate;
  verdict: OssCodeLaneGeneralizationVerdict;
  repos: OssCodeLaneGeneralizationRepoResult[];
};

export type OssCodeLaneObservabilityRow =
  | ({
      kind: "target_file";
      repoId: string;
      repoName: string;
      repoRoot: string;
      language: string;
      projectShape: string;
      changeType: string;
      ticket: string;
      commit: string;
      promptIndex: number;
    } & AgentCompletionTargetFileAutopsyRow)
  | ({
      kind: "noise_candidate";
      repoId: string;
      repoName: string;
      repoRoot: string;
      language: string;
      projectShape: string;
      changeType: string;
      ticket: string;
      commit: string;
      promptIndex: number;
    } & AgentCompletionCandidateNoiseAutopsyRow)
  | {
      kind: "method_delta";
      repoId: string;
      repoName: string;
      repoRoot: string;
      language: string;
      projectShape: string;
      deltaKind:
        | "ranked_gain"
        | "ranked_loss"
        | "top3_gain"
        | "top3_loss"
        | "support_gain"
        | "support_loss";
      ticket: string;
      commit: string;
      file: string;
    };

export type RunOssCodeLaneGeneralizationOptions = {
  repos: readonly OssCodeLaneValidationRepo[];
  policy?: OssCodeLaneGeneralizationPolicy;
  budgetTokensOverride?: number;
  candidateRecallDepths?: number[];
  targetPromptVariantsPerCase?: number;
  runComparison?: (
    repo: OssCodeLaneValidationRepo,
    options: {
      budgetTokensOverride?: number;
      candidateRecallDepths?: number[];
    },
  ) => Promise<PairedCodeLaneComparison>;
};

export type ParsedOssCodeLaneManifest = {
  repos: OssCodeLaneValidationRepo[];
  policy?: OssCodeLaneGeneralizationPolicy;
};

const DEFAULT_CANDIDATE_RECALL_DEPTHS = [10, 30, 100] as const;

export function parseOssCodeLaneManifest(
  raw: unknown,
): ParsedOssCodeLaneManifest {
  const manifest = objectAt(raw, "manifest");
  const rawRepos = arrayAt(manifest.repos, "repos");
  const repos = rawRepos.map((rawRepo, repoIndex) => {
    const repo = objectAt(rawRepo, `repos[${repoIndex}]`);
    const rawCases = arrayAt(
      repo.agentCompletionCases,
      `repos[${repoIndex}].agentCompletionCases`,
    );
    return {
      id: stringAt(repo.id, `repos[${repoIndex}].id`),
      name: stringAt(repo.name, `repos[${repoIndex}].name`),
      repoRoot: stringAt(repo.repoRoot, `repos[${repoIndex}].repoRoot`),
      primaryLanguage: stringAt(
        repo.primaryLanguage,
        `repos[${repoIndex}].primaryLanguage`,
      ),
      projectShape: stringAt(
        repo.projectShape,
        `repos[${repoIndex}].projectShape`,
      ),
      minimumTaskPanel: stringArrayAt(
        repo.minimumTaskPanel,
        `repos[${repoIndex}].minimumTaskPanel`,
      ),
      whyRealistic: stringAt(
        repo.whyRealistic,
        `repos[${repoIndex}].whyRealistic`,
      ),
      whyUnfamiliar: stringAt(
        repo.whyUnfamiliar,
        `repos[${repoIndex}].whyUnfamiliar`,
      ),
      accessAssumptions: stringArrayAt(
        repo.accessAssumptions,
        `repos[${repoIndex}].accessAssumptions`,
      ),
      agentCompletionCases: rawCases.map((rawCase, caseIndex) => {
        const testCase = objectAt(
          rawCase,
          `repos[${repoIndex}].agentCompletionCases[${caseIndex}]`,
        );
        return {
          ticket: stringAt(
            testCase.ticket,
            `repos[${repoIndex}].agentCompletionCases[${caseIndex}].ticket`,
          ),
          commit_sha: stringAt(
            testCase.commit_sha,
            `repos[${repoIndex}].agentCompletionCases[${caseIndex}].commit_sha`,
          ),
          queries: stringArrayAt(
            testCase.queries,
            `repos[${repoIndex}].agentCompletionCases[${caseIndex}].queries`,
          ),
          changeType: stringAt(
            testCase.changeType,
            `repos[${repoIndex}].agentCompletionCases[${caseIndex}].changeType`,
          ),
          ...(testCase.ignore === undefined
            ? {}
            : {
                ignore: stringArrayAt(
                  testCase.ignore,
                  `repos[${repoIndex}].agentCompletionCases[${caseIndex}].ignore`,
                ),
              }),
        };
      }),
    };
  });
  return {
    repos,
    ...(manifest.policy === undefined
      ? {}
      : { policy: parsePolicy(manifest.policy) }),
  };
}

export async function runOssCodeLaneGeneralizationEval(
  options: RunOssCodeLaneGeneralizationOptions,
): Promise<OssCodeLaneGeneralizationReport> {
  const policy =
    options.policy ?? DEFAULT_OSS_CODE_LANE_GENERALIZATION_POLICY;
  const evaluationRepos = expandOssReposForPromptVariants(
    options.repos,
    options.targetPromptVariantsPerCase,
  );
  const runComparison =
    options.runComparison ??
    ((repo, comparisonOptions) =>
      runPairedCodeLaneComparisonForRepo({
        repoRoot: repo.repoRoot,
        cases: repo.agentCompletionCases,
        budgetTokensOverride: comparisonOptions.budgetTokensOverride,
        sourceFilePolicy: "oss-code-lane",
        candidateRecallDepths: comparisonOptions.candidateRecallDepths,
      }));
  const candidateRecallDepths =
    options.candidateRecallDepths ?? [...DEFAULT_CANDIDATE_RECALL_DEPTHS];

  const repos: OssCodeLaneGeneralizationRepoResult[] = [];
  for (const repo of evaluationRepos) {
    repos.push({
      repo: {
        id: repo.id,
        name: repo.name,
        repoRoot: repo.repoRoot,
        primaryLanguage: repo.primaryLanguage,
        projectShape: repo.projectShape,
        minimumTaskPanel: repo.minimumTaskPanel,
        agentCompletionCases: repo.agentCompletionCases,
      },
      comparison: await runComparison(repo, {
        budgetTokensOverride: options.budgetTokensOverride,
        candidateRecallDepths,
      }),
    });
  }

  const manifest = summarizeOssCodeLaneManifest(evaluationRepos);
  const aggregate = summarizeOssCodeLaneMetrics(repos, policy.confidence);
  const verdict = evaluateOssCodeLaneGeneralization({
    policy,
    manifest,
    aggregate,
  });

  return {
    policy,
    manifest,
    aggregate,
    verdict,
    repos,
  };
}

function expandOssReposForPromptVariants(
  repos: readonly OssCodeLaneValidationRepo[],
  targetPromptVariantsPerCase: number | undefined,
): OssCodeLaneValidationRepo[] {
  if (targetPromptVariantsPerCase === undefined) {
    return repos.map((repo) => ({
      ...repo,
      agentCompletionCases: [...repo.agentCompletionCases],
    }));
  }
  return repos.map((repo) => ({
    ...repo,
    agentCompletionCases: expandAgentCompletionPromptPanel(
      repo.agentCompletionCases,
      { targetPromptVariantsPerCase },
    ),
  }));
}

export function summarizeOssCodeLaneManifest(
  repos: readonly OssCodeLaneValidationRepo[],
): OssCodeLaneManifestSummary {
  return {
    repoCount: repos.length,
    caseCount: repos.reduce(
      (sum, repo) => sum + repo.agentCompletionCases.length,
      0,
    ),
    promptVariantCount: repos.reduce(
      (sum, repo) =>
        sum +
        repo.agentCompletionCases.reduce(
          (caseSum, testCase) => caseSum + testCase.queries.length,
          0,
        ),
      0,
    ),
    languages: uniqueSorted(repos.map((repo) => repo.primaryLanguage)),
    projectShapes: uniqueSorted(repos.map((repo) => repo.projectShape)),
    changeTypes: uniqueSorted(
      repos.flatMap((repo) =>
        repo.agentCompletionCases.map((testCase) => testCase.changeType),
      ),
    ),
  };
}

export function summarizeOssCodeLaneMetrics(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
  confidence: number,
): OssCodeLaneGeneralizationAggregate {
  const promptTop3 = sumPromptMetric(
    repos,
    "promptTop3Useful",
    "promptCount",
  );
  const ticketsTop3Robust = sumPromptMetric(
    repos,
    "ticketsTop3Robust",
    "ticketsWithPromptVariants",
  );
  const rankedUseful = sumPromptMetric(
    repos,
    "promptRankedUseful",
    "promptCount",
  );
  const supportFileHits = repos.reduce(
    (sum, repo) => ({
      hits:
        sum.hits +
        repo.comparison.newSummary.supportClusterFileOverlap.mentioned,
      total:
        sum.total + repo.comparison.newSummary.supportClusterFileOverlap.total,
    }),
    { hits: 0, total: 0 },
  );

  return {
    promptTop3: metric(promptTop3.hits, promptTop3.total, confidence),
    ticketsTop3Robust: metric(
      ticketsTop3Robust.hits,
      ticketsTop3Robust.total,
      confidence,
    ),
    rankedUseful: metric(rankedUseful.hits, rankedUseful.total, confidence),
    supportFileHits: metric(
      supportFileHits.hits,
      supportFileHits.total,
      confidence,
    ),
    ...candidateRecallAggregate(repos),
    ...targetFileAutopsyAggregate(repos),
    ...candidateNoiseAutopsyAggregate(repos),
  };
}

function candidateRecallAggregate(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
): Pick<OssCodeLaneGeneralizationAggregate, "candidateRecall"> {
  const depths = new Map<
    number,
    {
      promptUseful: number;
      promptCount: number;
      fileHits: number;
      fileTotal: number;
    }
  >();
  const methodFamilies = new Map<
    string,
    {
      depth: number;
      family: CodeCandidateEvidenceFamily;
      promptUseful: number;
      promptCount: number;
      fileHits: number;
      fileTotal: number;
    }
  >();
  const diagnostics = {
    usefulShadowFiles: 0,
    usefulAdmittedFiles: 0,
    uselessAdmittedFiles: 0,
    usefulBuriedFiles: 0,
    topThreeUselessFiles: 0,
  };
  for (const repo of repos) {
    const recallSummary = repo.comparison.newSummary.candidateRecallSummary;
    for (const depth of recallSummary?.depths ?? []) {
      const current = depths.get(depth.depth) ?? {
        promptUseful: 0,
        promptCount: 0,
        fileHits: 0,
        fileTotal: 0,
      };
      current.promptUseful += depth.promptUseful;
      current.promptCount += depth.promptCount;
      current.fileHits += depth.fileHits;
      current.fileTotal += depth.fileTotal;
      depths.set(depth.depth, current);
    }
    for (const family of recallSummary?.methodFamilies ?? []) {
      const key = `${family.depth}:${family.family}`;
      const current = methodFamilies.get(key) ?? {
        depth: family.depth,
        family: family.family,
        promptUseful: 0,
        promptCount: 0,
        fileHits: 0,
        fileTotal: 0,
      };
      current.promptUseful += family.promptUseful;
      current.promptCount += family.promptCount;
      current.fileHits += family.fileHits;
      current.fileTotal += family.fileTotal;
      methodFamilies.set(key, current);
    }
    if (recallSummary?.diagnostics) {
      diagnostics.usefulShadowFiles += recallSummary.diagnostics.usefulShadowFiles;
      diagnostics.usefulAdmittedFiles += recallSummary.diagnostics.usefulAdmittedFiles;
      diagnostics.uselessAdmittedFiles += recallSummary.diagnostics.uselessAdmittedFiles;
      diagnostics.usefulBuriedFiles += recallSummary.diagnostics.usefulBuriedFiles;
      diagnostics.topThreeUselessFiles += recallSummary.diagnostics.topThreeUselessFiles;
    }
  }
  if (depths.size === 0 && methodFamilies.size === 0) return {};
  const diagnosticsTotal =
    diagnostics.usefulShadowFiles +
    diagnostics.usefulAdmittedFiles +
    diagnostics.uselessAdmittedFiles +
    diagnostics.usefulBuriedFiles +
    diagnostics.topThreeUselessFiles;
  return {
    candidateRecall: {
      depths: [...depths.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([depth, value]) => ({ depth, ...value })),
      ...(methodFamilies.size > 0
        ? {
            methodFamilies: [...methodFamilies.values()].sort(
              (a, b) => a.depth - b.depth || String(a.family).localeCompare(String(b.family)),
            ),
          }
        : {}),
      ...(diagnosticsTotal > 0 ? { diagnostics } : {}),
    },
  };
}

function targetFileAutopsyAggregate(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
): Pick<OssCodeLaneGeneralizationAggregate, "targetFileAutopsy"> {
  const summaries = repos
    .map((repo) => repo.comparison.newSummary.targetFileAutopsySummary)
    .filter(
      (summary): summary is AgentCompletionTargetFileAutopsySummary =>
        summary !== undefined,
    );
  if (summaries.length === 0) return {};

  const outcomeCounts = new Map<string, number>();
  const relationCounts = new Map<string, number>();
  const ownerCandidateRelationCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const summary = summaries.reduce(
    (acc, current) => {
      acc.observations += current.observations;
      acc.indexed += current.indexed;
      acc.withChunks += current.withChunks;
      acc.packTopThreeHits += current.packTopThreeHits;
      acc.packRankedHits += current.packRankedHits;
      acc.candidateTopTenHits += current.candidateTopTenHits;
      acc.candidateTopThirtyHits += current.candidateTopThirtyHits;
      acc.candidateTopHundredHits += current.candidateTopHundredHits;
      acc.queryObvious.path += current.queryObvious.path;
      acc.queryObvious.symbol += current.queryObvious.symbol;
      acc.queryObvious.purpose += current.queryObvious.purpose;
      acc.queryObvious.noFactOverlap += current.queryObvious.noFactOverlap;
      for (const bucket of current.outcomes) {
        outcomeCounts.set(
          bucket.outcome,
          (outcomeCounts.get(bucket.outcome) ?? 0) + bucket.count,
        );
      }
      for (const bucket of current.ownerRelations) {
        relationCounts.set(
          bucket.relation,
          (relationCounts.get(bucket.relation) ?? 0) + bucket.count,
        );
      }
      for (const bucket of current.ownerCandidateRelations ?? []) {
        ownerCandidateRelationCounts.set(
          bucket.relation,
          (ownerCandidateRelationCounts.get(bucket.relation) ?? 0) + bucket.count,
        );
      }
      for (const bucket of current.evidenceFamilies) {
        familyCounts.set(
          bucket.family,
          (familyCounts.get(bucket.family) ?? 0) + bucket.count,
        );
      }
      return acc;
    },
    {
      observations: 0,
      indexed: 0,
      withChunks: 0,
      packTopThreeHits: 0,
      packRankedHits: 0,
      candidateTopTenHits: 0,
      candidateTopThirtyHits: 0,
      candidateTopHundredHits: 0,
      queryObvious: {
        path: 0,
        symbol: 0,
        purpose: 0,
        noFactOverlap: 0,
      },
      outcomes: [],
      ownerRelations: [],
      ownerCandidateRelations: [],
      evidenceFamilies: [],
    } satisfies AgentCompletionTargetFileAutopsySummary,
  );

  return {
    targetFileAutopsy: {
      ...summary,
      outcomes: sortedCountEntries(outcomeCounts).map(([outcome, count]) => ({
        outcome: outcome as AgentCompletionTargetFileAutopsySummary["outcomes"][number]["outcome"],
        count,
      })),
      ownerRelations: sortedCountEntries(relationCounts).map(([relation, count]) => ({
        relation: relation as AgentCompletionTargetFileAutopsySummary["ownerRelations"][number]["relation"],
        count,
      })),
      ownerCandidateRelations: sortedCountEntries(ownerCandidateRelationCounts).map(([relation, count]) => ({
        relation: relation as AgentCompletionTargetFileAutopsySummary["ownerCandidateRelations"][number]["relation"],
        count,
      })),
      evidenceFamilies: sortedCountEntries(familyCounts).map(([family, count]) => ({
        family: family as AgentCompletionTargetFileAutopsySummary["evidenceFamilies"][number]["family"],
        count,
      })),
    },
  };
}

function candidateNoiseAutopsyAggregate(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
): Pick<OssCodeLaneGeneralizationAggregate, "candidateNoiseAutopsy"> {
  const summaries = repos
    .map((repo) => repo.comparison.newSummary.candidateNoiseAutopsySummary)
    .filter(
      (summary): summary is AgentCompletionCandidateNoiseAutopsySummary =>
        summary !== undefined,
    );
  if (summaries.length === 0) return {};

  const relationCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const summary = summaries.reduce(
    (acc, current) => {
      acc.observations += current.observations;
      acc.admitted += current.admitted;
      acc.shadow += current.shadow;
      acc.packRanked += current.packRanked;
      acc.candidateTopThree += current.candidateTopThree;
      acc.candidateTopTen += current.candidateTopTen;
      acc.candidateTopThirty += current.candidateTopThirty;
      acc.queryObvious.path += current.queryObvious.path;
      acc.queryObvious.symbol += current.queryObvious.symbol;
      acc.queryObvious.purpose += current.queryObvious.purpose;
      acc.queryObvious.noFactOverlap += current.queryObvious.noFactOverlap;
      for (const bucket of current.ownerRelations) {
        relationCounts.set(
          bucket.relation,
          (relationCounts.get(bucket.relation) ?? 0) + bucket.count,
        );
      }
      for (const bucket of current.evidenceFamilies) {
        familyCounts.set(
          bucket.family,
          (familyCounts.get(bucket.family) ?? 0) + bucket.count,
        );
      }
      return acc;
    },
    {
      observations: 0,
      admitted: 0,
      shadow: 0,
      packRanked: 0,
      candidateTopThree: 0,
      candidateTopTen: 0,
      candidateTopThirty: 0,
      queryObvious: {
        path: 0,
        symbol: 0,
        purpose: 0,
        noFactOverlap: 0,
      },
      ownerRelations: [],
      evidenceFamilies: [],
    } satisfies AgentCompletionCandidateNoiseAutopsySummary,
  );

  return {
    candidateNoiseAutopsy: {
      ...summary,
      ownerRelations: sortedCountEntries(relationCounts).map(([relation, count]) => ({
        relation: relation as AgentCompletionCandidateNoiseAutopsySummary["ownerRelations"][number]["relation"],
        count,
      })),
      evidenceFamilies: sortedCountEntries(familyCounts).map(([family, count]) => ({
        family: family as AgentCompletionCandidateNoiseAutopsySummary["evidenceFamilies"][number]["family"],
        count,
      })),
    },
  };
}

function sortedCountEntries(counts: ReadonlyMap<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function evaluateOssCodeLaneGeneralization(args: {
  policy: OssCodeLaneGeneralizationPolicy;
  manifest: OssCodeLaneManifestSummary;
  aggregate: OssCodeLaneGeneralizationAggregate;
}): OssCodeLaneGeneralizationVerdict {
  const { policy, manifest, aggregate } = args;
  const gates: OssCodeLaneGeneralizationGate[] = [
    countGate(
      "repo_count_floor",
      manifest.repoCount,
      policy.minRepos,
      "certification needs enough independent repositories",
    ),
    countGate(
      "case_count_floor",
      manifest.caseCount,
      policy.minCases,
      "certification needs enough commit-grounded PR/ticket cases",
    ),
    countGate(
      "prompt_variant_floor",
      manifest.promptVariantCount,
      policy.minPromptVariants,
      "certification needs enough prompt variants to resist wording overfit",
    ),
    countGate(
      "language_diversity_floor",
      manifest.languages.length,
      policy.minLanguages,
      "certification needs multi-language coverage",
    ),
    countGate(
      "project_shape_diversity_floor",
      manifest.projectShapes.length,
      policy.minProjectShapes,
      "certification needs multiple OSS project shapes",
    ),
    countGate(
      "change_type_diversity_floor",
      manifest.changeTypes.length,
      policy.minChangeTypes,
      "certification needs multiple implementation change families",
    ),
    confidenceGate(
      "prompt_top3_confidence_floor",
      aggregate.promptTop3,
      policy.promptTop3LowerBoundFloor,
      policy.confidence,
      "top-3 prompt usefulness must clear the floor at the requested confidence",
    ),
    confidenceGate(
      "ticket_top3_robust_confidence_floor",
      aggregate.ticketsTop3Robust,
      policy.ticketTop3RobustLowerBoundFloor,
      policy.confidence,
      "ticket robustness must survive prompt wording changes",
    ),
    confidenceGate(
      "ranked_useful_confidence_floor",
      aggregate.rankedUseful,
      policy.rankedUsefulLowerBoundFloor,
      policy.confidence,
      "the code lane must keep broad ranked recall very high",
    ),
    confidenceGate(
      "support_file_hit_confidence_floor",
      aggregate.supportFileHits,
      policy.supportFileHitLowerBoundFloor,
      policy.confidence,
      "support-file coverage must clear the exact-file floor",
    ),
  ];
  const failedGates = gates
    .filter((gate) => !gate.pass)
    .map((gate) => gate.name);
  return {
    pass: failedGates.length === 0,
    failedGates,
    gates,
  };
}

export function renderOssCodeLaneGeneralizationReport(
  report: OssCodeLaneGeneralizationReport,
): string {
  const lines: string[] = [];
  lines.push("========== OSS CODE-LANE GENERALIZATION EVAL ==========");
  lines.push(`Outcome: ${report.verdict.pass ? "PASS" : "FAIL"}`);
  lines.push(`Confidence: ${pct(report.policy.confidence)}`);
  if (hasRelaxedMetricFloors(report.policy)) {
    lines.push(
      "Metric floors: RELAXED -- useful for plumbing smoke only; not a certification verdict.",
    );
  }
  if (!report.verdict.pass) {
    lines.push(`Failed gates: ${report.verdict.failedGates.join(", ")}`);
  }
  lines.push("");
  lines.push("Corpus:");
  lines.push(`  Repos: ${report.manifest.repoCount}`);
  lines.push(`  Cases: ${report.manifest.caseCount}`);
  lines.push(`  Prompt variants: ${report.manifest.promptVariantCount}`);
  lines.push(`  Languages: ${joinOrNone(report.manifest.languages)}`);
  lines.push(`  Project shapes: ${joinOrNone(report.manifest.projectShapes)}`);
  lines.push(`  Change types: ${joinOrNone(report.manifest.changeTypes)}`);
  lines.push("");
  lines.push("Aggregate metrics:");
  lines.push(
    `  prompt top-3: ${renderMetric(report.aggregate.promptTop3, report.policy.confidence)}`,
  );
  lines.push(
    `  tickets top-3 robust: ${renderMetric(report.aggregate.ticketsTop3Robust, report.policy.confidence)}`,
  );
  lines.push(
    `  ranked useful: ${renderMetric(report.aggregate.rankedUseful, report.policy.confidence)}`,
  );
  lines.push(
    `  support file hits: ${renderMetric(report.aggregate.supportFileHits, report.policy.confidence)}`,
  );
  if (report.aggregate.candidateRecall) {
    lines.push("");
    lines.push("Candidate recall ceiling:");
    for (const depth of report.aggregate.candidateRecall.depths) {
      lines.push(
        `  recall@${depth.depth}: prompts ${depth.promptUseful}/${depth.promptCount} (${formatRate(depth.promptUseful / Math.max(depth.promptCount, 1))}), files ${depth.fileHits}/${depth.fileTotal} (${formatRate(depth.fileHits / Math.max(depth.fileTotal, 1))})`,
      );
    }
    if (report.aggregate.candidateRecall.methodFamilies) {
      lines.push("");
      lines.push("Method-family recall:");
      for (const family of report.aggregate.candidateRecall.methodFamilies) {
        lines.push(
          `  ${family.family}@${family.depth}: prompts ${family.promptUseful}/${family.promptCount} (${formatRate(family.promptUseful / Math.max(family.promptCount, 1))}), files ${family.fileHits}/${family.fileTotal} (${formatRate(family.fileHits / Math.max(family.fileTotal, 1))})`,
        );
      }
    }
    if (report.aggregate.candidateRecall.diagnostics) {
      const diagnostics = report.aggregate.candidateRecall.diagnostics;
      lines.push("");
      lines.push("Candidate diagnostics:");
      lines.push(`  useful_shadow_files: ${diagnostics.usefulShadowFiles}`);
      lines.push(`  useful_admitted_files: ${diagnostics.usefulAdmittedFiles}`);
      lines.push(`  useless_admitted_files: ${diagnostics.uselessAdmittedFiles}`);
      lines.push(`  useful_buried_files: ${diagnostics.usefulBuriedFiles}`);
      lines.push(`  top3_useless_files: ${diagnostics.topThreeUselessFiles}`);
    }
  }
  if (report.aggregate.targetFileAutopsy) {
    const autopsy = report.aggregate.targetFileAutopsy;
    lines.push("");
    lines.push("Target-file autopsy:");
    lines.push(
      `  observations: ${autopsy.observations}, indexed=${autopsy.indexed}, chunks=${autopsy.withChunks}`,
    );
    lines.push(
      `  pack hits: top3=${autopsy.packTopThreeHits}, ranked=${autopsy.packRankedHits}`,
    );
    lines.push(
      `  candidate hits: top10=${autopsy.candidateTopTenHits}, top30=${autopsy.candidateTopThirtyHits}, top100=${autopsy.candidateTopHundredHits}`,
    );
    lines.push(
      `  query-obvious: path=${autopsy.queryObvious.path}, symbol=${autopsy.queryObvious.symbol}, purpose=${autopsy.queryObvious.purpose}, no_fact_overlap=${autopsy.queryObvious.noFactOverlap}`,
    );
    lines.push(
      `  outcomes: ${formatNamedCounts(autopsy.outcomes, "outcome")}`,
    );
    lines.push(
      `  owner relations: ${formatNamedCounts(autopsy.ownerRelations, "relation")}`,
    );
    lines.push(
      `  owner candidate relations: ${formatNamedCounts(autopsy.ownerCandidateRelations, "relation")}`,
    );
    if (autopsy.evidenceFamilies.length > 0) {
      lines.push(
        `  evidence families: ${formatNamedCounts(autopsy.evidenceFamilies, "family")}`,
      );
    }
  }
  if (report.aggregate.candidateNoiseAutopsy) {
    const noise = report.aggregate.candidateNoiseAutopsy;
    lines.push("");
    lines.push("Candidate-noise autopsy:");
    lines.push(
      `  observations: ${noise.observations}, admitted=${noise.admitted}, shadow=${noise.shadow}, pack_ranked=${noise.packRanked}`,
    );
    lines.push(
      `  candidate depth: top3=${noise.candidateTopThree}, top10=${noise.candidateTopTen}, top30=${noise.candidateTopThirty}`,
    );
    lines.push(
      `  query-obvious: path=${noise.queryObvious.path}, symbol=${noise.queryObvious.symbol}, purpose=${noise.queryObvious.purpose}, no_fact_overlap=${noise.queryObvious.noFactOverlap}`,
    );
    lines.push(
      `  owner relations: ${formatNamedCounts(noise.ownerRelations, "relation")}`,
    );
    if (noise.evidenceFamilies.length > 0) {
      lines.push(
        `  evidence families: ${formatNamedCounts(noise.evidenceFamilies, "family")}`,
      );
    }
  }
  const targetDiagnostics = summarizeTargetDiagnostics(report.repos);
  if (targetDiagnostics.totalChangedFiles > 0) {
    lines.push("");
    lines.push("Target diagnostics:");
    lines.push(
      `  strict target files: ${targetDiagnostics.eligibleFiles}/${targetDiagnostics.totalChangedFiles} changed files`,
    );
    for (const [bucket, count] of targetDiagnostics.excludedBuckets) {
      lines.push(`  excluded ${bucket}: ${count}`);
    }
  }
  const diagnosticSlices = summarizeDiagnosticSlices(report.repos);
  if (diagnosticSlices.length > 0) {
    lines.push("");
    lines.push("Diagnostic slices:");
    for (const slice of diagnosticSlices.slice(0, 12)) {
      lines.push(
        `  ${slice.label}: top3=${slice.promptTop3.hits}/${slice.promptTop3.total} (${formatRate(slice.promptTop3.rate)}), tickets=${slice.ticketsTop3Robust.hits}/${slice.ticketsTop3Robust.total} (${formatRate(slice.ticketsTop3Robust.rate)}), support_files=${slice.supportFiles.hits}/${slice.supportFiles.total} (${formatRate(slice.supportFiles.rate)})${slice.bestCandidateRecall ? `, recall@${slice.bestCandidateRecall.depth}=${slice.bestCandidateRecall.promptUseful}/${slice.bestCandidateRecall.promptCount} (${formatRate(slice.bestCandidateRecall.promptUseful / Math.max(slice.bestCandidateRecall.promptCount, 1))})` : ""}`,
      );
    }
  }
  const missTaxonomy = summarizeReportMissTaxonomy(report.repos);
  if (missTaxonomy.caseTotal > 0) {
    lines.push("");
    lines.push("Miss taxonomy:");
    for (const shape of OSS_CODE_LANE_MISS_SHAPES) {
      lines.push(`  ${shape}: ${missTaxonomy.caseBuckets[shape]}`);
    }
    lines.push(
      `  ranked_file_hits: ${missTaxonomy.fileBuckets.rankedHits}/${missTaxonomy.fileBuckets.totalSrc}`,
    );
    lines.push(
      `  top3_file_hits: ${missTaxonomy.fileBuckets.topThreeHits}/${missTaxonomy.fileBuckets.totalSrc}`,
    );
    lines.push(
      `  support_file_hits: ${missTaxonomy.fileBuckets.supportHits}/${missTaxonomy.fileBuckets.totalSrc}`,
    );
    lines.push(
      `  missing_from_ranked: ${missTaxonomy.fileBuckets.missingFromRanked}/${missTaxonomy.fileBuckets.totalSrc}`,
    );
  }
  const weakestRepos = weakestRepoDiagnostics(report.repos, 5);
  if (weakestRepos.length > 0) {
    lines.push("");
    lines.push("Weakest repos:");
    for (const repo of weakestRepos) {
      lines.push(
        `  ${repo.name}: top3=${repo.promptTop3.hits}/${repo.promptTop3.total} (${formatRate(repo.promptTop3.rate)}), ranked=${repo.promptRanked.hits}/${repo.promptRanked.total} (${formatRate(repo.promptRanked.rate)}), support_files=${repo.supportFiles.hits}/${repo.supportFiles.total} (${formatRate(repo.supportFiles.rate)}), dominant_miss=${repo.dominantMissShape}`,
      );
    }
  }
  const representativeMisses = representativeOssMisses(report.repos, 8);
  if (representativeMisses.length > 0) {
    lines.push("");
    lines.push("Representative misses:");
    for (const miss of representativeMisses) {
      lines.push(
        `  ${miss.repoName} :: ${shorten(miss.ticket, 72)} (${miss.commit}) top3=${miss.promptTop3Hits}/${miss.promptCount} ranked=${miss.promptRankedHits}/${miss.promptCount} support=${miss.promptSupportHits}/${miss.promptCount} changed=${joinLimited(miss.changedFiles, 3)}`,
      );
    }
  }
  lines.push("");
  lines.push("Gates:");
  for (const gate of report.verdict.gates) {
    lines.push(
      `  ${gate.pass ? "PASS" : "FAIL"} ${gate.name}: ${gate.current} required ${gate.required} -- ${gate.detail}`,
    );
  }
  lines.push("");
  lines.push("Repos:");
  for (const repo of report.repos) {
    const diagnostic = repoDiagnosticSummary(repo);
    lines.push(
      `  Repo: ${repo.repo.name} (${repo.repo.primaryLanguage}, ${repo.repo.projectShape})`,
    );
    lines.push(`    root: ${repo.repo.repoRoot}`);
    lines.push(
      `    cases: ${repo.comparison.caseCount}, top3=${diagnostic.promptTop3.hits}/${diagnostic.promptTop3.total}, ranked=${diagnostic.promptRanked.hits}/${diagnostic.promptRanked.total}, support_files=${diagnostic.supportFiles.hits}/${diagnostic.supportFiles.total}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function collectOssCodeLaneObservabilityRows(
  report: OssCodeLaneGeneralizationReport,
): OssCodeLaneObservabilityRow[] {
  const out: OssCodeLaneObservabilityRow[] = [];
  for (const repo of report.repos) {
    const changeTypeByCase = new Map(
      repo.repo.agentCompletionCases.map((testCase) => [
        `${testCase.ticket}:${testCase.commit_sha}`,
        testCase.changeType,
      ]),
    );
    for (const row of repo.comparison.newSummary.rows) {
      const changeType =
        changeTypeByCase.get(`${row.ticket}:${row.commit}`) ?? "unknown";
      for (const [promptIndex, variant] of variantsForDiagnosticRow(row).entries()) {
        for (const autopsy of variant.targetFileAutopsy ?? []) {
          out.push({
            kind: "target_file",
            repoId: repo.repo.id,
            repoName: repo.repo.name,
            repoRoot: repo.repo.repoRoot,
            language: repo.repo.primaryLanguage,
            projectShape: repo.repo.projectShape,
            changeType,
            ticket: row.ticket,
            commit: row.commit,
            promptIndex,
            ...autopsy,
          });
        }
        for (const noise of variant.candidateNoiseAutopsy ?? []) {
          out.push({
            kind: "noise_candidate",
            repoId: repo.repo.id,
            repoName: repo.repo.name,
            repoRoot: repo.repo.repoRoot,
            language: repo.repo.primaryLanguage,
            projectShape: repo.repo.projectShape,
            changeType,
            ticket: row.ticket,
            commit: row.commit,
            promptIndex,
            ...noise,
          });
        }
      }
    }
    for (const [deltaKind, rows] of [
      ["ranked_gain", repo.comparison.methodDelta.rankedGains],
      ["ranked_loss", repo.comparison.methodDelta.rankedLosses],
      ["top3_gain", repo.comparison.methodDelta.topThreeGains],
      ["top3_loss", repo.comparison.methodDelta.topThreeLosses],
      ["support_gain", repo.comparison.methodDelta.supportGains],
      ["support_loss", repo.comparison.methodDelta.supportLosses],
    ] as const) {
      for (const delta of rows) {
        out.push({
          kind: "method_delta",
          repoId: repo.repo.id,
          repoName: repo.repo.name,
          repoRoot: repo.repo.repoRoot,
          language: repo.repo.primaryLanguage,
          projectShape: repo.repo.projectShape,
          deltaKind,
          ticket: delta.ticket,
          commit: delta.commit,
          file: delta.file,
        });
      }
    }
  }
  return out;
}

export function renderOssCodeLaneObservabilityJsonl(
  report: OssCodeLaneGeneralizationReport,
): string {
  const rows = collectOssCodeLaneObservabilityRows(report);
  if (rows.length === 0) return "";
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function formatNamedCounts<
  T extends { count: number } & Record<K, string>,
  K extends string,
>(items: readonly T[], key: K): string {
  if (items.length === 0) return "(none)";
  return items.map((item) => `${item[key]}=${item.count}`).join(", ");
}

const OSS_CODE_LANE_MISS_SHAPES = [
  "top1_hit",
  "top3_hit_top1_miss",
  "ranked_hit_top3_miss",
  "ranked_miss_body_only",
  "ranked_miss",
] as const;

type OssCodeLaneMissShape = (typeof OSS_CODE_LANE_MISS_SHAPES)[number];

type ReportMissTaxonomy = {
  caseTotal: number;
  caseBuckets: Record<OssCodeLaneMissShape, number>;
  fileBuckets: {
    rankedHits: number;
    topThreeHits: number;
    supportHits: number;
    bodyOnlyHits: number;
    missingFromRanked: number;
    totalSrc: number;
  };
};

type RepoDiagnosticSummary = {
  name: string;
  promptTop3: RateMetric;
  promptRanked: RateMetric;
  supportFiles: RateMetric;
  dominantMissShape: OssCodeLaneMissShape | "none";
};

type RepresentativeMiss = {
  repoName: string;
  ticket: string;
  commit: string;
  changedFiles: string[];
  promptCount: number;
  promptTop3Hits: number;
  promptRankedHits: number;
  promptSupportHits: number;
  score: number;
};

type RateMetric = {
  hits: number;
  total: number;
  rate: number;
};

type TargetDiagnostics = {
  totalChangedFiles: number;
  eligibleFiles: number;
  excludedBuckets: Array<[OssCodeLaneTargetBucket, number]>;
};

type DiagnosticSlice = {
  label: string;
  promptTop3: RateMetric;
  ticketsTop3Robust: RateMetric;
  supportFiles: RateMetric;
  bestCandidateRecall?: {
    depth: number;
    promptUseful: number;
    promptCount: number;
  };
};

function hasRelaxedMetricFloors(
  policy: OssCodeLaneGeneralizationPolicy,
): boolean {
  return (
    policy.promptTop3LowerBoundFloor <= 0 ||
    policy.ticketTop3RobustLowerBoundFloor <= 0 ||
    policy.rankedUsefulLowerBoundFloor <= 0 ||
    policy.supportFileHitLowerBoundFloor <= 0
  );
}

function summarizeReportMissTaxonomy(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
): ReportMissTaxonomy {
  const caseBuckets = Object.fromEntries(
    OSS_CODE_LANE_MISS_SHAPES.map((shape) => [shape, 0]),
  ) as Record<OssCodeLaneMissShape, number>;
  const fileBuckets: ReportMissTaxonomy["fileBuckets"] = {
    rankedHits: 0,
    topThreeHits: 0,
    supportHits: 0,
    bodyOnlyHits: 0,
    missingFromRanked: 0,
    totalSrc: 0,
  };
  let caseTotal = 0;
  for (const repo of repos) {
    const miss = repo.comparison.newSummary.missShapeSummary;
    if (!miss) continue;
    for (const shape of OSS_CODE_LANE_MISS_SHAPES) {
      const count = miss.caseBuckets[shape] ?? 0;
      caseBuckets[shape] += count;
      caseTotal += count;
    }
    fileBuckets.rankedHits += miss.fileBuckets.rankedHits;
    fileBuckets.topThreeHits += miss.fileBuckets.topThreeHits;
    fileBuckets.supportHits += miss.fileBuckets.supportHits;
    fileBuckets.bodyOnlyHits += miss.fileBuckets.bodyOnlyHits;
    fileBuckets.missingFromRanked += miss.fileBuckets.missingFromRanked;
    fileBuckets.totalSrc += miss.fileBuckets.totalSrc;
  }
  return {
    caseTotal,
    caseBuckets,
    fileBuckets,
  };
}

function summarizeTargetDiagnostics(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
): TargetDiagnostics {
  const excluded = new Map<OssCodeLaneTargetBucket, number>();
  let totalChangedFiles = 0;
  let eligibleFiles = 0;
  for (const repo of repos) {
    for (const row of repo.comparison.newSummary.rows) {
      for (const file of row.changedFiles) {
        totalChangedFiles += 1;
        const classification = classifyOssCodeLaneTargetFile({
          file,
          repoRoot: repo.repo.repoRoot,
        });
        if (classification.eligible) {
          eligibleFiles += 1;
        } else if (classification.bucket !== "non_code_extension") {
          excluded.set(
            classification.bucket,
            (excluded.get(classification.bucket) ?? 0) + 1,
          );
        }
      }
    }
  }
  return {
    totalChangedFiles,
    eligibleFiles,
    excludedBuckets: [...excluded.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
  };
}

type DiagnosticSliceAccumulator = {
  label: string;
  promptTop3: number;
  promptCount: number;
  robustTickets: number;
  ticketCount: number;
  supportHits: number;
  supportTotal: number;
  candidateRecall: Map<
    number,
    { promptUseful: number; promptCount: number }
  >;
};

function summarizeDiagnosticSlices(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
): DiagnosticSlice[] {
  const slices = new Map<string, DiagnosticSliceAccumulator>();
  for (const repo of repos) {
    const changeTypeByCase = new Map(
      repo.repo.agentCompletionCases.map((testCase) => [
        `${testCase.ticket}:${testCase.commit_sha}`,
        testCase.changeType,
      ]),
    );
    for (const row of repo.comparison.newSummary.rows) {
      addDiagnosticSlice(slices, `language:${repo.repo.primaryLanguage}`, row);
      addDiagnosticSlice(
        slices,
        `change:${changeTypeByCase.get(`${row.ticket}:${row.commit}`) ?? "unknown"}`,
        row,
      );
      addDiagnosticSlice(slices, `target_size:${targetSizeBucket(row.srcTotal)}`, row);
      addDiagnosticSlice(
        slices,
        targetCleanlinessLabel(repo.repo.repoRoot, row),
        row,
      );
    }
  }
  return [...slices.values()]
    .filter((slice) => slice.promptCount > 0)
    .map((slice) => materializeDiagnosticSlice(slice))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

function addDiagnosticSlice(
  slices: Map<string, DiagnosticSliceAccumulator>,
  label: string,
  row: AgentCompletionDetailedRow,
): void {
  const current = slices.get(label) ?? {
    label,
    promptTop3: 0,
    promptCount: 0,
    robustTickets: 0,
    ticketCount: 0,
    supportHits: 0,
    supportTotal: 0,
    candidateRecall: new Map<
      number,
      { promptUseful: number; promptCount: number }
    >(),
  };
  const variants = variantsForDiagnosticRow(row);
  current.promptTop3 += variants.filter((variant) => variant.topThreeCodeUseful)
    .length;
  current.promptCount += variants.length;
  current.ticketCount += row.srcTotal > 0 ? 1 : 0;
  if (
    row.srcTotal > 0 &&
    variants.length > 0 &&
    variants.every((variant) => variant.topThreeCodeUseful)
  ) {
    current.robustTickets += 1;
  }
  current.supportHits += row.supportClusterChangedFiles.length;
  current.supportTotal += row.srcTotal;
  for (const variant of variants) {
    for (const recall of variant.candidateRecall ?? []) {
      const depth = current.candidateRecall.get(recall.depth) ?? {
        promptUseful: 0,
        promptCount: 0,
      };
      depth.promptCount += 1;
      if (recall.useful) depth.promptUseful += 1;
      current.candidateRecall.set(recall.depth, depth);
    }
  }
  slices.set(label, current);
}

function variantsForDiagnosticRow(
  row: AgentCompletionDetailedRow,
): AgentCompletionPromptVariantRow[] {
  if (row.promptVariants && row.promptVariants.length > 0) {
    return row.promptVariants;
  }
  const topThreeCodeChangedFiles = row.topThreeCodeChangedFiles ?? [];
  return [
    {
      query: "(aggregate)",
      mentionedFiles: row.mentionedFiles,
      topCodeFiles: row.topCodeFiles,
      topThreeCodeFiles: row.topThreeCodeFiles ?? row.rankedCodeFiles.slice(0, 3),
      topThreeCodeChangedFiles,
      rankedCodeFiles: row.rankedCodeFiles,
      rankedCodeChangedFiles: row.rankedCodeChangedFiles,
      supportClusterFiles: row.supportClusterFiles,
      supportClusterChangedFiles: row.supportClusterChangedFiles,
      srcOverlap: row.srcOverlap,
      topCodeAcceptable: row.topCodeAcceptable,
      topThreeCodeUseful: topThreeCodeChangedFiles.length > 0,
      rankedCodeUseful: row.rankedCodeUseful,
      supportClusterUseful: row.supportClusterUseful,
    },
  ];
}

function materializeDiagnosticSlice(
  slice: DiagnosticSliceAccumulator,
): DiagnosticSlice {
  const candidateRecall = [...slice.candidateRecall.entries()]
    .filter(([, value]) => value.promptCount > 0)
    .sort((a, b) => b[0] - a[0])[0];
  return {
    label: slice.label,
    promptTop3: rateMetric(slice.promptTop3, slice.promptCount),
    ticketsTop3Robust: rateMetric(slice.robustTickets, slice.ticketCount),
    supportFiles: rateMetric(slice.supportHits, slice.supportTotal),
    ...(candidateRecall
      ? {
          bestCandidateRecall: {
            depth: candidateRecall[0],
            promptUseful: candidateRecall[1].promptUseful,
            promptCount: candidateRecall[1].promptCount,
          },
        }
      : {}),
  };
}

function targetSizeBucket(srcTotal: number): string {
  if (srcTotal <= 0) return "0";
  if (srcTotal === 1) return "1";
  if (srcTotal <= 4) return "2-4";
  if (srcTotal <= 9) return "5-9";
  if (srcTotal <= 24) return "10-24";
  return "25+";
}

function targetCleanlinessLabel(
  repoRoot: string,
  row: AgentCompletionDetailedRow,
): string {
  const noisy = row.changedFiles.some((file) => {
    const classification = classifyOssCodeLaneTargetFile({ file, repoRoot });
    return !classification.eligible &&
      classification.bucket !== "non_code_extension";
  });
  if (!noisy && row.srcTotal > 0 && row.srcTotal <= 9) {
    return "cleanliness:clean_small";
  }
  return "cleanliness:noisy_or_large";
}

function weakestRepoDiagnostics(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
  limit: number,
): RepoDiagnosticSummary[] {
  return repos
    .map(repoDiagnosticSummary)
    .filter((repo) => repo.promptTop3.total > 0 || repo.promptRanked.total > 0)
    .sort(
      (a, b) =>
        a.promptTop3.rate - b.promptTop3.rate ||
        a.promptRanked.rate - b.promptRanked.rate ||
        a.supportFiles.rate - b.supportFiles.rate ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

function repoDiagnosticSummary(
  repo: OssCodeLaneGeneralizationRepoResult,
): RepoDiagnosticSummary {
  const prompt = repo.comparison.newSummary.promptVariantSummary;
  const support = repo.comparison.newSummary.supportClusterFileOverlap;
  return {
    name: repo.repo.id,
    promptTop3: rateMetric(
      prompt?.promptTop3Useful ?? repo.comparison.codeTop1.new.hits,
      prompt?.promptCount ?? repo.comparison.codeTop1.new.total,
    ),
    promptRanked: rateMetric(
      prompt?.promptRankedUseful ?? repo.comparison.codeRankedUseful.new.hits,
      prompt?.promptCount ?? repo.comparison.codeRankedUseful.new.total,
    ),
    supportFiles: rateMetric(support.mentioned, support.total),
    dominantMissShape: dominantMissShape(
      repo.comparison.newSummary.missShapeSummary?.caseBuckets,
    ),
  };
}

function dominantMissShape(
  caseBuckets: Partial<Record<OssCodeLaneMissShape, number>> | undefined,
): OssCodeLaneMissShape | "none" {
  if (!caseBuckets) return "none";
  let best: OssCodeLaneMissShape | "none" = "none";
  let bestCount = 0;
  for (const shape of OSS_CODE_LANE_MISS_SHAPES) {
    const count = caseBuckets[shape] ?? 0;
    if (count > bestCount) {
      best = shape;
      bestCount = count;
    }
  }
  return best;
}

function representativeOssMisses(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
  limit: number,
): RepresentativeMiss[] {
  return repos
    .flatMap((repo) =>
      repo.comparison.newSummary.rows
        .filter((row) => row.srcTotal > 0)
        .map((row) => {
        const variants = row.promptVariants ?? [];
        const promptCount = variants.length > 0 ? variants.length : 1;
        const promptTop3Hits =
          variants.length > 0
            ? variants.filter((variant) => variant.topThreeCodeUseful).length
            : row.topThreeCodeChangedFiles?.length
              ? 1
              : 0;
        const promptRankedHits =
          variants.length > 0
            ? variants.filter((variant) => variant.rankedCodeUseful).length
            : row.rankedCodeUseful
              ? 1
              : 0;
        const promptSupportHits =
          variants.length > 0
            ? variants.filter((variant) => variant.supportClusterUseful).length
            : row.supportClusterUseful
              ? 1
              : 0;
        const score =
          (promptCount - promptTop3Hits) * 4 +
          (promptCount - promptRankedHits) * 2 +
          (promptCount - promptSupportHits);
        return {
          repoName: repo.repo.id,
          ticket: row.ticket,
          commit: row.commit,
          changedFiles: diagnosticChangedSourceFiles(row),
          promptCount,
          promptTop3Hits,
          promptRankedHits,
          promptSupportHits,
          score,
        };
      }),
    )
    .filter((miss) => miss.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.repoName.localeCompare(b.repoName) ||
        a.ticket.localeCompare(b.ticket),
    )
    .slice(0, limit);
}

function rateMetric(hits: number, total: number): RateMetric {
  return {
    hits,
    total,
    rate: total === 0 ? 0 : hits / total,
  };
}

function diagnosticChangedSourceFiles(
  row: AgentCompletionDetailedRow,
): string[] {
  if (row.targetSourceFiles && row.targetSourceFiles.length > 0) {
    return row.targetSourceFiles;
  }
  const sourceFiles = row.changedFiles.filter(isDiagnosticSourceFile);
  return sourceFiles.length > 0 ? sourceFiles : [...row.changedFiles];
}

function isDiagnosticSourceFile(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!/\.(?:ts|tsx|js|jsx|py|go|rs)$/.test(normalized)) return false;
  if (
    normalized.endsWith(".d.ts") ||
    normalized.includes(".test.") ||
    normalized.includes(".spec.") ||
    /_test\.(?:go|rs|py)$/.test(normalized) ||
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/")
  ) {
    return false;
  }
  return true;
}

function sumPromptMetric(
  repos: readonly OssCodeLaneGeneralizationRepoResult[],
  hitsField:
    | "promptTop3Useful"
    | "ticketsTop3Robust"
    | "promptRankedUseful",
  totalField: "promptCount" | "ticketsWithPromptVariants",
): { hits: number; total: number } {
  return repos.reduce(
    (sum, repo) => {
      const promptSummary = repo.comparison.newSummary.promptVariantSummary;
      return {
        hits: sum.hits + (promptSummary?.[hitsField] ?? 0),
        total: sum.total + (promptSummary?.[totalField] ?? 0),
      };
    },
    { hits: 0, total: 0 },
  );
}

function countGate(
  name: OssCodeLaneGeneralizationGateName,
  current: number,
  required: number,
  detail: string,
): OssCodeLaneGeneralizationGate {
  return {
    name,
    pass: current >= required,
    current: String(current),
    required: `>=${required}`,
    detail,
  };
}

function confidenceGate(
  name: OssCodeLaneGeneralizationGateName,
  current: OssCodeLaneGeneralizationMetric,
  required: number,
  confidence: number,
  detail: string,
): OssCodeLaneGeneralizationGate {
  return {
    name,
    pass: current.lowerConfidenceBound >= required,
    current: `${current.hits}/${current.total} lower${pct(confidence)}=${formatRate(
      current.lowerConfidenceBound,
    )}`,
    required: `>=${formatRate(required)}`,
    detail,
  };
}

function metric(
  hits: number,
  total: number,
  confidence: number,
): OssCodeLaneGeneralizationMetric {
  return {
    hits,
    total,
    rate: total === 0 ? 0 : hits / total,
    lowerConfidenceBound: wilsonLowerBound(hits, total, confidence),
  };
}

export function wilsonLowerBound(
  hits: number,
  total: number,
  confidence: number,
): number {
  if (total <= 0) return 0;
  const z = zForConfidence(confidence);
  const p = hits / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin =
    z *
    Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return Math.max(0, (center - margin) / denominator);
}

function zForConfidence(confidence: number): number {
  if (confidence >= 0.999) return 3.290526731;
  if (confidence >= 0.99) return 2.575829304;
  if (confidence >= 0.975) return 2.241402728;
  if (confidence >= 0.95) return 1.959963985;
  if (confidence >= 0.9) return 1.644853627;
  return 1.281551566;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function renderMetric(
  metric: OssCodeLaneGeneralizationMetric,
  confidence: number,
): string {
  return `${metric.hits}/${metric.total} (${formatRate(metric.rate)}, lower${pct(confidence)}=${formatRate(metric.lowerConfidenceBound)})`;
}

function joinOrNone(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}

function joinLimited(values: readonly string[], limit: number): string {
  if (values.length <= limit) return joinOrNone(values);
  return `${values.slice(0, limit).join(", ")} (+${values.length - limit} more)`;
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function stringArrayAt(value: unknown, path: string): string[] {
  return arrayAt(value, path).map((item, index) =>
    stringAt(item, `${path}[${index}]`),
  );
}

function parsePolicy(raw: unknown): OssCodeLaneGeneralizationPolicy {
  const policy = objectAt(raw, "policy");
  return {
    ...DEFAULT_OSS_CODE_LANE_GENERALIZATION_POLICY,
    ...(policy.confidence === undefined
      ? {}
      : { confidence: numberAt(policy.confidence, "policy.confidence") }),
    ...(policy.minRepos === undefined
      ? {}
      : { minRepos: numberAt(policy.minRepos, "policy.minRepos") }),
    ...(policy.minCases === undefined
      ? {}
      : { minCases: numberAt(policy.minCases, "policy.minCases") }),
    ...(policy.minPromptVariants === undefined
      ? {}
      : {
          minPromptVariants: numberAt(
            policy.minPromptVariants,
            "policy.minPromptVariants",
          ),
        }),
    ...(policy.minLanguages === undefined
      ? {}
      : { minLanguages: numberAt(policy.minLanguages, "policy.minLanguages") }),
    ...(policy.minProjectShapes === undefined
      ? {}
      : {
          minProjectShapes: numberAt(
            policy.minProjectShapes,
            "policy.minProjectShapes",
          ),
        }),
    ...(policy.minChangeTypes === undefined
      ? {}
      : {
          minChangeTypes: numberAt(
            policy.minChangeTypes,
            "policy.minChangeTypes",
          ),
        }),
    ...(policy.promptTop3LowerBoundFloor === undefined
      ? {}
      : {
          promptTop3LowerBoundFloor: numberAt(
            policy.promptTop3LowerBoundFloor,
            "policy.promptTop3LowerBoundFloor",
          ),
        }),
    ...(policy.ticketTop3RobustLowerBoundFloor === undefined
      ? {}
      : {
          ticketTop3RobustLowerBoundFloor: numberAt(
            policy.ticketTop3RobustLowerBoundFloor,
            "policy.ticketTop3RobustLowerBoundFloor",
          ),
        }),
    ...(policy.rankedUsefulLowerBoundFloor === undefined
      ? {}
      : {
          rankedUsefulLowerBoundFloor: numberAt(
            policy.rankedUsefulLowerBoundFloor,
            "policy.rankedUsefulLowerBoundFloor",
          ),
        }),
    ...(policy.supportFileHitLowerBoundFloor === undefined
      ? {}
      : {
          supportFileHitLowerBoundFloor: numberAt(
            policy.supportFileHitLowerBoundFloor,
            "policy.supportFileHitLowerBoundFloor",
          ),
        }),
  };
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function manifestPathFromArgs(argv: readonly string[]): string | undefined {
  return argv
    .find((arg) => arg.startsWith("--manifest="))
    ?.replace("--manifest=", "");
}

function numberArg(
  argv: readonly string[],
  name: string,
): number | undefined {
  const raw = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return undefined;
  const value = Number(raw.replace(`--${name}=`, ""));
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} must be a finite number`);
  }
  return value;
}

function stringArg(
  argv: readonly string[],
  name: string,
): string | undefined {
  return argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.replace(`--${name}=`, "");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const manifestPath =
    manifestPathFromArgs(argv) ??
    process.env.OSS_CODE_LANE_MANIFEST;
  if (!manifestPath) {
    throw new Error(
      "OSS code-lane eval requires --manifest=/path/to/manifest.json or OSS_CODE_LANE_MANIFEST.",
    );
  }
  const parsed = parseOssCodeLaneManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  const report = await runOssCodeLaneGeneralizationEval({
    repos: parsed.repos,
    policy: parsed.policy,
    targetPromptVariantsPerCase:
      numberArg(argv, "target-prompts-per-case") ??
      (process.env.OSS_CODE_LANE_PROMPTS_PER_CASE
        ? Number(process.env.OSS_CODE_LANE_PROMPTS_PER_CASE)
        : undefined),
  });
  process.stdout.write(renderOssCodeLaneGeneralizationReport(report));
  const observabilityJsonlPath = stringArg(argv, "observability-jsonl");
  if (observabilityJsonlPath) {
    writeFileSync(
      observabilityJsonlPath,
      renderOssCodeLaneObservabilityJsonl(report),
      "utf8",
    );
  }
  if (!report.verdict.pass) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1]?.endsWith("oss-code-lane-generalization.js") ||
  process.argv[1]?.endsWith("oss-code-lane-generalization.ts")
) {
  void main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
