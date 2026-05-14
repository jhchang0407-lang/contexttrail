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

export type AgentCompletionProbeRow = {
  ticket: string;
  commit: string;
  changedFiles: string[];
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
};

export type AgentCompletionEvalOptions = {
  budgetTokensOverride?: number;
  codeSourceIndexEnabled?: boolean;
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

function getFilesChangedInCommit(sha: string, repoRoot: string): string[] {
  try {
    const out = execSync(`git show --pretty=format: --name-only ${sha}`, {
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
  const re = /(?:^|[\s`(\[])(src\/[A-Za-z0-9_\-/.]+\.(?:ts|tsx|js|test\.ts)|docs\/[A-Za-z0-9_\-/.()]+\.(?:md|mdx)|tests\/[A-Za-z0-9_\-/.]+\.[a-z]+)/g;
  for (const m of body.matchAll(re)) {
    if (m[1]) out.add(m[1]);
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

function categorize(path: string): "src" | "test" | "doc" | "other" {
  if (path.endsWith(".md") || path.endsWith(".mdx")) return "doc";
  if (path.includes(".test.") || path.startsWith("tests/")) return "test";
  if (path.startsWith("src/")) return "src";
  return "other";
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
        (sum, row) =>
          sum +
          row.changedFiles.filter((file) =>
            categorize(file) === "src" &&
            row.mentionedFiles.includes(file) &&
            !row.rankedCodeChangedFiles.includes(file),
          ).length,
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
  }
  lines.push("");
  lines.push("Per-ticket detail:");
  for (const row of summary.rows) {
    lines.push("");
    lines.push(`  ${row.ticket} (${row.commit})`);
    lines.push(`    src files: ${row.srcOverlap}/${row.srcTotal} mentioned in pack`);
    lines.push(`    doc files: ${row.docOverlap}/${row.docTotal} mentioned in pack`);
    const srcChanged = row.changedFiles.filter((file) => categorize(file) === "src");
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
      }
    }
  }
  return `${lines.join("\n")}\n`;
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
      for (const c of options.cases) {
        const changed = getFilesChangedInCommit(c.commit_sha, options.repoRoot).filter(
          (f) => !(c.ignore ?? []).some((ig) => f.startsWith(ig)),
        );
        const srcChanged = changed.filter((f) => categorize(f) === "src");
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
