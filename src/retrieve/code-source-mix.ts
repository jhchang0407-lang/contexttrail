/**
 * PRD-0028 / slice 28.3 — code-source candidate mixer.
 *
 * When the `RETRIEVAL_CODE_SOURCE_INDEX` flag is on, this module queries the
 * `code_sources_fts` virtual table (populated by slice 28.2) with the user's
 * task text, projects each hit into a ranked entry with `kind: "code"`, and
 * the caller appends those entries to `pack.ranked` peer-to `kind: "chunk"`
 * / `kind: "card"` entries.
 *
 * Scoring: FTS5 BM25F with the principled fixed weights from
 * `CODE_SOURCES_FTS_WEIGHTS` (PRD-0028 § slice 28.2). bm25() is negative-
 * lower-better; we flip to positive-higher-better and clamp to a [0, 1]-ish
 * range using the doc-side `min_final_score` floor as a regularizer so code
 * candidates don't crowd the top of the pack.
 *
 * Body shape mirrors what an engineer would read first when they open the
 * file: path → exports → JSDoc summary → signatures. This is also what the
 * `extractFilePathMentions` regex in the agent-completion probe scans for.
 */
import type { Db } from "../store/db.js";
import {
  getCodeSource,
  searchCodeSourcesFts,
} from "../store/code-sources.js";
import { expandCodeGraphWithDistances } from "../store/code-graph.js";
import { count as countTokens } from "../parse/tokens.js";
import { codeSourceIndexEnabledFromEnv } from "./code-source-flag.js";

export type CodeRankedEntry = {
  id: string;
  kind: "code";
  scope: Record<string, never>;
  tokens: number;
  score: number;
  body: string;
  contexttrail: string;
  type_bias_applied: false;
};

export type BuildCodeRankedEntriesArgs = {
  db: Db;
  query: string;
  limit?: number;
  enabled?: boolean;
  /** Floor for the score so code entries don't crowd the top of the pack. */
  score_floor?: number;
  /** Clamp result count; default 10. */
  max_results?: number;
  /**
   * PRD-0028 / slice 28.4: max hops for code-import-graph traversal.
   * Defaults to 2 (parity with markdown link traversal). Set to 0 to
   * disable traversal — only direct FTS hits are returned.
   */
  import_max_hops?: number;
  /**
   * Fraction of the worst FTS hit's score to assign to import-traversed
   * entries. Keeps the traversal pulls below the symbol-matched entries.
   */
  import_inherited_score_fraction?: number;
  /**
   * Hard cap on the number of import-traversed code entries appended
   * after direct lexical hits.
   */
  import_traversed_max_results?: number;
  /**
   * Hard cap on the token mass of import-traversed code entries.
   */
  import_traversed_max_tokens?: number;
};

const DEFAULT_MAX_RESULTS = 10;
const SCORE_FLOOR = 0.05;
const DEFAULT_IMPORT_HOPS = 2;
const IMPORT_INHERITED_SCORE_FRACTION = 0.5;
const DEFAULT_IMPORT_TRAVERSED_MAX_RESULTS = 8;
const DEFAULT_IMPORT_TRAVERSED_MAX_TOKENS = 1000;

