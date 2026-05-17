#!/usr/bin/env node
import {
  parseAgentCompletionBudgetArgs,
  renderAgentCompletionReport,
  runAgentCompletionEvalDetailed,
  runAgentCompletionEvalDetailedForPanel,
  type AgentCompletionDetailedRow,
  type AgentCompletionDetailedSummary,
  type AgentCompletionCase,
  type AgentCompletionEvalOptions,
} from "./agent-completion-probe.js";

export type PairedCodeLaneRow = {
  ticket: string;
  commit: string;
  old: AgentCompletionDetailedRow;
  new: AgentCompletionDetailedRow;
};

export type CodeLaneDiagnosticMissKind =
  | "missing_from_ranked"
  | "ranked_below_top3"
  | "support_missing"
  | "body_only";

export type CodeLaneTicketDiagnostic = {
  ticket: string;
  commit: string;
  missingFromRanked: string[];
  rankedBelowTop3: string[];
  supportMissing: string[];
  bodyOnly: string[];
};

export type CodeLaneTargetFileDiagnostic = {
  file: string;
  tickets: string[];
  missCounts: Record<CodeLaneDiagnosticMissKind, number>;
  score: number;
};

export type CodeLaneResidualFamily =
  | "source_profile_storage"
  | "persistence_substrate"
  | "import_workflow"
  | "retrieval_index"
  | "cli_workflow"
  | "other";

export type CodeLaneResidualFamilyDiagnostic = {
  family: CodeLaneResidualFamily;
  files: string[];
  tickets: string[];
  missCounts: Record<CodeLaneDiagnosticMissKind, number>;
  score: number;
};

export type CodeLaneDiagnostics = {
  ticketDiagnostics: CodeLaneTicketDiagnostic[];
  nextTargetFiles: CodeLaneTargetFileDiagnostic[];
  residualFamilies: CodeLaneResidualFamilyDiagnostic[];
};

export type PairedCodeLaneComparison = {
  budgetTokensOverride?: number;
  caseCount: number;
  fileCoverage: {
    old: { mentioned: number; total: number };
    new: { mentioned: number; total: number };
  };
  codeTop1: {
    old: { hits: number; total: number };
    new: { hits: number; total: number };
  };
  codeRankedUseful: {
    old: { hits: number; total: number };
    new: { hits: number; total: number };
  };
  supportClusterUseful: {
    old: { hits: number; total: number };
    new: { hits: number; total: number };
  };
  oldSummary: AgentCompletionDetailedSummary;
  newSummary: AgentCompletionDetailedSummary;
  diagnostics?: CodeLaneDiagnostics;
  rows: PairedCodeLaneRow[];
};

export type PairedCodeLaneComparisonOptions = {
  budgetTokensOverride?: number;
  runEval?: (
    options: AgentCompletionEvalOptions,
  ) => Promise<AgentCompletionDetailedSummary>;
};

export type PairedCodeLaneRepoComparisonOptions = {
  repoRoot: string;
  cases: AgentCompletionCase[];
  budgetTokensOverride?: number;
  runEval?: (
    options: AgentCompletionEvalOptions & {
      repoRoot: string;
      cases: AgentCompletionCase[];
    },
  ) => Promise<AgentCompletionDetailedSummary>;
};

