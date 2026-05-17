import type { Db } from "../store/db.js";
import { listCodeChunksForSource } from "../store/code-chunks.js";
import { listCodeGraphNeighbors } from "../store/code-graph.js";
import { listCodeSources, type StoredCodeSource } from "../store/code-sources.js";
import {
  buildCodeRankedEntries,
  type CodeRankedEntry,
  type CodeLaneRankingMethod,
} from "../retrieve/code-source-mix.js";
import type { CodeLaneResidualFamily } from "./code-lane-comparison.js";

export type PriorArtMethod = {
  name: string;
  sources: string[];
  methodShape: string;
  license: string;
  attribution: string;
  dependencyFootprint: string;
  localOffline: string;
  codeReuseBoundary: string;
  expectedImpact: {
    candidateRecall: string;
    top3Ordering: string;
    supportClusterUsefulness: string;
    crossRepoHoldout: string;
  };
  operationalBoundary: string;
};

export type CodeContextShadowMethodId =
  | "prd-0048-baseline"
  | "repository-map"
  | "hybrid-rerank"
  | "graph-xref"
  | "combined-bundle";

export type CodeContextTraceKind =
  | "production_current"
  | "direct_owner_evidence"
  | "symbol_hit"
  | "exported_symbol_importance"
  | "repository_map_context"
  | "lexical_candidate"
  | "path_candidate"
  | "owner_retention"
  | "owner_ambiguous"
  | "rerank_promotion"
  | "rerank_demotion"
  | "import_edge"
  | "reverse_import_edge"
  | "symbol_reference"
  | "schema_store_support"
  | "support_necessity";

export type CodeContextTraceReason = {
  kind: CodeContextTraceKind;
  detail?: string;
  weight?: number;
};

export type CodeContextShadowCandidate = {
  source_path: string;
  symbol_path: string | null;
  start_line: number;
  end_line: number;
  score: number;
  tokens: number;
  support_candidate: boolean;
  trace_reasons: CodeContextTraceReason[];
};

export type CodeContextShadowMethod = {
  id: CodeContextShadowMethodId;
  name: string;
  description: string;
  dependency_notes: string[];
  shadow_only: true;
};

export type CodeContextShadowCase = {
  id: string;
  query: string;
  expectedOwnerFiles: string[];
  expectedSupportFiles: string[];
  expectedOwnerMatch?: "all" | "any";
  expectedSupportMatch?: "all" | "any";
  residualFamily: CodeLaneResidualFamily;
};

export type RepositoryMapEvidence = {
  source_path: string;
  direct_owner_score: number;
  support_score: number;
  reasons: string[];
};

export type OwnerRetentionDecision =
  | {
      kind: "retained";
      owner_source_path: string;
      reason: string;
      evidence: RepositoryMapEvidence[];
    }
  | {
      kind: "ambiguous";
      owner_source_path?: undefined;
      reason: string;
      evidence: RepositoryMapEvidence[];
    }
  | {
      kind: "absent";
      owner_source_path?: undefined;
      reason: string;
      evidence: RepositoryMapEvidence[];
    };

export type SupportNecessityReason = {
  family: "persistence_substrate" | "import_workflow";
  detail: string;
  evidence: string[];
  weight: number;
};

export type SupportNecessityLens = {
  id: SupportNecessityReason["family"];
  evaluate: (args: {
    queryTokens: ReadonlySet<string>;
    owner: StoredCodeSource | undefined;
    candidate: StoredCodeSource;
  }) => SupportNecessityReason | null;
};

export type CodeContextBundleReranker = {
  rerank: (args: {
    queryTokens: ReadonlySet<string>;
    candidates: CombinedBundleGeneratedSource[];
    topK: number;
  }) => {
    ownerRetentionDecision: OwnerRetentionDecision;
    reranked: CombinedBundleGeneratedSource[];
  };
};

export type CodeContextShadowAdapterResult = {
  method: CodeContextShadowMethod;
  caseId: string;
  query: string;
  initialCandidates: CodeContextShadowCandidate[];
  topCandidates: CodeContextShadowCandidate[];
  ownerRetentionDecision?: OwnerRetentionDecision;
};

export type CodeContextShadowAdapter = {
  method: CodeContextShadowMethod;
  run: (args: {
    db: Db;
    testCase: CodeContextShadowCase;
    candidateLimit: number;
    topK: number;
  }) => CodeContextShadowAdapterResult;
};

export type CodeContextShadowMetric = {
  hits: number;
  total: number;
};

export type CodeContextShadowEvidenceScope =
  | "focused_synthetic"
  | "full_panel_shadow"
  | "production_candidate";

export type CodeContextShadowFamilyMovement = {
  family: CodeLaneResidualFamily;
  ownerCandidateRecall: CodeContextShadowMetric;
  supportCandidateRecall: CodeContextShadowMetric;
  setCandidateRecall: CodeContextShadowMetric;
  candidateRecall: CodeContextShadowMetric;
  topKUsefulness: CodeContextShadowMetric;
  supportClusterUsefulness: CodeContextShadowMetric;
};

export type CodeContextShadowMethodSummary = {
  method: CodeContextShadowMethod;
  caseCount: number;
  ownerCandidateRecall: CodeContextShadowMetric;
  supportCandidateRecall: CodeContextShadowMetric;
  setCandidateRecall: CodeContextShadowMetric;
  candidateRecall: CodeContextShadowMetric;
  topKUsefulness: CodeContextShadowMetric;
  rankedUsefulness: CodeContextShadowMetric;
  supportClusterUsefulness: CodeContextShadowMetric;
  setLevelContextQuality: CodeContextShadowMetric;
  payloadTokens: number;
  rows: CodeContextShadowAdapterResult[];
  familyMovement: CodeContextShadowFamilyMovement[];
};

export type CodeContextShadowComparisonReport = {
  candidateLimit: number;
  topK: number;
  evidenceScope: CodeContextShadowEvidenceScope;
  methods: CodeContextShadowMethodSummary[];
};

export type CodeContextMethodDisposition =
  | "shadow-only"
  | "full-panel promotion"
  | "production promotion"
  | "promote"
  | "promote to full-panel shadow eval"
  | "combine"
  | "defer"
  | "reject";

export type Prd0049MethodVerdictOptions = {
  baselineName: string;
  evidenceScope: CodeContextShadowEvidenceScope;
  realCorpusNoRegressionPassed: boolean;
  realCorpusSummary: string;
  crossRepoHoldoutSummary: string;
};

export type Prd0050PromotionMetrics = {
  promptVariantTop3: CodeContextShadowMetric;
  ticketsTop3Robust: CodeContextShadowMetric;
  supportFileHits: CodeContextShadowMetric;
  codeTop1Acceptable: CodeContextShadowMetric;
  codeRankedUseful: CodeContextShadowMetric;
  supportClusterUseful: CodeContextShadowMetric;
  payloadTokens: number;
};

export type Prd0050PromotionVerdictInput = {
  baselineName: string;
  candidateName: string;
  evidenceScope: CodeContextShadowEvidenceScope;
  baselineMetrics: Prd0050PromotionMetrics;
  candidateMetrics: Prd0050PromotionMetrics;
  guardrails: {
    noRegression: boolean;
    details: string[];
  };
};

