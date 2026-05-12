import { join } from "node:path";
import { importCodeSources, runImport, type ImportSummary } from "../cli/import.js";
import { runIndex, type IndexSummary } from "../cli/index-cmd.js";
import {
  detectStaleSources,
  type FreshnessResult,
  type FreshnessCheckOptions,
} from "../retrieve/freshness-check.js";
import { closeDb, openDb } from "../store/db.js";

export type { FreshnessResult };

export type FreshnessRepairWarning = {
  kind: "stale_source" | "missing_source";
  message: string;
  hint: string;
};

export type FreshnessRepairApplyResult = {
  doc_import?: ImportSummary;
  code_import?: { files_indexed: number };
  index?: IndexSummary;
  writes: string[];
};

export type FreshnessPrePassResult = FreshnessRepairApplyResult & {
  freshness: FreshnessResult;
  warnings: FreshnessRepairWarning[];
};

export type FreshnessPrePassOptions = {
  autoReindex: boolean;
  earlyExit?: boolean;
};

export function detectLedgerFreshness(
  cwd: string,
  options: FreshnessCheckOptions = { earlyExit: false },
): FreshnessResult {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    return detectStaleSources(db, cwd, options);
  } finally {
    closeDb(db);
  }
}

export function runFreshnessPrePass(
  cwd: string,
  options: FreshnessPrePassOptions,
): FreshnessPrePassResult {
  const freshness = detectLedgerFreshness(cwd, {
    earlyExit: options.earlyExit ?? !options.autoReindex,
  });
  if (options.autoReindex && hasFreshnessWork(freshness)) {
    const repair = applyFreshnessRepair(cwd, freshness);
    return {
      freshness,
      warnings: [],
      ...repair,
    };
  }
  return {
    freshness,
    warnings: warningsForFreshness(freshness),
    writes: [],
  };
}

export function applyFreshnessRepair(
  cwd: string,
  freshness: FreshnessResult,
): FreshnessRepairApplyResult {
  const dbPath = join(cwd, ".contexttrail/cache/contexttrail.db");
  const writes: string[] = [];
  let docImport: ImportSummary | undefined;
  let codeImport: { files_indexed: number } | undefined;
  let indexSummary: IndexSummary | undefined;

  if (freshness.stale_doc_sources.length > 0) {
    docImport = runImport(cwd, freshness.stale_doc_sources, { skipCodeSources: true });
    writes.push(...freshness.stale_doc_sources, ".contexttrail/cache/contexttrail.db");
  }

  if (freshness.stale_code_sources.length > 0) {
    const db = openDb(dbPath);
    try {
      codeImport = importCodeSources({
        cwd,
        db,
        indexed_at: new Date().toISOString(),
        globs: freshness.stale_code_sources,
        ignore: [],
      });
    } finally {
      closeDb(db);
    }
    writes.push(...freshness.stale_code_sources, ".contexttrail/cache/contexttrail.db");
  }

  if (freshness.missing_sources.length > 0) {
    indexSummary = runIndex(cwd);
    writes.push(".contexttrail/cache/contexttrail.db");
  }

  return {
    doc_import: docImport,
    code_import: codeImport,
    index: indexSummary,
    writes: unique(writes),
  };
}

export function warningsForFreshness(
  freshness: FreshnessResult,
): FreshnessRepairWarning[] {
  const warnings: FreshnessRepairWarning[] = [];
  const staleCount =
    freshness.stale_doc_sources.length + freshness.stale_code_sources.length;
  if (staleCount > 0) {
    warnings.push({
      kind: "stale_source",
      message: `${staleCount} indexed source(s) changed on disk since last import`,
      hint: "Run `contexttrail import` to refresh.",
    });
  }
  if (freshness.missing_sources.length > 0) {
    warnings.push({
      kind: "missing_source",
      message: `${freshness.missing_sources.length} indexed source(s) no longer exist on disk`,
      hint: "Run `contexttrail index` to tombstone gone sources.",
    });
  }
  return warnings;
}

function hasFreshnessWork(freshness: FreshnessResult): boolean {
  return (
    freshness.stale_doc_sources.length > 0 ||
    freshness.stale_code_sources.length > 0 ||
    freshness.missing_sources.length > 0
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
