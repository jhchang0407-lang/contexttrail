/**
 * Slice 0 (PRD-0010 / THO-116) — runner that wires the real-corpus eval set
 * to the Slice 0 capture/aggregation pipeline.
 *
 * For each real-corpus repo:
 *   - import the corpus into a temp lab (same as runRealCorpusRetrievalEval)
 *   - for each case: run production retrieve_context_pack to capture the
 *     wire-shape response (warnings, coverage_confidence, query_mode), then
 *     capture pre-pack scored candidates via captureSlice0ChunkCandidates
 *   - assemble per-case Slice 0 observations
 *
 * The synthetic regression gate is run separately and passed in as a flag.
 */
import { loadConfig } from "../../config/load.js";
import { openDb, closeDb } from "../../store/db.js";
import { listSources } from "../../store/sources.js";
import { join } from "node:path";
import { createHandlers } from "../../mcp/handlers.js";
import {
  createRealCorpusLab,
  loadRealCorpusEvalSet,
  type RealCorpusEvalCase,
} from "../real-corpus-fixture.js";
import { captureSlice0ChunkCandidates } from "./candidates.js";
import {
  aggregateSourceCandidates,
  computeSourceRecallMetrics,
  isCriticalSourceCase,
} from "./sources.js";
import { computeOracleMetrics, computeLossDiagnostics } from "./oracle.js";
import { computeSeparabilityFeatures } from "./separability.js";
import type { Slice0CaseObservation, Slice0RepoCapture } from "./report.js";
import type { SourceRerankObservation } from "./slice2.js";
import { buildFusedSourceCandidates } from "../../retrieve/fused-source-candidates.js";
import {
  listSourceProfiles,
  getSourceProfile,
} from "../../store/source-profiles.js";
import {
  classifyQueryIntent,
  rerankSourceCandidates,
  tokenizeForRerank,
} from "../../retrieve/source-rerank.js";
import { verifySourceCoverage } from "../../retrieve/coverage-verifier.js";
import type { SourceDescriptor } from "./source-selection.js";

export type Slice0RunOpts = {
  repos: string[];
};

function actualTopAcceptable(
  ranked: Array<{ kind: "chunk" | "card" | "code"; contexttrail: string }>,
  acceptable: string[],
  topN: number,
): boolean {
  return ranked
    .slice(0, topN)
    .some(
      (r) =>
        r.kind === "chunk" &&
        acceptable.some((source) => r.contexttrail.includes(source)),
    );
}

export async function runSlice0CapturePerRepo(
  repo: string,
): Promise<Slice0RepoCapture> {
  const cases = loadRealCorpusEvalSet(repo);
  const lab = createRealCorpusLab(repo);
  try {
    lab.importCorpus();
    const handlers = createHandlers({ cwd: lab.cwd });
    const config = loadConfig(lab.cwd);
    const db = openDb(join(lab.cwd, ".contexttrail/cache/contexttrail.db"));
    try {
      // THO-135: imported source inventory is shared by every case in the
      // repo. Capturing once amortises the SQLite scan and lets failure-layer
      // distinguish `not_imported` from any retrieval-stage failure.
      const imported_sources = listSources(db).map((s) => s.source_path);
      const caseObservations: Slice0CaseObservation[] = [];
      for (const entry of cases) {
        const obs = await captureCase({
          entry,
          repo,
          handlers,
          db,
          config,
          imported_sources,
        });
        caseObservations.push(obs);
      }
      return { repo, cases: caseObservations };
    } finally {
      closeDb(db);
    }
  } finally {
    lab.cleanup();
  }
}