export const PRD_0049_PRIOR_ART_METHODS: PriorArtMethod[] = [
  {
    name: "Aider-style repository map",
    sources: [
      "https://aider.chat/docs/repomap.html",
      "https://github.com/Aider-AI/aider",
    ],
    methodShape:
      "Parsed symbol map plus budgeted repository context ordered around query-relevant files and exported symbols.",
    license: "Apache-2.0 project license as of inspection; verify before copying code.",
    attribution:
      "Credit Aider repository-map design if adapting the method; preserve notices for any copied snippets.",
    dependencyFootprint:
      "Tree-sitter/parsing concepts; ContextTrail can adapt from existing code-source facts without adding a parser dependency in the spike.",
    localOffline:
      "Local/offline friendly; no hosted service or credentials are required.",
    codeReuseBoundary:
      "Method adaptation only in this PRD; no source code is copied.",
    expectedImpact: {
      candidateRecall: "Improves owner and symbol-family recall for code-lane misses.",
      top3Ordering:
        "Can keep implementation owners near the top if symbol hits outrank broad support context.",
      supportClusterUsefulness:
        "Useful for exact navigation and compact orientation support.",
      crossRepoHoldout:
        "Expected to help repositories with stable exported symbols; neutral where symbols are sparse.",
    },
    operationalBoundary: "No hosted service / credentials boundary.",
  },
  {
    name: "Continue-style hybrid retrieval/rerank",
    sources: [
      "https://docs.continue.dev/customize/deep-dives/codebase",
      "https://github.com/continuedev/continue",
    ],
    methodShape:
      "Broad lexical/path/symbol candidate generation followed by a deterministic local top-N to top-K rerank.",
    license: "Apache-2.0 project license as of inspection; verify before copying code.",
    attribution:
      "Credit Continue codebase-indexing and reranking method family if adapted.",
    dependencyFootprint:
      "Lexical search is already local; embeddings or model rerankers are optional candidates and not CI requirements.",
    localOffline:
      "Default path is local/offline; embedding/model paths require explicit cost, latency, and offline guardrails.",
    codeReuseBoundary:
      "Method adaptation only in this PRD; no source code is copied.",
    expectedImpact: {
      candidateRecall:
        "Separates generation misses from rerank misses by widening the initial candidate slate.",
      top3Ordering:
        "Expected to improve top-3 ordering when lexical/path/symbol signals agree.",
      supportClusterUsefulness:
        "Set-level scoring can keep necessary support with the owner rather than judging chunks alone.",
      crossRepoHoldout:
        "Expected to help retrieval-index holdout gaps if names and paths carry signal.",
    },
    operationalBoundary:
      "Hosted service / credentials boundary applies only to optional model rerankers.",
  },
  {
    name: "Sourcegraph/Cody-style multi-source context",
    sources: [
      "https://sourcegraph.com/docs/cody/capabilities/codebase-context",
      "https://github.com/sourcegraph/sourcegraph",
    ],
    methodShape:
      "Combines keyword search, code graph relationships, and code intelligence surfaces into one context decision.",
    license:
      "Sourcegraph is Apache-2.0 with enterprise components; inspect exact files before any reuse.",
    attribution:
      "Credit Sourcegraph/Cody multi-source context pattern when adapting the method.",
    dependencyFootprint:
      "Full system can depend on hosted indexing and code intelligence; ContextTrail should only adapt local graph/search signals here.",
    localOffline:
      "Partly local, but hosted service or indexed instance assumptions are out of scope for CI.",
    codeReuseBoundary:
      "Method adaptation only in this PRD; no source code is copied.",
    expectedImpact: {
      candidateRecall:
        "Can recover support files through search plus structural relationships.",
      top3Ordering:
        "Risky if graph breadth overwhelms the owner; must improve top-3 usefulness to promote.",
      supportClusterUsefulness:
        "Potentially strong for schema/store/import companions with typed reasons.",
      crossRepoHoldout:
        "Expected to help only if the existing code graph has enough signal in the holdout repo.",
    },
    operationalBoundary:
      "Hosted service / credentials boundary for Sourcegraph instance or Cody-specific code intelligence.",
  },
  {
    name: "OpenGrok-style search/cross-reference",
    sources: [
      "https://oracle.github.io/opengrok/",
      "https://github.com/oracle/opengrok",
    ],
    methodShape:
      "Fast lexical source search plus cross-reference and navigation indexes.",
    license: "CDDL-1.0 project license; do not copy code into this MIT project without legal review.",
    attribution:
      "Credit OpenGrok search/xref method family if adapting the concept.",
    dependencyFootprint:
      "Standalone indexing service in the original system; ContextTrail should adapt only narrow local xref ideas.",
    localOffline:
      "Can run locally, but service-style indexing is heavier than this spike should require.",
    codeReuseBoundary:
      "Non-compatible license means method adaptation only; code copying is not allowed in this PRD.",
    expectedImpact: {
      candidateRecall:
        "Can improve candidate recall for references and import/reindex workflows.",
      top3Ordering:
        "Neutral unless cross-reference reasons are bounded and owner-preserving.",
      supportClusterUsefulness:
        "Good candidate for explaining import edge and reverse import edge support.",
      crossRepoHoldout:
        "Expected to help CLI/retrieval-index holdout only if references are not too broad.",
    },
    operationalBoundary: "Hosted service optionality is out of scope; local index only.",
  },
  {
    name: "REPOFUSE-style fused repository context",
    sources: ["https://arxiv.org/abs/2402.14323"],
    methodShape:
      "Research method for fused repository-level context, mostly evaluated for code completion.",
    license:
      "Paper attribution required; implementation license depends on any inspected code artifact.",
    attribution:
      "Cite the paper if using fused repository context ideas in a follow-up design.",
    dependencyFootprint:
      "Usually assumes model-side context construction and code-completion evaluation machinery.",
    localOffline:
      "Conceptual method can be local; model-dependent variants require explicit operational boundaries.",
    codeReuseBoundary:
      "Method adaptation only in this PRD; no source code is copied.",
    expectedImpact: {
      candidateRecall:
        "May improve set-level candidate recall but is less directly mapped to ContextTrail's pack contract.",
      top3Ordering:
        "Unproven for top-3 implementation-owner ordering in this repo's eval.",
      supportClusterUsefulness:
        "Promising for files useful together, but needs a bounded pack-shaped adapter.",
      crossRepoHoldout:
        "Research signal only until adapted to the existing cross-repo harness.",
    },
    operationalBoundary:
      "Large model dependency boundary; not a CI requirement for PRD-0049.",
  },
];

export function renderPriorArtMatrix(methods: readonly PriorArtMethod[]): string {
  const lines: string[] = [];
  lines.push("# PRD-0049 Prior-Art Matrix");
  lines.push("");
  lines.push(
    "This matrix is evidence for shadow evaluation only. It records method fit and reuse boundaries before any runtime retrieval behavior changes.",
  );
  lines.push("");
  lines.push(
    "| Method | Sources | License | Attribution | Dependency footprint | Local/offline | Code reuse boundary | Candidate recall | Top-3 ordering | Support-cluster usefulness | Cross-repo holdout | Operational boundary |",
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const method of methods) {
    lines.push(
      [
        method.name,
        method.sources.map((source) => `[source](${source})`).join("<br>"),
        method.license,
        method.attribution,
        method.dependencyFootprint,
        method.localOffline,
        method.codeReuseBoundary,
        method.expectedImpact.candidateRecall,
        method.expectedImpact.top3Ordering,
        method.expectedImpact.supportClusterUsefulness,
        method.expectedImpact.crossRepoHoldout,
        method.operationalBoundary,
      ]
        .map(escapeTableCell)
        .join(" | ")
        .replace(/^/, "| ")
        .concat(" |"),
    );
  }
  lines.push("");
  lines.push("## Explicit Boundaries");
  lines.push("");
  lines.push("- Hosted service / credentials boundary: not required for CI or local shadow adapters.");
  lines.push("- Method adaptation only: no OSS source code is copied by PRD-0049.");
  lines.push(
    "- Runtime retrieval behavior is unchanged until a later PRD or ADR promotes a measured method.",
  );
  return `${lines.join("\n")}\n`;
}

export function createCurrentProductionShadowAdapter(): CodeContextShadowAdapter {
  const method: CodeContextShadowMethod = {
    id: "prd-0048-baseline",
    name: "PRD-0048 current production",
    description:
      "Wraps the current chunk-first code lane as the comparison baseline without changing retrieval behavior.",
    dependency_notes: [
      "Uses existing code_chunks FTS, code-source index, and bounded support cluster behavior.",
      "No hosted service, credentials, embeddings, or model reranker required.",
    ],
    shadow_only: true,
  };

  return {
    method,
    run: ({ db, testCase, candidateLimit, topK }) => {
      const entries = buildCodeRankedEntries({
        db,
        query: testCase.query,
        enabled: true,
        max_results: candidateLimit,
      });
      const candidates = entries.map((entry) =>
        codeRankedEntryToShadowCandidate(entry, [
          { kind: "production_current", detail: "current chunk-first code lane" },
        ]),
      );
      return {
        method,
        caseId: testCase.id,
        query: testCase.query,
        initialCandidates: candidates,
        topCandidates: candidates.slice(0, topK),
      };
    },
  };
}

export function createRepositoryMapShadowAdapter(): CodeContextShadowAdapter {
  const method: CodeContextShadowMethod = {
    id: "repository-map",
    name: "Aider-style repository-map",
    description:
      "Uses existing parsed code-source facts and import graph neighbors to build a bounded Aider-style repository map.",
    dependency_notes: [
      "Uses existing code_sources, code_chunks, and code_graph tables.",
      "No hosted service, credentials, embeddings, model reranker, or new parser dependency required.",
    ],
    shadow_only: true,
  };

  return {
    method,
    run: ({ db, testCase, candidateLimit, topK }) => {
      const candidates = buildRepositoryMapCandidates(db, testCase.query, candidateLimit);
      return {
        method,
        caseId: testCase.id,
        query: testCase.query,
        initialCandidates: candidates,
        topCandidates: candidates.slice(0, topK),
      };
    },
  };
}

export function createHybridRerankShadowAdapter(): CodeContextShadowAdapter {
  const method: CodeContextShadowMethod = {
    id: "hybrid-rerank",
    name: "Hybrid broad-recall/local-rerank",
    description:
      "Builds a broad lexical/path/symbol candidate slate, then reranks top-K with deterministic local owner/support signals.",
    dependency_notes: [
      "Default reranker is local and deterministic.",
      "Embeddings or model rerankers are optional follow-up candidates, not CI requirements.",
    ],
    shadow_only: true,
  };

  return {
    method,
    run: ({ db, testCase, candidateLimit, topK }) => {
      const { initialCandidates, topCandidates } = buildHybridRerankCandidates(
        db,
        testCase.query,
        candidateLimit,
        topK,
      );
      return {
        method,
        caseId: testCase.id,
        query: testCase.query,
        initialCandidates,
        topCandidates,
      };
    },
  };
}

export function createGraphXrefShadowAdapter(): CodeContextShadowAdapter {
  const method: CodeContextShadowMethod = {
    id: "graph-xref",
    name: "Local code graph/xref expansion",
    description:
      "Uses existing code graph import edges plus narrow local source-fact signals to evaluate cross-reference-style support.",
    dependency_notes: [
      "Augments the existing code_graph_edges import substrate; it does not replace or duplicate the graph.",
      "Typed symbol references are reported as a missing shadow signal, not a required runtime dependency.",
    ],
    shadow_only: true,
  };

  return {
    method,
    run: ({ db, testCase, candidateLimit, topK }) => {
      const candidates = buildGraphXrefCandidates(db, testCase.query, candidateLimit);
      return {
        method,
        caseId: testCase.id,
        query: testCase.query,
        initialCandidates: candidates,
        topCandidates: candidates.slice(0, topK),
      };
    },
  };
}

export function createCombinedBundleShadowAdapter(): CodeContextShadowAdapter {
  const method: CodeContextShadowMethod = {
    id: "combined-bundle",
    name: "Combined bundle-aware hybrid rerank",
    description:
      "Generates a broad deterministic slate, then assembles an owner-plus-support top-3 bundle with owner retention and support lenses.",
    dependency_notes: [
      "Uses existing code_sources, code_chunks, and code_graph facts.",
      "Local deterministic rerank only; no embeddings, hosted service, or runtime LLM reranker required.",
      "Shadow adapter only until PRD-0050 promotion gates are satisfied.",
    ],
    shadow_only: true,
  };

  return {
    method,
    run: ({ db, testCase, candidateLimit, topK }) => {
      const { initialCandidates, topCandidates, ownerRetentionDecision } =
        buildCombinedBundleCandidates(db, testCase.query, candidateLimit, topK);
      return {
        method,
        caseId: testCase.id,
        query: testCase.query,
        initialCandidates,
        topCandidates,
        ownerRetentionDecision,
      };
    },
  };
}

export function createPrd0050FullPanelShadowAdapters(): CodeContextShadowAdapter[] {
  return [
    createCurrentProductionShadowAdapter(),
    createRepositoryMapShadowAdapter(),
    createHybridRerankShadowAdapter(),
    createGraphXrefShadowAdapter(),
    createCombinedBundleShadowAdapter(),
  ];
}

