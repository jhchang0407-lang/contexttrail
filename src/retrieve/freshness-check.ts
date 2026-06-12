/**
 * Pre-retrieve freshness check.
 *
 * Pure detector: given a SQLite db and a corpus root, returns the indexed
 * sources whose on-disk state has drifted since they were last imported.
 *
 *   - `missing_sources`  — indexed but no longer on disk.
 *   - `stale_doc_sources` — indexed doc whose content-hash no longer matches.
 *
 * No side effects, no SQL writes. The MCP `retrieve_context_pack` handler
 * calls this before pack assembly and emits warnings into `pack.warnings[]`.
 *
 * Staleness uses content-hash comparison (not mtime), so a save-without-
 * change is not flagged. We have stored stat metadata for each source, so
 * we skip hashing only when both mtime and size still match.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Db } from "../store/db.js";
import { listSources } from "../store/sources.js";
import { absoluteSourcePath } from "../source-path.js";

export type FreshnessResult = {
  stale_doc_sources: string[];
  missing_sources: string[];
};

export type FreshnessCheckOptions = {
  /**
   * Defaults to true for the warning-only path. Auto-reindex callers disable
   * this so repair operates on the full stale set, not the first stale path.
   */
  earlyExit?: boolean;
};

/**
 * Early-exit threshold. When more sources than this are indexed, the
 * check stops at the first detected staleness so latency floor stays
 * predictable on large corpora. The warning still fires; we just don't
 * enumerate every stale path.
 */
export const FRESHNESS_EARLY_EXIT_THRESHOLD = 200;

function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

export function detectStaleSources(
  db: Db,
  cwd: string,
  opts: FreshnessCheckOptions = {},
): FreshnessResult {
  const out: FreshnessResult = {
    stale_doc_sources: [],
    missing_sources: [],
  };

  // Deterministic file-path order so early-exit results are reproducible.
  const docSources = [...listSources(db)].sort((a, b) =>
    a.source_path.localeCompare(b.source_path),
  );
  const totalIndexed = docSources.length;
  const earlyExit =
    (opts.earlyExit ?? true) && totalIndexed > FRESHNESS_EARLY_EXIT_THRESHOLD;
  const hasAny = (): boolean =>
    out.missing_sources.length > 0 || out.stale_doc_sources.length > 0;

  for (const src of docSources) {
    const abs = absoluteSourcePath(cwd, src.source_path);
    if (!existsSync(abs)) {
      out.missing_sources.push(src.source_path);
      if (earlyExit && hasAny()) return out;
      continue;
    }
    const stat = statSync(abs);
    const mtimeMs = Math.floor(stat.mtimeMs);
    if (stat.size === src.source_size && mtimeMs === src.source_mtime_ms) {
      continue;
    }
    const raw = readFileSync(abs);
    if (sha256(raw) !== src.source_content_hash) {
      out.stale_doc_sources.push(src.source_path);
      if (earlyExit && hasAny()) return out;
    }
  }

  return out;
}
