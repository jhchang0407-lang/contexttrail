#!/usr/bin/env node
/**
 * Agent-completion probe — does the assembled context pack point the
 * agent at the right files to actually do the work?
 *
 * For each completed Linear ticket we know:
 *   1. The natural queries an engineer would issue
 *   2. The shipping commit and the set of files it touched
 *
 * The probe assembles the pack via the engine (retrieve + link-traversal)
 * and scans all chunk bodies for mentions of the actually-touched .ts /
 * .test.ts / .md files. The metric is precision/recall of "files
 * pointed at" vs "files actually changed", not "is this doc retrieved".
 *
 * This is a more honest end-to-end test than the source-coverage probe
 * because it grounds the assembly metric in shipped engineering work.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { closeDb, openDb } from "../store/db.js";
import { assembleContextPackWithLinks } from "../retrieve/assemble-with-links.js";
import {
  evaluateAssemblyGates,
  renderAssemblyVerdict,
} from "./assembly-gate-bands.js";
import { budgetedRankedEntries } from "./budgeted-pack.js";
import { COMMIT_GROUNDED_EVAL_IMPORT_GLOBS } from "./import-globs.js";
import { prepareCommitGroundedEvalWorkspace } from "./import-globs.js";
import { isOssCodeLaneTargetFile } from "./oss-code-lane-targets.js";
import {
  buildCodeCandidateDiagnostics,
  buildCodeRankedEntries,
  type CodeCandidateDiagnostic,
} from "../retrieve/code-source-mix.js";
import { codeSourceIndexEnabledFromEnv } from "../retrieve/code-source-flag.js";
import type { CodeCandidateEvidenceFamily } from "../retrieve/code-candidate-evidence.js";
import type { CodeRetrievalConfidenceLevel } from "../types/code-source.js";
import { listCodeGraphNeighbors } from "../store/code-graph.js";
import { listCodeChunksForSource } from "../store/code-chunks.js";
import { getCodeSource } from "../store/code-sources.js";

type ProbeCliIO = {
  write: (text: string) => void;
  exit: (code: number) => void;
};

export type AgentCompletionCase = {
  ticket: string;
  commit_sha: string;
  queries: string[];
  /** Optional: paths to ignore (lockfiles, snapshots, etc.). */
  ignore?: string[];
};

export type AgentCompletionSourceFilePolicy =
  | "agent-completion"
  | "oss-code-lane";

export type AgentCompletionCandidateRecallDepth = {
  depth: number;
  codeFiles: string[];
  changedFiles: string[];
  fileHits: number;
  fileTotal: number;
  useful: boolean;
  methodFamilyRecall?: AgentCompletionCandidateMethodFamilyRecall[];
  usefulShadowFiles?: string[];
  usefulAdmittedFiles?: string[];
  uselessAdmittedFiles?: string[];
  usefulBuriedFiles?: string[];
  topThreeUselessFiles?: string[];
};

export type AgentCompletionCandidateMethodFamilyRecall = {
  family: CodeCandidateEvidenceFamily;
  changedFiles: string[];
  fileHits: number;
  fileTotal: number;
  useful: boolean;
};

export type AgentCompletionTargetFileOutcome =
  | "pack_top3_hit"
  | "pack_ranked_hit"
  | "candidate_top10_hit"
  | "candidate_top30_hit"
  | "candidate_top100_hit"
  | "candidate_hit"
  | "candidate_shadow_only"
  | "generated_buried"
  | "never_generated"
  | "no_chunks"
  | "not_indexed";

export type AgentCompletionTargetOwnerRelation =
  | "same_file"
  | "same_directory"
  | "same_package"
  | "same_path_suffix"
  | "owner_imports_target"
  | "target_imports_owner"
  | "unknown";

export type AgentCompletionOwnerCandidateRelation = {
  sourcePath: string;
  rank: number;
  candidateRank: number | null;
  packRank: number | null;
  relations: AgentCompletionTargetOwnerRelation[];
};

export type AgentCompletionTargetFileAutopsyRow = {
  query: string;
  targetFile: string;
  indexed: boolean;
  hasChunks: boolean;
  packRank: number | null;
  candidateRank: number | null;
  diagnosticRank: number | null;
  candidateScore: number | null;
  candidateConfidenceLevel: CodeRetrievalConfidenceLevel | null;
  candidateConfidenceScore: number | null;
  candidateRetryRecommended: boolean;
  candidateAdmitted: boolean;
  candidateShadow: boolean;
  evidenceFamilies: CodeCandidateEvidenceFamily[];
  evidenceReasons: string[];
  topOwnerFile: string | null;
  ownerRelations: AgentCompletionTargetOwnerRelation[];
  ownerCandidates: AgentCompletionOwnerCandidateRelation[];
  queryTokenCount: number;
  pathTokenOverlap: number;
  symbolTokenOverlap: number;
  purposeTokenOverlap: number;
  factTokenOverlap: number;
  outcome: AgentCompletionTargetFileOutcome;
};

export type AgentCompletionCandidateNoiseAutopsyRow = {
  query: string;
  sourcePath: string;
  rank: number;
  score: number;
  confidenceLevel: CodeRetrievalConfidenceLevel;
  confidenceScore: number;
  retryRecommended: boolean;
  admitted: boolean;
  shadow: boolean;
  packRank: number | null;
  evidenceFamilies: CodeCandidateEvidenceFamily[];
  evidenceReasons: string[];
  topOwnerFile: string | null;
  ownerRelations: AgentCompletionTargetOwnerRelation[];
  queryTokenCount: number;
  pathTokenOverlap: number;
  symbolTokenOverlap: number;
  purposeTokenOverlap: number;
  factTokenOverlap: number;
};

export type AgentCompletionTargetFileAutopsySummary = {
  observations: number;
  indexed: number;
  withChunks: number;
  packTopThreeHits: number;
  packRankedHits: number;
  candidateTopTenHits: number;
  candidateTopThirtyHits: number;
  candidateTopHundredHits: number;
  queryObvious: {
    path: number;
    symbol: number;
    purpose: number;
    noFactOverlap: number;
  };
  outcomes: Array<{
    outcome: AgentCompletionTargetFileOutcome;
    count: number;
  }>;
  ownerRelations: Array<{
    relation: AgentCompletionTargetOwnerRelation;
    count: number;
  }>;
  ownerCandidateRelations: Array<{
    relation: AgentCompletionTargetOwnerRelation;
    count: number;
  }>;
  evidenceFamilies: Array<{
    family: CodeCandidateEvidenceFamily;
    count: number;
  }>;
};

export type AgentCompletionCandidateNoiseAutopsySummary = {
  observations: number;
  admitted: number;
  shadow: number;
  packRanked: number;
  candidateTopThree: number;
  candidateTopTen: number;
  candidateTopThirty: number;
  queryObvious: {
    path: number;
    symbol: number;
    purpose: number;
    noFactOverlap: number;
  };
  ownerRelations: Array<{
    relation: AgentCompletionTargetOwnerRelation;
    count: number;
  }>;
  evidenceFamilies: Array<{
    family: CodeCandidateEvidenceFamily;
    count: number;
  }>;
};

export type AgentCompletionProbeRow = {
  ticket: string;
  commit: string;
  changedFiles: string[];
  targetSourceFiles?: string[];
  mentionedFiles: string[];
  srcOverlap: number;
  srcTotal: number;
  docOverlap: number;
  docTotal: number;
};

export type AgentCompletionProbeSummary = {
  caseCount: number;
  rows: AgentCompletionProbeRow[];
  totalSrc: number;
  totalSrcOverlap: number;
  totalDoc: number;
  totalDocOverlap: number;
};

export type AgentCompletionDetailedRow = AgentCompletionProbeRow & {
  topCodeFiles: string[];
  topThreeCodeFiles?: string[];
  topThreeCodeChangedFiles?: string[];
  rankedCodeFiles: string[];
  rankedCodeChangedFiles: string[];
  supportClusterFiles: string[];
  supportClusterChangedFiles: string[];
  topCodeAcceptable: boolean;
  rankedCodeUseful: boolean;
  supportClusterUseful: boolean;
  promptVariants?: AgentCompletionPromptVariantRow[];
};

export type AgentCompletionPromptVariantRow = {
  query: string;
  mentionedFiles: string[];
  topCodeFiles: string[];
  topThreeCodeFiles: string[];
  topThreeCodeChangedFiles: string[];
  rankedCodeFiles: string[];
  rankedCodeChangedFiles: string[];
  supportClusterFiles: string[];
  supportClusterChangedFiles: string[];
  srcOverlap: number;
  topCodeAcceptable: boolean;
  topThreeCodeUseful: boolean;
  rankedCodeUseful: boolean;
  supportClusterUseful: boolean;
  candidateRecall?: AgentCompletionCandidateRecallDepth[];
  targetFileAutopsy?: AgentCompletionTargetFileAutopsyRow[];
  candidateNoiseAutopsy?: AgentCompletionCandidateNoiseAutopsyRow[];
};

export type AgentCompletionMissShape =
  | "top1_hit"
  | "top3_hit_top1_miss"
  | "ranked_hit_top3_miss"
  | "ranked_miss_body_only"
  | "ranked_miss";

export type AgentCompletionMissShapeCounts = Record<
  AgentCompletionMissShape,
  number
>;

export type AgentCompletionMissShapeSummary = {
  caseBuckets: AgentCompletionMissShapeCounts;
  fileBuckets: {
    rankedHits: number;
    topThreeHits: number;
    supportHits: number;
    bodyOnlyHits: number;
    missingFromRanked: number;
    totalSrc: number;
  };
  supportBuckets: {
    useful: number;
    couldPromoteTop1Miss: number;
    missingWhenTop1Missed: number;
  };
};