export function renderCodeGraphCapabilityInventory(): string {
  return [
    "# PRD-0049 Code Graph Capability Inventory",
    "",
    "## Existing capabilities",
    "",
    "- `code_sources` stores per-file structural facts: file path, exported symbols, signatures, purpose, and imports.",
    "- `code_chunks` stores exact navigation metadata for orientation and declaration chunks.",
    "- `code_graph_edges` stores resolved import edges and supports outgoing and incoming traversal.",
    "- Current retrieval already uses bounded late graph augmentation for support clusters.",
    "",
    "## Genuinely missing shadow signals",
    "",
    "- typed symbol references beyond import edges",
    "- call-site/reference counts that distinguish necessary support from broad related files",
    "- typed schema/store support edges beyond path, symbol, and purpose evidence",
    "",
    "PRD-0049 keeps those gaps in shadow reports. It does not reimplement the graph substrate or promote broad graph expansion.",
  ].join("\n");
}

export function runCodeContextShadowComparison(args: {
  db: Db;
  cases: readonly CodeContextShadowCase[];
  adapters: readonly CodeContextShadowAdapter[];
  candidateLimit?: number;
  topK?: number;
  evidenceScope?: CodeContextShadowEvidenceScope;
}): CodeContextShadowComparisonReport {
  const candidateLimit = args.candidateLimit ?? 20;
  const topK = args.topK ?? 3;
  const methods = args.adapters.map((adapter) => {
    const rows = args.cases.map((testCase) =>
      adapter.run({ db: args.db, testCase, candidateLimit, topK }),
    );
    return summarizeShadowRows({
      method: adapter.method,
      cases: args.cases,
      rows,
    });
  });
  return {
    candidateLimit,
    topK,
    evidenceScope: args.evidenceScope ?? "focused_synthetic",
    methods,
  };
}

