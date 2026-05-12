/**
 * Debug-trace dump for a single real-corpus case.
 *
 * After three blanket-policy reverts (V5.8, V5.9, V5.11) it became clear
 * that the remaining 17 real-corpus failures are not a single class —
 * each is a specific combination of signals where V3's primitives don't
 * fire (or fire wrong) in a specific way. Building the next narrow fix
 * needs full visibility into V3's actual decision for one case.
 *
 * This script:
 *   1. Loads a real-corpus repo's docs into a temp lab
 *   2. Runs the full retrieval pipeline against a single case ID
 *   3. Prints every decision layer V3 made:
 *      - query_compilation (anchor recognition, mode)
 *      - source candidates after V2.5 source-rerank (top-10)
 *      - source_aboutness (labels + reason codes per top-N card)
 *      - source_selection (selected_sources with reasons + scores)
 *      - source_selection_applied (the gate result)
 *      - displayed top-3
 *   4. Annotates each block with the case's `expected_top_source` so
 *      mismatches are obvious.
 *
 * Usage:
 *   npm run eval:debug-case -- <repo> <case_id>
 *   npm run eval:debug-case -- <repo> --list
 *
 * Example:
 *   npm run eval:debug-case -- vitest vitest-cross-module-browser-mode
 */
import { ConfigSchema, type ContextTrailConfig } from "../config/defaults.js";
import { openDb } from "../store/db.js";
import { retrieve, type RetrievalRequest } from "../retrieve/retrieve.js";
import {
  createRealCorpusLab,
  loadRealCorpusEvalSet,
} from "./real-corpus-fixture.js";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";

function loadConfig(cwd: string): ContextTrailConfig {
  const cfgPath = join(cwd, ".contexttrail", "config.yaml");
  if (!existsSync(cfgPath)) return ConfigSchema.parse({});
  const text = readFileSync(cfgPath, "utf8");
  return ConfigSchema.parse(parseYaml(text));
}

function pad(label: string, value: unknown, indent = 2): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const ind = " ".repeat(indent);
  return `${ind}${label}: ${text}`;
}

function header(text: string): string {
  return `\n=== ${text} ===\n`;
}