async function captureCase(args: {
  entry: RealCorpusEvalCase;
  repo: string;
  handlers: ReturnType<typeof createHandlers>;
  db: ReturnType<typeof openDb>;
  config: ReturnType<typeof loadConfig>;
  imported_sources: string[];
}): Promise<Slice0CaseObservation> {
  const { entry, repo, handlers, db, config, imported_sources } = args;

  // Production retrieval — captures the wire-shape response (warnings,
  // coverage_confidence, query_mode) without changing it.
  const response = await handlers.retrieve_context_pack({
    task: entry.task,
    files: entry.files,
    symbols: entry.symbols,
    routes: entry.routes,
    budget: entry.budget,
    expected_locked: [],
    explain: true,
  });

  // Pre-pack scored candidates — the Slice 0 ceiling-probe substrate.
  const capture = captureSlice0ChunkCandidates({
    db,
    config,
    request: {
      task: entry.task,
      query_anchors: {
        files: entry.files,
        symbols: entry.symbols,
        routes: entry.routes,
      },
      budget: entry.budget ?? "default",
    },
  });

  const acceptableTopSources = entry.acceptable_top_sources ?? [
    entry.expected_top_source,
  ];
  const sourceCandidates = aggregateSourceCandidates(capture.chunk_candidates);

  const isCritical = isCriticalSourceCase({
    expectation_kind: entry.expectation_kind,
    expected_query_mode: entry.expected_query_mode,
    expected_signal_empty_warning: entry.expected_signal_empty_warning,
    must_include_sources: entry.must_include_sources,
  });

  const sourceRecall = computeSourceRecallMetrics({
    sources: sourceCandidates,
    expected_top_source: entry.expected_top_source,
    acceptable_top_sources: acceptableTopSources,
    must_include_sources: entry.must_include_sources,
    is_critical: isCritical,
  });
  const oracle = computeOracleMetrics({
    sources: sourceCandidates,
    expected_top_source: entry.expected_top_source,
    acceptable_top_sources: acceptableTopSources,
    must_include_sources: entry.must_include_sources,
    is_critical: isCritical,
  });
  const loss = computeLossDiagnostics({
    sources: sourceCandidates,
    candidates: capture.chunk_candidates,
    included_version_ids: capture.included_version_ids,
    below_threshold_version_ids: capture.below_threshold_version_ids,
    budget_dropped_version_ids: capture.budget_dropped_version_ids,
    must_include_sources: entry.must_include_sources,
    is_critical: isCritical,
  });

  const top1Acceptable = actualTopAcceptable(response.ranked, acceptableTopSources, 1);
  const top3Acceptable = actualTopAcceptable(response.ranked, acceptableTopSources, 3);
  const agentAnswerPass =
    entry.must_include_sources.length === 0 ||
    entry.must_include_sources.every((source) =>
      sourceIncludedInRanked(response.ranked, source),
    );

  // THO-134: distinct source paths in the displayed top-3 chunks.
  // drift is `Source: <path> > Section: <heading> > Part: i/n` (see
  // chunkContextTrail in src/retrieve/drift.ts).
  const SOURCE_PREFIX = "Source: ";
  const displayed_top3_sources = Array.from(
    new Set(
      response.ranked
        .slice(0, 3)
        .filter((r) => r.kind === "chunk")
        .map((r) => {
          const bc = r.contexttrail;
          const after = bc.startsWith(SOURCE_PREFIX)
            ? bc.slice(SOURCE_PREFIX.length)
            : bc;
          const stop = after.indexOf(" > ");
          return stop >= 0 ? after.slice(0, stop) : after;
        }),
    ),
  );

  // PRD-0012 Slice 2 v2 + PRD-0013 V2.5.4: capture before/after source-rerank
  // movement using the same fused deterministic scorer that runs in
  // production. Fused candidates carry post-RRF rank + path agreement, so the
  // eval movement table reflects production source ordering.
  const enrichedSources = buildFusedSourceCandidates({
    lexical_chunks: capture.chunk_candidates.map((c) => ({
      rank: c.rank,
      version_id: c.version_id,
      source_path: c.source_path || null,
      final_score: c.final_score,
      kind: "doc_chunk" as const,
    })),
    profiles: listSourceProfiles(db),
    query_tokens: tokenizeForRerank(entry.task),
    anchors: {
      files: entry.files ?? [],
      symbols: entry.symbols ?? [],
      routes: entry.routes ?? [],
    },
    profileBySource: (path) => getSourceProfile(db, path),
  });
  const intent = classifyQueryIntent({
    task: entry.task,
    query_mode: response.query_mode,
    has_anchors:
      (entry.files?.length ?? 0) > 0 ||
      (entry.symbols?.length ?? 0) > 0 ||
      (entry.routes?.length ?? 0) > 0,
  });
  const reranked = rerankSourceCandidates({
    candidates: enrichedSources,
    query_tokens: tokenizeForRerank(entry.task),
    intent,
  });
  const sourceRerank: SourceRerankObservation[] = reranked.slice(0, 5).map((r) => ({
    source_path: r.candidate.source_path,
    pre_rerank_rank: r.original_rank,
    post_rerank_rank: r.rank,
    pre_rerank_score: r.candidate.best_chunk_score,
    post_rerank_score: r.score,
    feature_reasons: r.features,
    fused_rank: r.candidate.fused_rank,
    fused_path_count: r.candidate.fused_path_count,
  }));

  // THO-138 / V2.5.5: replay coverage on the eval side so the separability
  // diagnostic reason agrees with the production presenter (THO-139).
  const topCoverageVerification = reranked.length > 0
    ? verifySourceCoverage({
        intent,
        query_tokens: tokenizeForRerank(entry.task),
        candidate: reranked[0]!.candidate,
        path_agreement: reranked[0]!.candidate.fused_path_count ?? 1,
        top_chunk_score: reranked[0]!.candidate.best_chunk_score,
        required_anchors: {
          files: entry.files ?? [],
          symbols: entry.symbols ?? [],
          routes: entry.routes ?? [],
        },
      })
    : undefined;
  const top_coverage_decision = topCoverageVerification?.decision;
  const source_cards = capture.source_cards;
  const source_descriptors: SourceDescriptor[] = sourceCandidates.map((s) => {
    const profile = getSourceProfile(db, s.source_path);
    return {
      source_path: s.source_path,
      ...(profile?.doc_purpose !== undefined
        ? { doc_purpose: profile.doc_purpose }
        : {}),
      ...(profile?.doc_role !== undefined
        ? { doc_role: profile.doc_role }
        : {}),
    };
  });

  const separability = computeSeparabilityFeatures({
    candidates: capture.chunk_candidates,
    coverage_confidence: response.coverage_confidence,
    query_mode: response.query_mode,
    warning_kinds: response.warnings.map((w) => w.kind),
    ranked_count: response.ranked.length,
    has_locked: response.locked.length > 0,
    safety_net_engaged: false,
    top_coverage_decision,
  });

  return {
    id: entry.id,
    repo,
    expectation_kind: entry.expectation_kind,
    is_critical: isCritical,
    expected_query_mode: entry.expected_query_mode,
    actual_query_mode: response.query_mode,
    query_intent: entry.query_intent,
    must_include_sources: entry.must_include_sources,
    expected_top_source: entry.expected_top_source,
    acceptable_top_sources: acceptableTopSources,
    chunk_candidates: capture.chunk_candidates,
    source_candidates: sourceCandidates,
    source_recall: sourceRecall,
    oracle,
    loss,
    separability,
    actual_top1_acceptable: top1Acceptable,
    actual_top3_acceptable: top3Acceptable,
    agent_answer_pass: agentAnswerPass,
    source_rerank: sourceRerank,
    source_cards,
    source_aboutness: capture.source_aboutness,
    source_selection: capture.source_selection,
    source_selection_applied: capture.source_selection_applied,
    source_descriptors,
    displayed_top3_sources,
    imported_sources,
  };
}

function sourceIncludedInRanked(
  ranked: Array<{ kind: "chunk" | "card" | "code"; contexttrail: string }>,
  source: string,
): boolean {
  return ranked.some(
    (entry) => entry.kind === "chunk" && entry.contexttrail.includes(source),
  );
}