export function comparePairedCodeLaneSummaries(args: {
  oldSummary: AgentCompletionDetailedSummary;
  newSummary: AgentCompletionDetailedSummary;
  budgetTokensOverride?: number;
}): PairedCodeLaneComparison {
  const oldByTicket = new Map<string, AgentCompletionDetailedRow>(
    args.oldSummary.rows.map((row) => [`${row.ticket}:${row.commit}`, row]),
  );
  const rows: PairedCodeLaneRow[] = args.newSummary.rows.map((row) => {
    const key = `${row.ticket}:${row.commit}`;
    const oldRow = oldByTicket.get(key);
    if (!oldRow) {
      throw new Error(`Missing baseline row for ${key}`);
    }
    return {
      ticket: row.ticket,
      commit: row.commit,
      old: oldRow,
      new: row,
    };
  });

  return {
    budgetTokensOverride: args.budgetTokensOverride,
    caseCount: args.newSummary.caseCount,
    fileCoverage: {
      old: {
        mentioned: args.oldSummary.rankedCodeFileOverlap.mentioned,
        total: args.oldSummary.totalSrc,
      },
      new: {
        mentioned: args.newSummary.rankedCodeFileOverlap.mentioned,
        total: args.newSummary.totalSrc,
      },
    },
    codeTop1: {
      old: {
        hits: args.oldSummary.topCodeAcceptableCount,
        total: args.oldSummary.codeCaseCount,
      },
      new: {
        hits: args.newSummary.topCodeAcceptableCount,
        total: args.newSummary.codeCaseCount,
      },
    },
    codeRankedUseful: {
      old: {
        hits: args.oldSummary.rankedCodeUsefulCount,
        total: args.oldSummary.codeCaseCount,
      },
      new: {
        hits: args.newSummary.rankedCodeUsefulCount,
        total: args.newSummary.codeCaseCount,
      },
    },
    supportClusterUseful: {
      old: {
        hits: args.oldSummary.supportClusterUsefulCount,
        total: args.oldSummary.codeCaseCount,
      },
      new: {
        hits: args.newSummary.supportClusterUsefulCount,
        total: args.newSummary.codeCaseCount,
      },
    },
    oldSummary: args.oldSummary,
    newSummary: args.newSummary,
    diagnostics: buildCodeLaneDiagnostics(args.newSummary.rows),
    rows,
  };
}

export async function runPairedCodeLaneComparison(
  options: PairedCodeLaneComparisonOptions = {},
): Promise<PairedCodeLaneComparison> {
  const runEval = options.runEval ?? runAgentCompletionEvalDetailed;
  const oldSummary = await runEval({
    budgetTokensOverride: options.budgetTokensOverride,
    codeSourceIndexEnabled: false,
  });
  const newSummary = await runEval({
    budgetTokensOverride: options.budgetTokensOverride,
    codeSourceIndexEnabled: true,
  });
  return comparePairedCodeLaneSummaries({
    oldSummary,
    newSummary,
    budgetTokensOverride: options.budgetTokensOverride,
  });
}

