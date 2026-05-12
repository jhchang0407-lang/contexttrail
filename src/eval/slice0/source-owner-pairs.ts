/**
 * Eval-only pairwise owner probes.
 *
 * These probes encode the real-corpus failure shape directly: for a task, the
 * owner source should rank above a named broad/adjacent competitor. They are
 * diagnostic rather than production gates. A failed pair tells us which stage
 * first inverted the owner/competitor order.
 */

export const PAIRWISE_LOSS_STAGES = [
  "none",
  "probe_case_missing",
  "owner_absent",
  "candidate_pairwise_loss",
  "source_card_pairwise_loss",
  "source_selection_pairwise_loss",
  "display_pairwise_loss",
] as const;

export type PairwiseLossStage = (typeof PAIRWISE_LOSS_STAGES)[number];

export type SourceOwnerPairProbe = {
  id: string;
  repo: string;
  case_id: string;
  owner_source: string;
  competitor_source: string;
  reason: string;
};

export type SourceOwnerPairObservation = {
  repo: string;
  id: string;
  source_candidates: Array<{ source_path: string; rank: number }>;
  source_cards?: Array<{ source_path: string; rank: number }>;
  source_selection?: {
    selected_sources: Array<{ source_path: string }>;
  };
  displayed_top3_sources?: string[];
};

export type SourceOwnerPairResult = {
  probe_id: string;
  repo: string;
  case_id: string;
  owner_source: string;
  competitor_source: string;
  reason: string;
  passed: boolean;
  first_loss_stage: PairwiseLossStage;
  ranks: {
    candidate_owner: number | null;
    candidate_competitor: number | null;
    source_card_owner: number | null;
    source_card_competitor: number | null;
    source_selection_owner: number | null;
    source_selection_competitor: number | null;
    displayed_owner: number | null;
    displayed_competitor: number | null;
  };
};

export type SourceOwnerPairAggregate = {
  total: number;
  passed: number;
  failed: number;
  stage_counts: Record<PairwiseLossStage, number>;
  results: SourceOwnerPairResult[];
};

export const REAL_CORPUS_OWNER_PAIR_PROBES: SourceOwnerPairProbe[] = [
  {
    id: "trpc-overview-owner-vs-react-utils",
    repo: "trpc",
    case_id: "trpc-unanchored-overview",
    owner_source: "docs/server/overview.md",
    competitor_source: "docs/client/react/createTRPCQueryUtils.md",
    reason: "overview owner should beat a dense client utility page",
  },
  {
    id: "trpc-authorization-owner-vs-metadata-auth",
    repo: "trpc",
    case_id: "trpc-unanchored-authorization",
    owner_source: "docs/server/authorization.md",
    competitor_source: "docs/server/metadata.md",
    reason: "authorization owner should beat per-route metadata examples",
  },
  {
    id: "trpc-rpc-decision-owner-vs-adapter",
    repo: "trpc",
    case_id: "trpc-decision-rpc-vs-rest",
    owner_source: "docs/further/rpc.md",
    competitor_source: "docs/server/adapters/aws-lambda.md",
    reason: "RPC decision rationale should beat procedural adapter docs",
  },
  {
    id: "turborepo-globs-owner-vs-config",
    repo: "turborepo",
    case_id: "turborepo-anchored-globs",
    owner_source: "docs/reference/globs.md",
    competitor_source: "docs/reference/configuration.md",
    reason: "globs reference should beat the broad turbo.json config sink",
  },
  {
    id: "turborepo-package-types-owner-vs-index",
    repo: "turborepo",
    case_id: "turborepo-decision-package-types",
    owner_source: "docs/core-concepts/package-types.md",
    competitor_source: "docs/index.md",
    reason: "package-types concept should beat the broad product overview",
  },
  {
    id: "vitest-cli-owner-vs-vitest-api",
    repo: "vitest",
    case_id: "vitest-anchored-cli",
    owner_source: "docs/guide/cli.md",
    competitor_source: "docs/api/advanced/vitest.md",
    reason: "CLI guide should beat the Vitest programmatic API page",
  },
  {
    id: "vitest-projects-owner-vs-config-index",
    repo: "vitest",
    case_id: "vitest-unanchored-projects",
    owner_source: "docs/guide/projects.md",
    competitor_source: "docs/config/index.md",
    reason: "projects guide should beat the broad config index",
  },
  {
    id: "vitest-browser-owner-vs-component-testing",
    repo: "vitest",
    case_id: "vitest-cross-module-browser-mode",
    owner_source: "docs/guide/browser/index.md",
    competitor_source: "docs/guide/browser/component-testing.md",
    reason: "browser mode index should beat the narrower component-testing leaf",
  },
];

