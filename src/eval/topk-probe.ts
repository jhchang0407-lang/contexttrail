#!/usr/bin/env node
/**
 * Context-assembly source-recall probe: per answer-bearing real-corpus case,
 * capture the FULL ranked list (not just top-3) and compute whether an
 * acceptable source is reachable at K=1, 3, 5, 10, 20, or anywhere.
 *
 * This intentionally measures source reachability rather than production
 * pack-readiness. It answers the context-assembly question: "if assembly
 * starts from top-3/top-5/top-10 sources, how often is the right source in
 * the slate at all?"
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { closeDb, openDb } from "../store/db.js";
import { loadConfig } from "../config/load.js";
import { listSourcesCanonical } from "../store/read-model.js";
import { retrieve, type RetrievalRequest } from "../retrieve/retrieve.js";
import { presentContextPack } from "../mcp/presenter.js";
import {
  classifyRealCorpusOutcome,
  createRealCorpusLab,
  inferEvalSurface,
  loadRealCorpusEvalSet,
  realCorpusRoot,
} from "./real-corpus-fixture.js";

function sourceFromContextTrail(b: string): string {
  const m = b.match(/^Source:\s+([^>]+?)\s+>/);
  if (m && m[1]) return m[1].trim();
  const m2 = b.match(/^Source:\s+(.+)/);
  return m2 && m2[1] ? m2[1].trim() : "";
}

function rankOfFirstMatch(ranked: { contexttrail: string }[], accepted: string[]): number {
  const set = new Set(accepted);
  for (let i = 0; i < ranked.length; i++) {
    const item = ranked[i];
    if (!item) continue;
    const src = sourceFromContextTrail(item.contexttrail);
    if (set.has(src)) return i + 1;
  }
  return 0; // 0 = absent
}

async function main() {
  const root = realCorpusRoot();
  const repos: string[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".yaml") || name.endsWith(".config.yaml")) continue;
    const repo = name.replace(/\.yaml$/, "");
    try { if (statSync(join(root, repo)).isDirectory()) repos.push(repo); } catch { /* skip */ }
  }
  repos.sort();

  type CaseRow = {
    repo: string; id: string; intent: string; mode: string;
    accepted: string[]; rank: number; rankedCount: number;
    rank1Source: string;
  };
  const rows: CaseRow[] = [];

  for (const repo of repos) {
    const cases = loadRealCorpusEvalSet(repo);
    const lab = createRealCorpusLab(repo);
    try {
      lab.importCorpus();
      const db = openDb(join(lab.cwd, ".contexttrail", "cache", "contexttrail.db"));
      try {
        const config = loadConfig(lab.cwd);
        const importedSources = new Set(listSourcesCanonical(db).map(s => s.source_path));
        const budgets = config.retrieval.budgets;
        for (const entry of cases) {
          if (inferEvalSurface(entry) === "code") continue;
          const request: RetrievalRequest = {
            task: entry.task,
            query_anchors: { files: entry.files ?? [], symbols: entry.symbols ?? [], routes: entry.routes ?? [] },
            budget: entry.budget ?? "default",
            expected_locked: [],
            explain: false,
          };
          const result = retrieve(db, request, config);
          const response = presentContextPack({
            query: entry.task,
            result,
            requested_budget: budgets[entry.budget ?? "default"],
            has_sources: importedSources.size > 0,
            explain: false,
            min_final_score: config.retrieval.min_final_score,
          });
          const acceptable =
            entry.acceptable_top_sources ??
            (entry.expected_top_source ? [entry.expected_top_source] : []);
          const classification = classifyRealCorpusOutcome({
            expectation_kind: entry.expectation_kind,
            expected_query_mode: entry.expected_query_mode,
            expected_signal_empty_warning: entry.expected_signal_empty_warning,
            expected_top_source: entry.expected_top_source,
            acceptableTopSources: acceptable,
            mustIncludeSources: entry.must_include_sources,
            actual_query_mode: response.query_mode,
            coverage_confidence: response.coverage_confidence,
            ranked: response.ranked.map(r => ({ kind: r.kind, contexttrail: r.contexttrail })),
          });
          if (!classification.isAnswerBearing) continue;
          // Count rank against chunk-kind entries only (kind === "chunk"), since
          // that's what the existing top-1/top-3 metric uses.
          const chunkRanked = response.ranked.filter(r => r.kind === "chunk");
          const rank = rankOfFirstMatch(chunkRanked, acceptable);
          const top = chunkRanked[0];
          const rank1Source = top ? sourceFromContextTrail(top.contexttrail) : "(none)";
          rows.push({
            repo, id: entry.id,
            intent: entry.query_intent ?? "?",
            mode: entry.expected_query_mode ?? "?",
            accepted: acceptable,
            rank, rankedCount: chunkRanked.length,
            rank1Source,
          });
        }
      } finally { closeDb(db); }
    } finally { lab.cleanup(); }
  }

  // Aggregate
  const total = rows.length;
  const k = (max: number) => rows.filter(r => r.rank > 0 && r.rank <= max).length;
  const anywhere = rows.filter(r => r.rank > 0).length;
  console.log(`\nTop-K probe over ${total} answer-bearing cases\n`);
  console.log(`top-1:   ${k(1)}/${total}  (${(k(1)/total*100).toFixed(1)}%)`);
  console.log(`top-3:   ${k(3)}/${total}  (${(k(3)/total*100).toFixed(1)}%)`);
  console.log(`top-5:   ${k(5)}/${total}  (${(k(5)/total*100).toFixed(1)}%)`);
  console.log(`top-10:  ${k(10)}/${total}  (${(k(10)/total*100).toFixed(1)}%)`);
  console.log(`top-20:  ${k(20)}/${total}  (${(k(20)/total*100).toFixed(1)}%)`);
  console.log(`anywhere: ${anywhere}/${total}  (${(anywhere/total*100).toFixed(1)}%)`);
  console.log(`\nMisses by rank bucket (rank == 0 means absent):`);
  let bAbsent = 0, b1 = 0, b23 = 0, b45 = 0, b610 = 0, b11p = 0;
  for (const r of rows) {
    if (r.rank === 0) bAbsent += 1;
    else if (r.rank === 1) b1 += 1;
    else if (r.rank <= 3) b23 += 1;
    else if (r.rank <= 5) b45 += 1;
    else if (r.rank <= 10) b610 += 1;
    else b11p += 1;
  }
  const buckets: [string, number][] = [
    ["0 (absent)", bAbsent], ["1", b1], ["2-3", b23], ["4-5", b45], ["6-10", b610], ["11+", b11p],
  ];
  for (const [k2, v] of buckets) console.log(`  ${k2}: ${v}`);
  console.log(`\nCases with right answer at rank > 3 OR absent (the cohort that matters):`);
  for (const r of rows.filter(r => r.rank === 0 || r.rank > 3)) {
    console.log(`  rank=${r.rank || "absent"}  ${r.repo}/${r.id}  intent=${r.intent}  ranked=${r.rankedCount}`);
    console.log(`    rank-1 was: ${r.rank1Source}`);
    console.log(`    expected:   ${r.accepted.join(" | ")}`);
  }
  console.log(`\nRank-2-3 cohort (top-3 hit but lost top-1 — ordering quality):`);
  for (const r of rows.filter(r => r.rank === 2 || r.rank === 3)) {
    console.log(`  rank=${r.rank}  ${r.repo}/${r.id}  intent=${r.intent}`);
    console.log(`    rank-1 (beat us): ${r.rank1Source}`);
    console.log(`    expected:         ${r.accepted.join(" | ")}`);
  }
}

void main().catch(err => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
