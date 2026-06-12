/**
 * Repo-level setup readiness scan.
 *
 * Pure read-side composition. Inspects the filesystem for discoverable
 * markdown and the local SQLite cache for imported chunk / card state.
 * Returns per-dimension band + structured evidence. retrieval_probes is
 * stubbed unless pre-computed probe results are passed in via ScanOpts.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { openDb, closeDb } from "../store/db.js";
import {
  bandForCorpusCoverage,
  bandForScopeCoverage,
  bandForCardCoverage,
  bandForRetrievalProbes,
  type ReadinessBand,
} from "./readiness-bands.js";
import type { ProbeResult } from "./probes.js";

export type ReadinessDimensionName =
  | "corpus_coverage"
  | "scope_coverage"
  | "card_coverage"
  | "retrieval_probes";

export type DimensionReport = {
  score: ReadinessBand;
  evidence: Record<string, unknown>;
};

export type SetupReadinessReport = {
  cwd: string;
  dimensions: Record<ReadinessDimensionName, DimensionReport>;
};

function listDiscoverableMarkdown(cwd: string): string[] {
  const out: string[] = [];
  // Repo-root README.md only (case-insensitive name match, but must end in .md).
  let entries: string[] = [];
  try { entries = readdirSync(cwd); } catch { /* repo dir gone — treat as empty */ }
  for (const name of entries) {
    if (/^readme\.md$/i.test(name)) {
      out.push(join(cwd, name));
    }
  }
  const docsDir = join(cwd, "docs");
  if (existsSync(docsDir)) {
    walkMarkdown(docsDir, out);
  }
  return out;
}

function walkMarkdown(dir: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const p = join(dir, entry);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      walkMarkdown(p, out);
    } else if (entry.toLowerCase().endsWith(".md")) {
      out.push(p);
    }
  }
}

function normalizeSourcePath(cwd: string, p: string): string {
  const rel = isAbsolute(p) ? relative(cwd, p) : p;
  return rel.split(sep).join("/");
}

export type ScanOpts = {
  /**
   * Pre-computed probe results. When omitted, retrieval_probes
   * is reported as `partial` with a "probes not run" note. The CLI /
   * MCP path produces results from runProbes() and passes them in;
   * library callers can read state without paying the retrieval cost.
   */
  probeResults?: ProbeResult[];
};

export function scanSetupReadiness(
  cwd: string,
  opts: ScanOpts = {},
): SetupReadinessReport {
  const discoverableMd = listDiscoverableMarkdown(cwd);
  const discoverableRel = new Set(discoverableMd.map((p) => normalizeSourcePath(cwd, p)));

  const retrieval_probes = opts.probeResults
    ? buildProbeDimension(opts.probeResults)
    : stubbedProbeReport();

  const dbPath = join(cwd, ".contexttrail/cache/contexttrail.db");
  if (!existsSync(dbPath)) {
    return {
      cwd,
      dimensions: {
        corpus_coverage: {
          score: bandForCorpusCoverage({
            discoverable: discoverableRel.size,
            imported: 0,
            importedChunks: 0,
          }),
          evidence: {
            discoverable_markdown: discoverableRel.size,
            imported_markdown: 0,
            imported_chunks: 0,
            cache_present: false,
          },
        },
        scope_coverage: {
          score: bandForScopeCoverage({ totalChunks: 0, scopedChunks: 0 }),
          evidence: { total_chunks: 0, scoped_chunks: 0, cache_present: false },
        },
        card_coverage: {
          score: bandForCardCoverage({ acceptedCards: 0, constraintCards: 0 }),
          evidence: {
            accepted_cards: 0,
            constraint_cards: 0,
            card_type_counts: { constraint: 0, symbol_note: 0, evidence: 0 },
            cache_present: false,
          },
        },
        retrieval_probes,
      },
    };
  }

  const db = openDb(dbPath);
  try {
    const sourcePathRows = db
      .prepare(
        "SELECT DISTINCT source_path FROM doc_chunks WHERE status='current'",
      )
      .all() as { source_path: string }[];
    const importedRel = new Set(
      sourcePathRows.map((r) => normalizeSourcePath(cwd, r.source_path)),
    );
    let importedDiscoverable = 0;
    for (const f of discoverableRel) {
      if (importedRel.has(f)) importedDiscoverable++;
    }

    const chunkCountRow = db
      .prepare("SELECT COUNT(*) AS n FROM doc_chunks WHERE status='current'")
      .get() as { n: number };
    const importedChunks = chunkCountRow.n;

    const corpus_coverage: DimensionReport = {
      score: bandForCorpusCoverage({
        discoverable: discoverableRel.size,
        imported: importedDiscoverable,
        importedChunks,
      }),
      evidence: {
        discoverable_markdown: discoverableRel.size,
        imported_markdown: importedDiscoverable,
        imported_chunks: importedChunks,
        cache_present: true,
      },
    };

    const scopeRows = db
      .prepare("SELECT scope_layer FROM doc_chunks WHERE status='current'")
      .all() as { scope_layer: string | null }[];
    const totalChunks = scopeRows.length;
    const scopedChunks = scopeRows.filter(
      (r) => r.scope_layer != null && r.scope_layer !== "unknown",
    ).length;
    const scope_coverage: DimensionReport = {
      score: bandForScopeCoverage({ totalChunks, scopedChunks }),
      evidence: {
        total_chunks: totalChunks,
        scoped_chunks: scopedChunks,
        unknown_chunks: totalChunks - scopedChunks,
      },
    };

    const cardRows = db
      .prepare("SELECT type FROM cards WHERE authority='accepted'")
      .all() as { type: string }[];
    const acceptedCards = cardRows.length;
    const typeCounts = { constraint: 0, symbol_note: 0, evidence: 0 };
    for (const r of cardRows) {
      if (r.type === "constraint") typeCounts.constraint++;
      else if (r.type === "symbol_note") typeCounts.symbol_note++;
      else if (r.type === "evidence") typeCounts.evidence++;
    }
    const card_coverage: DimensionReport = {
      score: bandForCardCoverage({
        acceptedCards,
        constraintCards: typeCounts.constraint,
      }),
      evidence: {
        accepted_cards: acceptedCards,
        constraint_cards: typeCounts.constraint,
        card_type_counts: typeCounts,
      },
    };

    return {
      cwd,
      dimensions: {
        corpus_coverage,
        scope_coverage,
        card_coverage,
        retrieval_probes,
      },
    };
  } finally {
    closeDb(db);
  }
}

function stubbedProbeReport(): DimensionReport {
  return {
    score: "partial",
    evidence: { note: "probes not run — pass opts.probeResults to populate" },
  };
}

function buildProbeDimension(results: ProbeResult[]): DimensionReport {
  const totalProbes = results.length;
  const confidentProbes = results.filter(
    (r) => r.coverage_confidence === "confident",
  ).length;
  return {
    score: bandForRetrievalProbes({ totalProbes, confidentProbes }),
    evidence: {
      total_probes: totalProbes,
      confident_probes: confidentProbes,
      per_probe: results.map((r) => ({
        id: r.id,
        task: r.task,
        coverage_confidence: r.coverage_confidence,
        signal_empty: r.signal_empty,
        rationale: r.rationale,
      })),
    },
  };
}