export function renderCodeContextShadowComparison(
  report: CodeContextShadowComparisonReport,
): string {
  const lines: string[] = [];
  lines.push("========== CODE-CONTEXT SHADOW COMPARISON ==========");
  lines.push(
    `Same cases, candidate recall@${report.candidateLimit}, final top-${report.topK}. Production retrieval is not changed by this report.`,
  );
  for (const method of report.methods) {
    lines.push("");
    lines.push(`Method: ${method.method.name} (${method.method.id})`);
    lines.push(
      `  owner candidate recall@${report.candidateLimit}: ${metric(method.ownerCandidateRecall)}`,
    );
    lines.push(
      `  support candidate recall@${report.candidateLimit}: ${metric(method.supportCandidateRecall)}`,
    );
    lines.push(
      `  set candidate recall@${report.candidateLimit}: ${metric(method.setCandidateRecall)}`,
    );
    lines.push(`  top-${report.topK} usefulness: ${metric(method.topKUsefulness)}`);
    lines.push(`  ranked usefulness: ${metric(method.rankedUsefulness)}`);
    lines.push(
      `  support-cluster usefulness: ${metric(method.supportClusterUsefulness)}`,
    );
    lines.push(`  set-level context quality: ${metric(method.setLevelContextQuality)}`);
    lines.push(`  payload tokens: ${method.payloadTokens}`);
    lines.push("  dependency notes:");
    for (const note of method.method.dependency_notes) {
      lines.push(`    - ${note}`);
    }
    if (method.familyMovement.length > 0) {
      lines.push("  per-family movement:");
      for (const family of method.familyMovement) {
        lines.push(
          `    ${family.family}: ownerRecall=${metric(family.ownerCandidateRecall)} supportRecall=${metric(family.supportCandidateRecall)} setRecall=${metric(family.setCandidateRecall)} topK=${metric(family.topKUsefulness)} support=${metric(family.supportClusterUsefulness)}`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderPrd0049MethodVerdict(
  report: CodeContextShadowComparisonReport,
  options: Prd0049MethodVerdictOptions,
): string {
  const lines: string[] = [];
  lines.push("# PRD-0049 Method Comparison Verdict");
  lines.push("");
  lines.push(`Baseline: ${options.baselineName}`);
  lines.push(`Evidence scope: ${options.evidenceScope}`);
  lines.push("");
  lines.push("## Method Dispositions");
  lines.push("");
  lines.push(
    `| Method | Disposition | owner candidate recall@${report.candidateLimit} | support candidate recall@${report.candidateLimit} | set candidate recall@${report.candidateLimit} | top-${report.topK} usefulness | ranked usefulness | support-cluster usefulness | per-family movement | ticket robustness | payload-size impact | Reason |`,
  );
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |");
  for (const method of report.methods) {
    const decision = decideMethodDisposition(
      method,
      options.realCorpusNoRegressionPassed,
      options.evidenceScope,
    );
    lines.push(
      [
        `${method.method.id}: ${method.method.name}`,
        decision.disposition,
        metric(method.ownerCandidateRecall),
        metric(method.supportCandidateRecall),
        metric(method.setCandidateRecall),
        metric(method.topKUsefulness),
        metric(method.rankedUsefulness),
        metric(method.supportClusterUsefulness),
        renderFamilyMovementInline(method.familyMovement),
        renderTicketRobustness(method),
        `${method.payloadTokens} payload tokens`,
        decision.reason,
      ]
        .map(escapeTableCell)
        .join(" | ")
        .replace(/^/, "| ")
        .concat(" |"),
    );
  }
  lines.push("");
  lines.push("## Cross-Repo Holdout");
  lines.push("");
  lines.push(options.crossRepoHoldoutSummary);
  lines.push("");
  lines.push("## Real-Corpus Guardrails");
  lines.push("");
  lines.push(
    `real-corpus guardrails: ${options.realCorpusNoRegressionPassed ? "PASS" : "BLOCKED"}`,
  );
  lines.push(options.realCorpusSummary);
  lines.push("");
  lines.push("## Next production PRD recommendation");
  lines.push("");
  const promoted = report.methods.filter(
    (method) =>
      decideMethodDisposition(
        method,
        options.realCorpusNoRegressionPassed,
        options.evidenceScope,
      )
        .disposition === "promote",
  );
  if (promoted.length === 0) {
    lines.push(
      "No production PRD is recommended until a method improves targeted code-context outcomes without guardrail regression.",
    );
  } else {
    lines.push(
      `Open the next production PRD around ${promoted.map((method) => method.method.id).join(" + ")} only after carrying this shadow evidence into the full code-lane and holdout harness.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderPrd0050FullPanelVerdict(
  report: CodeContextShadowComparisonReport,
  options: { baselineName: string },
): string {
  const lines: string[] = [];
  lines.push("# PRD-0050 Full-Panel Shadow Verdict");
  lines.push("");
  lines.push(`Baseline: ${options.baselineName}`);
  lines.push(`Evidence scope: ${report.evidenceScope}`);
  lines.push("");
  lines.push(
    "This report compares shadow methods over one shared code-lane panel. Production retrieval is unchanged unless the separate promotion verdict earns every runtime gate.",
  );
  lines.push("");
  lines.push(
    `| Method | owner candidate recall@${report.candidateLimit} | support candidate recall@${report.candidateLimit} | full-set candidate recall@${report.candidateLimit} | top-${report.topK} usefulness | ranked usefulness | support-cluster usefulness | ticket robustness | payload-size impact | family movement |`,
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |");
  for (const method of report.methods) {
    lines.push(
      [
        `${method.method.id}: ${method.method.name}`,
        metric(method.ownerCandidateRecall),
        metric(method.supportCandidateRecall),
        metric(method.setCandidateRecall),
        metric(method.topKUsefulness),
        metric(method.rankedUsefulness),
        metric(method.supportClusterUsefulness),
        renderTicketRobustness(method),
        `${method.payloadTokens} payload tokens`,
        renderFamilyMovementInline(method.familyMovement),
      ]
        .map(escapeTableCell)
        .join(" | ")
        .replace(/^/, "| ")
        .concat(" |"),
    );
  }
  lines.push("");
  lines.push(
    report.evidenceScope === "production_candidate"
      ? "Production promotion still requires the explicit PRD-0050 promotion gate."
      : "Shadow evidence can recommend a next step, but cannot emit production promotion from focused or full-panel diagnostics alone.",
  );
  return `${lines.join("\n")}\n`;
}

export function renderPrd0050PromotionVerdict(
  input: Prd0050PromotionVerdictInput,
): string {
  const gate = evaluatePrd0050PromotionGate(input);
  const lines: string[] = [];
  lines.push("# PRD-0050 Promotion Verdict");
  lines.push("");
  lines.push(`Baseline: ${input.baselineName}`);
  lines.push(`Candidate: ${input.candidateName}`);
  lines.push(`Evidence scope: ${input.evidenceScope}`);
  lines.push(`Disposition: ${gate.disposition}`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push("| Metric | Baseline | Candidate | Gate |");
  lines.push("| --- | ---: | ---: | --- |");
  lines.push(
    `| prompt variant top-3 | ${metric(input.baselineMetrics.promptVariantTop3)} | ${metric(input.candidateMetrics.promptVariantTop3)} | >=75% |`,
  );
  lines.push(
    `| tickets top-3 robust | ${metric(input.baselineMetrics.ticketsTop3Robust)} | ${metric(input.candidateMetrics.ticketsTop3Robust)} | >=10/14 |`,
  );
  lines.push(
    `| support file hits | ${metric(input.baselineMetrics.supportFileHits)} | ${metric(input.candidateMetrics.supportFileHits)} | >=50/66 |`,
  );
  lines.push(
    `| code top-1 acceptable | ${metric(input.baselineMetrics.codeTop1Acceptable)} | ${metric(input.candidateMetrics.codeTop1Acceptable)} | no regression |`,
  );
  lines.push(
    `| code ranked useful | ${metric(input.baselineMetrics.codeRankedUseful)} | ${metric(input.candidateMetrics.codeRankedUseful)} | no regression |`,
  );
  lines.push(
    `| support-cluster useful | ${metric(input.baselineMetrics.supportClusterUseful)} | ${metric(input.candidateMetrics.supportClusterUseful)} | no regression |`,
  );
  lines.push(
    `| payload tokens | ${input.baselineMetrics.payloadTokens} | ${input.candidateMetrics.payloadTokens} | reported impact |`,
  );
  lines.push("");
  lines.push(`Guardrails: ${input.guardrails.noRegression ? "PASS" : "BLOCKED"}`);
  for (const detail of input.guardrails.details) {
    lines.push(`- ${detail}`);
  }
  lines.push("");
  if (gate.blockers.length > 0) {
    lines.push(`next blocker: ${gate.blockers[0]}`);
    for (const blocker of gate.blockers.slice(1)) {
      lines.push(`- ${blocker}`);
    }
  } else {
    lines.push(
      `CodeLaneRankingMethod: ${gate.runtimeMethod} is available behind the reversible runtime method boundary.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function codeRankedEntryToShadowCandidate(
  entry: CodeRankedEntry,
  traceReasons: CodeContextTraceReason[],
): CodeContextShadowCandidate {
  return {
    source_path: entry.source_path,
    symbol_path: entry.symbol_path,
    start_line: entry.start_line,
    end_line: entry.end_line,
    score: entry.score,
    tokens: entry.tokens,
    support_candidate: entry.support_cluster?.role === "support",
    trace_reasons: traceReasons,
  };
}

function buildRepositoryMapCandidates(
  db: Db,
  query: string,
  candidateLimit: number,
): CodeContextShadowCandidate[] {
  const queryTokens = tokensFromText(query);
  const sources = listCodeSources(db);
  const base = sources
    .map((source) => scoreRepositoryMapSource(source, queryTokens))
    .filter((candidate) => candidate.score > 0)
    .sort(compareScoredSource);
  const owner = base[0];
  if (!owner) return [];

  const outgoing = new Set(
    listCodeGraphNeighbors(db, {
      source_path: owner.source.facts.file_path,
      direction: "outgoing",
    }),
  );
  const incoming = new Set(
    listCodeGraphNeighbors(db, {
      source_path: owner.source.facts.file_path,
      direction: "incoming",
    }),
  );

  const rescored = base.map((candidate) =>
    scoreRepositoryMapSupport(candidate, queryTokens, owner, outgoing, incoming),
  );

  return rescored
    .sort(compareScoredSource)
    .slice(0, candidateLimit)
    .map((candidate) => materializeRepositoryMapCandidate(db, candidate, owner));
}

type ScoredSource = {
  source: StoredCodeSource;
  score: number;
  trace_reasons: CodeContextTraceReason[];
  support_candidate: boolean;
};

function scoreRepositoryMapSource(
  source: StoredCodeSource,
  queryTokens: ReadonlySet<string>,
): ScoredSource {
  const pathTokens = tokensFromText(source.facts.file_path);
  const symbolTokens = tokensFromText(
    source.facts.exported_symbols.map((symbol) => symbol.name).join(" "),
  );
  const purposeTokens = tokensFromText(source.facts.file_purpose ?? "");
  const pathOverlap = overlapCount(queryTokens, pathTokens);
  const symbolOverlap = overlapCount(queryTokens, symbolTokens);
  const purposeOverlap = overlapCount(queryTokens, purposeTokens);
  const trace_reasons: CodeContextTraceReason[] = [];

  let score =
    pathOverlap * 0.08 +
    symbolOverlap * 0.25 +
    purposeOverlap * 0.04 +
    Math.min(0.06, source.facts.exported_symbols.length * 0.02);
  if (pathOverlap > 0) {
    trace_reasons.push({
      kind: "path_candidate",
      detail: "repository path tokens overlap query",
      weight: pathOverlap,
    });
  }
  if (symbolOverlap > 0) {
    trace_reasons.push({
      kind: "symbol_hit",
      detail: "exported symbol tokens overlap query",
      weight: symbolOverlap,
    });
  }
  if (source.facts.exported_symbols.length > 0) {
    trace_reasons.push({
      kind: "exported_symbol_importance",
      detail: "exported symbols are compact repository-map anchors",
      weight: Math.min(0.06, source.facts.exported_symbols.length * 0.02),
    });
  }
  for (const symbol of source.facts.exported_symbols) {
    const symbolNameTokens = tokensFromText(symbol.name);
    if (symbolNameTokens.size > 0 && containsEvery(queryTokens, symbolNameTokens)) {
      score += 0.45;
      trace_reasons.push({
        kind: "symbol_hit",
        detail: `exact exported symbol match: ${symbol.name}`,
        weight: 0.45,
      });
      break;
    }
  }

  return {
    source,
    score: clamp01(score),
    trace_reasons,
    support_candidate: false,
  };
}

function scoreRepositoryMapSupport(
  candidate: ScoredSource,
  queryTokens: ReadonlySet<string>,
  owner: ScoredSource,
  outgoing: ReadonlySet<string>,
  incoming: ReadonlySet<string>,
): ScoredSource {
  if (candidate.source.facts.file_path === owner.source.facts.file_path) {
    return candidate;
  }

  const candidateTokens = tokensFromText(
    [
      candidate.source.facts.file_path,
      candidate.source.facts.file_purpose ?? "",
      ...candidate.source.facts.exported_symbols.map((symbol) => symbol.name),
    ].join(" "),
  );
  const queryWantsStore =
    hasAny(queryTokens, ["schema", "db", "database", "ledger", "store", "storage"]);
  const candidateLooksStore = hasAny(candidateTokens, [
    "schema",
    "db",
    "database",
    "ledger",
    "store",
    "storage",
    "table",
  ]);
  const trace_reasons = [...candidate.trace_reasons];
  let score = candidate.score;
  let supportCandidate = false;

  if (outgoing.has(candidate.source.facts.file_path)) {
    score += 0.24;
    supportCandidate = true;
    trace_reasons.push({
      kind: "repository_map_context",
      detail: `owner imports ${candidate.source.facts.file_path}`,
      weight: 0.24,
    });
  } else if (incoming.has(candidate.source.facts.file_path)) {
    score += 0.18;
    supportCandidate = true;
    trace_reasons.push({
      kind: "repository_map_context",
      detail: `${candidate.source.facts.file_path} imports owner`,
      weight: 0.18,
    });
  }

  if (queryWantsStore && candidateLooksStore) {
    score += 0.2;
    supportCandidate = true;
    trace_reasons.push({
      kind: "schema_store_support",
      detail: "query asks for schema/store support and source supplies it",
      weight: 0.2,
    });
  }

  return {
    ...candidate,
    score: clamp01(score),
    trace_reasons,
    support_candidate: supportCandidate,
  };
}

function materializeRepositoryMapCandidate(
  db: Db,
  scored: ScoredSource,
  owner: ScoredSource,
): CodeContextShadowCandidate {
  const chunk = bestRepositoryMapChunk(db, scored.source, scored.trace_reasons);
  return {
    source_path: scored.source.facts.file_path,
    symbol_path: chunk?.symbol_path ?? null,
    start_line: chunk?.start_line ?? 1,
    end_line: chunk?.end_line ?? 1,
    score: scored.score,
    tokens: chunk?.token_count ?? 0,
    support_candidate:
      scored.source.facts.file_path === owner.source.facts.file_path
        ? false
        : scored.support_candidate,
    trace_reasons: scored.trace_reasons,
  };
}

function bestRepositoryMapChunk(
  db: Db,
  source: StoredCodeSource,
  traceReasons: readonly CodeContextTraceReason[],
) {
  const chunks = listCodeChunksForSource(db, source.facts.file_path);
  const exactSymbol = traceReasons
    .find((reason) => reason.detail?.startsWith("exact exported symbol match: "))
    ?.detail?.replace("exact exported symbol match: ", "");
  if (exactSymbol) {
    const exactChunk = chunks.find((chunk) => chunk.symbol_path === exactSymbol);
    if (exactChunk) return exactChunk;
  }
  for (const symbol of source.facts.exported_symbols) {
    const chunk = chunks.find((candidate) => candidate.symbol_path === symbol.name);
    if (chunk) return chunk;
  }
  return chunks.find((chunk) => chunk.code_role === "orientation") ?? chunks[0] ?? null;
}

function compareScoredSource(a: ScoredSource, b: ScoredSource): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.support_candidate !== b.support_candidate) {
    return a.support_candidate ? 1 : -1;
  }
  return a.source.facts.file_path.localeCompare(b.source.facts.file_path);
}

type HybridGeneratedSource = ScoredSource & {
  generationScore: number;
  rerankScore: number;
};

function buildHybridRerankCandidates(
  db: Db,
  query: string,
  candidateLimit: number,
  topK: number,
): {
  initialCandidates: CodeContextShadowCandidate[];
  topCandidates: CodeContextShadowCandidate[];
} {
  const queryTokens = tokensFromText(query);
  const generated = listCodeSources(db)
    .map((source) => scoreHybridGeneratedSource(source, queryTokens))
    .filter((candidate) => candidate.generationScore > 0)
    .sort(compareHybridGeneration)
    .slice(0, candidateLimit);
  const owner = pickHybridOwner(generated, queryTokens);
  const outgoing = owner
    ? new Set(
        listCodeGraphNeighbors(db, {
          source_path: owner.source.facts.file_path,
          direction: "outgoing",
        }),
      )
    : new Set<string>();

  const reranked = generated
    .map((candidate) => rerankHybridCandidate(candidate, queryTokens, owner, outgoing))
    .sort(compareHybridRerank);
  const rerankedByPath = new Map(
    reranked.map((candidate) => [candidate.source.facts.file_path, candidate]),
  );
  const initialCandidates = generated.map((candidate) =>
    materializeHybridCandidate(
      db,
      rerankedByPath.get(candidate.source.facts.file_path) ?? candidate,
    ),
  );
  const topCandidates = reranked
    .slice(0, topK)
    .map((candidate) => materializeHybridCandidate(db, candidate));
  return { initialCandidates, topCandidates };
}

function scoreHybridGeneratedSource(
  source: StoredCodeSource,
  queryTokens: ReadonlySet<string>,
): HybridGeneratedSource {
  const pathTokens = tokensFromText(source.facts.file_path);
  const symbolTokens = tokensFromText(
    source.facts.exported_symbols.map((symbol) => symbol.name).join(" "),
  );
  const purposeTokens = tokensFromText(source.facts.file_purpose ?? "");
  const lexicalOverlap = overlapCount(queryTokens, purposeTokens);
  const pathOverlap = overlapCount(queryTokens, pathTokens);
  const symbolOverlap = overlapCount(queryTokens, symbolTokens);
  const trace_reasons: CodeContextTraceReason[] = [];
  const generationScore =
    lexicalOverlap * 0.12 + pathOverlap * 0.12 + symbolOverlap * 0.16;

  if (lexicalOverlap > 0 || symbolOverlap > 0) {
    trace_reasons.push({
      kind: "lexical_candidate",
      detail: "query terms matched purpose or symbols in broad candidate generation",
      weight: lexicalOverlap + symbolOverlap,
    });
  }
  if (pathOverlap > 0) {
    trace_reasons.push({
      kind: "path_candidate",
      detail: "query terms matched source path in broad candidate generation",
      weight: pathOverlap,
    });
  }

  return {
    source,
    score: clamp01(generationScore),
    generationScore,
    rerankScore: generationScore,
    trace_reasons,
    support_candidate: false,
  };
}

function pickHybridOwner(
  candidates: readonly HybridGeneratedSource[],
  queryTokens: ReadonlySet<string>,
): HybridGeneratedSource | undefined {
  return [...candidates].sort((a, b) => {
    const bOwner = hybridOwnerSignal(b, queryTokens);
    const aOwner = hybridOwnerSignal(a, queryTokens);
    if (bOwner !== aOwner) return bOwner - aOwner;
    return compareHybridGeneration(a, b);
  })[0];
}

function rerankHybridCandidate(
  candidate: HybridGeneratedSource,
  queryTokens: ReadonlySet<string>,
  owner: HybridGeneratedSource | undefined,
  outgoing: ReadonlySet<string>,
): HybridGeneratedSource {
  const tokens = tokensFromText(
    [
      candidate.source.facts.file_path,
      candidate.source.facts.file_purpose ?? "",
      ...candidate.source.facts.exported_symbols.map((symbol) => symbol.name),
    ].join(" "),
  );
  const isOwner =
    owner?.source.facts.file_path === candidate.source.facts.file_path;
  const trace_reasons = [...candidate.trace_reasons];
  let rerankScore = candidate.generationScore;
  let supportCandidate = false;

  if (isOwner) {
    const ownerBoost = hybridOwnerSignal(candidate, queryTokens);
    rerankScore += ownerBoost;
    if (ownerBoost > 0) {
      trace_reasons.push({
        kind: "rerank_promotion",
        detail: "local rerank preserves likely implementation owner",
        weight: ownerBoost,
      });
    }
  } else {
    const supportBoost =
      outgoing.has(candidate.source.facts.file_path) ||
      hybridSupportSignal(tokens, queryTokens)
        ? 0.32
        : 0;
    if (supportBoost > 0) {
      rerankScore += supportBoost;
      supportCandidate = true;
      trace_reasons.push({
        kind: "support_necessity",
        detail: "candidate supplies parser/store/index support for the owner",
        weight: supportBoost,
      });
      trace_reasons.push({
        kind: "rerank_promotion",
        detail: "local rerank keeps owner/support set together",
        weight: supportBoost,
      });
    }
  }

  if (hybridPassiveSignal(tokens)) {
    rerankScore -= 0.42;
    trace_reasons.push({
      kind: "rerank_demotion",
      detail: "passive notification/example-like file is less likely necessary support",
      weight: -0.42,
    });
  }

  return {
    ...candidate,
    score: clamp01(rerankScore),
    rerankScore,
    trace_reasons,
    support_candidate: supportCandidate,
  };
}

function materializeHybridCandidate(
  db: Db,
  scored: HybridGeneratedSource,
): CodeContextShadowCandidate {
  const chunk = bestRepositoryMapChunk(db, scored.source, scored.trace_reasons);
  return {
    source_path: scored.source.facts.file_path,
    symbol_path: chunk?.symbol_path ?? null,
    start_line: chunk?.start_line ?? 1,
    end_line: chunk?.end_line ?? 1,
    score: clamp01(scored.rerankScore),
    tokens: chunk?.token_count ?? 0,
    support_candidate: scored.support_candidate,
    trace_reasons: scored.trace_reasons,
  };
}

function compareHybridGeneration(
  a: HybridGeneratedSource,
  b: HybridGeneratedSource,
): number {
  if (b.generationScore !== a.generationScore) {
    return b.generationScore - a.generationScore;
  }
  return a.source.facts.file_path.localeCompare(b.source.facts.file_path);
}

function compareHybridRerank(
  a: HybridGeneratedSource,
  b: HybridGeneratedSource,
): number {
  if (b.rerankScore !== a.rerankScore) return b.rerankScore - a.rerankScore;
  if (a.support_candidate !== b.support_candidate) {
    return a.support_candidate ? 1 : -1;
  }
  return a.source.facts.file_path.localeCompare(b.source.facts.file_path);
}

function hybridOwnerSignal(
  candidate: HybridGeneratedSource,
  queryTokens: ReadonlySet<string>,
): number {
  const tokens = tokensFromText(
    [
      candidate.source.facts.file_path,
      candidate.source.facts.file_purpose ?? "",
      ...candidate.source.facts.exported_symbols.map((symbol) => symbol.name),
    ].join(" "),
  );
  let score = 0;
  if (
    hasAny(queryTokens, ["command", "cli", "workflow"]) &&
    hasAny(tokens, ["command", "cli", "workflow", "owner"])
  ) {
    score += 0.45;
  }
  if (hasAny(queryTokens, ["service", "owner"]) && hasAny(tokens, ["service", "owner"])) {
    score += 0.25;
  }
  return score;
}

function hybridSupportSignal(
  candidateTokens: ReadonlySet<string>,
  queryTokens: ReadonlySet<string>,
): boolean {
  return (
    (hasAny(queryTokens, ["parser", "parse", "chunker", "chunk"]) &&
      hasAny(candidateTokens, ["parser", "parse", "chunker", "chunk"])) ||
    (hasAny(queryTokens, ["schema", "store", "storage", "db", "database", "index"]) &&
      hasAny(candidateTokens, ["schema", "store", "storage", "db", "database", "index"]))
  );
}

function hybridPassiveSignal(candidateTokens: ReadonlySet<string>): boolean {
  return hasAny(candidateTokens, [
    "notification",
    "email",
    "example",
    "fixture",
    "report",
    "demo",
  ]);
}

function buildGraphXrefCandidates(
  db: Db,
  query: string,
  candidateLimit: number,
): CodeContextShadowCandidate[] {
  const queryTokens = tokensFromText(query);
  const direct = listCodeSources(db)
    .map((source) => scoreGraphDirectSource(source, queryTokens))
    .filter((candidate) => candidate.score > 0)
    .sort(compareScoredSource);
  const owner = pickGraphOwner(direct, queryTokens);
  if (!owner) return [];

  const byPath = new Map<string, ScoredSource>();
  byPath.set(owner.source.facts.file_path, {
    ...owner,
    support_candidate: false,
    score: 1,
  });

  for (const path of listCodeGraphNeighbors(db, {
    source_path: owner.source.facts.file_path,
    direction: "outgoing",
  })) {
    const support = graphNeighborCandidate(db, path, queryTokens, "import_edge", owner);
    if (support) byPath.set(path, support);
  }
  for (const path of listCodeGraphNeighbors(db, {
    source_path: owner.source.facts.file_path,
    direction: "incoming",
  })) {
    const support = graphNeighborCandidate(
      db,
      path,
      queryTokens,
      "reverse_import_edge",
      owner,
    );
    if (support) byPath.set(path, support);
  }
  for (const candidate of direct) {
    const current = byPath.get(candidate.source.facts.file_path);
    if (!current || (!current.support_candidate && candidate.score > current.score)) {
      byPath.set(candidate.source.facts.file_path, candidate);
    }
  }

  return [...byPath.values()]
    .sort(compareScoredSource)
    .slice(0, candidateLimit)
    .map((candidate) => materializeGraphXrefCandidate(db, candidate, owner));
}

function scoreGraphDirectSource(
  source: StoredCodeSource,
  queryTokens: ReadonlySet<string>,
): ScoredSource {
  const pathTokens = tokensFromText(source.facts.file_path);
  const symbolTokens = tokensFromText(
    source.facts.exported_symbols.map((symbol) => symbol.name).join(" "),
  );
  const purposeTokens = tokensFromText(source.facts.file_purpose ?? "");
  const pathOverlap = overlapCount(queryTokens, pathTokens);
  const symbolOverlap = overlapCount(queryTokens, symbolTokens);
  const purposeOverlap = overlapCount(queryTokens, purposeTokens);
  const trace_reasons: CodeContextTraceReason[] = [];
  let score = pathOverlap * 0.12 + symbolOverlap * 0.18 + purposeOverlap * 0.08;
  if (symbolOverlap > 0) {
    trace_reasons.push({
      kind: "symbol_reference",
      detail: "query overlaps exported symbol facts",
      weight: symbolOverlap,
    });
  }
  if (pathOverlap > 0 || purposeOverlap > 0) {
    trace_reasons.push({
      kind: "lexical_candidate",
      detail: "query overlaps source path or purpose",
      weight: pathOverlap + purposeOverlap,
    });
  }
  const allTokens = unionTokens(pathTokens, symbolTokens, purposeTokens);
  if (hasAny(allTokens, ["owner"]) && hasAny(queryTokens, ["retrieval", "index"])) {
    score += 0.36;
    trace_reasons.push({
      kind: "support_necessity",
      detail: "source describes itself as the implementation owner",
      weight: 0.36,
    });
  }
  return {
    source,
    score: clamp01(score),
    trace_reasons,
    support_candidate: false,
  };
}

function pickGraphOwner(
  candidates: readonly ScoredSource[],
  queryTokens: ReadonlySet<string>,
): ScoredSource | undefined {
  return [...candidates].sort((a, b) => {
    const bScore = graphOwnerScore(b, queryTokens);
    const aScore = graphOwnerScore(a, queryTokens);
    if (bScore !== aScore) return bScore - aScore;
    return compareScoredSource(a, b);
  })[0];
}

function graphOwnerScore(
  candidate: ScoredSource,
  queryTokens: ReadonlySet<string>,
): number {
  const tokens = tokensFromText(
    [
      candidate.source.facts.file_path,
      candidate.source.facts.file_purpose ?? "",
      ...candidate.source.facts.exported_symbols.map((symbol) => symbol.name),
    ].join(" "),
  );
  let score = candidate.score;
  if (hasAny(tokens, ["owner"]) && hasAny(queryTokens, ["retrieval", "index"])) {
    score += 0.5;
  }
  if (hasAny(tokens, ["cli", "command"]) && hasAny(queryTokens, ["schema"])) {
    score -= 0.2;
  }
  return score;
}

function graphNeighborCandidate(
  db: Db,
  source_path: string,
  queryTokens: ReadonlySet<string>,
  edgeKind: "import_edge" | "reverse_import_edge",
  owner: ScoredSource,
): ScoredSource | null {
  const source = listCodeSources(db).find(
    (candidate) => candidate.facts.file_path === source_path,
  );
  if (!source) return null;
  const tokens = tokensFromText(
    [
      source.facts.file_path,
      source.facts.file_purpose ?? "",
      ...source.facts.exported_symbols.map((symbol) => symbol.name),
    ].join(" "),
  );
  const schemaStoreSupport =
    hasAny(queryTokens, ["schema", "store", "storage", "db", "database"]) &&
    hasAny(tokens, ["schema", "store", "storage", "db", "database", "table"]);
  const cliWorkflowSupport =
    hasAny(queryTokens, ["cli", "command", "workflow"]) &&
    hasAny(tokens, ["cli", "command", "workflow"]);
  const edgeWeight = edgeKind === "import_edge" ? 0.34 : 0.26;
  const trace_reasons: CodeContextTraceReason[] = [
    {
      kind: edgeKind,
      detail:
        edgeKind === "import_edge"
          ? `owner imports ${source_path}`
          : `${source_path} imports owner`,
      weight: edgeWeight,
    },
  ];
  let score = owner.score * 0.55 + edgeWeight;

  if (schemaStoreSupport) {
    score += 0.22;
    trace_reasons.push({
      kind: "schema_store_support",
      detail: "graph neighbor supplies schema/store/index support",
      weight: 0.22,
    });
  }
  if (cliWorkflowSupport) {
    score += 0.18;
    trace_reasons.push({
      kind: "support_necessity",
      detail: "reverse edge supplies CLI workflow support",
      weight: 0.18,
    });
  }

  return {
    source,
    score: clamp01(score),
    trace_reasons,
    support_candidate: true,
  };
}

function materializeGraphXrefCandidate(
  db: Db,
  scored: ScoredSource,
  owner: ScoredSource,
): CodeContextShadowCandidate {
  const chunk = bestRepositoryMapChunk(db, scored.source, scored.trace_reasons);
  return {
    source_path: scored.source.facts.file_path,
    symbol_path: chunk?.symbol_path ?? null,
    start_line: chunk?.start_line ?? 1,
    end_line: chunk?.end_line ?? 1,
    score: clamp01(scored.score),
    tokens: chunk?.token_count ?? 0,
    support_candidate:
      scored.source.facts.file_path === owner.source.facts.file_path
        ? false
        : scored.support_candidate,
    trace_reasons: scored.trace_reasons,
  };
}

export type CombinedBundleGeneratedSource = {
  source: StoredCodeSource;
  score: number;
  trace_reasons: CodeContextTraceReason[];
  support_candidate: boolean;
  generationScore: number;
  rerankScore: number;
  ownerEvidenceScore: number;
  supportReasons: SupportNecessityReason[];
};

function buildCombinedBundleCandidates(
  db: Db,
  query: string,
  candidateLimit: number,
  topK: number,
): {
  initialCandidates: CodeContextShadowCandidate[];
  topCandidates: CodeContextShadowCandidate[];
  ownerRetentionDecision: OwnerRetentionDecision;
} {
  const queryTokens = tokensFromText(query);
  const generated = listCodeSources(db)
    .map((source) => scoreCombinedGeneratedSource(source, queryTokens))
    .filter((candidate) => candidate.generationScore > 0)
    .sort(compareCombinedGeneration)
    .slice(0, candidateLimit);
  const reranker = createCodeContextBundleReranker();
  const { reranked, ownerRetentionDecision } = reranker.rerank({
    queryTokens,
    candidates: generated,
    topK,
  });
  const rerankedByPath = new Map(
    reranked.map((candidate) => [candidate.source.facts.file_path, candidate]),
  );
  return {
    initialCandidates: generated.map((candidate) =>
      materializeCombinedBundleCandidate(
        db,
        rerankedByPath.get(candidate.source.facts.file_path) ?? candidate,
      ),
    ),
    topCandidates: reranked
      .slice(0, topK)
      .map((candidate) => materializeCombinedBundleCandidate(db, candidate)),
    ownerRetentionDecision,
  };
}

export function createCodeContextBundleReranker(): CodeContextBundleReranker {
  const lenses = createSupportNecessityLenses();
  return {
    rerank: ({ queryTokens, candidates }) => {
      const ownerRetentionDecision = decideOwnerRetention(candidates);
      const owner =
        ownerRetentionDecision.kind === "retained"
          ? candidates.find(
              (candidate) =>
                candidate.source.facts.file_path ===
                ownerRetentionDecision.owner_source_path,
            )?.source
          : undefined;
      const reranked = candidates
        .map((candidate) =>
          applyBundleRerank({
            candidate,
            queryTokens,
            owner,
            ownerRetentionDecision,
            lenses,
          }),
        )
        .sort((a, b) => compareCombinedBundleRerank(a, b, ownerRetentionDecision));
      return {
        ownerRetentionDecision,
        reranked,
      };
    },
  };
}

function scoreCombinedGeneratedSource(
  source: StoredCodeSource,
  queryTokens: ReadonlySet<string>,
): CombinedBundleGeneratedSource {
  const pathTokens = tokensFromText(source.facts.file_path);
  const symbolTokens = tokensFromText(
    source.facts.exported_symbols.map((symbol) => symbol.name).join(" "),
  );
  const purposeTokens = tokensFromText(source.facts.file_purpose ?? "");
  const pathOverlap = overlapCount(queryTokens, pathTokens);
  const symbolOverlap = overlapCount(queryTokens, symbolTokens);
  const purposeOverlap = overlapCount(queryTokens, purposeTokens);
  const allTokens = unionTokens(pathTokens, symbolTokens, purposeTokens);
  const trace_reasons: CodeContextTraceReason[] = [];
  let generationScore =
    pathOverlap * 0.1 + symbolOverlap * 0.18 + purposeOverlap * 0.1;
  let ownerEvidenceScore = symbolOverlap * 0.18 + pathOverlap * 0.05;

  if (pathOverlap > 0) {
    trace_reasons.push({
      kind: "path_candidate",
      detail: "path tokens matched broad candidate generation",
      weight: pathOverlap,
    });
  }
  if (symbolOverlap > 0 || purposeOverlap > 0) {
    trace_reasons.push({
      kind: "lexical_candidate",
      detail: "purpose or symbol tokens matched broad candidate generation",
      weight: symbolOverlap + purposeOverlap,
    });
  }
  for (const symbol of source.facts.exported_symbols) {
    const symbolNameTokens = tokensFromText(symbol.name);
    if (symbolNameTokens.size > 0 && containsEvery(queryTokens, symbolNameTokens)) {
      generationScore += 0.4;
      ownerEvidenceScore += 0.55;
      trace_reasons.push({
        kind: "direct_owner_evidence",
        detail: `exact exported symbol owner evidence: ${symbol.name}`,
        weight: 0.55,
      });
      break;
    }
  }
  if (
    hasAny(queryTokens, ["owner", "service", "handler", "command", "workflow"]) &&
    hasAny(allTokens, ["owner", "service", "handler", "command", "workflow", "cli"])
  ) {
    ownerEvidenceScore += 0.28;
    trace_reasons.push({
      kind: "direct_owner_evidence",
      detail: "query and source both describe implementation ownership",
      weight: 0.28,
    });
  }

  return {
    source,
    score: clamp01(generationScore),
    generationScore,
    rerankScore: generationScore,
    ownerEvidenceScore: clamp01(ownerEvidenceScore),
    supportReasons: [],
    trace_reasons,
    support_candidate: false,
  };
}

function decideOwnerRetention(
  candidates: readonly CombinedBundleGeneratedSource[],
): OwnerRetentionDecision {
  const evidence = candidates
    .map((candidate) => repositoryMapEvidenceFor(candidate))
    .sort((a, b) => b.direct_owner_score - a.direct_owner_score);
  const best = evidence[0];
  if (!best || best.direct_owner_score < 0.35) {
    return {
      kind: "absent",
      reason: "no clear direct owner evidence",
      evidence,
    };
  }
  const second = evidence[1];
  if (
    second &&
    second.direct_owner_score >= 0.35 &&
    best.direct_owner_score - second.direct_owner_score < 0.14
  ) {
    return {
      kind: "ambiguous",
      reason: "multiple plausible owners have similar direct owner evidence",
      evidence,
    };
  }
  return {
    kind: "retained",
    owner_source_path: best.source_path,
    reason: "clear direct owner evidence outranks support context",
    evidence,
  };
}

function repositoryMapEvidenceFor(
  candidate: CombinedBundleGeneratedSource,
): RepositoryMapEvidence {
  const supportScore = candidate.support_candidate ? 0.4 : 0;
  return {
    source_path: candidate.source.facts.file_path,
    direct_owner_score: candidate.ownerEvidenceScore,
    support_score: supportScore,
    reasons: candidate.trace_reasons
      .filter((reason) =>
        reason.kind === "direct_owner_evidence" ||
        reason.kind === "path_candidate" ||
        reason.kind === "lexical_candidate",
      )
      .map((reason) => reason.detail ?? reason.kind),
  };
}

function applyBundleRerank(args: {
  candidate: CombinedBundleGeneratedSource;
  queryTokens: ReadonlySet<string>;
  owner: StoredCodeSource | undefined;
  ownerRetentionDecision: OwnerRetentionDecision;
  lenses: readonly SupportNecessityLens[];
}): CombinedBundleGeneratedSource {
  const trace_reasons = [...args.candidate.trace_reasons];
  const tokens = tokensFromText(
    [
      args.candidate.source.facts.file_path,
      args.candidate.source.facts.file_purpose ?? "",
      ...args.candidate.source.facts.exported_symbols.map((symbol) => symbol.name),
    ].join(" "),
  );
  const isRetainedOwner =
    args.ownerRetentionDecision.kind === "retained" &&
    args.ownerRetentionDecision.owner_source_path ===
      args.candidate.source.facts.file_path;
  let rerankScore = args.candidate.generationScore;
  let supportCandidate = false;
  const supportReasons: SupportNecessityReason[] = [];

  if (isRetainedOwner) {
    rerankScore += 1;
    trace_reasons.push({
      kind: "owner_retention",
      detail: args.ownerRetentionDecision.reason,
      weight: 1,
    });
  } else if (
    args.ownerRetentionDecision.kind === "ambiguous" &&
    args.candidate.ownerEvidenceScore >= 0.35
  ) {
    trace_reasons.push({
      kind: "owner_ambiguous",
      detail: args.ownerRetentionDecision.reason,
      weight: args.candidate.ownerEvidenceScore,
    });
  }

  if (!isRetainedOwner) {
    for (const lens of args.lenses) {
      const reason = lens.evaluate({
        queryTokens: args.queryTokens,
        owner: args.owner,
        candidate: args.candidate.source,
      });
      if (!reason) continue;
      supportCandidate = true;
      supportReasons.push(reason);
      rerankScore += reason.weight;
      trace_reasons.push({
        kind: "support_necessity",
        detail: reason.detail,
        weight: reason.weight,
      });
      trace_reasons.push({
        kind: "rerank_promotion",
        detail: "bundle rerank keeps necessary support with the owner",
        weight: reason.weight,
      });
    }
  }

  if (hybridPassiveSignal(tokens)) {
    rerankScore -= 0.6;
    trace_reasons.push({
      kind: "rerank_demotion",
      detail: "passive report/example/eval file is not necessary implementation support",
      weight: -0.6,
    });
  }

  return {
    ...args.candidate,
    rerankScore,
    score: clamp01(rerankScore),
    support_candidate: supportCandidate,
    supportReasons,
    trace_reasons,
  };
}

function createSupportNecessityLenses(): SupportNecessityLens[] {
  return [
    {
      id: "import_workflow",
      evaluate: ({ queryTokens, candidate }) => {
        const tokens = sourceTokens(candidate);
        if (hybridPassiveSignal(tokens)) return null;
        if (
          hasAny(queryTokens, [
            "cli",
            "command",
            "import",
            "index",
            "parser",
            "parse",
            "reindex",
            "workflow",
            "chunker",
            "chunk",
          ]) &&
          hasAny(tokens, [
            "cli",
            "command",
            "import",
            "index",
            "parser",
            "parse",
            "reindex",
            "workflow",
            "chunker",
            "chunk",
          ])
        ) {
          return {
            family: "import_workflow",
            detail: "import_workflow: parser/chunker/reindex/index support necessary",
            evidence: ["query_family", "candidate_role"],
            weight: 0.62,
          };
        }
        return null;
      },
    },
    {
      id: "persistence_substrate",
      evaluate: ({ queryTokens, candidate }) => {
        const tokens = sourceTokens(candidate);
        if (hybridPassiveSignal(tokens)) return null;
        if (
          hasAny(queryTokens, [
            "database",
            "db",
            "persist",
            "persistence",
            "record",
            "schema",
            "store",
            "storage",
            "table",
          ]) &&
          hasAny(tokens, [
            "database",
            "db",
            "persist",
            "persistence",
            "record",
            "schema",
            "sqlite",
            "store",
            "storage",
            "table",
          ])
        ) {
          return {
            family: "persistence_substrate",
            detail: "persistence_substrate: schema/database/store support necessary",
            evidence: ["query_family", "candidate_role"],
            weight: 0.56,
          };
        }
        return null;
      },
    },
  ];
}

function sourceTokens(source: StoredCodeSource): Set<string> {
  return tokensFromText(
    [
      source.facts.file_path,
      source.facts.file_purpose ?? "",
      ...source.facts.exported_symbols.map((symbol) => symbol.name),
      ...source.facts.exported_signatures,
    ].join(" "),
  );
}

function compareCombinedGeneration(
  a: CombinedBundleGeneratedSource,
  b: CombinedBundleGeneratedSource,
): number {
  if (b.generationScore !== a.generationScore) {
    return b.generationScore - a.generationScore;
  }
  return a.source.facts.file_path.localeCompare(b.source.facts.file_path);
}

function compareCombinedBundleRerank(
  a: CombinedBundleGeneratedSource,
  b: CombinedBundleGeneratedSource,
  ownerRetentionDecision: OwnerRetentionDecision,
): number {
  if (ownerRetentionDecision.kind === "retained") {
    const aOwner = a.source.facts.file_path === ownerRetentionDecision.owner_source_path;
    const bOwner = b.source.facts.file_path === ownerRetentionDecision.owner_source_path;
    if (aOwner !== bOwner) return aOwner ? -1 : 1;
  }
  const aSupportPriority = supportPriority(a.supportReasons);
  const bSupportPriority = supportPriority(b.supportReasons);
  if (aSupportPriority !== bSupportPriority) return aSupportPriority - bSupportPriority;
  if (b.rerankScore !== a.rerankScore) return b.rerankScore - a.rerankScore;
  if (a.support_candidate !== b.support_candidate) {
    return a.support_candidate ? -1 : 1;
  }
  return a.source.facts.file_path.localeCompare(b.source.facts.file_path);
}

function supportPriority(reasons: readonly SupportNecessityReason[]): number {
  if (reasons.some((reason) => reason.family === "persistence_substrate")) return 1;
  if (reasons.some((reason) => reason.family === "import_workflow")) return 0;
  return 2;
}

function materializeCombinedBundleCandidate(
  db: Db,
  scored: CombinedBundleGeneratedSource,
): CodeContextShadowCandidate {
  const chunk = bestRepositoryMapChunk(db, scored.source, scored.trace_reasons);
  return {
    source_path: scored.source.facts.file_path,
    symbol_path: chunk?.symbol_path ?? null,
    start_line: chunk?.start_line ?? 1,
    end_line: chunk?.end_line ?? 1,
    score: clamp01(scored.rerankScore),
    tokens: chunk?.token_count ?? 0,
    support_candidate: scored.support_candidate,
    trace_reasons: scored.trace_reasons,
  };
}

function unionTokens(...sets: ReadonlySet<string>[]): Set<string> {
  const out = new Set<string>();
  for (const set of sets) {
    for (const token of set) out.add(token);
  }
  return out;
}

function summarizeShadowRows(args: {
  method: CodeContextShadowMethod;
  cases: readonly CodeContextShadowCase[];
  rows: CodeContextShadowAdapterResult[];
}): CodeContextShadowMethodSummary {
  const casesById = new Map(args.cases.map((testCase) => [testCase.id, testCase]));
  const ownerCandidateRecall = emptyMetric(args.cases.length);
  const setCandidateRecall = emptyMetric(args.cases.length);
  const topKUsefulness = emptyMetric(args.cases.length);
  const rankedUsefulness = emptyMetric(args.cases.length);
  const supportCases = args.cases.filter(
    (testCase) => testCase.expectedSupportFiles.length > 0,
  );
  const supportCandidateRecall = emptyMetric(supportCases.length);
  const supportClusterUsefulness = emptyMetric(supportCases.length);
  const setLevelContextQuality = emptyMetric(supportCases.length);
  const familyBuckets = new Map<
    CodeLaneResidualFamily,
    {
      cases: CodeContextShadowCase[];
      rows: CodeContextShadowAdapterResult[];
    }
  >();
  let payloadTokens = 0;

  for (const row of args.rows) {
    const testCase = casesById.get(row.caseId);
    if (!testCase) continue;
    payloadTokens += row.topCandidates.reduce((sum, candidate) => sum + candidate.tokens, 0);

    const bucket =
      familyBuckets.get(testCase.residualFamily) ?? {
        cases: [],
        rows: [],
      };
    bucket.cases.push(testCase);
    bucket.rows.push(row);
    familyBuckets.set(testCase.residualFamily, bucket);

    const ownerInitialHit = containsExpectedOwners(
      row.initialCandidates,
      testCase,
    );
    const supportInitialHit = containsExpectedSupport(
      row.initialCandidates,
      testCase,
    );
    const setInitialHit = containsExpectedSet(row.initialCandidates, testCase);
    if (ownerInitialHit) ownerCandidateRecall.hits += 1;
    if (setInitialHit) setCandidateRecall.hits += 1;
    if (containsExpectedOwners(row.topCandidates, testCase)) {
      topKUsefulness.hits += 1;
    }
    if (setInitialHit) rankedUsefulness.hits += 1;
    if (testCase.expectedSupportFiles.length > 0) {
      if (supportInitialHit) supportCandidateRecall.hits += 1;
      if (containsExpectedSupport(row.topCandidates, testCase)) {
        supportClusterUsefulness.hits += 1;
      }
      if (
        containsExpectedOwners(row.topCandidates, testCase) &&
        containsExpectedSupport(row.topCandidates, testCase)
      ) {
        setLevelContextQuality.hits += 1;
      }
    }
  }

  const familyMovement = [...familyBuckets.entries()]
    .map(([family, bucket]) => ({
      family,
      ownerCandidateRecall: ownerMetricForRows(
        bucket.cases,
        bucket.rows,
        "initialCandidates",
      ),
      supportCandidateRecall: supportMetricForRows(
        bucket.cases,
        bucket.rows,
        "initialCandidates",
      ),
      setCandidateRecall: setMetricForRows(
        bucket.cases,
        bucket.rows,
        "initialCandidates",
      ),
      candidateRecall: setMetricForRows(
        bucket.cases,
        bucket.rows,
        "initialCandidates",
      ),
      topKUsefulness: metricForRows(bucket.cases, bucket.rows, "topCandidates"),
      supportClusterUsefulness: supportMetricForRows(
        bucket.cases,
        bucket.rows,
        "topCandidates",
      ),
    }))
    .sort((a, b) => a.family.localeCompare(b.family));

  return {
    method: args.method,
    caseCount: args.cases.length,
    ownerCandidateRecall,
    supportCandidateRecall,
    setCandidateRecall,
    candidateRecall: setCandidateRecall,
    topKUsefulness,
    rankedUsefulness,
    supportClusterUsefulness,
    setLevelContextQuality,
    payloadTokens,
    rows: args.rows,
    familyMovement,
  };
}

function metricForRows(
  cases: readonly CodeContextShadowCase[],
  rows: readonly CodeContextShadowAdapterResult[],
  field: "initialCandidates" | "topCandidates",
): CodeContextShadowMetric {
  return ownerMetricForRows(cases, rows, field);
}

function ownerMetricForRows(
  cases: readonly CodeContextShadowCase[],
  rows: readonly CodeContextShadowAdapterResult[],
  field: "initialCandidates" | "topCandidates",
): CodeContextShadowMetric {
  const out = emptyMetric(cases.length);
  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    const row = rows[i];
    if (!testCase || !row) continue;
    if (containsExpectedOwners(row[field], testCase)) out.hits += 1;
  }
  return out;
}

function supportMetricForRows(
  cases: readonly CodeContextShadowCase[],
  rows: readonly CodeContextShadowAdapterResult[],
  field: "initialCandidates" | "topCandidates",
): CodeContextShadowMetric {
  const supportCases = cases.filter((testCase) => testCase.expectedSupportFiles.length > 0);
  const out = emptyMetric(supportCases.length);
  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    const row = rows[i];
    if (!testCase || !row || testCase.expectedSupportFiles.length === 0) continue;
    if (containsExpectedSupport(row[field], testCase)) out.hits += 1;
  }
  return out;
}

function setMetricForRows(
  cases: readonly CodeContextShadowCase[],
  rows: readonly CodeContextShadowAdapterResult[],
  field: "initialCandidates" | "topCandidates",
): CodeContextShadowMetric {
  const out = emptyMetric(cases.length);
  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    const row = rows[i];
    if (!testCase || !row) continue;
    if (containsExpectedSet(row[field], testCase)) out.hits += 1;
  }
  return out;
}

function emptyMetric(total: number): CodeContextShadowMetric {
  return { hits: 0, total };
}

function containsAll(
  candidates: readonly CodeContextShadowCandidate[],
  sourcePaths: readonly string[],
): boolean {
  const candidatePaths = new Set(candidates.map((candidate) => candidate.source_path));
  return sourcePaths.every((sourcePath) => candidatePaths.has(sourcePath));
}

function containsAny(
  candidates: readonly CodeContextShadowCandidate[],
  sourcePaths: readonly string[],
): boolean {
  if (sourcePaths.length === 0) return true;
  const candidatePaths = new Set(candidates.map((candidate) => candidate.source_path));
  return sourcePaths.some((sourcePath) => candidatePaths.has(sourcePath));
}

function containsExpectedOwners(
  candidates: readonly CodeContextShadowCandidate[],
  testCase: CodeContextShadowCase,
): boolean {
  return testCase.expectedOwnerMatch === "any"
    ? containsAny(candidates, testCase.expectedOwnerFiles)
    : containsAll(candidates, testCase.expectedOwnerFiles);
}

function containsExpectedSupport(
  candidates: readonly CodeContextShadowCandidate[],
  testCase: CodeContextShadowCase,
): boolean {
  return testCase.expectedSupportMatch === "any"
    ? containsAny(candidates, testCase.expectedSupportFiles)
    : containsAll(candidates, testCase.expectedSupportFiles);
}

function containsExpectedSet(
  candidates: readonly CodeContextShadowCandidate[],
  testCase: CodeContextShadowCase,
): boolean {
  return (
    containsExpectedOwners(candidates, testCase) &&
    containsExpectedSupport(candidates, testCase)
  );
}

function metric(value: CodeContextShadowMetric): string {
  return `${value.hits}/${value.total}`;
}

function decideMethodDisposition(
  method: CodeContextShadowMethodSummary,
  realCorpusNoRegressionPassed: boolean,
  evidenceScope: CodeContextShadowEvidenceScope,
): { disposition: CodeContextMethodDisposition; reason: string } {
  if (method.method.id === "prd-0048-baseline") {
    return {
      disposition: "defer",
      reason: "comparison baseline, not a new method",
    };
  }
  if (!realCorpusNoRegressionPassed) {
    return {
      disposition: "defer",
      reason: "shadow method cannot promote while no-regression guardrails are blocked",
    };
  }
  const setRecallPerfect = isPerfectMetric(method.setCandidateRecall);
  const topKPerfect =
    method.topKUsefulness.total > 0 &&
    method.topKUsefulness.hits === method.topKUsefulness.total;
  const supportPerfect = isPerfectMetric(method.supportClusterUsefulness);
  const setTopKPerfect = isPerfectMetric(method.setLevelContextQuality);
  const candidateSignal =
    method.ownerCandidateRecall.hits > 0 ||
    method.supportCandidateRecall.hits > 0 ||
    method.setCandidateRecall.hits > 0;

  if (evidenceScope === "focused_synthetic") {
    if (method.method.id === "repository-map" && candidateSignal) {
      return {
        disposition: "combine",
        reason:
          "focused evidence supports owner retention and map context, but production needs hybrid/full-panel validation",
      };
    }
    if (
      method.method.id === "hybrid-rerank" &&
      setRecallPerfect &&
      topKPerfect &&
      supportPerfect &&
      setTopKPerfect
    ) {
      return {
        disposition: "promote to full-panel shadow eval",
        reason:
          "focused evidence clears owner/support gates; next step is full-panel shadow evaluation, not production promotion",
      };
    }
    if (method.method.id === "graph-xref" && candidateSignal) {
      return {
        disposition: "defer",
        reason:
          "focused graph evidence is useful diagnostically but broad graph expansion still needs holdout proof",
      };
    }
    if (candidateSignal) {
      return {
        disposition: "defer",
        reason: "focused synthetic evidence is not sufficient for production promotion",
      };
    }
    return {
      disposition: "reject",
      reason: "no useful candidate recall in focused synthetic evidence",
    };
  }

  if (
    evidenceScope === "production_candidate" &&
    method.caseCount < PRODUCTION_PROMOTION_MIN_CASES
  ) {
    return {
      disposition: "defer",
      reason: `production promotion requires at least ${PRODUCTION_PROMOTION_MIN_CASES} evaluated cases`,
    };
  }

  if (setRecallPerfect && topKPerfect && supportPerfect && setTopKPerfect) {
    return {
      disposition: "promote",
      reason: "owner/support candidate generation and final top-k gates are clear",
    };
  }
  if (candidateSignal && method.supportClusterUsefulness.hits > 0) {
    return {
      disposition: "combine",
      reason: "useful support evidence, but not enough top-k ownership to promote alone",
    };
  }
  if (candidateSignal) {
    return {
      disposition: "defer",
      reason: "candidate generation has signal, rerank/top-k evidence is not sufficient",
    };
  }
  return {
    disposition: "reject",
    reason: "no useful candidate recall in the shadow evidence",
  };
}

function evaluatePrd0050PromotionGate(
  input: Prd0050PromotionVerdictInput,
): {
  disposition: Extract<
    CodeContextMethodDisposition,
    "shadow-only" | "full-panel promotion" | "production promotion"
  >;
  blockers: string[];
  runtimeMethod?: CodeLaneRankingMethod;
} {
  const blockers: string[] = [];
  if (metricRate(input.candidateMetrics.promptVariantTop3) < 0.75) {
    blockers.push("prompt variant top-3 below 75%");
  }
  if (input.candidateMetrics.ticketsTop3Robust.hits < 10) {
    blockers.push("tickets top-3 robust below 10/14");
  }
  if (input.candidateMetrics.supportFileHits.hits < 50) {
    blockers.push("support file hits below 50/66");
  }
  if (
    input.candidateMetrics.codeTop1Acceptable.hits <
    input.baselineMetrics.codeTop1Acceptable.hits
  ) {
    blockers.push("code top-1 acceptable regressed below PRD-0048 baseline");
  }
  if (
    input.candidateMetrics.codeRankedUseful.hits <
    input.baselineMetrics.codeRankedUseful.hits
  ) {
    blockers.push("code ranked useful regressed below PRD-0048 baseline");
  }
  if (
    input.candidateMetrics.supportClusterUseful.hits <
    input.baselineMetrics.supportClusterUseful.hits
  ) {
    blockers.push("support-cluster usefulness regressed below PRD-0048 baseline");
  }
  if (!input.guardrails.noRegression) {
    blockers.push("guardrail regression blocks production promotion");
  }
  if (blockers.length > 0) {
    return { disposition: "shadow-only", blockers };
  }
  if (input.evidenceScope !== "production_candidate") {
    return {
      disposition: "full-panel promotion",
      blockers: ["production_candidate evidence scope is required before runtime selection"],
    };
  }
  return {
    disposition: "production promotion",
    blockers,
    runtimeMethod: "bundle-aware",
  };
}

const PRODUCTION_PROMOTION_MIN_CASES = 10;

function isPerfectMetric(value: CodeContextShadowMetric): boolean {
  return value.total === 0 || value.hits === value.total;
}

function metricRate(value: CodeContextShadowMetric): number {
  if (value.total === 0) return 0;
  return value.hits / value.total;
}

function renderFamilyMovementInline(
  families: readonly CodeContextShadowFamilyMovement[],
): string {
  if (families.length === 0) return "(none)";
  return families
    .map(
      (family) =>
        `${family.family} ownerRecall=${metric(family.ownerCandidateRecall)} supportRecall=${metric(family.supportCandidateRecall)} setRecall=${metric(family.setCandidateRecall)} topK=${metric(family.topKUsefulness)} support=${metric(family.supportClusterUsefulness)}`,
    )
    .join("<br>");
}

function renderTicketRobustness(method: CodeContextShadowMethodSummary): string {
  return `${method.topKUsefulness.hits}/${method.caseCount} cases top-k useful`;
}

function tokensFromText(text: string): Set<string> {
  const spacedCamel = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return new Set(
    spacedCamel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1)
      .flatMap(expandToken)
      .map(singularizeToken),
  );
}

function expandToken(token: string): string[] {
  if (token === "sourceprofile" || token === "sourceprofiles") {
    return ["sourceprofile", "source", "profile"];
  }
  if (token === "sourcecard" || token === "sourcecards") {
    return ["sourcecard", "source", "card"];
  }
  return [token];
}

function singularizeToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && token.length > 3 && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function overlapCount(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function containsEvery(
  haystack: ReadonlySet<string>,
  needles: ReadonlySet<string>,
): boolean {
  for (const needle of needles) {
    if (!haystack.has(needle)) return false;
  }
  return true;
}

function hasAny(
  haystack: ReadonlySet<string>,
  needles: readonly string[],
): boolean {
  return needles.some((needle) => haystack.has(needle));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
