#!/usr/bin/env node
/**
 * OSS assembly probe — measures pack ASSEMBLY behaviour on an untuned corpus.
 *
 * This is not a retrieval-recall test. The metrics are about how the
 * scout-list architecture composes a pack:
 *   - where the right source lands (top-3 primary, top-4-10 scout, deep, absent)
 *   - pack token cost (primary chunks only — scout entries are header-cheap)
 *   - honesty signal: does coverage_confidence match how reachable the answer is?
 *
 * The corpus and fixture live outside the repo at /tmp/oss-test/. Pass the
 * fixture path and corpus root as env vars.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { closeDb, openDb } from "../store/db.js";
import { loadConfig } from "../config/load.js";
import { listSourcesCanonical } from "../store/read-model.js";
import { retrieve, type RetrievalRequest } from "../retrieve/retrieve.js";
import { presentContextPack } from "../mcp/presenter.js";

type FixtureCase = {
  id: string;
  task: string;
  expected_top_source: string;
  acceptable_top_sources?: string[];
};

const FIXTURE_PATH = process.env.OSS_FIXTURE ?? "/tmp/oss-test/valibot-fixture.yaml";
const CORPUS_ROOT = process.env.OSS_CORPUS ?? "/tmp/oss-test/corpus";
const IMPORT_GLOBS = ["*.md", "docs/**/*.md", "**/*.md"];

function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const sp = join(src, name);
    const dp = join(dst, name);
    if (statSync(sp).isDirectory()) copyDirSync(sp, dp);
    else copyFileSync(sp, dp);
  }
}

function sourceFromContextTrail(b: string): string {
  const m = b.match(/^Source:\s+([^>]+?)\s+>/);
  if (m && m[1]) return m[1].trim();
  const m2 = b.match(/^Source:\s+(.+)/);
  return m2 && m2[1] ? m2[1].trim() : "";
}

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function rankOfFirstMatch(ranked: { contexttrail: string }[], accepted: Set<string>): number {
  for (let i = 0; i < ranked.length; i++) {
    const item = ranked[i];
    if (!item) continue;
    if (accepted.has(sourceFromContextTrail(item.contexttrail))) return i + 1;
  }
  return 0;
}

async function main() {
  const fixture = YAML.parse(readFileSync(FIXTURE_PATH, "utf-8")) as FixtureCase[];
  const cwd = mkdtempSync(join(tmpdir(), "contexttrail-oss-probe-"));
  try {
    init(cwd);
    copyDirSync(CORPUS_ROOT, cwd);
    runImport(cwd, IMPORT_GLOBS);
    const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
    try {
      const config = loadConfig(cwd);
      const importedSources = new Set(listSourcesCanonical(db).map(s => s.source_path));
      console.log(`Imported ${importedSources.size} sources from ${CORPUS_ROOT}`);
      const budgets = config.retrieval.budgets;

      type Row = {
        id: string; task: string;
        accepted: string[];
        rank: number;
        primaryHit: boolean;       // right source surfaced in top-3 chunks
        scoutHit: boolean;         // right source surfaced in chunks ranked 4-10
        deepHit: boolean;          // right source surfaced at rank 11+
        absent: boolean;
        primaryTokens: number;     // approx tokens in top-3 chunk bodies
        coverage: string;          // coverage_confidence enum
        queryMode: string;
        topPrimarySources: string[];
        scoutSources: string[];
      };
      const rows: Row[] = [];

      for (const entry of fixture) {
        const accepted = new Set(entry.acceptable_top_sources ?? [entry.expected_top_source]);
        const request: RetrievalRequest = {
          task: entry.task,
          query_anchors: { files: [], symbols: [], routes: [] },
          budget: "default",
          expected_locked: [],
          explain: false,
        };
        const result = retrieve(db, request, config);
        const response = presentContextPack({
          query: entry.task,
          result,
          requested_budget: budgets["default"],
          has_sources: importedSources.size > 0,
          explain: false,
          min_final_score: config.retrieval.min_final_score,
        });
        const chunks = response.ranked.filter(r => r.kind === "chunk");
        const rank = rankOfFirstMatch(chunks, accepted);
        const primaryHit = rank > 0 && rank <= 3;
        const scoutHit = rank > 3 && rank <= 10;
        const deepHit = rank > 10;
        const absent = rank === 0;
        const top3 = chunks.slice(0, 3);
        const scoutBand = chunks.slice(3, 10);
        const primaryTokens = top3.reduce((acc, r) => acc + approxTokens(r.body ?? ""), 0);
        rows.push({
          id: entry.id, task: entry.task,
          accepted: [...accepted],
          rank,
          primaryHit, scoutHit, deepHit, absent,
          primaryTokens,
          coverage: response.coverage_confidence ?? "?",
          queryMode: response.query_mode ?? "?",
          topPrimarySources: top3.map(r => sourceFromContextTrail(r.contexttrail)),
          scoutSources: scoutBand.map(r => sourceFromContextTrail(r.contexttrail)),
        });
      }

      // Aggregate
      const total = rows.length;
      const primary = rows.filter(r => r.primaryHit).length;
      const scout = rows.filter(r => r.scoutHit).length;
      const deep = rows.filter(r => r.deepHit).length;
      const absentN = rows.filter(r => r.absent).length;
      const top1 = rows.filter(r => r.rank === 1).length;
      const top5 = rows.filter(r => r.rank > 0 && r.rank <= 5).length;
      const top10 = rows.filter(r => r.rank > 0 && r.rank <= 10).length;

      const tokenBuckets = rows.map(r => r.primaryTokens).sort((a, b) => a - b);
      const idx = (p: number) => tokenBuckets[Math.min(tokenBuckets.length - 1, Math.floor(tokenBuckets.length * p))] ?? 0;
      const p50 = idx(0.5);
      const p90 = idx(0.9);
      const max = tokenBuckets[tokenBuckets.length - 1] ?? 0;

      console.log(`\n========== ASSEMBLY METRICS — valibot OSS corpus ==========`);
      console.log(`${total} queries, untuned external corpus\n`);
      console.log(`Pack composition (where the right source lands):`);
      console.log(`  PRIMARY (rank 1-3, in pack as full chunk):  ${primary}/${total}  (${(primary/total*100).toFixed(1)}%)`);
      console.log(`  SCOUT   (rank 4-10, surfaced as candidate): ${scout}/${total}  (${(scout/total*100).toFixed(1)}%)`);
      console.log(`  DEEP    (rank 11+, retrievable but buried): ${deep}/${total}  (${(deep/total*100).toFixed(1)}%)`);
      console.log(`  ABSENT  (not in any candidate list):        ${absentN}/${total}  (${(absentN/total*100).toFixed(1)}%)`);
      console.log(`\nReachability:`);
      console.log(`  top-1:  ${top1}/${total}  (${(top1/total*100).toFixed(1)}%)`);
      console.log(`  top-3:  ${primary}/${total}  (${(primary/total*100).toFixed(1)}%)  ← scout-3 success`);
      console.log(`  top-5:  ${top5}/${total}  (${(top5/total*100).toFixed(1)}%)`);
      console.log(`  top-10: ${top10}/${total}  (${(top10/total*100).toFixed(1)}%)  ← scout-10 success`);
      console.log(`\nPrimary pack token cost (top-3 chunks, approx tokens):`);
      console.log(`  p50: ${p50}   p90: ${p90}   max: ${max}`);
      console.log(`\nHonesty (coverage_confidence × outcome):`);
      const matrix: Record<string, Record<string, number>> = {};
      for (const r of rows) {
        const outcome = r.primaryHit ? "primary" : r.scoutHit ? "scout" : r.absent ? "absent" : "deep";
        matrix[r.coverage] ??= { primary: 0, scout: 0, deep: 0, absent: 0 };
        const bucket = matrix[r.coverage]!;
        bucket[outcome] = (bucket[outcome] ?? 0) + 1;
      }
      const cov = Object.keys(matrix).sort();
      console.log(`  ${"coverage".padEnd(14)} ${"primary".padStart(8)} ${"scout".padStart(8)} ${"deep".padStart(8)} ${"absent".padStart(8)}`);
      for (const c of cov) {
        const m = matrix[c]!;
        console.log(`  ${c.padEnd(14)} ${String(m["primary"] ?? 0).padStart(8)} ${String(m["scout"] ?? 0).padStart(8)} ${String(m["deep"] ?? 0).padStart(8)} ${String(m["absent"] ?? 0).padStart(8)}`);
      }
      console.log(`\nPer-case detail:`);
      for (const r of rows) {
        const outcome = r.primaryHit ? "PRIMARY" : r.scoutHit ? "SCOUT  " : r.absent ? "ABSENT " : "DEEP   ";
        console.log(`  [${outcome}] rank=${String(r.rank).padStart(3)} cov=${r.coverage.padEnd(10)} mode=${r.queryMode.padEnd(12)} ${r.id}`);
        console.log(`              task: ${r.task}`);
        console.log(`              expected: ${r.accepted.join(" | ")}`);
        if (!r.primaryHit) {
          console.log(`              top-3 sources surfaced:`);
          r.topPrimarySources.forEach((s, i) => console.log(`                ${i + 1}. ${s}`));
          if (r.scoutHit || r.deepHit) {
            console.log(`              scout band (rank 4-10):`);
            r.scoutSources.forEach((s, i) => console.log(`                ${i + 4}. ${s}`));
          }
        }
      }
    } finally { closeDb(db); }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

void main().catch(err => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