export type AgentCompletionPromptVariantSummary = {
  promptCount: number;
  promptTop1Acceptable: number;
  promptTop3Useful: number;
  promptRankedUseful: number;
  promptSupportUseful: number;
  promptRankedCodeFileHits: number;
  promptRankedCodeFileTotal: number;
  ticketsWithPromptVariants: number;
  ticketsTop1Robust: number;
  ticketsTop3Robust: number;
  ticketsRankedRobust: number;
};

export type AgentCompletionCandidateRecallSummary = {
  depths: Array<{
    depth: number;
    promptUseful: number;
    promptCount: number;
    fileHits: number;
    fileTotal: number;
  }>;
  methodFamilies?: Array<{
    depth: number;
    family: CodeCandidateEvidenceFamily;
    promptUseful: number;
    promptCount: number;
    fileHits: number;
    fileTotal: number;
  }>;
  diagnostics?: {
    usefulShadowFiles: number;
    usefulAdmittedFiles: number;
    uselessAdmittedFiles: number;
    usefulBuriedFiles: number;
    topThreeUselessFiles: number;
  };
};

export type AgentCompletionDetailedSummary = {
  caseCount: number;
  rows: AgentCompletionDetailedRow[];
  totalSrc: number;
  totalSrcOverlap: number;
  totalDoc: number;
  totalDocOverlap: number;
  codeCaseCount: number;
  topCodeAcceptableCount: number;
  rankedCodeUsefulCount: number;
  supportClusterUsefulCount: number;
  rankedCodeFileOverlap: {
    mentioned: number;
    total: number;
  };
  bodyMentionOnlyFileOverlap: {
    mentioned: number;
    total: number;
  };
  supportClusterFileOverlap: {
    mentioned: number;
    total: number;
  };
  missShapeSummary?: AgentCompletionMissShapeSummary;
  promptVariantSummary?: AgentCompletionPromptVariantSummary;
  candidateRecallSummary?: AgentCompletionCandidateRecallSummary;
  targetFileAutopsySummary?: AgentCompletionTargetFileAutopsySummary;
  candidateNoiseAutopsySummary?: AgentCompletionCandidateNoiseAutopsySummary;
};

export type AgentCompletionEvalOptions = {
  budgetTokensOverride?: number;
  codeSourceIndexEnabled?: boolean;
  sourceFilePolicy?: AgentCompletionSourceFilePolicy;
  candidateRecallDepths?: number[];
};

export type AgentCompletionEvalPanel = {
  repoRoot: string;
  cases: AgentCompletionCase[];
};

export type AgentCompletionEvalPanelOptions = AgentCompletionEvalOptions &
  AgentCompletionEvalPanel;

const REPO_ROOT = process.env.AGENT_COMPLETION_REPO_ROOT ?? process.cwd();

export const AGENT_COMPLETION_CASES: AgentCompletionCase[] = [
  // ── PRD-0027 (nav + link graph) shipped slices ────────────────────
  {
    ticket: "THO-228",
    commit_sha: "493303b",
    queries: [
      "PRD-0027 SourceProfile nav-field extension import-time wiring",
      "SourceProfile nav fields buildSourceProfile",
      "NavGraph import wiring source-profile builder",
    ],
  },
  {
    ticket: "THO-227",
    commit_sha: "2ecd946",
    queries: [
      "PRD-0027 nav sidebar parser sub-parsers",
      "vitepress mkdocs docusaurus frontmatter nav parser",
      "parseNavConfig per-format extraction property tests",
    ],
  },
  {
    ticket: "THO-229",
    commit_sha: "c363aba",
    queries: [
      "PRD-0027 source-rerank wiring nav metadata flag",
      "nav-landing source-rerank scoring",
      "RETRIEVAL_NAV_METADATA flag overview-owner-score",
    ],
  },

  // ── PRD-0025 (structural contextual indexing) shipped slices ─────
  {
    ticket: "THO-225",
    commit_sha: "44e7735",
    queries: [
      "PRD-0025 BM25F field-weight extension structural context",
      "BM25F doc_title doc_purpose section_intro field weights",
      "structural chunk context flag candidate recall eval",
    ],
  },
  {
    ticket: "THO-224",
    commit_sha: "d4adc03",
    queries: [
      "PRD-0025 chunk table column extension FTS5",
      "chunk-table virtual table recreation reindex",
      "FTS5 schema migration chunk reindex",
    ],
  },
  {
    ticket: "THO-223",
    commit_sha: "5947445",
    queries: [
      "PRD-0025 chunk-structural-context extractor doc_purpose",
      "structural context extractor provenance trace",
      "chunk-level doc_purpose extractor synthetic property",
    ],
  },

  // ── PRD-0024 (import-time evidence) shipped slices ───────────────
  {
    ticket: "THO-221",
    commit_sha: "99cf920",
    queries: [
      "PRD-0024 code-fence entity consumption alias substrate",
      "code_fence_entities source-rerank wiring",
      "code-fence entity flag shadow eval",
    ],
  },
  {
    ticket: "THO-220",
    commit_sha: "fbd4300",
    queries: [
      "PRD-0024 SourceProfile code_fence_entities field import wiring",
      "code_fence_entities import-time wiring",
      "code_fence_entities SourceProfile schema field",
    ],
  },
  {
    ticket: "THO-219",
    commit_sha: "b4ca552",
    queries: [
      "PRD-0024 extractCodeFenceEntities extractor property tests",
      "code-fence entities markdown extractor",
      "extractCodeFenceEntities synthetic property gate",
    ],
  },
  {
    ticket: "THO-218",
    commit_sha: "9b62fd0",
    queries: [
      "PRD-0024 heading aliases source-rerank wiring",
      "heading_aliases SourceProfile field source-rerank evidence",
      "RETRIEVAL_HEADING_ALIASES flag flip",
    ],
  },
  {
    ticket: "THO-217",
    commit_sha: "bfe5abb",
    queries: [
      "PRD-0024 SourceProfile heading_aliases field import wiring",
      "heading_aliases SourceProfile schema field",
      "import-time wiring heading aliases extractor",
    ],
  },
  {
    ticket: "THO-216",
    commit_sha: "84a2ed3",
    queries: [
      "PRD-0024 extractHeadingAliases extractor property tests",
      "heading aliases markdown H1 H2 H3 extractor",
      "extractHeadingAliases synthetic property gate",
    ],
  },

  // ── PRD-0023 (path topology) shipped slices ──────────────────────
  {
    ticket: "THO-214",
    commit_sha: "32a46e2",
    queries: [
      "PRD-0023 path-topology source-rerank boosts flag",
      "landing index package version boost source-rerank",
      "RETRIEVAL_PATH_TOPOLOGY_BOOSTS flag",
    ],
  },
  {
    ticket: "THO-213",
    commit_sha: "6dac61a",
    queries: [
      "PRD-0023 SourceProfile path-topology fields import wiring",
      "is_index_file is_section_landing path_depth SourceProfile",
      "package_segment version_segment SourceProfile extension",
    ],
  },
];

function getFilesChangedInCommit(
  sha: string,
  repoRoot: string,
  options: { diffFilter?: string } = {},
): string[] {
  try {
    const diffFilter = options.diffFilter
      ? ` --diff-filter=${options.diffFilter}`
      : "";
    const out = execSync(`git show --pretty=format: --name-only${diffFilter} ${sha}`, {
      cwd: repoRoot,
    }).toString();
    return out.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  } catch (err) {
    process.stderr.write(`Failed to read commit ${sha}: ${err}\n`);
    return [];
  }
}

/**
 * Find file-path-shaped tokens in a body of text: `src/foo/bar.ts`,
 * `docs/prd/0027-x.md`, etc. Pure regex — does not depend on
 * frontmatter or specific corpus conventions.
 */
