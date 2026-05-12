import { join } from "node:path";
import { openDb, closeDb } from "../store/db.js";
import type { CodeAnchor } from "../types/chunk.js";

export type ScopeReportRow = {
  version_id: string;
  source_path: string;
  scope_layer: string;
  scope: Record<string, unknown>;
  heading_path: string[];
  start_line: number;
  end_line: number;
  anchors: CodeAnchor[];
};

export type ScopeReportOpts = { unknownOnly?: boolean };

export function listScopeReport(
  cwd: string,
  opts: ScopeReportOpts = {},
): ScopeReportRow[] {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const baseSql = `
      SELECT version_id, source_path, scope_layer, scope_data,
             heading_path, start_line, end_line
      FROM doc_chunks
      WHERE status='current'
      ${opts.unknownOnly ? "AND (scope_layer='unknown' OR scope_layer IS NULL)" : ""}
      ORDER BY source_path, chunk_index
    `;
    const rows = db.prepare(baseSql).all() as {
      version_id: string;
      source_path: string;
      scope_layer: string | null;
      scope_data: string | null;
      heading_path: string;
      start_line: number | null;
      end_line: number | null;
    }[];

    const anchorStmt = db.prepare(
      "SELECT chunk_version_id, kind, value, confidence, source FROM code_anchors WHERE chunk_version_id=?",
    );
    return rows.map((r) => ({
      version_id: r.version_id,
      source_path: r.source_path,
      scope_layer: r.scope_layer ?? "unknown",
      scope: r.scope_data ? JSON.parse(r.scope_data) : { layer: "unknown" },
      heading_path: JSON.parse(r.heading_path),
      start_line: r.start_line ?? 0,
      end_line: r.end_line ?? 0,
      anchors: anchorStmt.all(r.version_id) as CodeAnchor[],
    }));
  } finally {
    closeDb(db);
  }
}

export function renderScopeReport(rows: ScopeReportRow[]): string {
  if (rows.length === 0) return "(no chunks)\n";
  const out: string[] = [];
  for (const r of rows) {
    out.push(
      `${r.source_path}  [layer=${r.scope_layer}]  ${r.heading_path.join(" > ")}  L${r.start_line}-${r.end_line}`,
    );
    if (r.anchors.length === 0) {
      out.push("    (no anchors)");
    } else {
      for (const a of r.anchors) {
        out.push(`    ${a.kind}: ${a.value} (${a.confidence}, ${a.source})`);
      }
    }
  }
  return out.join("\n") + "\n";
}