export function evaluateSourceOwnerPairs(
  observations: SourceOwnerPairObservation[],
  probes: SourceOwnerPairProbe[] = REAL_CORPUS_OWNER_PAIR_PROBES,
): SourceOwnerPairAggregate {
  const observedRepos = new Set(observations.map((obs) => obs.repo));
  const results = probes
    .filter((probe) => observedRepos.has(probe.repo))
    .map((probe) => evaluateSourceOwnerPair(observations, probe))
    .filter((result): result is SourceOwnerPairResult => result !== null);
  const stage_counts = Object.fromEntries(
    PAIRWISE_LOSS_STAGES.map((stage) => [stage, 0]),
  ) as Record<PairwiseLossStage, number>;
  for (const result of results) stage_counts[result.first_loss_stage] += 1;
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    stage_counts,
    results,
  };
}

export function evaluateSourceOwnerPair(
  observations: SourceOwnerPairObservation[],
  probe: SourceOwnerPairProbe,
): SourceOwnerPairResult | null {
  const obs = observations.find(
    (candidate) => candidate.repo === probe.repo && candidate.id === probe.case_id,
  );
  if (!obs) {
    return {
      ...baseResult(probe),
      passed: false,
      first_loss_stage: "probe_case_missing",
      ranks: emptyRanks(),
    };
  }

  const candidateRanks = rankMap(obs.source_candidates);
  const sourceCardRanks = rankMap(obs.source_cards ?? []);
  const selectionRanks = new Map(
    (obs.source_selection?.selected_sources ?? []).map((source, index) => [
      source.source_path,
      index + 1,
    ]),
  );
  const displayedRanks = new Map(
    (obs.displayed_top3_sources ?? []).map((source, index) => [
      source,
      index + 1,
    ]),
  );

  const ranks = {
    candidate_owner: rank(candidateRanks, probe.owner_source),
    candidate_competitor: rank(candidateRanks, probe.competitor_source),
    source_card_owner: rank(sourceCardRanks, probe.owner_source),
    source_card_competitor: rank(sourceCardRanks, probe.competitor_source),
    source_selection_owner: rank(selectionRanks, probe.owner_source),
    source_selection_competitor: rank(selectionRanks, probe.competitor_source),
    displayed_owner: rank(displayedRanks, probe.owner_source),
    displayed_competitor: rank(displayedRanks, probe.competitor_source),
  };

  const first_loss_stage = classifyPairwiseStage(ranks);
  return {
    ...baseResult(probe),
    passed: first_loss_stage === "none",
    first_loss_stage,
    ranks,
  };
}

function classifyPairwiseStage(
  ranks: SourceOwnerPairResult["ranks"],
): PairwiseLossStage {
  if (ranks.candidate_owner === null) return "owner_absent";
  if (!ownerBeats(ranks.candidate_owner, ranks.candidate_competitor)) {
    return "candidate_pairwise_loss";
  }
  if (
    ranks.source_card_competitor !== null &&
    !ownerBeats(ranks.source_card_owner, ranks.source_card_competitor)
  ) {
    return "source_card_pairwise_loss";
  }
  if (
    ranks.source_selection_competitor !== null &&
    !ownerBeats(ranks.source_selection_owner, ranks.source_selection_competitor)
  ) {
    return "source_selection_pairwise_loss";
  }
  if (!ownerBeats(ranks.displayed_owner, ranks.displayed_competitor)) {
    return "display_pairwise_loss";
  }
  return "none";
}

function ownerBeats(
  ownerRank: number | null,
  competitorRank: number | null,
): boolean {
  if (ownerRank === null) return false;
  if (competitorRank === null) return true;
  return ownerRank < competitorRank;
}

function rankMap(items: Array<{ source_path: string; rank: number }>): Map<string, number> {
  return new Map(items.map((item) => [item.source_path, item.rank]));
}

function rank(ranks: Map<string, number>, source: string): number | null {
  return ranks.get(source) ?? null;
}

function baseResult(probe: SourceOwnerPairProbe): Omit<SourceOwnerPairResult, "passed" | "first_loss_stage" | "ranks"> {
  return {
    probe_id: probe.id,
    repo: probe.repo,
    case_id: probe.case_id,
    owner_source: probe.owner_source,
    competitor_source: probe.competitor_source,
    reason: probe.reason,
  };
}

function emptyRanks(): SourceOwnerPairResult["ranks"] {
  return {
    candidate_owner: null,
    candidate_competitor: null,
    source_card_owner: null,
    source_card_competitor: null,
    source_selection_owner: null,
    source_selection_competitor: null,
    displayed_owner: null,
    displayed_competitor: null,
  };
}