function extractFilePathMentions(body: string): Set<string> {
  const out = new Set<string>();
  const re =
    /(?:^|[\s`("'[])(\.?(?:\/)?(?:src|packages|apps|lib|crates|pkg|cmd|internal|tests|docs)\/[A-Za-z0-9_@\-/.()]+\.(?:tsx|ts|jsx|js|py|go|rs|mdx|md))(?=$|[\s`"',.;:)\]])/g;
  for (const m of body.matchAll(re)) {
    if (m[1]) out.add(m[1].replace(/^\.\//, ""));
  }
  return out;
}

export function extractMentionedPaths(args: {
  body: string;
  source_path?: string;
}): Set<string> {
  const out = extractFilePathMentions(args.body);
  if (args.source_path) out.add(args.source_path);
  return out;
}

export function categorizeAgentCompletionPath(
  path: string,
): "src" | "test" | "doc" | "other" {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.endsWith(".md") || normalized.endsWith(".mdx")) return "doc";
  if (
    normalized.includes(".test.") ||
    normalized.includes(".spec.") ||
    /_test\.(?:go|rs|py)$/.test(normalized) ||
    normalized.startsWith("tests/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/")
  ) {
    return "test";
  }
  if (/\.(?:ts|tsx|js|jsx|py|go|rs)$/.test(normalized)) return "src";
  return "other";
}

function categorize(path: string): "src" | "test" | "doc" | "other" {
  return categorizeAgentCompletionPath(path);
}

function changedSourceFilesForPolicy(args: {
  changedFiles: readonly string[];
  repoRoot: string;
  policy: AgentCompletionSourceFilePolicy;
}): string[] {
  if (args.policy === "oss-code-lane") {
    return args.changedFiles.filter((file) =>
      isOssCodeLaneTargetFile({ file, repoRoot: args.repoRoot }),
    );
  }
  return args.changedFiles.filter((file) => categorize(file) === "src");
}

function changedFileDiffFilterForPolicy(
  policy: AgentCompletionSourceFilePolicy,
): string | undefined {
  return policy === "oss-code-lane" ? "ACMRT" : undefined;
}

function normalizedCandidateRecallDepths(
  depths: readonly number[] | undefined,
): number[] {
  if (!depths) return [];
  return [...new Set(depths)]
    .filter((depth) => Number.isInteger(depth) && depth > 0)
    .sort((a, b) => a - b);
}

function computeCandidateObservability(args: {
  db: ReturnType<typeof openDb>;
  query: string;
  changedSourceFiles: readonly string[];
  depths: readonly number[];
  packRankedFiles: readonly string[];
}): {
  candidateRecall: AgentCompletionCandidateRecallDepth[];
  targetFileAutopsy: AgentCompletionTargetFileAutopsyRow[];
  candidateNoiseAutopsy: AgentCompletionCandidateNoiseAutopsyRow[];
} {
  if (args.depths.length === 0 || !codeSourceIndexEnabledFromEnv()) {
    return {
      candidateRecall: [],
      targetFileAutopsy: [],
      candidateNoiseAutopsy: [],
    };
  }
  const maxDepth = Math.max(...args.depths);
  const entries = buildCodeRankedEntries({
    db: args.db,
    query: args.query,
    query_anchors: { files: [], symbols: [], routes: [] },
    max_results: maxDepth,
    enabled: true,
  });
  const orderedFiles = uniqueNonEmpty(entries.map((entry) => entry.source_path));
  const diagnostics = buildCodeCandidateDiagnostics({
    db: args.db,
    query: args.query,
    query_anchors: { files: [], symbols: [], routes: [] },
    max_results: maxDepth,
    enabled: true,
  });
  const candidateRecall = args.depths.map((depth) => {
    const visible = new Set(orderedFiles.slice(0, depth));
    const changedFiles = args.changedSourceFiles.filter((file) =>
      visible.has(file),
    );
    const topThree = new Set(orderedFiles.slice(0, 3));
    const visibleDiagnostics = diagnostics.slice(0, depth);
    const diagnosticPaths = new Set(
      visibleDiagnostics.map((candidate) => candidate.source_path),
    );
    const changedDiagnosticFiles = args.changedSourceFiles.filter((file) =>
      diagnosticPaths.has(file),
    );
    const usefulShadowFiles = changedDiagnosticFiles.filter((file) =>
      visibleDiagnostics.some((candidate) =>
        candidate.source_path === file && candidate.shadow
      ),
    );
    const usefulAdmittedFiles = changedDiagnosticFiles.filter((file) =>
      visibleDiagnostics.some((candidate) =>
        candidate.source_path === file && candidate.admitted
      ),
    );
    const uselessAdmittedFiles = visibleDiagnostics
      .filter((candidate) =>
        candidate.admitted && !args.changedSourceFiles.includes(candidate.source_path)
      )
      .map((candidate) => candidate.source_path);
    const usefulBuriedFiles = changedDiagnosticFiles.filter((file) =>
      !topThree.has(file),
    );
    const topThreeUselessFiles = orderedFiles
      .slice(0, 3)
      .filter((file) => !args.changedSourceFiles.includes(file));
    const methodFamilyRecall = summarizeCandidateMethodFamilyRecall({
      diagnostics: visibleDiagnostics,
      changedSourceFiles: args.changedSourceFiles,
    });
    return {
      depth,
      codeFiles: orderedFiles.slice(0, depth),
      changedFiles,
      fileHits: changedFiles.length,
      fileTotal: args.changedSourceFiles.length,
      useful: changedFiles.length > 0,
      ...(methodFamilyRecall.length > 0 ? { methodFamilyRecall } : {}),
      ...(usefulShadowFiles.length > 0 ? { usefulShadowFiles } : {}),
      ...(usefulAdmittedFiles.length > 0 ? { usefulAdmittedFiles } : {}),
      ...(uselessAdmittedFiles.length > 0 ? { uselessAdmittedFiles } : {}),
      ...(usefulBuriedFiles.length > 0 ? { usefulBuriedFiles } : {}),
      ...(topThreeUselessFiles.length > 0 ? { topThreeUselessFiles } : {}),
    };
  });
  return {
    candidateRecall,
    targetFileAutopsy: buildTargetFileAutopsy({
      db: args.db,
      query: args.query,
      targetFiles: args.changedSourceFiles,
      packRankedFiles: args.packRankedFiles,
      candidateRankedFiles: orderedFiles,
      diagnostics,
      maxDepth,
    }),
    candidateNoiseAutopsy: buildCandidateNoiseAutopsy({
      db: args.db,
      query: args.query,
      targetFiles: args.changedSourceFiles,
      packRankedFiles: args.packRankedFiles,
      candidateRankedFiles: orderedFiles,
      diagnostics,
      maxDepth,
    }),
  };
}

function buildTargetFileAutopsy(args: {
  db: ReturnType<typeof openDb>;
  query: string;
  targetFiles: readonly string[];
  packRankedFiles: readonly string[];
  candidateRankedFiles: readonly string[];
  diagnostics: readonly CodeCandidateDiagnostic[];
  maxDepth: number;
}): AgentCompletionTargetFileAutopsyRow[] {
  if (args.targetFiles.length === 0) return [];
  const diagnosticByPath = new Map(
    args.diagnostics.map((diagnostic) => [diagnostic.source_path, diagnostic]),
  );
  const ownerFiles = ownerCandidateFiles(args.candidateRankedFiles, args.packRankedFiles);
  const topOwnerFile = ownerFiles[0]?.sourcePath ?? null;
  const queryTokens = evalTokenSet(args.query);
  return args.targetFiles.map((targetFile) => {
    const source = getCodeSource(args.db, targetFile);
    const chunks = source ? listCodeChunksForSource(args.db, targetFile) : [];
    const diagnostic = diagnosticByPath.get(targetFile);
    const candidateRank = oneBasedIndex(args.candidateRankedFiles, targetFile);
    const packRank = oneBasedIndex(args.packRankedFiles, targetFile);
    const evidence = diagnostic?.evidence?.evidence ?? [];
    const evidenceFamilies = uniqueSorted(
      evidence.map((item) => item.family),
    ) as CodeCandidateEvidenceFamily[];
    const evidenceReasons = uniqueSorted(evidence.map((item) => item.reason));
    const overlaps = targetFactOverlaps({
      queryTokens,
      path: targetFile,
      source,
    });
    const row: AgentCompletionTargetFileAutopsyRow = {
      query: args.query,
      targetFile,
      indexed: source !== null,
      hasChunks: chunks.length > 0,
      packRank,
      candidateRank,
      diagnosticRank: diagnostic?.rank ?? null,
      candidateScore: diagnostic?.score ?? null,
      candidateConfidenceLevel: diagnostic?.confidence.level ?? null,
      candidateConfidenceScore: diagnostic?.confidence.score ?? null,
      candidateRetryRecommended:
        diagnostic?.confidence.retry_recommended ?? false,
      candidateAdmitted: diagnostic?.admitted ?? false,
      candidateShadow: diagnostic?.shadow ?? false,
      evidenceFamilies,
      evidenceReasons,
      topOwnerFile,
      ownerRelations: ownerRelationsForTarget(args.db, topOwnerFile, targetFile),
      ownerCandidates: ownerCandidateRelationsForTarget(
        args.db,
        ownerFiles,
        targetFile,
      ),
      queryTokenCount: queryTokens.size,
      pathTokenOverlap: overlaps.path,
      symbolTokenOverlap: overlaps.symbol,
      purposeTokenOverlap: overlaps.purpose,
      factTokenOverlap: overlaps.fact,
      outcome: "never_generated",
    };
    return {
      ...row,
      outcome: classifyTargetFileOutcome(row, args.maxDepth),
    };
  });
}

function buildCandidateNoiseAutopsy(args: {
  db: ReturnType<typeof openDb>;
  query: string;
  targetFiles: readonly string[];
  packRankedFiles: readonly string[];
  candidateRankedFiles: readonly string[];
  diagnostics: readonly CodeCandidateDiagnostic[];
  maxDepth: number;
}): AgentCompletionCandidateNoiseAutopsyRow[] {
  const targetSet = new Set(args.targetFiles);
  const ownerFiles = ownerCandidateFiles(args.candidateRankedFiles, args.packRankedFiles);
  const topOwnerFile = ownerFiles[0]?.sourcePath ?? null;
  const queryTokens = evalTokenSet(args.query);
  return args.diagnostics
    .slice(0, args.maxDepth)
    .filter((diagnostic) => !targetSet.has(diagnostic.source_path))
    .map((diagnostic) => {
      const source = getCodeSource(args.db, diagnostic.source_path);
      const evidence = diagnostic.evidence?.evidence ?? [];
      const overlaps = targetFactOverlaps({
        queryTokens,
        path: diagnostic.source_path,
        source,
      });
      return {
        query: args.query,
        sourcePath: diagnostic.source_path,
        rank: diagnostic.rank,
        score: diagnostic.score,
        confidenceLevel: diagnostic.confidence.level,
        confidenceScore: diagnostic.confidence.score,
        retryRecommended: diagnostic.confidence.retry_recommended,
        admitted: diagnostic.admitted,
        shadow: diagnostic.shadow,
        packRank: oneBasedIndex(args.packRankedFiles, diagnostic.source_path),
        evidenceFamilies: uniqueSorted(
          evidence.map((item) => item.family),
        ) as CodeCandidateEvidenceFamily[],
        evidenceReasons: uniqueSorted(evidence.map((item) => item.reason)),
        topOwnerFile,
        ownerRelations: ownerRelationsForTarget(
          args.db,
          topOwnerFile,
          diagnostic.source_path,
        ),
        queryTokenCount: queryTokens.size,
        pathTokenOverlap: overlaps.path,
        symbolTokenOverlap: overlaps.symbol,
        purposeTokenOverlap: overlaps.purpose,
        factTokenOverlap: overlaps.fact,
      };
    });
}

function classifyTargetFileOutcome(
  row: AgentCompletionTargetFileAutopsyRow,
  maxDepth: number,
): AgentCompletionTargetFileOutcome {
  if (!row.indexed) return "not_indexed";
  if (!row.hasChunks) return "no_chunks";
  if (row.packRank !== null && row.packRank <= 3) return "pack_top3_hit";
  if (row.packRank !== null) return "pack_ranked_hit";
  if (row.candidateRank !== null && row.candidateRank <= 10) {
    return "candidate_top10_hit";
  }
  if (row.candidateRank !== null && row.candidateRank <= 30) {
    return "candidate_top30_hit";
  }
  if (row.candidateRank !== null && row.candidateRank <= 100) {
    return "candidate_top100_hit";
  }
  if (row.candidateRank !== null && row.candidateRank <= maxDepth) {
    return "candidate_hit";
  }
  if (row.candidateShadow) return "candidate_shadow_only";
  if (row.diagnosticRank !== null) return "generated_buried";
  return "never_generated";
}

function summarizeCandidateMethodFamilyRecall(args: {
  diagnostics: readonly CodeCandidateDiagnostic[];
  changedSourceFiles: readonly string[];
}): AgentCompletionCandidateMethodFamilyRecall[] {
  const families = new Set<CodeCandidateEvidenceFamily>();
  const familiesByPath = new Map<string, Set<CodeCandidateEvidenceFamily>>();
  for (const candidate of args.diagnostics) {
    const candidateFamilies = new Set(
      candidate.evidence?.evidence.map((item) => item.family) ?? [],
    );
    if (candidateFamilies.size === 0) continue;
    familiesByPath.set(candidate.source_path, candidateFamilies);
    for (const family of candidateFamilies) families.add(family);
  }
  return [...families]
    .sort()
    .map((family) => {
      const changedFiles = args.changedSourceFiles.filter((file) =>
        familiesByPath.get(file)?.has(family),
      );
      return {
        family,
        changedFiles,
        fileHits: changedFiles.length,
        fileTotal: args.changedSourceFiles.length,
        useful: changedFiles.length > 0,
      };
    });
}

function targetFactOverlaps(args: {
  queryTokens: ReadonlySet<string>;
  path: string;
  source: ReturnType<typeof getCodeSource>;
}): { path: number; symbol: number; purpose: number; fact: number } {
  const pathTokens = evalTokenSet(args.path);
  const symbolTokens = evalTokenSet(
    args.source?.facts.exported_symbols.map((symbol) => symbol.name).join(" ") ?? "",
  );
  const purposeTokens = evalTokenSet(args.source?.facts.file_purpose ?? "");
  const factTokens = new Set([
    ...pathTokens,
    ...symbolTokens,
    ...purposeTokens,
  ]);
  return {
    path: overlapCount(args.queryTokens, pathTokens),
    symbol: overlapCount(args.queryTokens, symbolTokens),
    purpose: overlapCount(args.queryTokens, purposeTokens),
    fact: overlapCount(args.queryTokens, factTokens),
  };
}

function ownerRelationsForTarget(
  db: ReturnType<typeof openDb>,
  ownerFile: string | null,
  targetFile: string,
): AgentCompletionTargetOwnerRelation[] {
  if (!ownerFile) return ["unknown"];
  const relations: AgentCompletionTargetOwnerRelation[] = [];
  if (ownerFile === targetFile) relations.push("same_file");
  if (sourceDirectory(ownerFile) === sourceDirectory(targetFile)) {
    relations.push("same_directory");
  }
  const ownerPackage = packageRoot(ownerFile);
  const targetPackage = packageRoot(targetFile);
  if (ownerPackage !== null && ownerPackage === targetPackage) {
    relations.push("same_package");
  }
  const ownerSuffix = pathSuffix(ownerFile, 2);
  if (ownerSuffix !== null && ownerSuffix === pathSuffix(targetFile, 2)) {
    relations.push("same_path_suffix");
  }
  if (listCodeGraphNeighbors(db, { source_path: ownerFile, direction: "outgoing" })
    .includes(targetFile)) {
    relations.push("owner_imports_target");
  }
  if (listCodeGraphNeighbors(db, { source_path: ownerFile, direction: "incoming" })
    .includes(targetFile)) {
    relations.push("target_imports_owner");
  }
  return relations.length > 0 ? uniqueRelations(relations) : ["unknown"];
}

function ownerCandidateFiles(
  candidateRankedFiles: readonly string[],
  packRankedFiles: readonly string[],
): Array<Omit<AgentCompletionOwnerCandidateRelation, "relations">> {
  return uniqueNonEmpty([
    ...candidateRankedFiles.slice(0, 5),
    ...packRankedFiles.slice(0, 5),
  ]).map((sourcePath, index) => ({
    sourcePath,
    rank: index + 1,
    candidateRank: oneBasedIndex(candidateRankedFiles, sourcePath),
    packRank: oneBasedIndex(packRankedFiles, sourcePath),
  }));
}

function ownerCandidateRelationsForTarget(
  db: ReturnType<typeof openDb>,
  ownerFiles: readonly Omit<AgentCompletionOwnerCandidateRelation, "relations">[],
  targetFile: string,
): AgentCompletionOwnerCandidateRelation[] {
  return ownerFiles.map((ownerFile) => ({
    ...ownerFile,
    relations: ownerRelationsForTarget(db, ownerFile.sourcePath, targetFile),
  }));
}

function uniqueRelations(
  relations: readonly AgentCompletionTargetOwnerRelation[],
): AgentCompletionTargetOwnerRelation[] {
  return [...new Set(relations)];
}

function sourceDirectory(path: string): string {
  const normalized = normalizeEvalPath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function packageRoot(path: string): string | null {
  const segments = normalizeEvalPath(path).split("/").filter(Boolean);
  const markerIndex = segments.findIndex((segment) =>
    ["apps", "crates", "libs", "packages", "pkg"].includes(segment)
  );
  if (markerIndex >= 0 && segments[markerIndex + 1]) {
    return `${segments[markerIndex]}/${segments[markerIndex + 1]}`;
  }
  if (segments[0] === "src" && segments[1]) return `src/${segments[1]}`;
  if (segments[0] === "internal" && segments[1]) return `internal/${segments[1]}`;
  return null;
}

function pathSuffix(path: string, segmentCount: number): string | null {
  const segments = normalizeEvalPath(path).split("/").filter(Boolean);
  if (segments.length < segmentCount) return null;
  return segments.slice(-segmentCount).join("/");
}

function oneBasedIndex(values: readonly string[], target: string): number | null {
  const index = values.indexOf(target);
  return index === -1 ? null : index + 1;
}

function evalTokenSet(text: string): Set<string> {
  return new Set(
    text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1)
      .map(singularizeEvalToken),
  );
}

function singularizeEvalToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (
    token.endsWith("s") &&
    token.length > 3 &&
    token !== "vcs" &&
    token !== "css" &&
    !token.endsWith("ss")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function overlapCount(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function normalizeEvalPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
}

const AGENT_COMPLETION_MISS_SHAPES: readonly AgentCompletionMissShape[] = [
  "top1_hit",
  "top3_hit_top1_miss",
  "ranked_hit_top3_miss",
  "ranked_miss_body_only",
  "ranked_miss",
];

function emptyMissShapeCounts(): AgentCompletionMissShapeCounts {
  return Object.fromEntries(
    AGENT_COMPLETION_MISS_SHAPES.map((shape) => [shape, 0]),
  ) as AgentCompletionMissShapeCounts;
}

function changedSrcFiles(row: AgentCompletionProbeRow): string[] {
  if (row.targetSourceFiles) return row.targetSourceFiles;
  return row.changedFiles.filter((file) => categorize(file) === "src");
}

function topThreeCodeChangedFiles(row: AgentCompletionDetailedRow): string[] {
  if (row.topThreeCodeChangedFiles) return row.topThreeCodeChangedFiles;
  const topThree = new Set(row.rankedCodeFiles.slice(0, 3));
  return changedSrcFiles(row).filter((file) => topThree.has(file));
}

function bodyMentionOnlyChangedFiles(row: AgentCompletionDetailedRow): string[] {
  return changedSrcFiles(row).filter(
    (file) =>
      row.mentionedFiles.includes(file) &&
      !row.rankedCodeChangedFiles.includes(file),
  );
}

export function classifyAgentCompletionMissShape(
  row: AgentCompletionDetailedRow,
): AgentCompletionMissShape {
  if (row.topCodeAcceptable) return "top1_hit";
  if (topThreeCodeChangedFiles(row).length > 0) {
    return "top3_hit_top1_miss";
  }
  if (row.rankedCodeChangedFiles.length > 0) {
    return "ranked_hit_top3_miss";
  }
  if (bodyMentionOnlyChangedFiles(row).length > 0) {
    return "ranked_miss_body_only";
  }
  return "ranked_miss";
}

export function summarizeAgentCompletionMissShapes(
  rows: AgentCompletionDetailedRow[],
): AgentCompletionMissShapeSummary {
  const caseBuckets = emptyMissShapeCounts();
  const fileBuckets: AgentCompletionMissShapeSummary["fileBuckets"] = {
    rankedHits: 0,
    topThreeHits: 0,
    supportHits: 0,
    bodyOnlyHits: 0,
    missingFromRanked: 0,
    totalSrc: 0,
  };
  const supportBuckets: AgentCompletionMissShapeSummary["supportBuckets"] = {
    useful: 0,
    couldPromoteTop1Miss: 0,
    missingWhenTop1Missed: 0,
  };

  for (const row of rows) {
    if (row.srcTotal === 0) continue;
    caseBuckets[classifyAgentCompletionMissShape(row)] += 1;
    const srcChanged = changedSrcFiles(row);
    fileBuckets.totalSrc += srcChanged.length;
    fileBuckets.rankedHits += row.rankedCodeChangedFiles.length;
    fileBuckets.topThreeHits += topThreeCodeChangedFiles(row).length;
    fileBuckets.supportHits += row.supportClusterChangedFiles.length;
    fileBuckets.bodyOnlyHits += bodyMentionOnlyChangedFiles(row).length;
    fileBuckets.missingFromRanked += srcChanged.filter(
      (file) => !row.rankedCodeChangedFiles.includes(file),
    ).length;

    if (row.supportClusterUseful) supportBuckets.useful += 1;
    if (!row.topCodeAcceptable && row.supportClusterChangedFiles.length > 0) {
      supportBuckets.couldPromoteTop1Miss += 1;
    }
    if (!row.topCodeAcceptable && row.supportClusterChangedFiles.length === 0) {
      supportBuckets.missingWhenTop1Missed += 1;
    }
  }

  return {
    caseBuckets,
    fileBuckets,
    supportBuckets,
  };
}

function variantsForRow(
  row: AgentCompletionDetailedRow,
): AgentCompletionPromptVariantRow[] {
  if (row.promptVariants && row.promptVariants.length > 0) {
    return row.promptVariants;
  }
  return [
    {
      query: "(aggregate)",
      mentionedFiles: row.mentionedFiles,
      topCodeFiles: row.topCodeFiles,
      topThreeCodeFiles: row.topThreeCodeFiles ?? row.rankedCodeFiles.slice(0, 3),
      topThreeCodeChangedFiles: topThreeCodeChangedFiles(row),
      rankedCodeFiles: row.rankedCodeFiles,
      rankedCodeChangedFiles: row.rankedCodeChangedFiles,
      supportClusterFiles: row.supportClusterFiles,
      supportClusterChangedFiles: row.supportClusterChangedFiles,
      srcOverlap: row.srcOverlap,
      topCodeAcceptable: row.topCodeAcceptable,
      topThreeCodeUseful: topThreeCodeChangedFiles(row).length > 0,
      rankedCodeUseful: row.rankedCodeUseful,
      supportClusterUseful: row.supportClusterUseful,
    },
  ];
}

export function summarizeAgentCompletionPromptVariants(
  rows: AgentCompletionDetailedRow[],
): AgentCompletionPromptVariantSummary {
  const codeRows = rows.filter((row) => row.srcTotal > 0);
  const variants = codeRows.flatMap((row) => variantsForRow(row).map((variant) => ({
    row,
    variant,
  })));
  return {
    promptCount: variants.length,
    promptTop1Acceptable: variants.filter(({ variant }) => variant.topCodeAcceptable)
      .length,
    promptTop3Useful: variants.filter(({ variant }) => variant.topThreeCodeUseful)
      .length,
    promptRankedUseful: variants.filter(({ variant }) => variant.rankedCodeUseful)
      .length,
    promptSupportUseful: variants.filter(({ variant }) => variant.supportClusterUseful)
      .length,
    promptRankedCodeFileHits: variants.reduce(
      (sum, { variant }) => sum + variant.rankedCodeChangedFiles.length,
      0,
    ),
    promptRankedCodeFileTotal: variants.reduce(
      (sum, { row }) => sum + row.srcTotal,
      0,
    ),
    ticketsWithPromptVariants: codeRows.length,
    ticketsTop1Robust: codeRows.filter((row) =>
      variantsForRow(row).every((variant) => variant.topCodeAcceptable),
    ).length,
    ticketsTop3Robust: codeRows.filter((row) =>
      variantsForRow(row).every((variant) => variant.topThreeCodeUseful),
    ).length,
    ticketsRankedRobust: codeRows.filter((row) =>
      variantsForRow(row).every((variant) => variant.rankedCodeUseful),
    ).length,
  };
}

export function summarizeAgentCompletionCandidateRecall(
  rows: AgentCompletionDetailedRow[],
): AgentCompletionCandidateRecallSummary | undefined {
  const variants = rows.flatMap((row) => variantsForRow(row));
  const depthMap = new Map<
    number,
    { promptUseful: number; promptCount: number; fileHits: number; fileTotal: number }
  >();
  const methodFamilyMap = new Map<
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
  for (const variant of variants) {
    for (const recall of variant.candidateRecall ?? []) {
      const current = depthMap.get(recall.depth) ?? {
        promptUseful: 0,
        promptCount: 0,
        fileHits: 0,
        fileTotal: 0,
      };
      current.promptCount += 1;
      if (recall.useful) current.promptUseful += 1;
      current.fileHits += recall.fileHits;
      current.fileTotal += recall.fileTotal;
      depthMap.set(recall.depth, current);

      for (const familyRecall of recall.methodFamilyRecall ?? []) {
        const key = `${recall.depth}:${familyRecall.family}`;
        const currentFamily = methodFamilyMap.get(key) ?? {
          depth: recall.depth,
          family: familyRecall.family,
          promptUseful: 0,
          promptCount: 0,
          fileHits: 0,
          fileTotal: 0,
        };
        currentFamily.promptCount += 1;
        if (familyRecall.useful) currentFamily.promptUseful += 1;
        currentFamily.fileHits += familyRecall.fileHits;
        currentFamily.fileTotal += familyRecall.fileTotal;
        methodFamilyMap.set(key, currentFamily);
      }

      diagnostics.usefulShadowFiles += recall.usefulShadowFiles?.length ?? 0;
      diagnostics.usefulAdmittedFiles += recall.usefulAdmittedFiles?.length ?? 0;
      diagnostics.uselessAdmittedFiles += recall.uselessAdmittedFiles?.length ?? 0;
      diagnostics.usefulBuriedFiles += recall.usefulBuriedFiles?.length ?? 0;
      diagnostics.topThreeUselessFiles += recall.topThreeUselessFiles?.length ?? 0;
    }
  }
  if (depthMap.size === 0) return undefined;
  const diagnosticsTotal =
    diagnostics.usefulShadowFiles +
    diagnostics.usefulAdmittedFiles +
    diagnostics.uselessAdmittedFiles +
    diagnostics.usefulBuriedFiles +
    diagnostics.topThreeUselessFiles;
  const summary: AgentCompletionCandidateRecallSummary = {
    depths: [...depthMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, value]) => ({ depth, ...value })),
  };
  if (methodFamilyMap.size > 0) {
    summary.methodFamilies = [...methodFamilyMap.values()].sort(
      (a, b) => a.depth - b.depth || a.family.localeCompare(b.family),
    );
  }
  if (diagnosticsTotal > 0) {
    summary.diagnostics = diagnostics;
  }
  return summary;
}

export function summarizeAgentCompletionTargetFileAutopsy(
  rows: AgentCompletionDetailedRow[],
): AgentCompletionTargetFileAutopsySummary | undefined {
  const autopsies = rows.flatMap((row) =>
    variantsForRow(row).flatMap((variant) => variant.targetFileAutopsy ?? [])
  );
  if (autopsies.length === 0) return undefined;
  const outcomes = countAutopsyValues(autopsies.map((row) => row.outcome));
  const ownerRelations = countAutopsyValues(
    autopsies.flatMap((row) => row.ownerRelations),
  );
  const ownerCandidateRelations = countAutopsyValues(
    autopsies.flatMap((row) =>
      row.ownerCandidates.flatMap((candidate) => candidate.relations)
    ),
  );
  const evidenceFamilies = countAutopsyValues(
    autopsies.flatMap((row) => row.evidenceFamilies),
  );
  return {
    observations: autopsies.length,
    indexed: autopsies.filter((row) => row.indexed).length,
    withChunks: autopsies.filter((row) => row.hasChunks).length,
    packTopThreeHits: autopsies.filter((row) =>
      row.packRank !== null && row.packRank <= 3
    ).length,
    packRankedHits: autopsies.filter((row) => row.packRank !== null).length,
    candidateTopTenHits: autopsies.filter((row) =>
      row.candidateRank !== null && row.candidateRank <= 10
    ).length,
    candidateTopThirtyHits: autopsies.filter((row) =>
      row.candidateRank !== null && row.candidateRank <= 30
    ).length,
    candidateTopHundredHits: autopsies.filter((row) =>
      row.candidateRank !== null && row.candidateRank <= 100
    ).length,
    queryObvious: {
      path: autopsies.filter((row) => row.pathTokenOverlap > 0).length,
      symbol: autopsies.filter((row) => row.symbolTokenOverlap > 0).length,
      purpose: autopsies.filter((row) => row.purposeTokenOverlap > 0).length,
      noFactOverlap: autopsies.filter((row) => row.factTokenOverlap === 0).length,
    },
    outcomes: outcomes.map(({ value, count }) => ({ outcome: value, count })),
    ownerRelations: ownerRelations.map(({ value, count }) => ({
      relation: value,
      count,
    })),
    ownerCandidateRelations: ownerCandidateRelations.map(({ value, count }) => ({
      relation: value,
      count,
    })),
    evidenceFamilies: evidenceFamilies.map(({ value, count }) => ({
      family: value,
      count,
    })),
  };
}

export function summarizeAgentCompletionCandidateNoiseAutopsy(
  rows: AgentCompletionDetailedRow[],
): AgentCompletionCandidateNoiseAutopsySummary | undefined {
  const noiseRows = rows.flatMap((row) =>
    variantsForRow(row).flatMap((variant) => variant.candidateNoiseAutopsy ?? [])
  );
  if (noiseRows.length === 0) return undefined;
  const ownerRelations = countAutopsyValues(
    noiseRows.flatMap((row) => row.ownerRelations),
  );
  const evidenceFamilies = countAutopsyValues(
    noiseRows.flatMap((row) => row.evidenceFamilies),
  );
  return {
    observations: noiseRows.length,
    admitted: noiseRows.filter((row) => row.admitted).length,
    shadow: noiseRows.filter((row) => row.shadow).length,
    packRanked: noiseRows.filter((row) => row.packRank !== null).length,
    candidateTopThree: noiseRows.filter((row) => row.rank <= 3).length,
    candidateTopTen: noiseRows.filter((row) => row.rank <= 10).length,
    candidateTopThirty: noiseRows.filter((row) => row.rank <= 30).length,
    queryObvious: {
      path: noiseRows.filter((row) => row.pathTokenOverlap > 0).length,
      symbol: noiseRows.filter((row) => row.symbolTokenOverlap > 0).length,
      purpose: noiseRows.filter((row) => row.purposeTokenOverlap > 0).length,
      noFactOverlap: noiseRows.filter((row) => row.factTokenOverlap === 0).length,
    },
    ownerRelations: ownerRelations.map(({ value, count }) => ({
      relation: value,
      count,
    })),
    evidenceFamilies: evidenceFamilies.map(({ value, count }) => ({
      family: value,
      count,
    })),
  };
}

function countAutopsyValues<T extends string>(
  values: readonly T[],
): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function summarizeAgentCompletionRows(
  rows: AgentCompletionProbeRow[],
  caseCount = AGENT_COMPLETION_CASES.length,
): AgentCompletionProbeSummary {
  return {
    caseCount,
    rows,
    totalSrc: rows.reduce((sum, row) => sum + row.srcTotal, 0),
    totalSrcOverlap: rows.reduce((sum, row) => sum + row.srcOverlap, 0),
    totalDoc: rows.reduce((sum, row) => sum + row.docTotal, 0),
    totalDocOverlap: rows.reduce((sum, row) => sum + row.docOverlap, 0),
  };
}

export function summarizeAgentCompletionDetailedRows(
  rows: AgentCompletionDetailedRow[],
  caseCount = AGENT_COMPLETION_CASES.length,
): AgentCompletionDetailedSummary {
  const candidateRecallSummary = summarizeAgentCompletionCandidateRecall(rows);
  const targetFileAutopsySummary = summarizeAgentCompletionTargetFileAutopsy(rows);
  const candidateNoiseAutopsySummary =
    summarizeAgentCompletionCandidateNoiseAutopsy(rows);
  return {
    caseCount,
    rows,
    totalSrc: rows.reduce((sum, row) => sum + row.srcTotal, 0),
    totalSrcOverlap: rows.reduce((sum, row) => sum + row.srcOverlap, 0),
    totalDoc: rows.reduce((sum, row) => sum + row.docTotal, 0),
    totalDocOverlap: rows.reduce((sum, row) => sum + row.docOverlap, 0),
    codeCaseCount: rows.filter((row) => row.srcTotal > 0).length,
    topCodeAcceptableCount: rows.filter((row) => row.topCodeAcceptable).length,
    rankedCodeUsefulCount: rows.filter((row) => row.rankedCodeUseful).length,
    supportClusterUsefulCount: rows.filter((row) => row.supportClusterUseful).length,
    rankedCodeFileOverlap: {
      mentioned: rows.reduce(
        (sum, row) => sum + row.rankedCodeChangedFiles.length,
        0,
      ),
      total: rows.reduce((sum, row) => sum + row.srcTotal, 0),
    },
    bodyMentionOnlyFileOverlap: {
      mentioned: rows.reduce(
        (sum, row) => sum + bodyMentionOnlyChangedFiles(row).length,
        0,
      ),
      total: rows.reduce((sum, row) => sum + row.srcTotal, 0),
    },
    supportClusterFileOverlap: {
      mentioned: rows.reduce(
        (sum, row) => sum + row.supportClusterChangedFiles.length,
        0,
      ),
      total: rows.reduce((sum, row) => sum + row.srcTotal, 0),
    },
    missShapeSummary: summarizeAgentCompletionMissShapes(rows),
    promptVariantSummary: summarizeAgentCompletionPromptVariants(rows),
    ...(candidateRecallSummary ? { candidateRecallSummary } : {}),
    ...(targetFileAutopsySummary ? { targetFileAutopsySummary } : {}),
    ...(candidateNoiseAutopsySummary ? { candidateNoiseAutopsySummary } : {}),
  };
}

export async function withCodeSourceIndexOverride<T>(
  enabled: boolean | undefined,
  run: () => Promise<T> | T,
): Promise<T> {
  const previous = process.env.RETRIEVAL_CODE_SOURCE_INDEX;
  if (enabled !== undefined) {
    process.env.RETRIEVAL_CODE_SOURCE_INDEX = enabled ? "on" : "off";
  }
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.RETRIEVAL_CODE_SOURCE_INDEX;
    else process.env.RETRIEVAL_CODE_SOURCE_INDEX = previous;
  }
}

export function agentCompletionVerdictFromSummary(summary: AgentCompletionProbeSummary) {
  const commitsPassing = summary.rows.filter(
    (row) => row.srcTotal > 0 && row.srcOverlap === row.srcTotal,
  ).length;
  const commitsTotal = summary.rows.filter((row) => row.srcTotal > 0).length;
  return evaluateAssemblyGates({
    agent_completion_commits: { passing: commitsPassing, total: commitsTotal },
    agent_completion_files: { mentioned: summary.totalSrcOverlap, total: summary.totalSrc },
  });
}

export function renderAgentCompletionReport(summary: AgentCompletionProbeSummary): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("========== AGENT-COMPLETION PROBE ==========");
  lines.push(`${summary.caseCount} tickets, comparing pack-mentioned files to actual commit diffs.`);
  lines.push("");
  lines.push(
    `Source files (src/**) pointed-at: ${summary.totalSrcOverlap}/${summary.totalSrc}  (${(summary.totalSrcOverlap / Math.max(summary.totalSrc, 1) * 100).toFixed(1)}%)`,
  );
  lines.push(
    `Doc files (docs/**) pointed-at:   ${summary.totalDocOverlap}/${summary.totalDoc}  (${(summary.totalDocOverlap / Math.max(summary.totalDoc, 1) * 100).toFixed(1)}%)`,
  );
  if (isDetailedSummary(summary)) {
    lines.push(
      `Ranked-code file hits: ${summary.rankedCodeFileOverlap.mentioned}/${summary.rankedCodeFileOverlap.total}  (${(summary.rankedCodeFileOverlap.mentioned / Math.max(summary.rankedCodeFileOverlap.total, 1) * 100).toFixed(1)}%)`,
    );
    lines.push(
      `Support-cluster useful: ${summary.supportClusterUsefulCount}/${summary.codeCaseCount}  (${(summary.supportClusterUsefulCount / Math.max(summary.codeCaseCount, 1) * 100).toFixed(1)}%)`,
    );
    lines.push(
      `Support-cluster file hits: ${summary.supportClusterFileOverlap.mentioned}/${summary.supportClusterFileOverlap.total}  (${(summary.supportClusterFileOverlap.mentioned / Math.max(summary.supportClusterFileOverlap.total, 1) * 100).toFixed(1)}%)`,
    );
    lines.push(
      `Body-mention-only file hits: ${summary.bodyMentionOnlyFileOverlap.mentioned}/${summary.bodyMentionOnlyFileOverlap.total}  (${(summary.bodyMentionOnlyFileOverlap.mentioned / Math.max(summary.bodyMentionOnlyFileOverlap.total, 1) * 100).toFixed(1)}%)`,
    );
    if (summary.missShapeSummary) {
      const miss = summary.missShapeSummary;
      lines.push("");
      lines.push("Miss taxonomy:");
      for (const shape of AGENT_COMPLETION_MISS_SHAPES) {
        lines.push(`  ${shape}: ${miss.caseBuckets[shape]}`);
      }
      lines.push(
        `  ranked_file_hits: ${miss.fileBuckets.rankedHits}/${miss.fileBuckets.totalSrc}`,
      );
      lines.push(
        `  top3_file_hits: ${miss.fileBuckets.topThreeHits}/${miss.fileBuckets.totalSrc}`,
      );
      lines.push(
        `  missing_from_ranked: ${miss.fileBuckets.missingFromRanked}/${miss.fileBuckets.totalSrc}`,
      );
      lines.push(
        `  body_only_file_hits: ${miss.fileBuckets.bodyOnlyHits}/${miss.fileBuckets.totalSrc}`,
      );
      lines.push(
        `  support_can_promote_top1_misses: ${miss.supportBuckets.couldPromoteTop1Miss}`,
      );
      lines.push(
        `  support_missing_when_top1_missed: ${miss.supportBuckets.missingWhenTop1Missed}`,
      );
    }
    if (summary.promptVariantSummary) {
      const variants = summary.promptVariantSummary;
      lines.push("");
      lines.push("Prompt variants:");
      lines.push(
        `  prompt top-1 acceptable: ${variants.promptTop1Acceptable}/${variants.promptCount}  (${(variants.promptTop1Acceptable / Math.max(variants.promptCount, 1) * 100).toFixed(1)}%)`,
      );
      lines.push(
        `  prompt top-3 useful: ${variants.promptTop3Useful}/${variants.promptCount}  (${(variants.promptTop3Useful / Math.max(variants.promptCount, 1) * 100).toFixed(1)}%)`,
      );
      lines.push(
        `  prompt ranked useful: ${variants.promptRankedUseful}/${variants.promptCount}  (${(variants.promptRankedUseful / Math.max(variants.promptCount, 1) * 100).toFixed(1)}%)`,
      );
      lines.push(
        `  prompt support useful: ${variants.promptSupportUseful}/${variants.promptCount}  (${(variants.promptSupportUseful / Math.max(variants.promptCount, 1) * 100).toFixed(1)}%)`,
      );
      lines.push(
        `  prompt ranked-file hits: ${variants.promptRankedCodeFileHits}/${variants.promptRankedCodeFileTotal}  (${(variants.promptRankedCodeFileHits / Math.max(variants.promptRankedCodeFileTotal, 1) * 100).toFixed(1)}%)`,
      );
      lines.push(
        `  tickets top-1 robust: ${variants.ticketsTop1Robust}/${variants.ticketsWithPromptVariants}`,
      );
      lines.push(
        `  tickets top-3 robust: ${variants.ticketsTop3Robust}/${variants.ticketsWithPromptVariants}`,
      );
      lines.push(
        `  tickets ranked robust: ${variants.ticketsRankedRobust}/${variants.ticketsWithPromptVariants}`,
      );
    }
    if (summary.candidateRecallSummary) {
      lines.push("");
      lines.push("Candidate recall ceiling:");
      for (const depth of summary.candidateRecallSummary.depths) {
        lines.push(
          `  recall@${depth.depth}: prompts ${depth.promptUseful}/${depth.promptCount}  (${(depth.promptUseful / Math.max(depth.promptCount, 1) * 100).toFixed(1)}%), files ${depth.fileHits}/${depth.fileTotal}  (${(depth.fileHits / Math.max(depth.fileTotal, 1) * 100).toFixed(1)}%)`,
        );
      }
      if (summary.candidateRecallSummary.methodFamilies) {
        lines.push("");
        lines.push("Method-family recall:");
        for (const family of summary.candidateRecallSummary.methodFamilies) {
          lines.push(
            `  ${family.family}@${family.depth}: prompts ${family.promptUseful}/${family.promptCount}  (${(family.promptUseful / Math.max(family.promptCount, 1) * 100).toFixed(1)}%), files ${family.fileHits}/${family.fileTotal}  (${(family.fileHits / Math.max(family.fileTotal, 1) * 100).toFixed(1)}%)`,
          );
        }
      }
      if (summary.candidateRecallSummary.diagnostics) {
        const diagnostics = summary.candidateRecallSummary.diagnostics;
        lines.push("");
        lines.push("Candidate diagnostics:");
        lines.push(`  useful_shadow_files: ${diagnostics.usefulShadowFiles}`);
        lines.push(`  useful_admitted_files: ${diagnostics.usefulAdmittedFiles}`);
        lines.push(`  useless_admitted_files: ${diagnostics.uselessAdmittedFiles}`);
        lines.push(`  useful_buried_files: ${diagnostics.usefulBuriedFiles}`);
        lines.push(`  top3_useless_files: ${diagnostics.topThreeUselessFiles}`);
      }
    }
    if (summary.targetFileAutopsySummary) {
      lines.push("");
      lines.push("Target-file autopsy:");
      const autopsy = summary.targetFileAutopsySummary;
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
        `  outcomes: ${formatAutopsyCounts(autopsy.outcomes, "outcome")}`,
      );
      lines.push(
        `  owner relations: ${formatAutopsyCounts(autopsy.ownerRelations, "relation")}`,
      );
      lines.push(
        `  owner candidate relations: ${formatAutopsyCounts(autopsy.ownerCandidateRelations, "relation")}`,
      );
      if (autopsy.evidenceFamilies.length > 0) {
        lines.push(
          `  evidence families: ${formatAutopsyCounts(autopsy.evidenceFamilies, "family")}`,
        );
      }
    }
    if (summary.candidateNoiseAutopsySummary) {
      lines.push("");
      lines.push("Candidate-noise autopsy:");
      const noise = summary.candidateNoiseAutopsySummary;
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
        `  owner relations: ${formatAutopsyCounts(noise.ownerRelations, "relation")}`,
      );
      if (noise.evidenceFamilies.length > 0) {
        lines.push(
          `  evidence families: ${formatAutopsyCounts(noise.evidenceFamilies, "family")}`,
        );
      }
    }
  }
  lines.push("");
  lines.push("Per-ticket detail:");
  for (const row of summary.rows) {
    lines.push("");
    lines.push(`  ${row.ticket} (${row.commit})`);
    lines.push(`    src files: ${row.srcOverlap}/${row.srcTotal} mentioned in pack`);
    lines.push(`    doc files: ${row.docOverlap}/${row.docTotal} mentioned in pack`);
    const srcChanged = changedSrcFiles(row);
    for (const file of srcChanged) {
      const hit = row.mentionedFiles.includes(file) ? "✅" : "❌";
      lines.push(`      [${hit}] ${file}`);
    }
    if (isDetailedRow(row) && row.supportClusterFiles.length > 0) {
      lines.push(`    support cluster: ${row.supportClusterFiles.join(", ")}`);
    }
    if (isDetailedRow(row) && row.promptVariants && row.promptVariants.length > 0) {
      lines.push("    prompt variants:");
      for (const variant of row.promptVariants) {
        lines.push(
          `      top1=${variant.topCodeAcceptable ? "hit" : "miss"} top3=${variant.topThreeCodeUseful ? "hit" : "miss"} ranked=${variant.rankedCodeUseful ? "hit" : "miss"} support=${variant.supportClusterUseful ? "hit" : "miss"} ranked_files=${variant.rankedCodeChangedFiles.length}/${row.srcTotal} :: ${variant.query}`,
        );
        if (variant.targetFileAutopsy && variant.targetFileAutopsy.length > 0) {
          for (const autopsy of variant.targetFileAutopsy.filter(
            (item) =>
              !["pack_top3_hit", "pack_ranked_hit"].includes(item.outcome),
          )) {
            lines.push(
              `        autopsy ${autopsy.targetFile}: outcome=${autopsy.outcome} candidate_rank=${autopsy.candidateRank ?? "-"} diagnostic_rank=${autopsy.diagnosticRank ?? "-"} relations=${autopsy.ownerRelations.join(",")} fact_overlap=${autopsy.factTokenOverlap}/${autopsy.queryTokenCount}`,
            );
          }
        }
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatAutopsyCounts<
  T extends { count: number } & Record<K, string>,
  K extends string,
>(items: readonly T[], key: K): string {
  if (items.length === 0) return "(none)";
  return items.map((item) => `${item[key]}=${item.count}`).join(", ");
}

function isDetailedSummary(
  summary: AgentCompletionProbeSummary,
): summary is AgentCompletionDetailedSummary {
  return "supportClusterUsefulCount" in summary;
}

function isDetailedRow(
  row: AgentCompletionProbeRow,
): row is AgentCompletionDetailedRow {
  return "supportClusterFiles" in row;
}

export function parseAgentCompletionBudgetArgs(
  argv: string[],
): { budget?: number; budgetSweep?: number[] } {
  const out: { budget?: number; budgetSweep?: number[] } = {};
  for (const arg of argv) {
    const single = /^--budget=(\d+)$/.exec(arg);
    if (single) {
      const n = Number.parseInt(single[1]!, 10);
      if (Number.isFinite(n) && n > 0) out.budget = n;
      continue;
    }
    const sweep = /^--budget-sweep=(.+)$/.exec(arg);
    if (sweep) {
      const parts = sweep[1]!
        .split(",")
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (parts.length > 0) out.budgetSweep = parts;
    }
  }
  return out;
}

export type AgentCompletionBudgetSweepRow = {
  budget: number;
  srcOverlap: number;
  srcTotal: number;
  commitsPassing: number;
  commitsTotal: number;
};

function pad(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}

export function renderAgentCompletionBudgetSweepTable(
  rows: AgentCompletionBudgetSweepRow[],
): string {
  if (rows.length === 0) return "";
  const baseline = rows.reduce(
    (best, row) => (row.budget > best.budget ? row : best),
    rows[0]!,
  );
  const dataRows = rows.map((row) => {
    const filePct = row.srcTotal === 0 ? "-" : `${((row.srcOverlap / row.srcTotal) * 100).toFixed(1)}%`;
    const commitPct = row.commitsTotal === 0 ? "-" : `${((row.commitsPassing / row.commitsTotal) * 100).toFixed(1)}%`;
    const fileDelta = row.srcOverlap - baseline.srcOverlap;
    const fileDeltaStr = row.budget === baseline.budget
      ? " baseline"
      : `${fileDelta > 0 ? "+" : ""}${fileDelta} ${Math.abs(fileDelta) === 1 ? "file" : "files"}`;
    return [
      String(row.budget),
      `${row.srcOverlap} / ${row.srcTotal}  (${filePct})`,
      `${row.commitsPassing} / ${row.commitsTotal}  (${commitPct})`,
      fileDeltaStr,
    ];
  });
  const header = ["budget", "file_retention", "commit_retention", "delta_vs_default"];
  return pad([header, ...dataRows]);
}

export function emitAgentCompletionProbeCli(args: {
  summary: AgentCompletionProbeSummary;
  io: ProbeCliIO;
}) {
  const { summary, io } = args;
  io.write(renderAgentCompletionReport(summary));
  const verdict = agentCompletionVerdictFromSummary(summary);
  io.write("\n");
  io.write(renderAssemblyVerdict(verdict));
  if (!verdict.pass) io.exit(1);
  return verdict;
}

export async function runAgentCompletionEvalDetailed(
  options: AgentCompletionEvalOptions = {},
): Promise<AgentCompletionDetailedSummary> {
  return runAgentCompletionEvalDetailedForPanel({
    repoRoot: REPO_ROOT,
    cases: AGENT_COMPLETION_CASES,
    ...options,
  });
}

export async function runAgentCompletionEvalDetailedForPanel(
  options: AgentCompletionEvalPanelOptions,
): Promise<AgentCompletionDetailedSummary> {
  return withCodeSourceIndexOverride(
    options.codeSourceIndexEnabled,
    async () => {
  const cwd = mkdtempSync(join(tmpdir(), "contexttrail-agent-completion-"));
  try {
    init(cwd);
    prepareCommitGroundedEvalWorkspace({
      repoRoot: options.repoRoot,
      cwd,
    });
    runImport(cwd, [...COMMIT_GROUNDED_EVAL_IMPORT_GLOBS]);
    const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
    try {
      const rows: AgentCompletionDetailedRow[] = [];
      const sourceFilePolicy = options.sourceFilePolicy ?? "agent-completion";
      const candidateRecallDepths = normalizedCandidateRecallDepths(
        options.candidateRecallDepths,
      );
      for (const c of options.cases) {
        const changed = getFilesChangedInCommit(c.commit_sha, options.repoRoot, {
          diffFilter: changedFileDiffFilterForPolicy(sourceFilePolicy),
        }).filter((f) => !(c.ignore ?? []).some((ig) => f.startsWith(ig)));
        const srcChanged = changedSourceFilesForPolicy({
          changedFiles: changed,
          repoRoot: options.repoRoot,
          policy: sourceFilePolicy,
        });
        const docChanged = changed.filter((f) => categorize(f) === "doc");
        const mentionedAcrossQueries = new Set<string>();
        const topCodeFiles = new Set<string>();
        const topThreeCodeFiles = new Set<string>();
        const rankedCodeFiles = new Set<string>();
        const supportClusterFiles = new Set<string>();
        const promptVariants: AgentCompletionPromptVariantRow[] = [];
        for (const q of c.queries) {
          const { pack } = assembleContextPackWithLinks({
            db,
            request: {
              task: q,
              query_anchors: { files: [], symbols: [], routes: [] },
              budget: "default",
              expected_locked: [],
              explain: false,
            },
            cwd,
            maxHops: 2,
            ...(options.budgetTokensOverride !== undefined
              ? { budgetTokensOverride: options.budgetTokensOverride }
              : {}),
          });
          const rankedForMeasurement = options.budgetTokensOverride === undefined
            ? pack.ranked
            : budgetedRankedEntries(pack, options.budgetTokensOverride);
          const variantMentionedFiles = new Set<string>();
          const variantTopCodeFiles = new Set<string>();
          const variantTopThreeCodeFiles = new Set<string>();
          const variantRankedCodeFiles = new Set<string>();
          const variantSupportClusterFiles = new Set<string>();
          const firstCode = rankedForMeasurement.find(
            (entry) => entry.kind === "code",
          );
          if (firstCode?.kind === "code" && firstCode.source_path) {
            topCodeFiles.add(firstCode.source_path);
            variantTopCodeFiles.add(firstCode.source_path);
          }
          const topThreeCodeEntries = rankedForMeasurement
            .filter((entry) => entry.kind === "code" && entry.source_path)
            .slice(0, 3);
          for (const entry of topThreeCodeEntries) {
            if (entry.kind === "code" && entry.source_path) {
              topThreeCodeFiles.add(entry.source_path);
              variantTopThreeCodeFiles.add(entry.source_path);
            }
          }
          for (const r of rankedForMeasurement) {
            if (r.kind === "code" && r.source_path) {
              rankedCodeFiles.add(r.source_path);
              variantRankedCodeFiles.add(r.source_path);
            }
            if (
              r.kind === "code" &&
              r.source_path &&
              r.support_cluster?.role === "support"
            ) {
              supportClusterFiles.add(r.source_path);
              variantSupportClusterFiles.add(r.source_path);
            }
            for (const m of extractMentionedPaths(r)) {
              mentionedAcrossQueries.add(m);
              variantMentionedFiles.add(m);
            }
          }
          const variantRankedCodeChangedFiles = srcChanged.filter((file) =>
            variantRankedCodeFiles.has(file),
          );
          const variantTopThreeCodeChangedFiles = srcChanged.filter((file) =>
            variantTopThreeCodeFiles.has(file),
          );
          const variantSupportClusterChangedFiles = srcChanged.filter((file) =>
            variantSupportClusterFiles.has(file),
          );
          const candidateObservability = computeCandidateObservability({
            db,
            query: q,
            changedSourceFiles: srcChanged,
            depths: candidateRecallDepths,
            packRankedFiles: [...variantRankedCodeFiles],
          });
          promptVariants.push({
            query: q,
            mentionedFiles: [...variantMentionedFiles],
            topCodeFiles: [...variantTopCodeFiles],
            topThreeCodeFiles: [...variantTopThreeCodeFiles],
            topThreeCodeChangedFiles: variantTopThreeCodeChangedFiles,
            rankedCodeFiles: [...variantRankedCodeFiles],
            rankedCodeChangedFiles: variantRankedCodeChangedFiles,
            supportClusterFiles: [...variantSupportClusterFiles],
            supportClusterChangedFiles: variantSupportClusterChangedFiles,
            srcOverlap: srcChanged.filter((file) => variantMentionedFiles.has(file)).length,
            topCodeAcceptable: srcChanged.some((file) =>
              variantTopCodeFiles.has(file),
            ),
            topThreeCodeUseful: variantTopThreeCodeChangedFiles.length > 0,
            rankedCodeUseful: variantRankedCodeChangedFiles.length > 0,
            supportClusterUseful: variantSupportClusterChangedFiles.length > 0,
            ...(candidateObservability.candidateRecall.length > 0
              ? { candidateRecall: candidateObservability.candidateRecall }
              : {}),
            ...(candidateObservability.targetFileAutopsy.length > 0
              ? { targetFileAutopsy: candidateObservability.targetFileAutopsy }
              : {}),
            ...(candidateObservability.candidateNoiseAutopsy.length > 0
              ? { candidateNoiseAutopsy: candidateObservability.candidateNoiseAutopsy }
              : {}),
          });
        }
        const srcOverlap = srcChanged.filter((f) => mentionedAcrossQueries.has(f)).length;
        const docOverlap = docChanged.filter((f) => mentionedAcrossQueries.has(f)).length;
        const supportClusterChangedFiles = srcChanged.filter((file) =>
          supportClusterFiles.has(file),
        );
        const rankedCodeChangedFiles = srcChanged.filter((file) =>
          rankedCodeFiles.has(file),
        );
        const topThreeCodeChangedFiles = srcChanged.filter((file) =>
          topThreeCodeFiles.has(file),
        );
        rows.push({
          ticket: c.ticket,
          commit: c.commit_sha,
          changedFiles: changed,
          targetSourceFiles: srcChanged,
          mentionedFiles: [...mentionedAcrossQueries],
          srcOverlap,
          srcTotal: srcChanged.length,
          docOverlap,
          docTotal: docChanged.length,
          topCodeFiles: [...topCodeFiles],
          topThreeCodeFiles: [...topThreeCodeFiles],
          topThreeCodeChangedFiles,
          rankedCodeFiles: [...rankedCodeFiles],
          rankedCodeChangedFiles,
          supportClusterFiles: [...supportClusterFiles],
          supportClusterChangedFiles,
          topCodeAcceptable: srcChanged.some((file) => topCodeFiles.has(file)),
          rankedCodeUseful: srcChanged.some((file) => rankedCodeFiles.has(file)),
          supportClusterUseful: supportClusterChangedFiles.length > 0,
          promptVariants,
        });
      }
      return summarizeAgentCompletionDetailedRows(rows, options.cases.length);
    } finally { closeDb(db); }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
    },
  );
}

async function runAgentCompletionEval(
  budgetTokensOverride?: number,
): Promise<AgentCompletionProbeSummary> {
  const detailed = await runAgentCompletionEvalDetailed({ budgetTokensOverride });
  return summarizeAgentCompletionRows(detailed.rows, detailed.caseCount);
}

async function runBudgetSweep(budgets: number[]): Promise<void> {
  const rows: AgentCompletionBudgetSweepRow[] = [];
  for (const budget of budgets) {
    const summary = await runAgentCompletionEval(budget);
    const commitsPassing = summary.rows.filter((r) => r.srcTotal > 0 && r.srcOverlap === r.srcTotal).length;
    const commitsTotal = summary.rows.filter((r) => r.srcTotal > 0).length;
    rows.push({
      budget,
      srcOverlap: summary.totalSrcOverlap,
      srcTotal: summary.totalSrc,
      commitsPassing,
      commitsTotal,
    });
  }
  process.stdout.write("Budget sweep (PRD-0030 / 30.2)\n\n");
  process.stdout.write(`${renderAgentCompletionBudgetSweepTable(rows)}\n`);
}

async function main() {
  const { budget, budgetSweep } = parseAgentCompletionBudgetArgs(process.argv);
  if (budgetSweep && budgetSweep.length > 0) {
    await runBudgetSweep(budgetSweep);
    return;
  }
  const summary = await runAgentCompletionEval(budget);
  if (budget !== undefined) {
    process.stdout.write(renderAgentCompletionReport(summary));
    process.stdout.write(`\n(verdict skipped: --budget=${budget} is not the gated default)\n`);
    return;
  }
  emitAgentCompletionProbeCli({
    summary,
    io: {
      write: (text) => process.stdout.write(text),
      exit: (code) => process.exit(code),
    },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
