#!/usr/bin/env node
/**
 * Vocabulary-mismatch recall eval.
 *
 * Decides whether the engine needs a semantic recall lane. Hypothesis under
 * test: candidate recall is ~99% on the repo's self-authored eval queries
 * because they lexically match the corpora, but drops on colloquial
 * phrasings a nontechnical user would type.
 *
 * Method: for each case in tests/fixtures/vocab-mismatch.yaml (original
 * real-corpus query + 2-3 hand-written paraphrases that avoid the expected
 * document's distinctive vocabulary), import the corpus once into a temp
 * workspace, run the full retrieval pipeline on every query variant, and
 * compare ORIGINAL vs PARAPHRASE on:
 *
 *   (a) candidate-pool recall — whether an acceptable source appears in the
 *       top-K of the `source_rerank` diagnostic on RetrievalResult. This is
 *       the WIDEST stage available: it is the full fused+reranked source
 *       candidate list and covers every chunk-bearing source in the corpus
 *       (so presence-anywhere is trivially ~100%; the informative cuts are
 *       K=20 and K=50). `source_cards` is the top-50 cut of this same list
 *       and is what the V3 source-selection stages actually consume, so
 *       pool@50 ~ "still visible to source selection".
 *   (b) top-1 / top-3 presence in the wire-level ranked pack (presenter
 *       output, capped at 3 entries) for context.
 *
 * All variants run task-text-only (no files/symbols/routes anchors) so the
 * wording is the only variable between original and paraphrase.
 *
 * Measurement, not a gate: always exits 0.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  createRealCorpusLab,
  loadRealCorpusEvalSet,
  sourceFromContextTrail,
} from "./real-corpus-fixture.js";
import {
  closeRetrievalRuntime,
  openRetrievalRuntime,
  runRetrievalPipeline,
} from "../retrieve/runtime.js";
import { presentContextPack } from "../mcp/presenter.js";
import { listSourcesCanonical } from "../store/read-model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const FIXTURE_PATH = join(REPO_ROOT, "tests", "fixtures", "vocab-mismatch.yaml");

/** Name of the candidate-pool stage measured, surfaced in the report. */
const POOL_STAGE =
  "source_rerank (full fused+reranked source list; source_cards = its top-50 cut)";

export type VocabMismatchCase = {
  corpus: string;
  case_id: string;
  original_task: string;
  expected_top_source: string;
  acceptable_top_sources?: string[];
  must_include_sources?: string[];
  paraphrases: string[];
};

export type VariantKind = "original" | "paraphrase";

export type VocabQueryObservation = {
  corpus: string;
  case_id: string;
  variant: VariantKind;
  query: string;
  expected_top_source: string;
  acceptable_sources: string[];
  /** Best (lowest) source_rerank rank over the acceptable sources; null when
   *  no acceptable source appears in the pool at all. */
  pool_rank: number | null;
  pool_size: number;
  pool_top20: boolean;
  pool_top50: boolean;
  pool_any: boolean;
  top1_hit: boolean;
  top3_hit: boolean;
  /** Wire-level packed chunk sources (max 3) — "what ranked instead". */
  packed_sources: string[];
  /** Leading pool sources for miss inspection. */
  pool_leaders: string[];
};

type Aggregate = {
  queries: number;
  pool20: number;
  pool50: number;
  poolAny: number;
  top1: number;
  top3: number;
};

function emptyAggregate(): Aggregate {
  return { queries: 0, pool20: 0, pool50: 0, poolAny: 0, top1: 0, top3: 0 };
}

function addObservation(agg: Aggregate, obs: VocabQueryObservation): void {
  agg.queries += 1;
  if (obs.pool_top20) agg.pool20 += 1;
  if (obs.pool_top50) agg.pool50 += 1;
  if (obs.pool_any) agg.poolAny += 1;
  if (obs.top1_hit) agg.top1 += 1;
  if (obs.top3_hit) agg.top3 += 1;
}

export function loadVocabMismatchCases(path: string = FIXTURE_PATH): VocabMismatchCase[] {
  const parsed = YAML.parse(readFileSync(path, "utf8")) as VocabMismatchCase[];
  for (const entry of parsed) {
    if (!entry.corpus || !entry.case_id || !entry.original_task) {
      throw new Error(
        `vocab-mismatch case is missing corpus/case_id/original_task: ${JSON.stringify(entry)}`,
      );
    }
    if (!Array.isArray(entry.paraphrases) || entry.paraphrases.length < 2) {
      throw new Error(
        `vocab-mismatch case '${entry.case_id}' must declare at least 2 paraphrases`,
      );
    }
  }
  return parsed;
}

/** Warn (stderr) when the fixture's copied provenance fields drifted from the
 *  live real-corpus fixture; the copied values still drive the measurement. */