export function buildCodeRankedEntries(
  args: BuildCodeRankedEntriesArgs,
): CodeRankedEntry[] {
  const enabled = args.enabled ?? codeSourceIndexEnabledFromEnv();
  if (!enabled) return [];
  if (!args.query.trim()) return [];
  const query = ftsSafeQuery(args.query);
  if (!query) return [];
  const limit = args.limit ?? args.max_results ?? DEFAULT_MAX_RESULTS;
  const hits = searchCodeSourcesFts(args.db, query, limit);
  if (hits.length === 0) return [];

  // bm25() returns negative-better; the worst (least relevant) hit is the
  // largest. Normalize to a positive [0, 1]-ish range: invert and divide
  // by the worst absolute magnitude in the set. The score floor keeps
  // code candidates from dominating the pack on weak matches.
  const floor = args.score_floor ?? SCORE_FLOOR;
  const worst = Math.max(...hits.map((h) => Math.abs(h.bm25)), 1);

  const out: CodeRankedEntry[] = [];
  const surfacedPaths = new Set<string>();
  const ftsScoreByPath = new Map<string, number>();
  for (const hit of hits) {
    const stored = getCodeSource(args.db, hit.file_path);
    if (!stored) continue;
    const body = renderCodeBody(stored.facts);
    const tokens = countTokens(body);
    const normalized = clamp01(Math.abs(hit.bm25) / worst);
    const score = floor + normalized * (1 - floor);
    surfacedPaths.add(stored.facts.file_path);
    ftsScoreByPath.set(stored.facts.file_path, score);
    out.push({
      id: `code:${stored.facts.file_path}`,
      kind: "code",
      scope: {},
      tokens,
      score,
      body,
      contexttrail: `Code: ${stored.facts.file_path}`,
      type_bias_applied: false,
    });
  }

  // PRD-0028 / slice 28.4: expand via the code-import graph. When a
  // file surfaces via FTS, its imports are part of the assembly need —
  // substrate files (db.ts, chunks.ts, schema.ts) are reached this way
  // because they don't FTS-match the natural-language ticket query.
  // Structural parallel to markdown link traversal in PRD-0027 / 28.3.
  const importHops = args.import_max_hops ?? DEFAULT_IMPORT_HOPS;
  if (importHops > 0 && surfacedPaths.size > 0) {
    const inheritedFraction =
      args.import_inherited_score_fraction ?? IMPORT_INHERITED_SCORE_FRACTION;
    const expanded = expandCodeGraphWithDistances(args.db, {
      seeds: surfacedPaths,
      maxHops: importHops,
      directions: ["outgoing", "incoming"],
    });
    const maxTraversedResults =
      args.import_traversed_max_results ?? DEFAULT_IMPORT_TRAVERSED_MAX_RESULTS;
    const maxTraversedTokens =
      args.import_traversed_max_tokens ?? DEFAULT_IMPORT_TRAVERSED_MAX_TOKENS;

    // Pre-compute traversed-entry score: inherited from the worst FTS
    // hit so traversed entries land below symbol-matched entries.
    const traversalScoreBase = Math.min(
      ...[...ftsScoreByPath.values()],
      floor,
    );
    const traversalScore = Math.max(floor, traversalScoreBase * inheritedFraction);

    const traversedCandidates: Array<CodeRankedEntry & { distance: number }> = [];
    for (const [path, distance] of expanded.entries()) {
      if (distance === 0 || surfacedPaths.has(path)) continue;
      const stored = getCodeSource(args.db, path);
      if (!stored) continue;
      const body = renderCodeBody(stored.facts);
      const tokens = countTokens(body);
      traversedCandidates.push({
        id: `code:${stored.facts.file_path}`,
        kind: "code",
        scope: {},
        tokens,
        score: traversalScore,
        body,
        contexttrail: `Code: ${stored.facts.file_path} (import-traversed)`,
        type_bias_applied: false,
        distance,
      });
    }
    traversedCandidates.sort(
      (a, b) => a.distance - b.distance || a.tokens - b.tokens || a.id.localeCompare(b.id),
    );

    let traversedCount = 0;
    let traversedTokens = 0;
    for (const candidate of traversedCandidates) {
      if (traversedCount >= maxTraversedResults) break;
      if (traversedTokens + candidate.tokens > maxTraversedTokens) continue;
      out.push({
        id: candidate.id,
        kind: candidate.kind,
        scope: candidate.scope,
        tokens: candidate.tokens,
        score: candidate.score,
        body: candidate.body,
        contexttrail: candidate.contexttrail,
        type_bias_applied: candidate.type_bias_applied,
      });
      traversedCount += 1;
      traversedTokens += candidate.tokens;
    }
  }
  return out;
}

function renderCodeBody(facts: {
  file_path: string;
  exported_symbols: { name: string; kind: string }[];
  exported_signatures: string[];
  file_purpose: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`File: ${facts.file_path}`);
  if (facts.exported_symbols.length > 0) {
    lines.push(
      `Exports: ${facts.exported_symbols
        .map((s) => `${s.name} (${s.kind})`)
        .join(", ")}`,
    );
  }
  if (facts.file_purpose) {
    lines.push("");
    lines.push(facts.file_purpose);
  }
  if (facts.exported_signatures.length > 0) {
    lines.push("");
    lines.push("Signatures:");
    for (const sig of facts.exported_signatures) lines.push(`  ${sig}`);
  }
  return lines.join("\n");
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Strip FTS5 query operators (and bare colons) so a raw user task string
 * can be passed through safely. FTS5 raises on a stray `:` or unbalanced
 * quote and the catch in searchCodeSourcesFts would swallow the whole
 * result set — pre-cleaning gives us partial-match recall on natural
 * language tasks.
 */
function ftsSafeQuery(raw: string): string {
  // Tokenize on non-word boundaries; drop FTS-meaningful chars; lowercase.
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9_\-/]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    // Drop tokens that look like FTS column qualifiers.
    .filter((t) => !t.endsWith("-") && !t.startsWith("-"));
  if (tokens.length === 0) return "";
  // OR-join so any token can match — FTS5 implicit conjunction is too
  // strict for natural-language task queries.
  return tokens.map((t) => `"${t}"`).join(" OR ");
}