export async function runPairedCodeLaneComparisonForRepo(
  options: PairedCodeLaneRepoComparisonOptions,
): Promise<PairedCodeLaneComparison> {
  const runEval = options.runEval ?? runAgentCompletionEvalDetailedForPanel;
  const oldSummary = await runEval({
    repoRoot: options.repoRoot,
    cases: options.cases,
    budgetTokensOverride: options.budgetTokensOverride,
    codeSourceIndexEnabled: false,
  });
  const newSummary = await runEval({
    repoRoot: options.repoRoot,
    cases: options.cases,
    budgetTokensOverride: options.budgetTokensOverride,
    codeSourceIndexEnabled: true,
  });
  return comparePairedCodeLaneSummaries({
    oldSummary,
    newSummary,
    budgetTokensOverride: options.budgetTokensOverride,
  });
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function missShapeCount(
  summary: AgentCompletionDetailedSummary,
  shape:
    | "top3_hit_top1_miss"
    | "ranked_hit_top3_miss"
    | "ranked_miss_body_only"
    | "ranked_miss",
): number {
  return summary.missShapeSummary?.caseBuckets[shape] ?? 0;
}

function totalRankedMisses(summary: AgentCompletionDetailedSummary): number {
  return (
    missShapeCount(summary, "ranked_miss_body_only") +
    missShapeCount(summary, "ranked_miss")
  );
}

function promptCount(summary: AgentCompletionDetailedSummary): number {
  return summary.promptVariantSummary?.promptCount ?? 0;
}

function promptTop1(summary: AgentCompletionDetailedSummary): number {
  return summary.promptVariantSummary?.promptTop1Acceptable ?? 0;
}

function promptTop3(summary: AgentCompletionDetailedSummary): number {
  return summary.promptVariantSummary?.promptTop3Useful ?? 0;
}

function promptRanked(summary: AgentCompletionDetailedSummary): number {
  return summary.promptVariantSummary?.promptRankedUseful ?? 0;
}

function changedSrcFiles(row: AgentCompletionDetailedRow): string[] {
  return row.changedFiles.filter(
    (file) =>
      file.startsWith("src/") &&
      !file.includes(".test.") &&
      !file.endsWith(".test.ts"),
  );
}

function topThreeChangedFiles(row: AgentCompletionDetailedRow): string[] {
  if (row.topThreeCodeChangedFiles) return row.topThreeCodeChangedFiles;
  const topThree = new Set(row.rankedCodeFiles.slice(0, 3));
  return changedSrcFiles(row).filter((file) => topThree.has(file));
}

function emptyMissCounts(): Record<CodeLaneDiagnosticMissKind, number> {
  return {
    missing_from_ranked: 0,
    ranked_below_top3: 0,
    support_missing: 0,
    body_only: 0,
  };
}

function diagnosticScore(
  counts: Record<CodeLaneDiagnosticMissKind, number>,
): number {
  return (
    counts.missing_from_ranked * 100 +
    counts.body_only * 70 +
    counts.ranked_below_top3 * 40 +
    counts.support_missing * 10
  );
}

function classifyCodeLaneResidualFamily(file: string): CodeLaneResidualFamily {
  const tokens = fileTokens(file);
  if (tokens.has("sourceprofile") || (tokens.has("source") && tokens.has("profile"))) {
    return "source_profile_storage";
  }
  if (
    hasAny(tokens, [
      "import",
      "reindex",
      "chunker",
      "extract",
      "parser",
      "parse",
    ]) ||
    ((tokens.has("cli") || tokens.has("cmd") || tokens.has("command")) &&
      (tokens.has("index") || tokens.has("import") || tokens.has("reindex")))
  ) {
    return "import_workflow";
  }
  if (
    hasAny(tokens, [
      "schema",
      "database",
      "db",
      "migration",
      "persist",
      "persistence",
      "storage",
      "store",
      "table",
      "chunk",
      "chunks",
    ])
  ) {
    return "persistence_substrate";
  }
  if (
    hasAny(tokens, [
      "bm25",
      "fts",
      "index",
      "rank",
      "ranking",
      "rerank",
      "retrieval",
      "score",
      "scoring",
      "search",
    ])
  ) {
    return "retrieval_index";
  }
  if (
    hasAny(tokens, [
      "cli",
      "cmd",
      "command",
      "manifest",
      "lock",
      "policy",
      "reset",
      "runner",
      "state",
      "takeover",
      "validate",
      "validator",
      "worker",
    ])
  ) {
    return "cli_workflow";
  }
  return "other";
}

function fileTokens(file: string): Set<string> {
  const raw = file
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .flatMap((token) => {
      if (token === "sourceprofile" || token === "sourceprofiles") {
        return ["sourceprofile", "source", "profile"];
      }
      return [token];
    })
    .map((token) => {
      if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
      if (token.endsWith("s") && token.length > 3 && !token.endsWith("ss")) {
        return token.slice(0, -1);
      }
      return token;
    });
  return new Set(raw);
}

function hasAny(tokens: Set<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

export function buildCodeLaneDiagnostics(
  rows: AgentCompletionDetailedRow[],
): CodeLaneDiagnostics {
  const ticketDiagnostics: CodeLaneTicketDiagnostic[] = [];
  const targetByFile = new Map<
    string,
    {
      tickets: Set<string>;
      missCounts: Record<CodeLaneDiagnosticMissKind, number>;
    }
  >();
  const targetByFamily = new Map<
    CodeLaneResidualFamily,
    {
      files: Set<string>;
      tickets: Set<string>;
      missCounts: Record<CodeLaneDiagnosticMissKind, number>;
    }
  >();

  function addTarget(
    file: string,
    ticket: string,
    kind: CodeLaneDiagnosticMissKind,
  ): void {
    const existing =
      targetByFile.get(file) ?? {
        tickets: new Set<string>(),
        missCounts: emptyMissCounts(),
      };
    existing.tickets.add(ticket);
    existing.missCounts[kind] += 1;
    targetByFile.set(file, existing);

    const family = classifyCodeLaneResidualFamily(file);
    const familyExisting =
      targetByFamily.get(family) ?? {
        files: new Set<string>(),
        tickets: new Set<string>(),
        missCounts: emptyMissCounts(),
      };
    familyExisting.files.add(file);
    familyExisting.tickets.add(ticket);
    familyExisting.missCounts[kind] += 1;
    targetByFamily.set(family, familyExisting);
  }

  for (const row of rows) {
    const srcChanged = changedSrcFiles(row);
    if (srcChanged.length === 0) continue;
    const ranked = new Set(row.rankedCodeChangedFiles);
    const topThree = new Set(topThreeChangedFiles(row));
    const support = new Set(row.supportClusterChangedFiles);
    const mentioned = new Set(row.mentionedFiles);
    const diagnostic: CodeLaneTicketDiagnostic = {
      ticket: row.ticket,
      commit: row.commit,
      missingFromRanked: srcChanged.filter((file) => !ranked.has(file)),
      rankedBelowTop3: srcChanged.filter(
        (file) => ranked.has(file) && !topThree.has(file),
      ),
      supportMissing: srcChanged.filter((file) => !support.has(file)),
      bodyOnly: srcChanged.filter(
        (file) => mentioned.has(file) && !ranked.has(file),
      ),
    };
    const hasMiss =
      diagnostic.missingFromRanked.length > 0 ||
      diagnostic.rankedBelowTop3.length > 0 ||
      diagnostic.supportMissing.length > 0 ||
      diagnostic.bodyOnly.length > 0;
    if (!hasMiss) continue;
    ticketDiagnostics.push(diagnostic);
    for (const file of diagnostic.missingFromRanked) {
      addTarget(file, row.ticket, "missing_from_ranked");
    }
    for (const file of diagnostic.rankedBelowTop3) {
      addTarget(file, row.ticket, "ranked_below_top3");
    }
    for (const file of diagnostic.supportMissing) {
      addTarget(file, row.ticket, "support_missing");
    }
    for (const file of diagnostic.bodyOnly) {
      addTarget(file, row.ticket, "body_only");
    }
  }

  const nextTargetFiles = [...targetByFile.entries()]
    .map(([file, value]) => ({
      file,
      tickets: [...value.tickets].sort(),
      missCounts: value.missCounts,
      score: diagnosticScore(value.missCounts),
    }))
    .sort((a, b) => {
      const primaryA =
        a.missCounts.missing_from_ranked +
        a.missCounts.ranked_below_top3 +
        a.missCounts.body_only;
      const primaryB =
        b.missCounts.missing_from_ranked +
        b.missCounts.ranked_below_top3 +
        b.missCounts.body_only;
      return (
        primaryB - primaryA ||
        b.score - a.score ||
        b.tickets.length - a.tickets.length ||
        a.file.localeCompare(b.file)
      );
    });

  const residualFamilies = [...targetByFamily.entries()]
    .map(([family, value]) => ({
      family,
      files: [...value.files].sort(),
      tickets: [...value.tickets].sort(),
      missCounts: value.missCounts,
      score: diagnosticScore(value.missCounts),
    }))
    .sort((a, b) =>
      b.score - a.score ||
      b.files.length - a.files.length ||
      a.family.localeCompare(b.family),
    );

  return {
    ticketDiagnostics,
    nextTargetFiles,
    residualFamilies,
  };
}

function formatFiles(files: string[]): string {
  return files.length === 0 ? "(none)" : files.join(", ");
}

function renderCodeLaneDiagnostics(diagnostics: CodeLaneDiagnostics): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("Code-lane diagnostics:");
  lines.push("  Residual miss families:");
  if (diagnostics.residualFamilies.length === 0) {
    lines.push("    (none)");
  } else {
    for (const family of diagnostics.residualFamilies) {
      lines.push(
        `    ${family.family}  tickets=${family.tickets.join(",")}  files=${family.files.join(", ")}  missing_from_ranked=${family.missCounts.missing_from_ranked}  ranked_below_top3=${family.missCounts.ranked_below_top3}  support_missing=${family.missCounts.support_missing}  body_only=${family.missCounts.body_only}`,
      );
    }
  }
  lines.push("  Next target files:");
  if (diagnostics.nextTargetFiles.length === 0) {
    lines.push("    (none)");
  } else {
    for (const target of diagnostics.nextTargetFiles.slice(0, 8)) {
      lines.push(
        `    ${target.file}  tickets=${target.tickets.join(",")}  missing_from_ranked=${target.missCounts.missing_from_ranked}  ranked_below_top3=${target.missCounts.ranked_below_top3}  support_missing=${target.missCounts.support_missing}  body_only=${target.missCounts.body_only}`,
      );
    }
  }
  lines.push("  Per-ticket missing files:");
  if (diagnostics.ticketDiagnostics.length === 0) {
    lines.push("    (none)");
  } else {
    for (const row of diagnostics.ticketDiagnostics) {
      lines.push(`    ${row.ticket} (${row.commit})`);
      lines.push(`      missing_from_ranked: ${formatFiles(row.missingFromRanked)}`);
      lines.push(`      ranked_below_top3: ${formatFiles(row.rankedBelowTop3)}`);
      lines.push(`      support_missing: ${formatFiles(row.supportMissing)}`);
      lines.push(`      body_only: ${formatFiles(row.bodyOnly)}`);
    }
  }
  return lines;
}

export function renderPairedCodeLaneComparison(
  comparison: PairedCodeLaneComparison,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("========== PAIRED CODE-LANE COMPARISON ==========");
  lines.push(
    comparison.budgetTokensOverride === undefined
      ? "Same task panel, default budget, old file-card path vs new chunk-first code lane."
      : `Same task panel, budget ${comparison.budgetTokensOverride}, old file-card path vs new chunk-first code lane.`,
  );
  lines.push("");
  lines.push("Summary:");
  lines.push(
    `  Ranked code-file coverage Old (file-card): ${comparison.fileCoverage.old.mentioned}/${comparison.fileCoverage.old.total} (${pct(comparison.fileCoverage.old.mentioned, comparison.fileCoverage.old.total)})`,
  );
  lines.push(
    `                            New (chunk-first): ${comparison.fileCoverage.new.mentioned}/${comparison.fileCoverage.new.total} (${pct(comparison.fileCoverage.new.mentioned, comparison.fileCoverage.new.total)})`,
  );
  lines.push(
    `  Code top-1 acceptable     Old (file-card): ${comparison.codeTop1.old.hits}/${comparison.codeTop1.old.total} (${pct(comparison.codeTop1.old.hits, comparison.codeTop1.old.total)})`,
  );
  lines.push(
    `                            New (chunk-first): ${comparison.codeTop1.new.hits}/${comparison.codeTop1.new.total} (${pct(comparison.codeTop1.new.hits, comparison.codeTop1.new.total)})`,
  );
  lines.push(
    `  Code ranked useful        Old (file-card): ${comparison.codeRankedUseful.old.hits}/${comparison.codeRankedUseful.old.total} (${pct(comparison.codeRankedUseful.old.hits, comparison.codeRankedUseful.old.total)})`,
  );
  lines.push(
    `                            New (chunk-first): ${comparison.codeRankedUseful.new.hits}/${comparison.codeRankedUseful.new.total} (${pct(comparison.codeRankedUseful.new.hits, comparison.codeRankedUseful.new.total)})`,
  );
  lines.push(
    `  Support-cluster useful    Old (file-card): ${comparison.supportClusterUseful.old.hits}/${comparison.supportClusterUseful.old.total} (${pct(comparison.supportClusterUseful.old.hits, comparison.supportClusterUseful.old.total)})`,
  );
  lines.push(
    `                            New (chunk-first): ${comparison.supportClusterUseful.new.hits}/${comparison.supportClusterUseful.new.total} (${pct(comparison.supportClusterUseful.new.hits, comparison.supportClusterUseful.new.total)})`,
  );
  if (
    comparison.oldSummary.promptVariantSummary ||
    comparison.newSummary.promptVariantSummary
  ) {
    lines.push(
      `  Prompt variant top-1     Old (file-card): ${promptTop1(comparison.oldSummary)}/${promptCount(comparison.oldSummary)} (${pct(promptTop1(comparison.oldSummary), promptCount(comparison.oldSummary))})`,
    );
    lines.push(
      `                            New (chunk-first): ${promptTop1(comparison.newSummary)}/${promptCount(comparison.newSummary)} (${pct(promptTop1(comparison.newSummary), promptCount(comparison.newSummary))})`,
    );
    lines.push(
      `  Prompt variant top-3     Old (file-card): ${promptTop3(comparison.oldSummary)}/${promptCount(comparison.oldSummary)} (${pct(promptTop3(comparison.oldSummary), promptCount(comparison.oldSummary))})`,
    );
    lines.push(
      `                            New (chunk-first): ${promptTop3(comparison.newSummary)}/${promptCount(comparison.newSummary)} (${pct(promptTop3(comparison.newSummary), promptCount(comparison.newSummary))})`,
    );
    lines.push(
      `  Prompt variant ranked    Old (file-card): ${promptRanked(comparison.oldSummary)}/${promptCount(comparison.oldSummary)} (${pct(promptRanked(comparison.oldSummary), promptCount(comparison.oldSummary))})`,
    );
    lines.push(
      `                            New (chunk-first): ${promptRanked(comparison.newSummary)}/${promptCount(comparison.newSummary)} (${pct(promptRanked(comparison.newSummary), promptCount(comparison.newSummary))})`,
    );
  }
  if (
    comparison.oldSummary.missShapeSummary ||
    comparison.newSummary.missShapeSummary
  ) {
    lines.push(
      `  Top-3 hit / top-1 miss  Old (file-card): ${missShapeCount(comparison.oldSummary, "top3_hit_top1_miss")}/${comparison.oldSummary.codeCaseCount} (${pct(missShapeCount(comparison.oldSummary, "top3_hit_top1_miss"), comparison.oldSummary.codeCaseCount)})`,
    );
    lines.push(
      `                            New (chunk-first): ${missShapeCount(comparison.newSummary, "top3_hit_top1_miss")}/${comparison.newSummary.codeCaseCount} (${pct(missShapeCount(comparison.newSummary, "top3_hit_top1_miss"), comparison.newSummary.codeCaseCount)})`,
    );
    lines.push(
      `  Ranked hit below top-3   Old (file-card): ${missShapeCount(comparison.oldSummary, "ranked_hit_top3_miss")}/${comparison.oldSummary.codeCaseCount} (${pct(missShapeCount(comparison.oldSummary, "ranked_hit_top3_miss"), comparison.oldSummary.codeCaseCount)})`,
    );
    lines.push(
      `                            New (chunk-first): ${missShapeCount(comparison.newSummary, "ranked_hit_top3_miss")}/${comparison.newSummary.codeCaseCount} (${pct(missShapeCount(comparison.newSummary, "ranked_hit_top3_miss"), comparison.newSummary.codeCaseCount)})`,
    );
    lines.push(
      `  Ranked miss              Old (file-card): ${totalRankedMisses(comparison.oldSummary)}/${comparison.oldSummary.codeCaseCount} (${pct(totalRankedMisses(comparison.oldSummary), comparison.oldSummary.codeCaseCount)})`,
    );
    lines.push(
      `                            New (chunk-first): ${totalRankedMisses(comparison.newSummary)}/${comparison.newSummary.codeCaseCount} (${pct(totalRankedMisses(comparison.newSummary), comparison.newSummary.codeCaseCount)})`,
    );
  }
  lines.push(
    ...renderCodeLaneDiagnostics(
      comparison.diagnostics ?? buildCodeLaneDiagnostics(comparison.newSummary.rows),
    ),
  );
  lines.push("");
  lines.push("Per-ticket detail:");
  for (const row of comparison.rows) {
    lines.push("");
    lines.push(`  ${row.ticket} (${row.commit})`);
    lines.push(
      `    ranked code files    old ${row.old.rankedCodeChangedFiles.length}/${row.old.srcTotal}  →  new ${row.new.rankedCodeChangedFiles.length}/${row.new.srcTotal}`,
    );
    lines.push(
      `    code top-1           old ${row.old.topCodeAcceptable ? "hit" : "miss"}  →  new ${row.new.topCodeAcceptable ? "hit" : "miss"}`,
    );
    lines.push(
      `    code ranked useful   old ${row.old.rankedCodeUseful ? "hit" : "miss"}  →  new ${row.new.rankedCodeUseful ? "hit" : "miss"}`,
    );
    lines.push(
      `    support cluster      old ${row.old.supportClusterUseful ? "hit" : "miss"}  →  new ${row.new.supportClusterUseful ? "hit" : "miss"}`,
    );
  }
  lines.push("");
  lines.push("Old (file-card) detail:");
  lines.push(renderAgentCompletionReport(comparison.oldSummary).trimEnd());
  lines.push("");
  lines.push("New (chunk-first) detail:");
  lines.push(renderAgentCompletionReport(comparison.newSummary).trimEnd());
  return `${lines.join("\n")}\n`;
}

async function main() {
  const { budget } = parseAgentCompletionBudgetArgs(process.argv);
  const comparison = await runPairedCodeLaneComparison({
    budgetTokensOverride: budget,
  });
  process.stdout.write(renderPairedCodeLaneComparison(comparison));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