function crossCheckProvenance(repo: string, cases: VocabMismatchCase[]): void {
  let seeds: ReturnType<typeof loadRealCorpusEvalSet>;
  try {
    seeds = loadRealCorpusEvalSet(repo);
  } catch (err) {
    process.stderr.write(`[vocab-recall] WARN: could not load real-corpus seed '${repo}': ${String(err)}\n`);
    return;
  }
  const byId = new Map(seeds.map((seed) => [seed.id, seed]));
  for (const entry of cases) {
    const seed = byId.get(entry.case_id);
    if (!seed) {
      process.stderr.write(
        `[vocab-recall] WARN: '${entry.case_id}' not found in tests/fixtures/real-corpus/${repo}.yaml\n`,
      );
      continue;
    }
    if (seed.task !== entry.original_task) {
      process.stderr.write(
        `[vocab-recall] WARN: original_task drifted for '${entry.case_id}' (fixture: "${entry.original_task}" vs seed: "${seed.task}")\n`,
      );
    }
    if (seed.expected_top_source !== entry.expected_top_source) {
      process.stderr.write(
        `[vocab-recall] WARN: expected_top_source drifted for '${entry.case_id}'\n`,
      );
    }
  }
}

function acceptableFor(entry: VocabMismatchCase): string[] {
  const acceptable =
    entry.acceptable_top_sources && entry.acceptable_top_sources.length > 0
      ? entry.acceptable_top_sources
      : [entry.expected_top_source];
  return acceptable.map((source) => source.trim()).filter((source) => source.length > 0);
}

export type VocabRecallReport = {
  pool_stage: string;
  observations: VocabQueryObservation[];
  byCorpus: Map<string, Record<VariantKind, Aggregate>>;
  overall: Record<VariantKind, Aggregate>;
};

export async function runVocabRecallEval(): Promise<VocabRecallReport> {
  const allCases = loadVocabMismatchCases();
  const byCorpusCases = new Map<string, VocabMismatchCase[]>();
  for (const entry of allCases) {
    const bucket = byCorpusCases.get(entry.corpus) ?? [];
    bucket.push(entry);
    byCorpusCases.set(entry.corpus, bucket);
  }

  const observations: VocabQueryObservation[] = [];

  for (const [repo, cases] of byCorpusCases) {
    crossCheckProvenance(repo, cases);
    process.stderr.write(
      `[vocab-recall] importing corpus '${repo}' (${cases.length} cases)...\n`,
    );
    const lab = createRealCorpusLab(repo);
    let runtime: ReturnType<typeof openRetrievalRuntime> | undefined;
    try {
      lab.importCorpus();
      runtime = openRetrievalRuntime({ cwd: lab.cwd });
      const hasSources = listSourcesCanonical(runtime.db).length > 0;

      for (const entry of cases) {
        const acceptable = acceptableFor(entry);
        const variants: Array<{ variant: VariantKind; query: string }> = [
          { variant: "original", query: entry.original_task },
          ...entry.paraphrases.map((query) => ({
            variant: "paraphrase" as const,
            query,
          })),
        ];

        for (const { variant, query } of variants) {
          // Task-text-only on purpose: anchors would differ between original
          // (seed declares files/symbols) and paraphrase (a nontechnical user
          // supplies none), conflating anchor loss with vocabulary mismatch.
          const result = runRetrievalPipeline(
            { db: runtime.db, config: runtime.config },
            { task: query, query_anchors: {}, budget: "default" },
          );

          const pool = [...(result.source_rerank ?? [])].sort((a, b) => a.rank - b.rank);
          let poolRank: number | null = null;
          for (const reranked of pool) {
            if (!acceptable.includes(reranked.candidate.source_path)) continue;
            if (poolRank === null || reranked.rank < poolRank) poolRank = reranked.rank;
          }

          const pack = presentContextPack({
            query,
            result,
            requested_budget: runtime.config.retrieval.budgets.default,
            has_sources: hasSources,
            explain: false,
            min_final_score: runtime.config.retrieval.min_final_score,
          });
          const packedSources = pack.ranked
            .filter((ranked) => ranked.kind === "chunk")
            .map(
              (ranked) =>
                ranked.source_path?.trim() || sourceFromContextTrail(ranked.contexttrail),
            );
          const top1Hit = packedSources.length > 0 && acceptable.includes(packedSources[0]!);
          const top3Hit = packedSources
            .slice(0, 3)
            .some((source) => acceptable.includes(source));

          observations.push({
            corpus: repo,
            case_id: entry.case_id,
            variant,
            query,
            expected_top_source: entry.expected_top_source,
            acceptable_sources: acceptable,
            pool_rank: poolRank,
            pool_size: pool.length,
            pool_top20: poolRank !== null && poolRank <= 20,
            pool_top50: poolRank !== null && poolRank <= 50,
            pool_any: poolRank !== null,
            top1_hit: top1Hit,
            top3_hit: top3Hit,
            packed_sources: packedSources,
            pool_leaders: pool
              .slice(0, 5)
              .map((reranked) => `${reranked.rank}:${reranked.candidate.source_path}`),
          });
        }
      }
    } finally {
      if (runtime !== undefined) closeRetrievalRuntime(runtime);
      lab.cleanup();
    }
  }

  const byCorpus = new Map<string, Record<VariantKind, Aggregate>>();
  const overall: Record<VariantKind, Aggregate> = {
    original: emptyAggregate(),
    paraphrase: emptyAggregate(),
  };
  for (const obs of observations) {
    const row =
      byCorpus.get(obs.corpus) ??
      ({ original: emptyAggregate(), paraphrase: emptyAggregate() } as Record<
        VariantKind,
        Aggregate
      >);
    addObservation(row[obs.variant], obs);
    byCorpus.set(obs.corpus, row);
    addObservation(overall[obs.variant], obs);
  }

  return { pool_stage: POOL_STAGE, observations, byCorpus, overall };
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "    —   ";
  return `${String(numerator).padStart(2)}/${String(denominator).padEnd(2)} ${(
    (numerator / denominator) * 100
  )
    .toFixed(1)
    .padStart(5)}%`;
}

