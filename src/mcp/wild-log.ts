/**
 * Wild-queries logging — env-var-gated capture of every retrieve_context_pack
 * call during real agent sessions.
 *
 * Behavior:
 *   - off by default
 *   - enabled when `CONTEXTTRAIL_WILD_LOG=1` (or `=true`)
 *   - optional `CONTEXTTRAIL_SESSION_TAG=<tag>` to bucket entries
 *   - writes append-only JSONL to `<cwd>/.contexttrail/wild-queries.jsonl`
 *   - swallows errors so logging never breaks retrieval
 *
 * Used as a directional sanity check, not a quality gate.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export type WildLogEntry = {
  timestamp: string;
  session_tag?: string;
  task: string;
  files?: string[];
  symbols?: string[];
  routes?: string[];
  budget?: string;
  query_mode: string;
  ranked_count: number;
  locked_count: number;
  warning_kinds: string[];
  top1?: string;
  packTokensUsed: number;
};

export function isWildLogEnabled(): boolean {
  const flag = process.env.CONTEXTTRAIL_WILD_LOG;
  return flag !== undefined && TRUTHY.has(flag.toLowerCase());
}

export function wildLogPath(cwd: string): string {
  return join(cwd, ".contexttrail", "wild-queries.jsonl");
}

export function logWildQuery(cwd: string, entry: WildLogEntry): void {
  if (!isWildLogEnabled()) return;
  try {
    const path = wildLogPath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Logging is sanity-check evidence, not a gate. Never let it fail a query.
  }
}

export function buildWildLogEntry(input: {
  task: string;
  files?: string[];
  symbols?: string[];
  routes?: string[];
  budget?: string;
}, response: {
  query_mode: string;
  ranked: { kind: "chunk" | "card"; contexttrail: string }[];
  locked: { id: string }[];
  warnings: { kind: string }[];
  budget: { used: number };
}): WildLogEntry {
  const top1 = response.ranked[0];
  return {
    timestamp: new Date().toISOString(),
    session_tag: process.env.CONTEXTTRAIL_SESSION_TAG || undefined,
    task: input.task,
    files: input.files,
    symbols: input.symbols,
    routes: input.routes,
    budget: input.budget,
    query_mode: response.query_mode,
    ranked_count: response.ranked.length,
    locked_count: response.locked.length,
    warning_kinds: response.warnings.map((w) => w.kind),
    top1: top1 ? `${top1.kind}:${top1.contexttrail}` : undefined,
    packTokensUsed: response.budget.used,
  };
}