async function main(): Promise<void> {
  const repo = process.argv[2];
  const caseId = process.argv[3];
  if (!repo || !caseId) {
    console.error("usage: debug-case <repo> <case_id>");
    console.error("   or: debug-case <repo> --list");
    process.exit(1);
  }

  const cases = loadRealCorpusEvalSet(repo);
  if (caseId === "--list") {
    console.log(header(`AVAILABLE CASES: ${repo}`));
    for (const c of cases) {
      console.log(`- ${c.id}`);
    }
    return;
  }
  const target = cases.find((c) => c.id === caseId);
  if (!target) {
    console.error(`case "${caseId}" not found in repo "${repo}"`);
    console.error("available case ids:");
    for (const c of cases) console.error(`  ${c.id}`);
    process.exit(1);
  }

  const lab = createRealCorpusLab(repo);
  try {
    lab.importCorpus();
    const db = openDb(join(lab.cwd, ".contexttrail", "cache", "contexttrail.db"));
    const config = loadConfig(lab.cwd);
    const request: RetrievalRequest = {
      task: target.task,
      query_anchors: {
        files: target.files ?? [],
        symbols: target.symbols ?? [],
        routes: target.routes ?? [],
      },
      budget: target.budget ?? "default",
    };
    const result = retrieve(db, request, config);

    console.log(header(`CASE: ${caseId}`));
    console.log(pad("repo", repo));
    console.log(pad("task", JSON.stringify(target.task)));
    console.log(pad("provided_anchors", request.query_anchors));
    console.log(pad("expected_query_mode", target.expected_query_mode));
    console.log(pad("expected_top_source", target.expected_top_source));
    console.log(pad("must_include_sources", target.must_include_sources));
    console.log(pad("acceptable_top_sources", target.acceptable_top_sources));

    console.log(header("query_compilation"));
    console.log(pad("query_mode", result.query_mode));
    console.log(pad("provided", result.query_compilation.provided_anchor_count));
    console.log(pad("recognized", result.query_compilation.recognized_anchor_count));
    for (const a of result.query_compilation.anchors) {
      console.log(
        pad(
          `anchor[${a.anchor.kind}=${a.anchor.value}]`,
          { recognition: a.recognition, mode: a.mode, scopes: a.scopes.length },
        ),
      );
    }

    console.log(header("V2.5 source rerank — top-10"));
    const topRerank = (result.source_rerank ?? []).slice(0, 10);
    for (const r of topRerank) {
      const path = r.candidate.source_path;
      const star = path === target.expected_top_source ? " ★" : "";
      console.log(
        pad(
          `rank[${r.rank}]${star} ${path}`,
          {
            score: round(r.score),
            best_chunk_score: round(r.candidate.best_chunk_score),
            fused_path_count: r.candidate.fused_path_count,
            doc_purpose: r.candidate.profile?.doc_purpose ?? null,
          },
        ),
      );
    }

    console.log(header("V2.5 top-source coverage"));
    console.log(
      pad("top_source_coverage", result.top_source_coverage ?? "(none)"),
    );

    console.log(header("V3 source aboutness — top-10"));
    const topAbout = (result.source_aboutness ?? []).slice(0, 10);
    for (const o of topAbout) {
      const star = o.source_path === target.expected_top_source ? " ★" : "";
      console.log(
        pad(
          `[rank=${o.rank}]${star} ${o.source_path}`,
          {
            label: o.label,
            reasons: o.reason_codes,
            coverage: round(o.combined_token_coverage),
          },
        ),
      );
    }

    console.log(header("V3 selection decision"));
    const sel = result.source_selection;
    console.log(pad("fail_closed", sel?.fail_closed ?? "n/a"));
    console.log(pad("applied", result.source_selection_applied ?? false));
    console.log(pad("top1_top2_margin", round(sel?.top1_top2_margin ?? 0)));
    if (sel) {
      for (const s of sel.selected_sources.slice(0, 5)) {
        const star = s.source_path === target.expected_top_source ? " ★" : "";
        console.log(
          pad(
            `selected[rank=${s.rank}]${star} ${s.source_path}`,
            { score: round(s.score), label: s.aboutness_label, reasons: s.reason_codes },
          ),
        );
      }
    }

    console.log(header("displayed top-3"));
    for (let i = 0; i < Math.min(3, result.pack.included.length); i++) {
      const t = result.pack.included[i];
      if (!t) continue;
      const sourcePath =
        t.kind === "doc_chunk"
          ? result.chunksByVersionId.get(t.version_id)?.source_path ?? "?"
          : "(card)";
      const star = sourcePath === target.expected_top_source ? " ★" : "";
      console.log(
        pad(
          `[${i + 1}]${star} ${sourcePath}`,
          { kind: t.kind, score: round(t.final_score) },
        ),
      );
    }

    const displayedTop1Source =
      result.pack.included[0]?.kind === "doc_chunk"
        ? result.chunksByVersionId.get(result.pack.included[0].version_id)
            ?.source_path
        : null;
    const verdict =
      displayedTop1Source &&
      target.acceptable_top_sources?.includes(displayedTop1Source)
        ? "PASS (top-1 acceptable)"
        : "FAIL (top-1 not in acceptable_top_sources)";
    console.log(header("verdict"));
    console.log(pad("displayed_top1", displayedTop1Source ?? "(none)"));
    console.log(pad("expected", target.expected_top_source));
    console.log(pad("verdict", verdict));
  } finally {
    lab.cleanup();
  }
}

function round(n: number | undefined): number {
  if (n === undefined) return 0;
  return Math.round(n * 1000) / 1000;
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