function tableRow(label: string, variant: string, agg: Aggregate): string {
  return [
    `  ${label.padEnd(11)}`,
    variant.padEnd(11),
    pct(agg.pool20, agg.queries),
    pct(agg.pool50, agg.queries),
    pct(agg.poolAny, agg.queries),
    pct(agg.top1, agg.queries),
    pct(agg.top3, agg.queries),
  ].join("  ");
}

export function renderVocabRecallReport(report: VocabRecallReport): string {
  const lines: string[] = [];
  lines.push("Vocabulary-mismatch recall eval (original vs paraphrased queries)");
  lines.push(`  candidate-pool stage: ${report.pool_stage}`);
  lines.push(
    "  all variants run task-text-only (no anchors) so wording is the only variable",
  );
  lines.push("");
  const header = [
    "  corpus     ",
    "variant    ",
    "pool@20       ",
    "pool@50       ",
    "pool@any      ",
    "top1          ",
    "top3",
  ].join("  ");
  lines.push(header);
  lines.push(`  ${"-".repeat(header.length)}`);
  const corpora = [...report.byCorpus.keys()].sort((a, b) => a.localeCompare(b));
  for (const corpus of corpora) {
    const row = report.byCorpus.get(corpus)!;
    lines.push(tableRow(corpus, "original", row.original));
    lines.push(tableRow(corpus, "paraphrase", row.paraphrase));
  }
  lines.push(`  ${"-".repeat(header.length)}`);
  lines.push(tableRow("OVERALL", "original", report.overall.original));
  lines.push(tableRow("OVERALL", "paraphrase", report.overall.paraphrase));
  lines.push("");

  const misses = report.observations.filter((obs) => !obs.top3_hit || !obs.pool_top20);
  lines.push(
    `Misses (${misses.length} of ${report.observations.length} queries missed top-3 and/or pool@20):`,
  );
  for (const obs of misses) {
    const flags = [
      obs.pool_any
        ? `pool_rank=${obs.pool_rank}${obs.pool_top20 ? "" : " (>20)"}`
        : "pool_rank=absent",
      obs.top1_hit ? "top1=hit" : obs.top3_hit ? "top3=hit" : "top3=miss",
    ].join("  ");
    lines.push("");
    lines.push(`  [${obs.corpus}] ${obs.case_id}  (${obs.variant})  ${flags}`);
    lines.push(`    query:    "${obs.query}"`);
    lines.push(`    expected: ${obs.acceptable_sources.join(" | ")}`);
    lines.push(
      `    packed top-3 instead: ${obs.packed_sources.length > 0 ? obs.packed_sources.join(" | ") : "(empty)"}`,
    );
    lines.push(`    pool leaders: ${obs.pool_leaders.join("  ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

if (
  process.argv[1]?.endsWith("vocab-recall.js") ||
  process.argv[1]?.endsWith("vocab-recall.ts")
) {
  runVocabRecallEval()
    .then((report) => {
      process.stdout.write(renderVocabRecallReport(report));
      // Measurement, not a gate: exit 0 regardless of the numbers.
      process.exitCode = 0;
    })
    .catch((err: unknown) => {
      console.error("[vocab-recall] eval failed:", err);
      // Still a measurement: surface the failure on stderr but do not gate.
      process.exitCode = 0;
    });
}
