/**
 * Pre-retrieve freshness check (PRD-0035 / slice 35.2).
 *
 * Pure detector: given a SQLite db and a corpus root, returns the indexed
 * sources whose on-disk state has drifted since they were last imported.
 *
 *   - `missing_sources`  — indexed but no longer on disk.
 *   - `stale_doc_sources` — indexed doc whose content-hash no longer matches.
 *   - `stale_code_sources` — indexed code whose content-hash no longer matches.
 *
 * No side effects, no SQL writes. The MCP `retrieve_context_pack` handler
 * calls this before pack assembly and emits warnings into `pack.warnings[]`.
 *
 * Staleness uses content-hash comparison (not mtime), so a save-without-
 * change is not flagged. For doc sources we have stored stat metadata, so
 * we skip hashing only when both mtime and size still match. Code sources
 * don't store stat metadata, so we hash directly when the file exists.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Db } from "../store/db.js";
import { listSources } from "../store/sources.js";
import { listCodeSources } from "../store/code-sources.js";

export type FreshnessResult = {
  stale_doc_sources: string[];
  stale_code_sources: string[];
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

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function detectStaleSources(
  db: Db,
  cwd: string,
  opts: FreshnessCheckOptions = {},
): FreshnessResult {
  const out: FreshnessResult = {
    stale_doc_sources: [],
    stale_code_sources: [],
    missing_sources: [],
  };

  // Deterministic file-path order so early-exit results are reproducible.
  const docSources = [...listSources(db)].sort((a, b) =>
    a.source_path.localeCompare(b.source_path),
  );
  const codeSources = listCodeSources(db); // already ORDER BY source_path

  const totalIndexed = docSources.length + codeSources.length;
  const earlyExit =
    (opts.earlyExit ?? true) && totalIndexed > FRESHNESS_EARLY_EXIT_THRESHOLD;
  const hasAny = (): boolean =>
    out.missing_sources.length > 0 ||
    out.stale_doc_sources.length > 0 ||
    out.stale_code_sources.length > 0;

  for (const src of docSources) {
    const abs = join(cwd, src.source_path);
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
    const raw = readFileSync(abs, "utf8");
    if (sha256(raw) !== src.source_content_hash) {
      out.stale_doc_sources.push(src.source_path);
      if (earlyExit && hasAny()) return out;
    }
  }

  for (const stored of codeSources) {
    const abs = join(cwd, stored.facts.file_path);
    if (!existsSync(abs)) {
      out.missing_sources.push(stored.facts.file_path);
      if (earlyExit && hasAny()) return out;
      continue;
    }
    const raw = readFileSync(abs, "utf8");
    if (sha256(raw) !== stored.source_content_hash) {
      out.stale_code_sources.push(stored.facts.file_path);
      if (earlyExit && hasAny()) return out;
    }
  }

  return out;
}
