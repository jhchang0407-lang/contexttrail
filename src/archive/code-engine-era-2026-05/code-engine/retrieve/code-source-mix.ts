/**
 * Chunk-first code retrieval lane.
 *
 * Queries `code_chunks_fts` directly, aggregates child evidence back to parent
 * files, selects one best chunk per file first, optionally adds an
 * orientation companion, and only then performs bounded file-graph late
 * augmentation.
 */
import type { Db } from "../../../../store/db.js";
import {
  getCodeChunkByVersionId,
  listCodeChunksForSource,
  listCurrentCodeChunks,
  searchCodeChunksFts,
} from "../store/code-chunks.js";
import { listCodeGraphNeighbors } from "../store/code-graph.js";
import {
  getCodeSource,
  listCodeSources,
  searchCodeSourcesFts,
} from "../store/code-sources.js";
import { codeSourceIndexEnabledFromEnv } from "./code-source-flag.js";
import { codeContextTrail } from "../../../../retrieve/contexttrail.js";
import { buildCodeQueryFacets } from "./code-query-facets.js";
import {
  codeQueryFacetEvidence,
  summarizeCodeCandidateEvidence,
  type CodeCandidateEvidence,
  type CodeCandidateEvidenceFamily,
  type CodeCandidateEvidenceSummary,
} from "./code-candidate-evidence.js";
import { admitCodeQueryFacet } from "./code-method-admission.js";
import {
  scoreCodeFamilyEvidence,
  type CodeFamilyEvidence,
} from "./code-family-evidence.js";
import { scoreCodeFacilitySupport } from "./code-facility-tags.js";
import { scoreCodeRepoFamilyEvidence } from "./code-repo-family-evidence.js";
import { inferCodeRoleFacts } from "../facts/code-role-facts.js";
import type { QueryAnchors } from "../../../../retrieve/score.js";
import type {
  CodeFacilityEvidenceSummary,
  CodeChunkRole,
  CodeDeclarationKind,
  CodeRetrievalConfidence,
  CodeSourceCochangeFacts,
  CodeSourceFileRole,
  CodeSourceFacts,
  CodeSourcePackageFacts,
  CodeSourceRoleFacts,
  CodeSupportCluster,
  StoredCodeChunk,
} from "../types/code-source.js";

export type CodeRankedEntry = {
  id: string;
  kind: "code";
  scope: Record<string, never>;
  tokens: number;
  score: number;
  body: string;
  contexttrail: string;
  type_bias_applied: false;
  source_path: string;
  start_line: number;
  end_line: number;
  symbol_path: string | null;
  code_role: CodeChunkRole;
  declaration_kind: CodeDeclarationKind | null;
  import_traversed?: boolean;
  parent_score: number;
  support_cluster?: CodeSupportCluster;
  retrieval_confidence: CodeRetrievalConfidence;
};

export type BuildCodeRankedEntriesArgs = {
  db: Db;
  query: string;
  query_anchors?: QueryAnchors;
  query_intent?: string;
  ranking_method?: CodeLaneRankingMethod;
  limit?: number;
  enabled?: boolean;
  score_floor?: number;
  max_results?: number;
  import_max_hops?: number;
  import_inherited_score_fraction?: number;
  import_traversed_max_results?: number;
  import_traversed_max_tokens?: number;
};

export type CodeLaneRankingMethod = "chunk-first" | "bundle-aware";

export type CodeCandidateDiagnostic = {
  source_path: string;
  rank: number;
  score: number;
  admitted: boolean;
  shadow: boolean;
  confidence: CodeRetrievalConfidence;
  evidence?: CodeCandidateEvidenceSummary;
};

export function resolveCodeLaneRankingMethod(args: {
  requested?: string;
  promotionEnabled?: boolean;
} = {}): CodeLaneRankingMethod {
  if (args.requested === "bundle-aware" && args.promotionEnabled === true) {
    return "bundle-aware";
  }
  return "chunk-first";
}

type ChunkHit = {
  chunk: StoredCodeChunk;
  score: number;
  anchor_priority: number;
  lexical_priority: number;
  path_priority: number;
  channel: CodeCandidateChannel;
  channel_rank: number;
  file_rrf_score?: number;
  file_signal_count?: number;
  source_fact_coverage?: number;
  evidence?: CodeCandidateEvidence[];
  file_evidence?: CodeCandidateEvidenceSummary;
};

type FileCandidate = {
  source_path: string;
  parent_score: number;
  primary: ChunkHit;
  orientation?: ChunkHit;
  file_rrf_score: number;
  file_signal_count: number;
  source_fact_coverage: number;
  file_evidence?: CodeCandidateEvidenceSummary;
};

type CodeCandidateChannel =
  | "chunk_fts"
  | "query_facet"
  | "source_facts_facet"
  | "source_facts_fts"
  | "exact_symbol"
  | "path_fallback"
  | "path_facts_shadow";

type CodeFacetFtsQuery = {
  fts_query: string;
  facet: ReturnType<typeof buildCodeQueryFacets>[number];
};

type ChunkHitEvidenceFactory = (chunk: StoredCodeChunk) => CodeCandidateEvidence[];

type SupportClusterCandidate = {
  source_path: string;
  seed_source_path: string;
  seed_parent_score: number;
  distance: number;
  reason: CodeSupportCluster["reason"];
  relevance: number;
  family_evidence?: CodeFamilyEvidence;
  facility_evidence?: CodeFacilityEvidenceSummary;
};

const DEFAULT_MAX_RESULTS = 10;
const SCORE_FLOOR = 0.05;
const DEFAULT_IMPORT_HOPS = 2;
const IMPORT_INHERITED_SCORE_FRACTION = 0.5;
const DEFAULT_IMPORT_TRAVERSED_MAX_RESULTS = 14;
const DEFAULT_IMPORT_TRAVERSED_MAX_TOKENS = 4000;
const SUPPORT_CLUSTER_RELEVANCE_FLOOR = 0.55;
const DIRECT_COMPACT_PROJECTION_TOKEN_THRESHOLD = 700;
const SOURCE_FACTS_FTS_MAX_RESULTS = 18;
const OWNER_FANOUT_MIN_MAX_RESULTS = 50;
const OWNER_FANOUT_SEED_LIMIT = 30;
const OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE = 0.9;
const SUPPORT_CONFIG_FANOUT_LIMIT = 6;
const SHARED_SUPPORT_IMPORT_FANOUT_LIMIT = 3;
const PACKAGE_DEPENDENCY_FANOUT_LIMIT = 12;
const ROLE_FAMILY_FANOUT_LIMIT = 14;
const SYMBOL_REFERENCE_FANOUT_LIMIT = 16;
const COCHANGE_FANOUT_LIMIT = 22;
const DEFAULT_TAIL_RECALL_RESERVE_FRACTION = 0.5;
const RRF_K = 60;

export function buildCodeRankedEntries(
  args: BuildCodeRankedEntriesArgs,
): CodeRankedEntry[] {
  const enabled = args.enabled ?? codeSourceIndexEnabledFromEnv();
  if (!enabled) return [];
  const effectiveArgs = withInferredCodeAnchors(args);
  const rankingMethod = resolveCodeLaneRankingMethod({
    requested: effectiveArgs.ranking_method ?? process.env.RETRIEVAL_CODE_LANE_METHOD,
    promotionEnabled: process.env.RETRIEVAL_CODE_LANE_BUNDLE_PROMOTED === "on",
  });
  if (!effectiveArgs.query.trim()) return [];
  const query = ftsSafeQuery(effectiveArgs.query);
  if (!query) return [];

  const limit = effectiveArgs.limit ?? (effectiveArgs.max_results ?? DEFAULT_MAX_RESULTS) * 6;
  const floor = effectiveArgs.score_floor ?? SCORE_FLOOR;
  const directHits = buildAdmittedCandidateHits(effectiveArgs, query, floor, limit);
  if (directHits.length === 0) return [];

  const files = rerankFirstSlateByCodeFamilyEvidence(
    effectiveArgs,
    aggregateFiles(effectiveArgs, directHits),
  );
  const maxResults = effectiveArgs.max_results ?? DEFAULT_MAX_RESULTS;
  const supportCandidatePool = buildSupportClusterCandidatesForSeeds(
    effectiveArgs,
    files,
    floor,
    maxResults,
    rankingMethod,
  );
  const directFilePaths = new Set(files.map((file) => file.source_path));
  const reserveTailExpansion =
    tailRecallExpansionPromoted() && maxResults >= OWNER_FANOUT_MIN_MAX_RESULTS;
  const supportReserveCount = supportCandidatePool.filter(
    (candidate) =>
      reserveTailExpansion
        ? shouldReserveTailRecallSupport(candidate, directFilePaths)
        : !directFilePaths.has(candidate.source_path) &&
          candidate.reason !== "support_substrate_bundle",
  ).length;
  const directLimit =
    reserveTailExpansion
      ? tailRecallDirectResultLimit(maxResults, supportReserveCount)
      : rankingMethod === "bundle-aware"
      ? bundleAwareDirectResultLimit(maxResults, supportReserveCount)
      : directResultLimit(maxResults, supportReserveCount);
  const directEntries = materializeDirectEntries(effectiveArgs, files, directLimit);

  const supportCandidates = admitSupportClusterCandidates(
    effectiveArgs,
    supportCandidatePool,
    directEntries,
  );
  const importEntries = materializeImportEntries(
    effectiveArgs,
    directEntries,
    supportCandidates,
    floor,
    maxResults,
  );

  const annotatedDirectEntries = annotateDirectSupportEntries(
    effectiveArgs.db,
    directEntries,
    files[0],
    supportCandidates,
  );

  const ordered = orderSupportClusterEntries(
    effectiveArgs,
    files[0],
    annotatedDirectEntries,
    importEntries,
  ).slice(0, maxResults);
  return ordered;
}

export function buildCodeCandidateDiagnostics(
  args: BuildCodeRankedEntriesArgs,
): CodeCandidateDiagnostic[] {
  const enabled = args.enabled ?? codeSourceIndexEnabledFromEnv();
  if (!enabled) return [];
  const effectiveArgs = withInferredCodeAnchors(args);
  if (!effectiveArgs.query.trim()) return [];
  const query = ftsSafeQuery(effectiveArgs.query);
  if (!query) return [];

  const limit = effectiveArgs.limit ?? (effectiveArgs.max_results ?? DEFAULT_MAX_RESULTS) * 6;
  const floor = effectiveArgs.score_floor ?? SCORE_FLOOR;
  const admittedHits = buildAdmittedCandidateHits(effectiveArgs, query, floor, limit);
  const admittedFiles = aggregateFiles(effectiveArgs, admittedHits);
  const admittedPaths = new Set(admittedFiles.map((file) => file.source_path));
  const diagnosticHits = withFileFusionSignals([
    ...admittedHits,
    ...hydratePathFactsShadowHits(effectiveArgs, floor),
  ]);
  const files = aggregateFiles(effectiveArgs, diagnosticHits)
    .slice(0, effectiveArgs.max_results ?? DEFAULT_MAX_RESULTS);

  return files.map((file, index) => {
    const admitted = admittedPaths.has(file.source_path);
    return {
      source_path: file.source_path,
      rank: index + 1,
      score: file.parent_score,
      admitted,
      shadow: !admitted,
      confidence: codeRetrievalConfidenceForFile(file, {
        admitted,
        shadow: !admitted,
      }),
      ...(file.file_evidence ? { evidence: file.file_evidence } : {}),
    };
  });
}

function buildAdmittedCandidateHits(
  args: BuildCodeRankedEntriesArgs,
  query: string,
  floor: number,
  limit: number,
): ChunkHit[] {
  const hits = searchCodeChunksFts(args.db, query, limit);
  const worst =
    hits.length > 0 ? Math.max(...hits.map((h) => Math.abs(h.bm25)), 1) : 1;
  return withFileFusionSignals([
    ...hydrateDirectHits(args, hits, worst, floor),
    ...hydrateQueryFacetFtsHits(args, floor, limit),
    ...hydrateQueryFacetSourceFactsFtsHits(args, floor),
    ...hydrateSourceFactsFtsHits(args, query, floor),
    ...hydrateExactSymbolFallbackHits(args, floor),
    ...hydratePathFallbackHits(args, floor),
  ]);
}

function withInferredCodeAnchors(
  args: BuildCodeRankedEntriesArgs,
): BuildCodeRankedEntriesArgs {
  const inferredSymbols = inferCodeSymbolAnchors(args.query);
  if (inferredSymbols.length === 0) return args;
  const currentAnchors = args.query_anchors ?? {};
  const symbols = [
    ...(currentAnchors.symbols ?? []),
    ...inferredSymbols.filter((symbol) =>
      !(currentAnchors.symbols ?? []).includes(symbol),
    ),
  ];
  return {
    ...args,
    query_anchors: {
      ...currentAnchors,
      symbols,
    },
  };
}

function inferCodeSymbolAnchors(query: string): string[] {
  const tokens = query.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) ?? [];
  const symbols = tokens
    .filter((token) => token.length >= 4)
    .filter((token) => /[a-z][A-Z]/.test(token));
  return [...new Set(symbols)].sort();
}

function hydrateDirectHits(
  args: BuildCodeRankedEntriesArgs,
  hits: Array<{ version_id: string; bm25: number }>,
  worst: number,
  floor: number,
  channel: CodeCandidateChannel = "chunk_fts",
  evidenceFactory?: ChunkHitEvidenceFactory,
): ChunkHit[] {
  const seen = new Set<string>();
  const out: ChunkHit[] = [];
  for (const [index, hit] of hits.entries()) {
    if (seen.has(hit.version_id)) continue;
    seen.add(hit.version_id);
    const chunk = getCodeChunkByVersionId(args.db, hit.version_id);
    if (!chunk) continue;
    if (shouldSkipCodePath(args, chunk.source_path)) {
      continue;
    }
    const normalized = clamp01(Math.abs(hit.bm25) / worst);
    const baseScore = floor + normalized * (1 - floor);
    const lexicalMatch = allowsUnanchoredLexicalBoost(args)
      ? lexicalCodeMatch(args.query, chunk)
      : { boost: 0, priority: 0, pathPriority: 0 };
    const boosted = clamp01(
      baseScore + fileAnchorBoost(args.query_anchors, chunk) + symbolBoost(args.query_anchors, chunk) +
        roleBoost(args.query_intent, args.query_anchors, chunk) + declarationBoost(args.query_intent, chunk) +
        lexicalMatch.boost,
    );
    out.push({
      chunk,
      score: boosted,
      anchor_priority: chunkAnchorPriority(args.query_anchors, chunk),
      lexical_priority: lexicalMatch.priority,
      path_priority: lexicalMatch.pathPriority,
      channel,
      channel_rank: index + 1,
      evidence: evidenceFactory?.(chunk),
    });
  }
  return out.sort(compareChunkHit);
}

function hydrateQueryFacetFtsHits(
  args: BuildCodeRankedEntriesArgs,
  floor: number,
  baseLimit: number,
): ChunkHit[] {
  if (!allowsUnanchoredLexicalBoost(args)) return [];
  const facetQueries = buildCodeFacetFtsQueries(args);
  if (facetQueries.length === 0) return [];

  const out: ChunkHit[] = [];
  const limit = Math.max(
    8,
    Math.min(baseLimit, (args.max_results ?? DEFAULT_MAX_RESULTS) * 3),
  );
  for (const facetQuery of facetQueries) {
    const hits = searchCodeChunksFts(args.db, facetQuery.fts_query, limit);
    if (hits.length === 0) continue;
    const worst = Math.max(...hits.map((hit) => Math.abs(hit.bm25)), 1);
    out.push(...hydrateDirectHits(
      args,
      hits,
      worst,
      floor,
      "query_facet",
      (chunk) => [
        codeQueryFacetEvidence({
          source_path: chunk.source_path,
          facet: facetQuery.facet,
        }),
      ],
    ));
  }
  return rankChannelHits(
    out
      .sort(compareChunkHit)
      .slice(0, Math.max(12, args.max_results ?? DEFAULT_MAX_RESULTS)),
    "query_facet",
  );
}

function hydrateQueryFacetSourceFactsFtsHits(
  args: BuildCodeRankedEntriesArgs,
  floor: number,
): ChunkHit[] {
  if (!allowsUnanchoredLexicalBoost(args)) return [];
  const facetQueries = buildCodeFacetFtsQueries(args);
  if (facetQueries.length === 0) return [];
  const out: ChunkHit[] = [];
  const limit = Math.max(8, (args.max_results ?? DEFAULT_MAX_RESULTS) * 3);

  for (const facetQuery of facetQueries) {
    const hits = searchCodeSourcesFts(args.db, facetQuery.fts_query, limit);
    if (hits.length === 0) continue;
    const worst = Math.max(...hits.map((hit) => Math.abs(hit.bm25)), 1);
    for (const [index, hit] of hits.entries()) {
      if (shouldSkipCodePath(args, hit.file_path)) continue;
      const source = getCodeSource(args.db, hit.file_path);
      if (!source) continue;
      const chunks = listCodeChunksForSource(args.db, hit.file_path);
      const chunk = pickSourceFactsProjectionChunk(args.query, source.facts, chunks);
      if (!chunk) continue;
      const match = sourceFactsCodeMatch(args.query, source.facts);
      if (!sourceFactsHitAdmissible(args.query, match)) continue;
      const normalized = Math.abs(hit.bm25) / worst;
      const score = Math.max(
        floor,
        Math.min(0.88, 0.44 + normalized * 0.24 + match.boost),
      );
      out.push({
        chunk,
        score: clamp01(score),
        anchor_priority: chunkAnchorPriority(args.query_anchors, chunk),
        lexical_priority: match.exactSymbol ? match.priority : 0,
        path_priority: match.pathPriority,
        channel: "source_facts_facet",
        channel_rank: index + 1,
        source_fact_coverage: match.coverage,
        evidence: [
          codeQueryFacetEvidence({
            source_path: hit.file_path,
            facet: facetQuery.facet,
          }),
          {
            source_path: hit.file_path,
            family: "source_facts",
            role: "owner",
            target: "direct_owner",
            reason: "source_facts_facet",
            channel_rank: index + 1,
            coverage: match.coverage,
          },
        ],
      });
    }
  }

  return rankChannelHits(
    out
      .sort(compareChunkHit)
      .slice(0, Math.max(12, args.max_results ?? DEFAULT_MAX_RESULTS)),
    "source_facts_facet",
  );
}

function buildCodeFacetFtsQueries(args: BuildCodeRankedEntriesArgs): CodeFacetFtsQuery[] {
  const out = new Map<string, CodeFacetFtsQuery>();
  for (const facet of buildCodeQueryFacets(args.query)) {
    if (
      admitCodeQueryFacet({
        facet,
        query_anchors: args.query_anchors,
        query_intent: args.query_intent,
      }).decision !== "direct_owner"
    ) {
      continue;
    }
    const ftsQuery = ftsSafeAllQuery(facet.query);
    if (ftsQuery.length === 0 || out.has(ftsQuery)) continue;
    out.set(ftsQuery, { fts_query: ftsQuery, facet });
  }
  return [...out.values()];
}

function hydrateSourceFactsFtsHits(
  args: BuildCodeRankedEntriesArgs,
  query: string,
  floor: number,
): ChunkHit[] {
  if (
    (args.query_anchors?.files?.length ?? 0) > 0 ||
    (args.query_anchors?.symbols?.length ?? 0) > 0
  ) {
    return [];
  }
  const hits = searchCodeSourcesFts(args.db, query, SOURCE_FACTS_FTS_MAX_RESULTS);
  if (hits.length === 0) return [];
  const worst = Math.max(...hits.map((hit) => Math.abs(hit.bm25)), 1);
  const out: ChunkHit[] = [];

  for (const [index, hit] of hits.entries()) {
    if (shouldSkipCodePath(args, hit.file_path)) continue;
    const source = getCodeSource(args.db, hit.file_path);
    if (!source) continue;
    const chunks = listCodeChunksForSource(args.db, hit.file_path);
    const chunk = pickSourceFactsProjectionChunk(args.query, source.facts, chunks);
    if (!chunk) continue;
    const match = sourceFactsCodeMatch(args.query, source.facts);
    if (!sourceFactsHitAdmissible(args.query, match)) continue;
    const normalized = Math.abs(hit.bm25) / worst;
    const score = clamp01(
      Math.max(
        floor,
        Math.min(0.9, 0.42 + normalized * 0.25 + match.boost),
      ),
    );
    out.push({
      chunk,
      score,
      anchor_priority: chunkAnchorPriority(args.query_anchors, chunk),
      lexical_priority: match.exactSymbol ? match.priority : 0,
      path_priority: match.pathPriority,
      channel: "source_facts_fts",
      channel_rank: index + 1,
      source_fact_coverage: match.coverage,
    });
  }

  return out.sort(compareChunkHit);
}

function sourceFactsHitAdmissible(
  query: string,
  match: ReturnType<typeof sourceFactsCodeMatch>,
): boolean {
  if (match.exactSymbol) return true;
  if (isPathShapedCodeQuery(query) && match.pathPriority >= 6) return true;
  const queryTokenCount = codeLexicalTokenSet(query).size;
  if (queryTokenCount <= 2) return match.factTokenHits >= 1;
  return match.factTokenHits >= 2;
}

function pickSourceFactsProjectionChunk(
  query: string,
  facts: CodeSourceFacts,
  chunks: StoredCodeChunk[],
): StoredCodeChunk | null {
  if (chunks.length === 0) return null;
  const nonOrientation = chunks.filter((chunk) => chunk.code_role !== "orientation");
  const candidates = nonOrientation.length > 0 ? nonOrientation : chunks;
  return [...candidates].sort(
    (a, b) =>
      sourceFactsProjectionScore(query, facts, b) -
      sourceFactsProjectionScore(query, facts, a) ||
      a.start_line - b.start_line ||
      a.stable_key.localeCompare(b.stable_key),
  )[0] ?? null;
}

function sourceFactsProjectionScore(
  query: string,
  facts: CodeSourceFacts,
  chunk: StoredCodeChunk,
): number {
  const queryTokens = codeLexicalTokenSet(query);
  const queryCompacts = codeCompactTokenSet(query);
  let score = chunk.code_role === "orientation" ? 0 : 1;
  if (chunk.symbol_path) {
    const compact = compactIdentifier(chunk.symbol_path);
    if (queryCompacts.has(compact)) score += 6;
    score += countMatches(codeLexicalTokens(chunk.symbol_path), queryTokens) * 2;
  }
  const exported = facts.exported_symbols.find((symbol) =>
    symbol.name === chunk.symbol_path,
  );
  if (exported) score += 1;
  score += exactBodyIdentifierMatches(query, chunk.body);
  return score;
}

function sourceFactsCodeMatch(
  query: string,
  facts: CodeSourceFacts,
): {
  boost: number;
  priority: number;
  pathPriority: number;
  factTokenHits: number;
  exactSymbol: boolean;
  coverage: number;
} {
  const queryTokens = codeLexicalTokenSet(query);
  const queryCompacts = codeCompactTokenSet(query);
  const pathPriority = filePathPriority(query, facts.file_path);
  let exactSymbol = false;
  let symbolTokenHits = 0;
  for (const symbol of facts.exported_symbols) {
    if (queryCompacts.has(compactIdentifier(symbol.name))) {
      exactSymbol = true;
    }
    symbolTokenHits += countMatches(codeLexicalTokens(symbol.name), queryTokens);
  }
  const factText = [
    facts.file_path,
    facts.file_purpose ?? "",
    ...facts.exported_symbols.map((symbol) => symbol.name),
    ...facts.exported_signatures,
  ].join(" ");
  const factTokenHits = countMatches(codeLexicalTokens(factText), queryTokens);
  let priority = 0;
  if (exactSymbol) priority = 4;
  else if (symbolTokenHits >= 2) priority = 1;

  return {
    boost: Math.min(
      0.38,
      (exactSymbol ? 0.24 : 0) +
        Math.min(0.12, symbolTokenHits * 0.04) +
        Math.min(0.14, factTokenHits * 0.035) +
        Math.min(0.08, pathPriority * 0.01),
    ),
    priority,
    pathPriority,
    factTokenHits,
    exactSymbol,
    coverage: queryTokens.size > 0 ? factTokenHits / queryTokens.size : 0,
  };
}

function hydratePathFallbackHits(
  args: BuildCodeRankedEntriesArgs,
  floor: number,
): ChunkHit[] {
  if (!isPathShapedCodeQuery(args.query)) return [];
  const queryTokens = codeLexicalTokenSet(args.query);
  if (queryTokens.size === 0) return [];
  const bySource = new Map<string, StoredCodeChunk[]>();
  for (const chunk of listCurrentCodeChunks(args.db)) {
    if (shouldSkipCodePath(args, chunk.source_path)) {
      continue;
    }
    const list = bySource.get(chunk.source_path) ?? [];
    list.push(chunk);
    bySource.set(chunk.source_path, list);
  }

  const out: ChunkHit[] = [];
  for (const chunks of bySource.values()) {
    const representative =
      chunks.find((chunk) => chunk.code_role === "orientation") ?? chunks[0];
    if (!representative) continue;
    const match = lexicalCodeMatch(args.query, representative);
    if (match.pathPriority < 3) continue;
    out.push({
      chunk: representative,
      score: clamp01(Math.max(floor, 0.25 + match.pathPriority * 0.08 + match.boost)),
      anchor_priority: chunkAnchorPriority(args.query_anchors, representative),
      lexical_priority: match.priority,
      path_priority: match.pathPriority,
      channel: "path_fallback",
      channel_rank: 0,
    });
  }
  return rankChannelHits(out
    .sort(
      (a, b) =>
        b.path_priority - a.path_priority ||
        b.score - a.score ||
        a.chunk.source_path.localeCompare(b.chunk.source_path),
    )
    .slice(0, Math.max(12, args.max_results ?? DEFAULT_MAX_RESULTS)), "path_fallback");
}

function hydratePathFactsShadowHits(
  args: BuildCodeRankedEntriesArgs,
  floor: number,
): ChunkHit[] {
  if (!allowsUnanchoredLexicalBoost(args)) return [];
  const query = ftsSafeQuery(args.query);
  if (!query) return [];
  const sourceHits = searchCodeSourcesFts(
    args.db,
    query,
    Math.max(200, (args.max_results ?? DEFAULT_MAX_RESULTS) * 8),
  );
  const out: ChunkHit[] = [];
  const seen = new Set<string>();
  for (const sourceHit of sourceHits) {
    if (seen.has(sourceHit.file_path)) continue;
    seen.add(sourceHit.file_path);
    const source = getCodeSource(args.db, sourceHit.file_path);
    if (!source) continue;
    const facts = source.facts;
    if (shouldSkipCodePath(args, facts.file_path)) continue;
    const chunks = listCodeChunksForSource(args.db, facts.file_path);
    const chunk = pickSourceFactsProjectionChunk(args.query, facts, chunks);
    if (!chunk) continue;

    const match = sourceFactsCodeMatch(args.query, facts);
    const repoFamily = scoreCodeRepoFamilyEvidence({
      query: args.query,
      facts,
    });
    const evidence: CodeCandidateEvidence[] = [];
    if (repoFamily.shadow_candidate) {
      evidence.push({
        source_path: facts.file_path,
        family: "repo_family",
        role: "owner",
        target: "shadow_only",
        reason: repoFamily.reasons[0] ?? "direct_query_token",
        strength: repoFamily.owner_admissible ? "strong" : "medium",
        coverage: repoFamily.score,
      });
    }
    if (match.pathPriority >= 3) {
      evidence.push({
        source_path: facts.file_path,
        family: "path_identity",
        role: "owner",
        target: "shadow_only",
        reason: "path_facts_shadow",
        strength: match.pathPriority >= 6 ? "strong" : "medium",
        coverage: Math.min(1, match.pathPriority / 10),
      });
    }
    if (match.exactSymbol || match.factTokenHits >= 2) {
      evidence.push({
        source_path: facts.file_path,
        family: match.exactSymbol ? "exact_symbol" : "source_facts",
        role: "owner",
        target: "shadow_only",
        reason: "source_facts_shadow",
        strength: match.exactSymbol ? "strong" : "medium",
        coverage: match.coverage,
      });
    }
    if (evidence.length === 0) continue;

    out.push({
      chunk,
      score: clamp01(
        Math.max(
          floor,
          Math.min(
            0.86,
            0.28 +
              repoFamily.score * 0.42 +
              match.boost +
              Math.min(0.12, match.pathPriority * 0.015),
          ),
        ),
      ),
      anchor_priority: chunkAnchorPriority(args.query_anchors, chunk),
      lexical_priority: match.exactSymbol ? match.priority : 0,
      path_priority: match.pathPriority,
      channel: "path_facts_shadow",
      channel_rank: 0,
      source_fact_coverage: Math.max(match.coverage, repoFamily.score),
      evidence,
    });
  }
  return rankChannelHits(
    out
      .sort(compareChunkHit)
      .slice(0, Math.max(50, (args.max_results ?? DEFAULT_MAX_RESULTS) * 3)),
    "path_facts_shadow",
  );
}

function hydrateExactSymbolFallbackHits(
  args: BuildCodeRankedEntriesArgs,
  floor: number,
): ChunkHit[] {
  if (!allowsUnanchoredLexicalBoost(args)) return [];
  const exactSymbols = [...codeCompactTokenSet(args.query)].filter(
    (token) => token.length >= 4 && !GENERIC_EXACT_SYMBOL_TOKENS.has(token),
  );
  if (exactSymbols.length === 0) return [];
  const exactSet = new Set(exactSymbols);
  const out: ChunkHit[] = [];
  for (const chunk of listCurrentCodeChunks(args.db)) {
    if (!chunk.symbol_path) continue;
    if (shouldSkipCodePath(args, chunk.source_path)) {
      continue;
    }
    if (!exactSet.has(compactIdentifier(chunk.symbol_path))) continue;
    const match = lexicalCodeMatch(args.query, chunk);
    out.push({
      chunk,
      score: clamp01(Math.max(floor, 0.92 + match.boost)),
      anchor_priority: chunkAnchorPriority(args.query_anchors, chunk),
      lexical_priority: Math.max(3, match.priority),
      path_priority: match.pathPriority,
      channel: "exact_symbol",
      channel_rank: 0,
    });
  }
  return rankChannelHits(out
    .sort(
      (a, b) =>
        b.lexical_priority - a.lexical_priority ||
        b.score - a.score ||
        a.chunk.source_path.localeCompare(b.chunk.source_path),
    )
    .slice(0, Math.max(12, args.max_results ?? DEFAULT_MAX_RESULTS)), "exact_symbol");
}

function rankChannelHits(
  hits: ChunkHit[],
  channel: CodeCandidateChannel,
): ChunkHit[] {
  return hits.map((hit, index) => ({
    ...hit,
    channel,
    channel_rank: index + 1,
  }));
}

function withFileFusionSignals(hits: ChunkHit[]): ChunkHit[] {
  if (hits.length === 0) return [];
  const ranksByFile = new Map<string, Map<CodeCandidateChannel, number>>();
  const evidenceSummaries = new Map(
    summarizeCodeCandidateEvidence(hits.flatMap(chunkHitEvidence)).map((summary) => [
      summary.source_path,
      summary,
    ]),
  );
  for (const hit of hits) {
    const ranks = ranksByFile.get(hit.chunk.source_path) ?? new Map();
    const current = ranks.get(hit.channel);
    if (current === undefined || hit.channel_rank < current) {
      ranks.set(hit.channel, hit.channel_rank);
    }
    ranksByFile.set(hit.chunk.source_path, ranks);
  }

  const fusedByFile = new Map<string, { score: number; signalCount: number }>();
  for (const [sourcePath, ranks] of ranksByFile) {
    let score = 0;
    for (const rank of ranks.values()) {
      score += 1 / (RRF_K + rank);
    }
    fusedByFile.set(sourcePath, {
      score,
      signalCount: ranks.size,
    });
  }

  return hits.map((hit) => {
    const fused = fusedByFile.get(hit.chunk.source_path);
    return {
      ...hit,
      file_rrf_score: fused?.score ?? 0,
      file_signal_count: fused?.signalCount ?? 1,
      file_evidence: evidenceSummaries.get(hit.chunk.source_path),
    };
  });
}

function chunkHitEvidence(hit: ChunkHit): CodeCandidateEvidence[] {
  if (hit.evidence && hit.evidence.length > 0) return hit.evidence;
  return [{
    source_path: hit.chunk.source_path,
    family: evidenceFamilyForChannel(hit.channel),
    role: "owner",
    target: "direct_owner",
    reason: hit.channel,
    channel_rank: hit.channel_rank,
    ...(hit.source_fact_coverage !== undefined
      ? { coverage: hit.source_fact_coverage }
      : {}),
  }];
}

function evidenceFamilyForChannel(
  channel: CodeCandidateChannel,
): CodeCandidateEvidenceFamily {
  switch (channel) {
    case "chunk_fts":
      return "chunk_text";
    case "query_facet":
      return "query_facet";
    case "source_facts_facet":
    case "source_facts_fts":
      return "source_facts";
    case "exact_symbol":
      return "exact_symbol";
    case "path_fallback":
      return "path_identity";
    case "path_facts_shadow":
      return "path_identity";
  }
}

function aggregateFiles(
  args: BuildCodeRankedEntriesArgs,
  hits: ChunkHit[],
): FileCandidate[] {
  const grouped = new Map<string, ChunkHit[]>();
  for (const hit of hits) {
    const current = grouped.get(hit.chunk.source_path) ?? [];
    current.push(hit);
    grouped.set(hit.chunk.source_path, current);
  }

  const files: FileCandidate[] = [];
  for (const [source_path, group] of grouped) {
    group.sort(compareChunkHit);
    const primary = pickPrimaryHit(args, group);
    if (!primary) continue;
    const orientation = pickOrientationCompanion(
      args.db,
      primary,
      group,
      wantsOrientationCompanion(args),
    );
    const distinctHits = new Set(group.map((hit) => hit.chunk.stable_key)).size;
    const fileSignalCount = Math.max(
      ...group.map((hit) => hit.file_signal_count ?? 1),
      1,
    );
    const fileRrfScore = Math.max(
      ...group.map((hit) => hit.file_rrf_score ?? 0),
      0,
    );
    const sourceFactCoverage = Math.max(
      ...group.map((hit) => hit.source_fact_coverage ?? 0),
      0,
    );
    const parent_score =
      primary.score +
      Math.min(0.08, 0.04 * Math.max(0, distinctHits - 1)) +
      Math.min(0.06, 0.03 * Math.max(0, fileSignalCount - 1));
    files.push({
      source_path,
      parent_score: clamp01(parent_score),
      primary,
      orientation,
      file_rrf_score: fileRrfScore,
      file_signal_count: fileSignalCount,
      source_fact_coverage: sourceFactCoverage,
      ...(primary.file_evidence ? { file_evidence: primary.file_evidence } : {}),
    });
  }

  const pathShaped = isPathShapedCodeQuery(args.query);
  const scopedChangePriorities = new Map(files.map((file) => [
    file.source_path,
    scopedChangePathPriority(args.query, file.source_path),
  ]));
  const pathPriorities = pathShaped
    ? new Map(files.map((file) => [
      file.source_path,
      filePathPriority(args.query, file.source_path),
    ]))
    : undefined;
  return files.sort((a, b) => {
    const anchorBias = b.primary.anchor_priority - a.primary.anchor_priority;
    if (anchorBias !== 0) return anchorBias;
    const scopedChangeBias =
      (scopedChangePriorities.get(b.source_path) ?? 0) -
      (scopedChangePriorities.get(a.source_path) ?? 0);
    if (scopedChangeBias !== 0) return scopedChangeBias;
    if (pathShaped) {
      const pathBias = (pathPriorities?.get(b.source_path) ?? 0) -
        (pathPriorities?.get(a.source_path) ?? 0);
      if (pathBias !== 0) return pathBias;
      const chunkPathBias = b.primary.path_priority - a.primary.path_priority;
      if (chunkPathBias !== 0) return chunkPathBias;
    }
    const lexicalBias = b.primary.lexical_priority - a.primary.lexical_priority;
    if (lexicalBias !== 0) return lexicalBias;
    const signalCountBias = b.file_signal_count - a.file_signal_count;
    if (
      signalCountBias !== 0 &&
      Math.max(a.file_signal_count, b.file_signal_count) > 1 &&
      Math.max(a.source_fact_coverage, b.source_fact_coverage) >= 0.6
    ) {
      return signalCountBias;
    }
    if (
      a.file_signal_count > 1 &&
      b.file_signal_count > 1 &&
      Math.max(a.source_fact_coverage, b.source_fact_coverage) >= 0.6
    ) {
      const fusionBias = b.file_rrf_score - a.file_rrf_score;
      if (Math.abs(fusionBias) > 0.0001) return fusionBias;
    }
    if (!pathShaped && looksLikeNaturalChangeTitle(args.query)) {
      const basenamePathBias =
        multiTokenBasenamePriority(args.query, b.source_path) -
        multiTokenBasenamePriority(args.query, a.source_path);
      if (basenamePathBias !== 0) return basenamePathBias;
    }
    if (b.parent_score !== a.parent_score) return b.parent_score - a.parent_score;
    return a.source_path.localeCompare(b.source_path);
  });
}

function scopedChangePathPriority(query: string, sourcePath: string): number {
  const scopeTokens = conventionalCommitScopeTokens(query);
  if (scopeTokens.length === 0) return 0;
  const pathTokens = codeLexicalTokenSet(sourcePath);
  const matches = scopeTokens.filter((token) => pathTokens.has(token)).length;
  if (matches === 0) return 0;
  const completeScope = matches === scopeTokens.length ? 2 : 0;
  return matches * 4 + completeScope;
}

function conventionalCommitScopeTokens(query: string): string[] {
  const match =
    /\b(?:feat|fix|refactor|perf|test|docs|chore|ci|build)(?:\(([^)]+)\))?!?:/i
      .exec(query);
  if (!match?.[1]) return [];
  return [...codeLexicalTokenSet(match[1])]
    .filter((token) => !CONVENTIONAL_SCOPE_STOPWORDS.has(token));
}

const CONVENTIONAL_SCOPE_STOPWORDS = new Set([
  "core",
  "misc",
]);

function looksLikeNaturalChangeTitle(query: string): boolean {
  return /\b(?:feat|fix|add|support|format(?:ting)?|parse|handle|prevent|improve)\b/i
    .test(query);
}

function multiTokenBasenamePriority(query: string, sourcePath: string): number {
  const queryTokens = codeLexicalTokenSet(query);
  const basenameHits = countMatches(
    codeLexicalTokens(pathBasenameStem(sourcePath)),
    queryTokens,
  );
  return basenameHits >= 2 ? basenameHits : 0;
}

function filePathPriority(query: string, sourcePath: string): number {
  const queryTokens = codeLexicalTokenSet(query);
  if (queryTokens.size === 0) return 0;
  const basenameHits = countMatches(
    codeLexicalTokens(pathBasenameStem(sourcePath)),
    queryTokens,
  );
  const pathHits = countMatches(codeLexicalTokens(sourcePath), queryTokens);
  return basenameHits * 2 + pathHits + pathAlignmentPriority(query, sourcePath);
}

function allowsUnanchoredLexicalBoost(args: BuildCodeRankedEntriesArgs): boolean {
  return (
    (args.query_anchors?.files?.length ?? 0) === 0 &&
    (args.query_anchors?.symbols?.length ?? 0) === 0
  );
}

type CodeRetrievalConfidenceFileOptions = {
  admitted?: boolean;
  shadow?: boolean;
  orientation_companion?: boolean;
};

function codeRetrievalConfidenceForFile(
  file: FileCandidate,
  opts: CodeRetrievalConfidenceFileOptions = {},
): CodeRetrievalConfidence {
  const evidence = file.file_evidence;
  const reasons: string[] = [];
  let score = 0.18 + clamp01(file.parent_score) * 0.28;

  if (file.parent_score >= 0.85) reasons.push("strong_rank_score");
  else if (file.parent_score >= 0.55) reasons.push("usable_rank_score");
  else reasons.push("weak_rank_score");

  const hasExactSymbolAnchor =
    evidence?.has_exact_symbol_anchor === true || file.primary.anchor_priority >= 2;
  const hasExactFileAnchor =
    evidence?.has_exact_file_anchor === true || file.primary.anchor_priority === 1;

  if (hasExactSymbolAnchor) {
    score += 0.26;
    reasons.push("exact_symbol_anchor");
  } else if (hasExactFileAnchor) {
    score += 0.22;
    reasons.push("exact_file_anchor");
  }

  const ownerEvidenceCount =
    evidence?.independent_owner_evidence_count ?? Math.max(1, file.file_signal_count);
  if (ownerEvidenceCount >= 3) {
    score += 0.18;
    reasons.push("multi_owner_evidence");
  } else if (ownerEvidenceCount === 2) {
    score += 0.12;
    reasons.push("dual_owner_evidence");
  } else if (ownerEvidenceCount === 1) {
    score += 0.04;
    reasons.push("single_owner_evidence");
  }

  if (file.file_signal_count >= 3) {
    score += 0.10;
    reasons.push("multi_channel_evidence");
  } else if (file.file_signal_count === 2) {
    score += 0.05;
    reasons.push("dual_channel_evidence");
  }

  if (file.source_fact_coverage >= 0.6) {
    score += 0.11;
    reasons.push("strong_source_fact_coverage");
  } else if (file.source_fact_coverage >= 0.35) {
    score += 0.06;
    reasons.push("source_fact_coverage");
  }

  if (opts.orientation_companion) {
    score -= 0.05;
    reasons.push("orientation_companion");
  }
  if (opts.shadow || opts.admitted === false) {
    score -= 0.16;
    reasons.push("shadow_only");
  }

  if (evidence?.passive_artifact === "rejected") {
    score -= 0.22;
    reasons.push("passive_artifact_rejected");
  } else if (evidence?.passive_artifact === "support_only") {
    score -= 0.10;
    reasons.push("support_only_artifact");
  }

  const ownerFamilies = evidence?.owner_families ?? [];
  const weakLexicalOnly =
    ownerFamilies.length === 1 &&
    ownerFamilies[0] === "chunk_text" &&
    !hasExactSymbolAnchor &&
    !hasExactFileAnchor &&
    file.file_signal_count <= 1 &&
    file.source_fact_coverage < 0.35;
  if (weakLexicalOnly) {
    score -= 0.10;
    reasons.push("weak_lexical_only");
  }

  return finalizeCodeRetrievalConfidence(score, reasons, {
    retry: weakLexicalOnly || opts.shadow === true || opts.admitted === false,
  });
}

function codeRetrievalConfidenceForSupport(
  support: SupportClusterCandidate,
  score: number,
  inherited?: CodeRetrievalConfidence,
): CodeRetrievalConfidence {
  const reasons = [
    "support_fanout",
    `support_${support.reason}`,
  ];
  let confidenceScore =
    0.18 +
    clamp01(score) * 0.15 +
    clamp01(support.seed_parent_score) * 0.16 +
    clamp01(support.relevance) * 0.32;

  if (support.distance === 1) {
    confidenceScore += 0.04;
    reasons.push("direct_relation");
  } else {
    confidenceScore -= 0.05;
    reasons.push("distant_relation");
  }

  if (support.family_evidence?.support_admissible) {
    confidenceScore += 0.14;
    reasons.push("family_support_evidence");
  }
  if (support.facility_evidence?.support_admissible) {
    confidenceScore += 0.10;
    reasons.push("facility_support_evidence");
  }
  if (isSpecificFanoutReason(support.reason)) {
    confidenceScore += 0.04;
    reasons.push("specific_fanout_relation");
  }

  if (inherited && inherited.score > confidenceScore) {
    confidenceScore = Math.max(confidenceScore, inherited.score * 0.92);
    reasons.push("inherited_direct_evidence");
  }

  return finalizeCodeRetrievalConfidence(confidenceScore, [
    ...reasons,
    ...(inherited?.reasons ?? []),
  ]);
}

function genericCodeRetrievalConfidence(score: number): CodeRetrievalConfidence {
  return finalizeCodeRetrievalConfidence(
    0.20 + clamp01(score) * 0.35,
    ["score_only"],
  );
}

function finalizeCodeRetrievalConfidence(
  rawScore: number,
  rawReasons: readonly string[],
  opts: { retry?: boolean } = {},
): CodeRetrievalConfidence {
  const score = Number(clamp01(rawScore).toFixed(3));
  const level =
    score >= 0.72
      ? "high"
      : score >= 0.46
        ? "medium"
        : "low";
  const reasons = distinctStrings(rawReasons).slice(0, 8);
  return {
    level,
    score,
    reasons,
    retry_recommended:
      level === "low" ||
      opts.retry === true ||
      reasons.includes("shadow_only") ||
      reasons.includes("weak_lexical_only"),
  };
}

function distinctStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function materializeDirectEntries(
  args: BuildCodeRankedEntriesArgs,
  files: FileCandidate[],
  maxResults: number,
): CodeRankedEntry[] {
  const out: CodeRankedEntry[] = [];
  const emittedStableKeys = new Set<string>();
  const primaryFiles = files.slice(0, maxResults);
  for (const file of primaryFiles) {
    const chunk = directProjectionChunk(args, file);
    emittedStableKeys.add(chunk.stable_key);
    out.push(toRankedEntry(chunk, file.parent_score, {
      retrieval_confidence: codeRetrievalConfidenceForFile(file),
    }));
  }
  for (const file of primaryFiles) {
    if (!file.orientation) continue;
    if (emittedStableKeys.has(file.orientation.chunk.stable_key)) continue;
    if (out.length >= maxResults) break;
    out.push(
      toRankedEntry(
        file.orientation.chunk,
        clamp01(Math.min(file.parent_score, file.orientation.score + 0.02)),
        {
          retrieval_confidence: codeRetrievalConfidenceForFile(file, {
            orientation_companion: true,
          }),
        },
      ),
    );
  }
  return out;
}

function directProjectionChunk(
  args: BuildCodeRankedEntriesArgs,
  file: FileCandidate,
): StoredCodeChunk {
  const preserveDeclaration =
    args.query_intent === "exact_symbol" ||
    (args.query_anchors?.symbols?.length ?? 0) > 0;
  if (preserveDeclaration) return file.primary.chunk;
  if (file.primary.chunk.code_role === "orientation") return file.primary.chunk;
  const orientation =
    file.orientation?.chunk ??
    listCodeChunksForSource(args.db, file.source_path).find(
      (chunk) => chunk.code_role === "orientation",
    );
  if (!orientation) return file.primary.chunk;
  if (file.primary.chunk.token_count <= DIRECT_COMPACT_PROJECTION_TOKEN_THRESHOLD) {
    return file.primary.chunk;
  }
  if (orientation.token_count >= file.primary.chunk.token_count) {
    return file.primary.chunk;
  }
  return orientation;
}

function buildSupportClusterCandidates(
  args: BuildCodeRankedEntriesArgs,
  primaryFile: FileCandidate | undefined,
  floor: number,
  eligibleFamilySupportPaths: ReadonlySet<string>,
): SupportClusterCandidate[] {
  const importHops = args.import_max_hops ?? DEFAULT_IMPORT_HOPS;
  if (importHops <= 0 || !primaryFile) return [];

  const visited = new Set<string>([primaryFile.source_path]);
  let frontier = new Set<string>([primaryFile.source_path]);
  const candidates = new Map<string, SupportClusterCandidate>();
  const primaryFacts = getCodeSource(args.db, primaryFile.source_path)?.facts;

  for (let hop = 0; hop < importHops; hop++) {
    const next = new Set<string>();
    for (const source_path of frontier) {
      const distance = hop + 1;
      for (const direction of ["outgoing", "incoming"] as const) {
        for (const neighbor of listCodeGraphNeighbors(args.db, { source_path, direction })) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          next.add(neighbor);
          if (shouldSkipCodePath(args, neighbor)) continue;
          const facts = getCodeSource(args.db, neighbor)?.facts;
          const familyEvidence = facts
            ? scoreCodeFamilyEvidence({
                query: args.query,
                primary: primaryFacts,
                candidate: facts,
              })
            : undefined;
          const reason = supportReason(direction, distance);
          const relevance = supportRelevance({
            facts,
            path: neighbor,
            reason,
            floor,
            familyEvidence,
          });
          if (relevance <= 0) continue;
          candidates.set(neighbor, {
            source_path: neighbor,
            seed_source_path: primaryFile.source_path,
            seed_parent_score: primaryFile.parent_score,
            distance,
            reason: familyEvidence?.support_admissible
              ? "code_family_evidence"
              : reason,
            relevance,
            ...(familyEvidence?.support_admissible
              ? { family_evidence: familyEvidence }
              : {}),
          });
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }

  for (const candidate of buildSameFamilySupportCandidates(
    args,
    primaryFile,
    floor,
    eligibleFamilySupportPaths,
  )) {
    const current = candidates.get(candidate.source_path);
    if (!current || candidate.relevance > current.relevance) {
      candidates.set(candidate.source_path, candidate);
    }
  }

  return [...candidates.values()].sort(compareSupportClusterCandidate);
}

function buildSupportClusterCandidatesForSeeds(
  args: BuildCodeRankedEntriesArgs,
  files: FileCandidate[],
  floor: number,
  maxResults: number,
  rankingMethod: CodeLaneRankingMethod,
): SupportClusterCandidate[] {
  if (files.length === 0) return [];
  const byPath = new Map<string, SupportClusterCandidate>();
  const eligibleFamilySupportPaths = new Set(files.map((file) => file.source_path));
  const primarySeed = files[0]!;
  const primaryCandidates = buildSupportClusterCandidates(
    args,
    primarySeed,
    floor,
    eligibleFamilySupportPaths,
  );
  const seededCandidates: SupportClusterCandidate[][] = [primaryCandidates];

  if (
    rankingMethod === "bundle-aware" &&
    maxResults > 2 &&
    primaryCandidates.length === 0 &&
    files.length > 1
  ) {
    seededCandidates.push(buildSupportClusterCandidates(
      args,
      files[1],
      floor,
      eligibleFamilySupportPaths,
    ));
  }

  for (const candidates of seededCandidates) {
    for (const candidate of candidates) {
      const current = byPath.get(candidate.source_path);
      if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
        byPath.set(candidate.source_path, candidate);
      }
    }
  }

  if (supportSubstrateBundlePromoted()) {
    const facilitySeedFiles = files.slice(0, Math.min(files.length, 3));
    for (const candidate of buildSupportSubstrateBundleCandidates(
      args,
      facilitySeedFiles,
      new Set(facilitySeedFiles.map((file) => file.source_path)),
      floor,
    )) {
      const current = byPath.get(candidate.source_path);
      if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
        byPath.set(candidate.source_path, candidate);
      }
    }
  }

  if (ownerFanoutPromoted() && maxResults >= OWNER_FANOUT_MIN_MAX_RESULTS) {
    const ownerFanoutSeedFiles = files.slice(0, OWNER_FANOUT_SEED_LIMIT);
    const seedSourcePaths = new Set(
      ownerFanoutSeedFiles.map((file) => file.source_path),
    );
    for (const candidate of buildSupportConfigFanoutCandidates(
      args,
      ownerFanoutSeedFiles,
      seedSourcePaths,
      floor,
      maxResults,
    )) {
      const current = byPath.get(candidate.source_path);
      if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
        byPath.set(candidate.source_path, candidate);
      }
    }
    for (const candidate of buildSharedSupportImportCandidates(
      args,
      ownerFanoutSeedFiles,
      seedSourcePaths,
      floor,
      maxResults,
    )) {
      const current = byPath.get(candidate.source_path);
      if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
        byPath.set(candidate.source_path, candidate);
      }
    }
    if (packageDependencyFanoutPromoted()) {
      for (const candidate of buildPackageDependencyFanoutCandidates(
        args,
        ownerFanoutSeedFiles,
        seedSourcePaths,
        floor,
        maxResults,
      )) {
        const current = byPath.get(candidate.source_path);
        if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
          byPath.set(candidate.source_path, candidate);
        }
      }
    }
    if (roleFamilyFanoutPromoted()) {
      for (const candidate of buildRoleFamilyFanoutCandidates(
        args,
        ownerFanoutSeedFiles,
        seedSourcePaths,
        floor,
        maxResults,
      )) {
        const current = byPath.get(candidate.source_path);
        if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
          byPath.set(candidate.source_path, candidate);
        }
      }
    }
    if (symbolReferenceFanoutPromoted()) {
      for (const candidate of buildSymbolReferenceFanoutCandidates(
        args,
        ownerFanoutSeedFiles,
        seedSourcePaths,
        floor,
        maxResults,
      )) {
        const current = byPath.get(candidate.source_path);
        if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
          byPath.set(candidate.source_path, candidate);
        }
      }
    }
    if (cochangeFanoutPromoted()) {
      for (const candidate of buildCochangeFanoutCandidates(
        args,
        ownerFanoutSeedFiles,
        seedSourcePaths,
        floor,
        maxResults,
      )) {
        const current = byPath.get(candidate.source_path);
        if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
          byPath.set(candidate.source_path, candidate);
        }
      }
    }
    for (const candidate of buildOwnerFanoutCandidates(
      args,
      ownerFanoutSeedFiles,
      seedSourcePaths,
      floor,
      maxResults,
    )) {
      const current = byPath.get(candidate.source_path);
      if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
        byPath.set(candidate.source_path, candidate);
      }
    }
  }

  return [...byPath.values()].sort(compareSupportClusterCandidate);
}

function supportSubstrateBundlePromoted(): boolean {
  return process.env.RETRIEVAL_CODE_LANE_SUPPORT_SUBSTRATE_PROMOTED === "on";
}

function ownerFanoutPromoted(): boolean {
  return process.env.RETRIEVAL_CODE_LANE_OWNER_FANOUT_PROMOTED === "on";
}

function packageDependencyFanoutPromoted(): boolean {
  return process.env.RETRIEVAL_CODE_LANE_PACKAGE_DEPENDENCY_FANOUT_PROMOTED === "on";
}

function roleFamilyFanoutPromoted(): boolean {
  return process.env.RETRIEVAL_CODE_LANE_ROLE_FAMILY_FANOUT_PROMOTED === "on";
}

function symbolReferenceFanoutPromoted(): boolean {
  return process.env.RETRIEVAL_CODE_LANE_SYMBOL_REFERENCE_FANOUT_PROMOTED === "on";
}

function cochangeFanoutPromoted(): boolean {
  return process.env.RETRIEVAL_CODE_LANE_COCHANGE_FANOUT_PROMOTED === "on";
}

function tailRecallExpansionPromoted(): boolean {
  return supportSubstrateBundlePromoted() || ownerFanoutPromoted();
}

function shouldReserveTailRecallSupport(
  candidate: SupportClusterCandidate,
  directFilePaths: ReadonlySet<string>,
): boolean {
  if (candidate.reason === "support_substrate_bundle") {
    return supportSubstrateBundlePromoted();
  }
  if (candidate.reason === "owner_fanout") {
    return candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE;
  }
  if (candidate.reason === "role_family_fanout") {
    return roleFamilyFanoutPromoted() &&
      candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE;
  }
  if (candidate.reason === "symbol_reference_fanout") {
    return symbolReferenceFanoutPromoted() &&
      candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE;
  }
  if (candidate.reason === "cochange_fanout") {
    return cochangeFanoutPromoted() &&
      candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE;
  }
  if (candidate.reason === "package_dependency_fanout") {
    return packageDependencyFanoutPromoted() &&
      candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE;
  }
  if (
    candidate.reason === "support_config" ||
    candidate.reason === "shared_support_import"
  ) {
    return ownerFanoutPromoted();
  }
  return !directFilePaths.has(candidate.source_path);
}

function buildSupportSubstrateBundleCandidates(
  args: BuildCodeRankedEntriesArgs,
  seedFiles: FileCandidate[],
  seedSourcePaths: ReadonlySet<string>,
  floor: number,
): SupportClusterCandidate[] {
  if (seedFiles.length === 0) return [];
  const seeds = seedFiles
    .map((file) => {
      const facts = getCodeSource(args.db, file.source_path)?.facts;
      return facts ? { file, facts } : undefined;
    })
    .filter((seed): seed is { file: FileCandidate; facts: CodeSourceFacts } =>
      seed !== undefined && isStrongFacilitySupportSeed(seed.file)
    );
  if (seeds.length === 0) return [];

  const candidates: SupportClusterCandidate[] = [];
  for (const source of listCodeSources(args.db)) {
    const facts = source.facts;
    const path = facts.file_path;
    if (seedSourcePaths.has(path)) continue;
    if (shouldSkipCodePath(args, path)) continue;

    const scored = seeds
      .map((seed) => ({
        seed,
        facilityEvidence: scoreCodeFacilitySupport({
          query: args.query,
          seed: seed.facts,
          candidate: facts,
        }),
      }))
      .filter((item) => item.facilityEvidence.support_admissible)
      .sort((a, b) =>
        b.facilityEvidence.score - a.facilityEvidence.score ||
        b.seed.file.parent_score - a.seed.file.parent_score ||
        a.seed.file.source_path.localeCompare(b.seed.file.source_path)
      )[0];
    if (!scored) continue;

    const relevance = scored.facilityEvidence.score;
    const familyEvidence = scoreCodeFamilyEvidence({
      query: args.query,
      primary: scored.seed.facts,
      candidate: facts,
    });
    candidates.push({
      source_path: path,
      seed_source_path: scored.seed.file.source_path,
      seed_parent_score: scored.seed.file.parent_score,
      distance: 1,
      reason: "support_substrate_bundle",
      relevance: clamp01(Math.max(floor, relevance)),
      ...(familyEvidence.support_admissible
        ? { family_evidence: familyEvidence }
        : {}),
      facility_evidence: scored.facilityEvidence,
    });
  }
  return candidates
    .sort(compareSupportClusterCandidate)
    .slice(0, expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS));
}

function buildSupportConfigFanoutCandidates(
  args: BuildCodeRankedEntriesArgs,
  seedFiles: FileCandidate[],
  seedSourcePaths: ReadonlySet<string>,
  floor: number,
  maxResults: number,
): SupportClusterCandidate[] {
  const seeds = seedFiles
    .map((file) => {
      const facts = getCodeSource(args.db, file.source_path)?.facts;
      return facts ? { file, facts } : undefined;
    })
    .filter((seed): seed is { file: FileCandidate; facts: CodeSourceFacts } =>
      seed !== undefined && isOwnerFanoutSeed(seed.file, seed.facts)
    );
  if (seeds.length === 0) return [];

  const candidates: SupportClusterCandidate[] = [];
  for (const source of listCodeSources(args.db)) {
    const facts = source.facts;
    const path = facts.file_path;
    if (seedSourcePaths.has(path)) continue;
    if (!isSupportConfigPath(path)) continue;
    if (isGeneratedArtifactPath(path) && !allowsGeneratedArtifacts(args)) continue;

    const scored = seeds
      .map((seed) => ({
        seed,
        relevance: supportConfigFanoutRelevance({
          seedPath: seed.file.source_path,
          candidatePath: path,
          floor,
        }),
      }))
      .filter((item) => item.relevance > 0)
      .sort((a, b) =>
        b.relevance - a.relevance ||
        b.seed.file.parent_score - a.seed.file.parent_score ||
        a.seed.file.source_path.localeCompare(b.seed.file.source_path)
      )[0];
    if (!scored) continue;

    candidates.push({
      source_path: path,
      seed_source_path: scored.seed.file.source_path,
      seed_parent_score: scored.seed.file.parent_score,
      distance: 1,
      reason: "support_config",
      relevance: scored.relevance,
    });
  }

  return candidates
    .sort(compareSupportClusterCandidate)
    .slice(0, Math.min(SUPPORT_CONFIG_FANOUT_LIMIT, expandedTailSupportLimit(maxResults)));
}

function buildSharedSupportImportCandidates(
  args: BuildCodeRankedEntriesArgs,
  seedFiles: FileCandidate[],
  seedSourcePaths: ReadonlySet<string>,
  floor: number,
  maxResults: number,
): SupportClusterCandidate[] {
  const seeds = seedFiles
    .map((file) => {
      const facts = getCodeSource(args.db, file.source_path)?.facts;
      const patternKey = fanoutPathPatternKey(file.source_path);
      return facts ? { file, facts, patternKey } : undefined;
    })
    .filter((seed): seed is {
      file: FileCandidate;
      facts: CodeSourceFacts;
      patternKey: string;
    } =>
      seed !== undefined &&
      seed.patternKey !== null &&
      isOwnerFanoutSeed(seed.file, seed.facts)
    );
  if (seeds.length === 0) return [];

  const candidates = new Map<string, SupportClusterCandidate>();
  for (const seed of seeds) {
    for (const neighbor of listCodeGraphNeighbors(args.db, {
      source_path: seed.file.source_path,
      direction: "outgoing",
    })) {
      if (seedSourcePaths.has(neighbor)) continue;
      if (shouldSkipCodePath(args, neighbor)) continue;
      const facts = getCodeSource(args.db, neighbor)?.facts;
      if (!facts) continue;
      if (!isSharedSupportImportCandidate(seed.file.source_path, neighbor, facts)) {
        continue;
      }
      const relevance = sharedSupportImportRelevance({
        seedPath: seed.file.source_path,
        candidatePath: neighbor,
        facts,
        floor,
      });
      if (relevance <= 0) continue;
      const familyEvidence = scoreCodeFamilyEvidence({
        query: args.query,
        primary: seed.facts,
        candidate: facts,
      });
      const candidate: SupportClusterCandidate = {
        source_path: neighbor,
        seed_source_path: seed.file.source_path,
        seed_parent_score: seed.file.parent_score,
        distance: 1,
        reason: "shared_support_import",
        relevance,
        ...(familyEvidence.support_admissible
          ? { family_evidence: familyEvidence }
          : {}),
      };
      const current = candidates.get(neighbor);
      if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
        candidates.set(neighbor, candidate);
      }
    }
  }

  return [...candidates.values()]
    .sort(compareSupportClusterCandidate)
    .slice(0, Math.min(
      SHARED_SUPPORT_IMPORT_FANOUT_LIMIT,
      expandedTailSupportLimit(maxResults),
    ));
}

function buildPackageDependencyFanoutCandidates(
  args: BuildCodeRankedEntriesArgs,
  seedFiles: FileCandidate[],
  seedSourcePaths: ReadonlySet<string>,
  floor: number,
  maxResults: number,
): SupportClusterCandidate[] {
  const seeds = seedFiles
    .map((file) => {
      const facts = getCodeSource(args.db, file.source_path)?.facts;
      return facts ? { file, facts, packageFacts: facts.package_facts } : undefined;
    })
    .filter((seed): seed is {
      file: FileCandidate;
      facts: CodeSourceFacts;
      packageFacts: CodeSourcePackageFacts;
    } =>
      seed !== undefined &&
      seed.packageFacts !== undefined &&
      isOwnerFanoutSeed(seed.file, seed.facts)
    );
  if (seeds.length === 0) return [];

  const candidates = new Map<string, SupportClusterCandidate>();
  for (const source of listCodeSources(args.db)) {
    const facts = source.facts;
    const path = facts.file_path;
    if (seedSourcePaths.has(path)) continue;
    if (shouldSkipCodePath(args, path)) continue;
    const packageFacts = facts.package_facts;
    if (!packageFacts) continue;

    const scored = seeds
      .map((seed) => ({
        seed,
        relation: packageDependencyRelation(seed.packageFacts, packageFacts),
        relevance: packageDependencyFanoutRelevance({
          query: args.query,
          candidatePath: path,
          candidateFacts: facts,
          candidatePackageFacts: packageFacts,
          floor,
        }),
      }))
      .filter((item) => item.relation !== null && item.relevance > 0)
      .sort((a, b) =>
        b.relevance - a.relevance ||
        packageDependencyRelationPriority(b.relation) -
          packageDependencyRelationPriority(a.relation) ||
        b.seed.file.parent_score - a.seed.file.parent_score ||
        a.seed.file.source_path.localeCompare(b.seed.file.source_path)
      )[0];
    if (!scored) continue;

    const familyEvidence = scoreCodeFamilyEvidence({
      query: args.query,
      primary: scored.seed.facts,
      candidate: facts,
    });
    const candidate: SupportClusterCandidate = {
      source_path: path,
      seed_source_path: scored.seed.file.source_path,
      seed_parent_score: scored.seed.file.parent_score,
      distance: 1,
      reason: "package_dependency_fanout",
      relevance: scored.relevance,
      ...(familyEvidence.support_admissible
        ? { family_evidence: familyEvidence }
        : {}),
    };
    const current = candidates.get(path);
    if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
      candidates.set(path, candidate);
    }
  }

  return [...candidates.values()]
    .sort(compareSupportClusterCandidate)
    .slice(0, Math.min(PACKAGE_DEPENDENCY_FANOUT_LIMIT, expandedTailSupportLimit(maxResults)));
}

function buildRoleFamilyFanoutCandidates(
  args: BuildCodeRankedEntriesArgs,
  seedFiles: FileCandidate[],
  seedSourcePaths: ReadonlySet<string>,
  floor: number,
  maxResults: number,
): SupportClusterCandidate[] {
  const seeds = seedFiles
    .map((file) => {
      const facts = getCodeSource(args.db, file.source_path)?.facts;
      return facts ? { file, facts, roleFacts: roleFactsFor(facts) } : undefined;
    })
    .filter((seed): seed is {
      file: FileCandidate;
      facts: CodeSourceFacts;
      roleFacts: CodeSourceRoleFacts;
    } =>
      seed !== undefined &&
      isOwnerFanoutSeed(seed.file, seed.facts) &&
      seedHasRoleFamilyIdentity(seed.roleFacts)
    );
  if (seeds.length === 0) return [];

  const candidates = new Map<string, SupportClusterCandidate>();
  for (const source of listCodeSources(args.db)) {
    const facts = source.facts;
    const path = facts.file_path;
    if (seedSourcePaths.has(path)) continue;
    if (shouldSkipRoleFamilyFanoutCandidate(args, path, facts)) continue;
    const roleFacts = roleFactsFor(facts);

    const scored = seeds
      .map((seed) => ({
        seed,
        relevance: roleFamilyFanoutRelevance({
          seedRoleFacts: seed.roleFacts,
          candidateRoleFacts: roleFacts,
          candidatePath: path,
          candidateFacts: facts,
          floor,
        }),
      }))
      .filter((item) => item.relevance > 0)
      .sort((a, b) =>
        b.relevance - a.relevance ||
        b.seed.file.parent_score - a.seed.file.parent_score ||
        a.seed.file.source_path.localeCompare(b.seed.file.source_path)
      )[0];

    if (!scored) continue;
    const familyEvidence = scoreCodeFamilyEvidence({
      query: args.query,
      primary: scored.seed.facts,
      candidate: facts,
    });
    const candidate: SupportClusterCandidate = {
      source_path: path,
      seed_source_path: scored.seed.file.source_path,
      seed_parent_score: scored.seed.file.parent_score,
      distance: 1,
      reason: "role_family_fanout",
      relevance: scored.relevance,
      ...(familyEvidence.support_admissible
        ? { family_evidence: familyEvidence }
        : {}),
    };
    const current = candidates.get(path);
    if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
      candidates.set(path, candidate);
    }
  }

  return [...candidates.values()]
    .sort(compareSupportClusterCandidate)
    .slice(0, Math.min(ROLE_FAMILY_FANOUT_LIMIT, expandedTailSupportLimit(maxResults)));
}

function buildSymbolReferenceFanoutCandidates(
  args: BuildCodeRankedEntriesArgs,
  seedFiles: FileCandidate[],
  seedSourcePaths: ReadonlySet<string>,
  floor: number,
  maxResults: number,
): SupportClusterCandidate[] {
  const seeds = seedFiles
    .map((file) => {
      const facts = getCodeSource(args.db, file.source_path)?.facts;
      return facts ? { file, facts } : undefined;
    })
    .filter((seed): seed is {
      file: FileCandidate;
      facts: CodeSourceFacts;
    } => seed !== undefined && isOwnerFanoutSeed(seed.file, seed.facts));
  if (seeds.length === 0) return [];

  const candidates = new Map<string, SupportClusterCandidate>();
  for (const seed of seeds) {
    for (const candidate of outgoingSymbolReferenceFanoutCandidates({
      args,
      seed,
      seedSourcePaths,
      floor,
    })) {
      const current = candidates.get(candidate.source_path);
      if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
        candidates.set(candidate.source_path, candidate);
      }
    }
    for (const candidate of incomingSymbolReferenceFanoutCandidates({
      args,
      seed,
      seedSourcePaths,
      floor,
      maxResults,
    })) {
      const current = candidates.get(candidate.source_path);
      if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
        candidates.set(candidate.source_path, candidate);
      }
    }
  }

  return [...candidates.values()]
    .sort(compareSupportClusterCandidate)
    .slice(0, Math.min(SYMBOL_REFERENCE_FANOUT_LIMIT, expandedTailSupportLimit(maxResults)));
}

function buildCochangeFanoutCandidates(
  args: BuildCodeRankedEntriesArgs,
  seedFiles: FileCandidate[],
  seedSourcePaths: ReadonlySet<string>,
  floor: number,
  maxResults: number,
): SupportClusterCandidate[] {
  const seeds = seedFiles
    .map((file) => {
      const facts = getCodeSource(args.db, file.source_path)?.facts;
      return facts ? { file, facts, cochangeFacts: facts.cochange_facts } : undefined;
    })
    .filter((seed): seed is {
      file: FileCandidate;
      facts: CodeSourceFacts;
      cochangeFacts: CodeSourceCochangeFacts;
    } =>
      seed !== undefined &&
      seed.cochangeFacts !== undefined &&
      isOwnerFanoutSeed(seed.file, seed.facts)
    );
  if (seeds.length === 0) return [];

  const candidates = new Map<string, SupportClusterCandidate>();
  for (const seed of seeds) {
    for (const related of seed.cochangeFacts.related_paths) {
      if (seedSourcePaths.has(related.source_path)) continue;
      if (shouldSkipCodePath(args, related.source_path)) continue;
      const facts = getCodeSource(args.db, related.source_path)?.facts;
      if (!facts) continue;
      if (isPassiveFanoutPath(related.source_path, facts)) continue;
      const relevance = cochangeFanoutRelevance({
        query: args.query,
        seedPath: seed.file.source_path,
        candidatePath: related.source_path,
        candidateFacts: facts,
        count: related.count,
        floor,
      });
      if (relevance <= 0) continue;
      const familyEvidence = scoreCodeFamilyEvidence({
        query: args.query,
        primary: seed.facts,
        candidate: facts,
      });
      const candidate: SupportClusterCandidate = {
        source_path: related.source_path,
        seed_source_path: seed.file.source_path,
        seed_parent_score: seed.file.parent_score,
        distance: 1,
        reason: "cochange_fanout",
        relevance,
        ...(familyEvidence.support_admissible
          ? { family_evidence: familyEvidence }
          : {}),
      };
      const current = candidates.get(related.source_path);
      if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
        candidates.set(related.source_path, candidate);
      }
    }
  }

  return [...candidates.values()]
    .sort(compareSupportClusterCandidate)
    .slice(0, Math.min(COCHANGE_FANOUT_LIMIT, expandedTailSupportLimit(maxResults)));
}

function cochangeFanoutRelevance(args: {
  query: string;
  seedPath: string;
  candidatePath: string;
  candidateFacts: CodeSourceFacts;
  count: number;
  floor: number;
}): number {
  const sourceMatch = sourceFactsCodeMatch(args.query, args.candidateFacts);
  const samePackage = packageRootKey(args.seedPath) !== null &&
    packageRootKey(args.seedPath) === packageRootKey(args.candidatePath);
  const sameDirectory = sourceDirectoryKey(args.seedPath) === sourceDirectoryKey(args.candidatePath);
  const supportRole = isOwnerFanoutSupportRole(args.candidatePath, args.candidateFacts);
  let score = 0.86 + Math.min(0.08, Math.max(1, args.count) * 0.025);
  if (sameDirectory) score += 0.05;
  else if (samePackage) score += 0.04;
  if (supportRole) score += 0.04;
  if (sourceMatch.exactSymbol) score += 0.04;
  else if (sourceMatch.factTokenHits > 0) score += 0.025;
  if (
    args.count <= 1 &&
    !sameDirectory &&
    !samePackage &&
    !supportRole &&
    sourceMatch.factTokenHits === 0
  ) {
    return 0;
  }
  if (score < Math.max(args.floor, SUPPORT_CLUSTER_RELEVANCE_FLOOR)) return 0;
  return clamp01(score);
}

function outgoingSymbolReferenceFanoutCandidates(args: {
  args: BuildCodeRankedEntriesArgs;
  seed: { file: FileCandidate; facts: CodeSourceFacts };
  seedSourcePaths: ReadonlySet<string>;
  floor: number;
}): SupportClusterCandidate[] {
  const seedText = symbolReferenceTextForPath(args.args.db, args.seed.file.source_path);
  if (seedText.length === 0) return [];

  const out: SupportClusterCandidate[] = [];
  for (const source of listCodeSources(args.args.db)) {
    const facts = source.facts;
    const path = facts.file_path;
    if (args.seedSourcePaths.has(path)) continue;
    if (shouldSkipCodePath(args.args, path)) continue;
    if (isPassiveFanoutPath(path, facts)) continue;

    const symbols = highEntropyExportedSymbolNames(facts);
    const matchedSymbols = symbols.filter((symbol) =>
      textContainsIdentifier(seedText, symbol)
    );
    if (matchedSymbols.length === 0) continue;

    const relevance = symbolReferenceFanoutRelevance({
      query: args.args.query,
      seedPath: args.seed.file.source_path,
      candidatePath: path,
      candidateFacts: facts,
      matchedSymbolCount: matchedSymbols.length,
      graphRelated: graphRelated(args.args.db, args.seed.file.source_path, path),
      floor: args.floor,
    });
    if (relevance <= 0) continue;
    out.push(symbolReferenceFanoutCandidate({
      args: args.args,
      seed: args.seed,
      facts,
      path,
      relevance,
    }));
  }
  return out;
}

function incomingSymbolReferenceFanoutCandidates(args: {
  args: BuildCodeRankedEntriesArgs;
  seed: { file: FileCandidate; facts: CodeSourceFacts };
  seedSourcePaths: ReadonlySet<string>;
  floor: number;
  maxResults: number;
}): SupportClusterCandidate[] {
  const seedSymbols = highEntropySourceSymbolNames(args.args.db, args.seed.file.source_path, args.seed.facts)
    .slice(0, 8);
  if (seedSymbols.length === 0) return [];

  const byPath = new Map<string, { matchedSymbolCount: number; graphRelated: boolean }>();
  const perSymbolLimit = Math.max(12, Math.min(50, args.maxResults));
  for (const symbol of seedSymbols) {
    const ftsQuery = ftsSafeAllQuery(symbol);
    if (!ftsQuery) continue;
    for (const hit of searchCodeChunksFts(args.args.db, ftsQuery, perSymbolLimit)) {
      const chunk = getCodeChunkByVersionId(args.args.db, hit.version_id);
      if (!chunk) continue;
      const path = chunk.source_path;
      if (args.seedSourcePaths.has(path)) continue;
      if (shouldSkipCodePath(args.args, path)) continue;
      const facts = getCodeSource(args.args.db, path)?.facts;
      if (!facts) continue;
      if (isPassiveFanoutPath(path, facts)) continue;
      if (!textContainsIdentifier(chunk.body, symbol) && chunk.symbol_path !== symbol) {
        continue;
      }
      const current = byPath.get(path) ?? { matchedSymbolCount: 0, graphRelated: false };
      current.matchedSymbolCount += 1;
      current.graphRelated ||= graphRelated(args.args.db, args.seed.file.source_path, path);
      byPath.set(path, current);
    }
  }

  const out: SupportClusterCandidate[] = [];
  for (const [path, relation] of byPath.entries()) {
    const facts = getCodeSource(args.args.db, path)?.facts;
    if (!facts) continue;
    const relevance = symbolReferenceFanoutRelevance({
      query: args.args.query,
      seedPath: args.seed.file.source_path,
      candidatePath: path,
      candidateFacts: facts,
      matchedSymbolCount: relation.matchedSymbolCount,
      graphRelated: relation.graphRelated,
      floor: args.floor,
    });
    if (relevance <= 0) continue;
    out.push(symbolReferenceFanoutCandidate({
      args: args.args,
      seed: args.seed,
      facts,
      path,
      relevance,
    }));
  }
  return out;
}

function symbolReferenceFanoutCandidate(args: {
  args: BuildCodeRankedEntriesArgs;
  seed: { file: FileCandidate; facts: CodeSourceFacts };
  facts: CodeSourceFacts;
  path: string;
  relevance: number;
}): SupportClusterCandidate {
  const familyEvidence = scoreCodeFamilyEvidence({
    query: args.args.query,
    primary: args.seed.facts,
    candidate: args.facts,
  });
  return {
    source_path: args.path,
    seed_source_path: args.seed.file.source_path,
    seed_parent_score: args.seed.file.parent_score,
    distance: 1,
    reason: "symbol_reference_fanout",
    relevance: args.relevance,
    ...(familyEvidence.support_admissible
      ? { family_evidence: familyEvidence }
      : {}),
  };
}

function symbolReferenceFanoutRelevance(args: {
  query: string;
  seedPath: string;
  candidatePath: string;
  candidateFacts: CodeSourceFacts;
  matchedSymbolCount: number;
  graphRelated: boolean;
  floor: number;
}): number {
  const sourceMatch = sourceFactsCodeMatch(args.query, args.candidateFacts);
  const samePackage = packageRootKey(args.seedPath) !== null &&
    packageRootKey(args.seedPath) === packageRootKey(args.candidatePath);
  const sameDirectory = sourceDirectoryKey(args.seedPath) === sourceDirectoryKey(args.candidatePath);
  const supportRole = isOwnerFanoutSupportRole(args.candidatePath, args.candidateFacts);

  let score = 0.82 + Math.min(0.06, args.matchedSymbolCount * 0.03);
  if (args.graphRelated) score += 0.08;
  if (sameDirectory) score += 0.07;
  else if (samePackage) score += 0.05;
  if (supportRole) score += 0.04;
  if (sourceMatch.exactSymbol) score += 0.05;
  else if (sourceMatch.factTokenHits > 0) score += 0.03;
  if (!args.graphRelated && !samePackage && !sameDirectory && sourceMatch.factTokenHits === 0) {
    return 0;
  }
  if (score < Math.max(args.floor, SUPPORT_CLUSTER_RELEVANCE_FLOOR)) return 0;
  return clamp01(score);
}

function symbolReferenceTextForPath(db: Db, sourcePath: string): string {
  const facts = getCodeSource(db, sourcePath)?.facts;
  const chunks = listCodeChunksForSource(db, sourcePath);
  return [
    facts?.file_path ?? "",
    facts?.file_purpose ?? "",
    ...(facts?.exported_signatures ?? []),
    ...chunks.map((chunk) => chunk.body),
  ].join("\n");
}

function highEntropySourceSymbolNames(
  db: Db,
  sourcePath: string,
  facts: CodeSourceFacts,
): string[] {
  return uniqueStrings([
    ...highEntropyExportedSymbolNames(facts),
    ...listCodeChunksForSource(db, sourcePath)
      .map((chunk) => chunk.symbol_path)
      .filter((symbol): symbol is string => symbol !== null)
      .filter(isHighEntropyCodeSymbol),
  ]);
}

function highEntropyExportedSymbolNames(facts: CodeSourceFacts): string[] {
  return uniqueStrings(
    facts.exported_symbols
      .map((symbol) => symbol.name)
      .filter(isHighEntropyCodeSymbol),
  );
}

function isHighEntropyCodeSymbol(symbol: string): boolean {
  const compact = compactIdentifier(symbol);
  if (compact.length < 6) return false;
  if (GENERIC_EXACT_SYMBOL_TOKENS.has(compact)) return false;
  if (GENERIC_SYMBOL_REFERENCE_TOKENS.has(compact)) return false;
  return /[A-Z_]|[a-z][A-Z]|[0-9]/.test(symbol) ||
    codeLexicalTokens(symbol).length >= 2;
}

function textContainsIdentifier(text: string, identifier: string): boolean {
  if (text.length === 0 || identifier.length === 0) return false;
  return new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(identifier)}([^A-Za-z0-9_$]|$)`).test(text);
}

function graphRelated(db: Db, left: string, right: string): boolean {
  return listCodeGraphNeighbors(db, { source_path: left, direction: "outgoing" }).includes(right) ||
    listCodeGraphNeighbors(db, { source_path: left, direction: "incoming" }).includes(right);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildOwnerFanoutCandidates(
  args: BuildCodeRankedEntriesArgs,
  seedFiles: FileCandidate[],
  seedSourcePaths: ReadonlySet<string>,
  floor: number,
  maxResults: number,
): SupportClusterCandidate[] {
  const seeds = seedFiles
    .map((file) => {
      const facts = getCodeSource(args.db, file.source_path)?.facts;
      return facts ? { file, facts, patternKey: fanoutPathPatternKey(file.source_path) } : undefined;
    })
    .filter((seed): seed is {
      file: FileCandidate;
      facts: CodeSourceFacts;
      patternKey: string | null;
    } => seed !== undefined && isOwnerFanoutSeed(seed.file, seed.facts));
  if (seeds.length === 0) return [];

  const candidates = new Map<string, SupportClusterCandidate>();
  for (const source of listCodeSources(args.db)) {
    const facts = source.facts;
    const path = facts.file_path;
    if (seedSourcePaths.has(path)) continue;
    if (shouldSkipCodePath(args, path)) continue;
    if (isPassiveFanoutPath(path, facts)) continue;

    const scored = seeds
      .map((seed) => ({
        seed,
        relation: ownerFanoutRelation(seed.file.source_path, path),
        patternMatch:
          seed.patternKey !== null && seed.patternKey === fanoutPathPatternKey(path),
      }))
      .filter((item) => item.relation !== null || item.patternMatch)
      .map((item) => ({
        ...item,
        relevance: ownerFanoutRelevance({
          seedPath: item.seed.file.source_path,
          candidatePath: path,
          facts,
          relation: item.relation,
          patternMatch: item.patternMatch,
          floor,
        }),
      }))
      .filter((item) => item.relevance > 0)
      .sort((a, b) =>
        b.relevance - a.relevance ||
        b.seed.file.parent_score - a.seed.file.parent_score ||
        a.seed.file.source_path.localeCompare(b.seed.file.source_path)
      )[0];

    if (!scored) continue;
    const familyEvidence = scoreCodeFamilyEvidence({
      query: args.query,
      primary: scored.seed.facts,
      candidate: facts,
    });
    const candidate: SupportClusterCandidate = {
      source_path: path,
      seed_source_path: scored.seed.file.source_path,
      seed_parent_score: scored.seed.file.parent_score,
      distance: 1,
      reason: "owner_fanout",
      relevance: scored.relevance,
      ...(familyEvidence.support_admissible
        ? { family_evidence: familyEvidence }
        : {}),
    };
    const current = candidates.get(path);
    if (!current || compareSupportClusterCandidate(candidate, current) < 0) {
      candidates.set(path, candidate);
    }
  }

  return [...candidates.values()]
    .sort(compareSupportClusterCandidate)
    .slice(0, expandedTailSupportLimit(maxResults));
}

function isOwnerFanoutSeed(
  file: FileCandidate,
  facts: CodeSourceFacts,
): boolean {
  return (
    file.parent_score >= 0.55 ||
    file.primary.anchor_priority > 0 ||
    file.primary.lexical_priority > 0 ||
    file.primary.path_priority >= 3 ||
    file.file_signal_count > 1 ||
    file.source_fact_coverage >= 0.35 ||
    isOwnerFanoutSupportRole(facts.file_path, facts)
  );
}

function ownerFanoutRelation(
  seedPath: string,
  candidatePath: string,
): "same_directory" | "same_package" | null {
  if (sourceDirectoryKey(seedPath) === sourceDirectoryKey(candidatePath)) {
    return "same_directory";
  }
  const seedPackage = packageRootKey(seedPath);
  if (seedPackage !== null && seedPackage === packageRootKey(candidatePath)) {
    return "same_package";
  }
  return null;
}

function ownerFanoutRelevance(args: {
  seedPath: string;
  candidatePath: string;
  facts: CodeSourceFacts;
  relation: "same_directory" | "same_package" | null;
  patternMatch: boolean;
  floor: number;
}): number {
  const supportRole = isOwnerFanoutSupportRole(args.candidatePath, args.facts);
  let score = 0;
  if (args.relation === "same_directory") {
    score = Math.max(score, supportRole ? 0.92 : 0.68);
  }
  if (args.relation === "same_package" && supportRole) score = Math.max(score, 0.62);
  if (args.patternMatch && supportRole) score = Math.max(score, 0.95);
  if (score <= 0) return 0;
  if (score < Math.max(args.floor, SUPPORT_CLUSTER_RELEVANCE_FLOOR)) return 0;
  return clamp01(score);
}

function roleFamilyFanoutRelevance(args: {
  seedRoleFacts: CodeSourceRoleFacts;
  candidateRoleFacts: CodeSourceRoleFacts;
  candidatePath: string;
  candidateFacts: CodeSourceFacts;
  floor: number;
}): number {
  if (isPassiveFanoutPath(args.candidatePath, args.candidateFacts)) return 0;
  const candidateRole = roleFamilyFanoutRoleStrength(args.candidateRoleFacts);
  const pathPatterns = sharedRoleFamilyKeys(
    args.seedRoleFacts.path_pattern_keys,
    args.candidateRoleFacts.path_pattern_keys,
  );
  const workspaceFamilies = sharedRoleFamilyKeys(
    args.seedRoleFacts.workspace_family_keys,
    args.candidateRoleFacts.workspace_family_keys,
  );
  const moduleFamilies = sharedRoleFamilyKeys(
    args.seedRoleFacts.module_family_keys,
    args.candidateRoleFacts.module_family_keys,
  );

  let score = 0;
  if (pathPatterns.length > 0) {
    score = Math.max(score, candidateRole > 0 ? 0.97 : 0.93);
  }
  if (workspaceFamilies.length > 0 && candidateRole >= 2) {
    score = Math.max(score, 0.94);
  }
  if (moduleFamilies.length > 0 && candidateRole >= 2) {
    score = Math.max(score, 0.92);
  }
  if (
    args.seedRoleFacts.package_root !== null &&
    args.seedRoleFacts.package_root === args.candidateRoleFacts.package_root &&
    candidateRole >= 2
  ) {
    score = Math.max(score, 0.9);
  }

  if (score < Math.max(args.floor, SUPPORT_CLUSTER_RELEVANCE_FLOOR)) return 0;
  return clamp01(score);
}

type PackageDependencyRelation =
  | "seed_depends_on_candidate"
  | "candidate_depends_on_seed";

function packageDependencyRelation(
  seed: CodeSourcePackageFacts,
  candidate: CodeSourcePackageFacts,
): PackageDependencyRelation | null {
  if (samePackageFacts(seed, candidate)) return null;
  if (
    packageNameOrRootMatches(candidate, seed.internal_dependency_names, seed.internal_dependency_roots)
  ) {
    return "seed_depends_on_candidate";
  }
  if (
    packageNameOrRootMatches(candidate, seed.internal_dependent_names, seed.internal_dependent_roots)
  ) {
    return "candidate_depends_on_seed";
  }
  if (
    packageNameOrRootMatches(seed, candidate.internal_dependency_names, candidate.internal_dependency_roots)
  ) {
    return "candidate_depends_on_seed";
  }
  return null;
}

function packageDependencyRelationPriority(
  relation: PackageDependencyRelation | null,
): number {
  switch (relation) {
    case "seed_depends_on_candidate":
      return 2;
    case "candidate_depends_on_seed":
      return 1;
    default:
      return 0;
  }
}

function packageDependencyFanoutRelevance(args: {
  query: string;
  candidatePath: string;
  candidateFacts: CodeSourceFacts;
  candidatePackageFacts: CodeSourcePackageFacts;
  floor: number;
}): number {
  if (isPassiveFanoutPath(args.candidatePath, args.candidateFacts)) return 0;
  const roleFacts = roleFactsFor(args.candidateFacts);
  const roles = new Set(roleFacts.file_roles);
  const sourceMatch = sourceFactsCodeMatch(args.query, args.candidateFacts);
  let score = 0;
  if (isPackageEntrypointPath(args.candidatePath, args.candidatePackageFacts)) {
    score = Math.max(score, 0.96);
  }
  if (hasAnyRole(roles, PACKAGE_DEPENDENCY_SUPPORT_ROLES)) {
    score = Math.max(score, 0.94);
  }
  if (sourceMatch.factTokenHits > 0 || sourceMatch.exactSymbol) {
    score = Math.max(score, sourceMatch.exactSymbol ? 0.96 : 0.92);
  }
  if (score < Math.max(args.floor, SUPPORT_CLUSTER_RELEVANCE_FLOOR)) return 0;
  return clamp01(score);
}

function samePackageFacts(
  left: CodeSourcePackageFacts,
  right: CodeSourcePackageFacts,
): boolean {
  return left.package_root !== null &&
    left.package_root === right.package_root;
}

function packageNameOrRootMatches(
  candidate: CodeSourcePackageFacts,
  names: readonly string[],
  roots: readonly string[],
): boolean {
  return (
    (candidate.package_name !== null && names.includes(candidate.package_name)) ||
    (candidate.package_root !== null && roots.includes(candidate.package_root))
  );
}

function isPackageEntrypointPath(
  sourcePath: string,
  packageFacts: CodeSourcePackageFacts,
): boolean {
  if (packageFacts.package_root === null) return false;
  const normalized = sourcePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const packageRoot = packageFacts.package_root;
  const relative = packageRoot === "."
    ? normalized
    : normalized.startsWith(`${packageRoot}/`)
    ? normalized.slice(packageRoot.length + 1)
    : normalized;
  return /^(?:src\/)?(?:index|main|mod|lib)\.(?:[cm]?[jt]sx?|rs|go|py)$/.test(relative) ||
    packageFacts.export_keys.length > 0 &&
      /^(?:src\/)?(?:index|main)\.(?:[cm]?[jt]sx?)$/.test(relative);
}

function roleFactsFor(facts: CodeSourceFacts): CodeSourceRoleFacts {
  return facts.role_facts ?? inferCodeRoleFacts(facts);
}

function seedHasRoleFamilyIdentity(roleFacts: CodeSourceRoleFacts): boolean {
  return roleFacts.workspace_family_keys.length > 0 ||
    roleFacts.module_family_keys.length > 0 ||
    roleFacts.path_pattern_keys.length > 0 ||
    roleFacts.package_root !== null;
}

function roleFamilyFanoutRoleStrength(roleFacts: CodeSourceRoleFacts): number {
  const roles = new Set(roleFacts.file_roles);
  if (hasAnyRole(roles, STRONG_ROLE_FAMILY_FANOUT_ROLES)) return 2;
  if (roleFacts.is_support_like) return 2;
  if (hasAnyRole(roles, WEAK_ROLE_FAMILY_FANOUT_ROLES)) return 1;
  return 0;
}

function hasAnyRole(
  roles: ReadonlySet<CodeSourceFileRole>,
  candidates: ReadonlySet<CodeSourceFileRole>,
): boolean {
  for (const role of candidates) {
    if (roles.has(role)) return true;
  }
  return false;
}

function sharedRoleFamilyKeys(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const rightSet = new Set(right);
  return left.filter((key) => rightSet.has(key));
}

function shouldSkipRoleFamilyFanoutCandidate(
  args: BuildCodeRankedEntriesArgs,
  path: string,
  facts: CodeSourceFacts,
): boolean {
  if (isGeneratedArtifactPath(path) && !allowsGeneratedArtifacts(args)) {
    return true;
  }
  if (isMeasurementOrToolingPath(path) && !allowsMeasurementOrTooling(args)) {
    const roleFacts = roleFactsFor(facts);
    return !hasAnyRole(
      new Set(roleFacts.file_roles),
      ROLE_FAMILY_TOOLING_BYPASS_ROLES,
    );
  }
  return false;
}

function supportConfigFanoutRelevance(args: {
  seedPath: string;
  candidatePath: string;
  floor: number;
}): number {
  let score = 0.88;
  if (isRootOrWorkspaceSupportConfigPath(args.candidatePath)) score = Math.max(score, 0.96);
  if (isTestRunnerSupportConfigPath(args.candidatePath)) score = Math.max(score, 0.93);
  if (ownerFanoutRelation(args.seedPath, args.candidatePath) !== null) {
    score = Math.max(score, 0.94);
  }
  if (score < Math.max(args.floor, SUPPORT_CLUSTER_RELEVANCE_FLOOR)) return 0;
  return clamp01(score);
}

function sharedSupportImportRelevance(args: {
  seedPath: string;
  candidatePath: string;
  facts: CodeSourceFacts;
  floor: number;
}): number {
  if (!isSharedSupportImportCandidate(args.seedPath, args.candidatePath, args.facts)) {
    return 0;
  }
  let score = 0.94;
  const pathTokens = sourcePathTokenSet(args.candidatePath.toLowerCase());
  if (hasAnyPathToken(pathTokens, ["config", "configs", "compile", "helper", "helpers"])) {
    score = 0.97;
  }
  if (score < Math.max(args.floor, SUPPORT_CLUSTER_RELEVANCE_FLOOR)) return 0;
  return clamp01(score);
}

function isSharedSupportImportCandidate(
  seedPath: string,
  candidatePath: string,
  facts: CodeSourceFacts,
): boolean {
  if (fanoutPathPatternKey(seedPath) === null) return false;
  if (!isOwnerFanoutSupportRole(candidatePath, facts)) return false;
  if (isPassiveFanoutPath(candidatePath, facts)) return false;
  const normalized = candidatePath.replace(/\\/g, "/").toLowerCase();
  const pathTokens = sourcePathTokenSet(normalized);
  const helperScoped =
    hasAnyPathToken(pathTokens, ["helper", "helpers"]) ||
    normalized.startsWith("helpers/") ||
    normalized.includes("/helpers/");
  if (!helperScoped) return false;
  return hasAnyPathToken(pathTokens, [
    "build",
    "compile",
    "config",
    "configs",
    "driver",
    "migration",
    "migrator",
    "session",
  ]);
}

function isOwnerFanoutSupportRole(
  sourcePath: string,
  facts: CodeSourceFacts,
): boolean {
  const normalized = sourcePath.replace(/\\/g, "/").toLowerCase();
  const basename = sourceBasename(normalized);
  const pathTokens = sourcePathTokenSet(normalized);
  const factTokens = sourcePathTokenSet(
    [
      facts.file_path,
      facts.file_purpose ?? "",
      ...facts.exported_symbols.map((symbol) => symbol.name),
    ].join(" "),
  );
  return (
    OWNER_FANOUT_SUPPORT_BASENAMES.has(basename) ||
    hasAnyPathToken(pathTokens, OWNER_FANOUT_SUPPORT_SEGMENTS) ||
    hasAnyPathToken(factTokens, OWNER_FANOUT_SUPPORT_FACT_TOKENS)
  );
}

function fanoutPathPatternKey(sourcePath: string): string | null {
  const segments = sourcePath
    .replace(/\\/g, "/")
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return null;
  const basename = stripSourceExtension(segments.at(-1) ?? "");
  const parent = segments.at(-2) ?? "";
  if (!OWNER_FANOUT_SUPPORT_BASENAMES.has(basename) && parent !== "helpers") {
    return null;
  }
  return `${parent}/${basename}`;
}

function sourceDirectoryKey(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function packageRootKey(sourcePath: string): string | null {
  const segments = sourcePath
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean);
  const markerIndex = segments.findIndex((segment) =>
    OWNER_FANOUT_PACKAGE_MARKERS.has(segment)
  );
  if (markerIndex >= 0 && segments[markerIndex + 1]) {
    return `${segments[markerIndex]}/${segments[markerIndex + 1]}`;
  }
  if (segments[0] === "src" && segments[1]) return `src/${segments[1]}`;
  if (segments[0] === "internal" && segments[1]) return `internal/${segments[1]}`;
  return null;
}

function isSupportConfigPath(sourcePath: string): boolean {
  const normalized = sourcePath.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  return SUPPORT_CONFIG_PATH_PATTERN.test(normalized);
}

function isRootOrWorkspaceSupportConfigPath(sourcePath: string): boolean {
  const normalized = sourcePath.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 1 && isSupportConfigPath(normalized)) return true;
  const first = segments[0] ?? "";
  return (
    ROOT_SUPPORT_CONFIG_SEGMENTS.has(first) &&
    isTestRunnerSupportConfigPath(normalized)
  );
}

function isTestRunnerSupportConfigPath(sourcePath: string): boolean {
  const basename = sourcePath
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase() ?? "";
  return /^(?:vitest|jest|playwright|cypress)(?:\.workspace)?\.config\./.test(
    basename,
  );
}

function stripSourceExtension(path: string): string {
  return path.replace(/\.[^.]+$/, "");
}

function isPassiveFanoutPath(
  sourcePath: string,
  facts: CodeSourceFacts,
): boolean {
  return PASSIVE_NEIGHBOR_PATTERN.test(
    [
      sourcePath,
      facts.file_purpose ?? "",
      ...facts.exported_symbols.map((symbol) => symbol.name),
    ].join(" ").toLowerCase(),
  );
}

const OWNER_FANOUT_PACKAGE_MARKERS = new Set([
  "apps",
  "crates",
  "libs",
  "packages",
  "pkg",
]);

const OWNER_FANOUT_SUPPORT_BASENAMES = new Set([
  "adapter",
  "build",
  "config",
  "configs",
  "db",
  "driver",
  "index",
  "migration",
  "migrations",
  "migrator",
  "schema",
  "session",
  "store",
]);

const OWNER_FANOUT_SUPPORT_SEGMENTS = [
  "adapters",
  "adapter",
  "config",
  "configs",
  "driver",
  "drivers",
  "helper",
  "helpers",
  "migration",
  "migrations",
  "schema",
  "session",
  "store",
] as const;

const OWNER_FANOUT_SUPPORT_FACT_TOKENS = [
  "adapter",
  "build",
  "config",
  "driver",
  "helper",
  "migration",
  "schema",
  "session",
  "store",
] as const;

const STRONG_ROLE_FAMILY_FANOUT_ROLES = new Set<CodeSourceFileRole>([
  "barrel",
  "build",
  "config",
  "entrypoint",
  "helper",
  "parser_formatter",
  "persistence_driver",
  "schema_type",
  "test_support",
]);

const WEAK_ROLE_FAMILY_FANOUT_ROLES = new Set<CodeSourceFileRole>([
  "implementation",
]);

const ROLE_FAMILY_TOOLING_BYPASS_ROLES = new Set<CodeSourceFileRole>([
  "build",
  "config",
  "test_support",
]);

const PACKAGE_DEPENDENCY_SUPPORT_ROLES = new Set<CodeSourceFileRole>([
  "barrel",
  "build",
  "config",
  "entrypoint",
  "schema_type",
]);

const SUPPORT_CONFIG_PATH_PATTERN =
  /(?:^|\/)(?:vitest|vite|jest|playwright|cypress|eslint|prettier|tsup|tsdown|rollup|webpack|tailwind|docusaurus|astro|next|nuxt|svelte|babel|swc|typedoc|commitlint)(?:\.workspace)?\.config\.(?:[cm]?[jt]sx?|mjs|cjs)$/;

const ROOT_SUPPORT_CONFIG_SEGMENTS = new Set([
  "e2e",
  "e2e-tests",
  "integration",
  "integration-tests",
  "test",
  "tests",
]);

function isStrongFacilitySupportSeed(file: FileCandidate): boolean {
  return file.parent_score >= 0.55 ||
    file.primary.anchor_priority > 0 ||
    file.primary.lexical_priority > 0 ||
    file.file_signal_count > 1;
}

function directResultLimit(maxResults: number, supportCandidateCount = 0): number {
  if (supportCandidateCount > 0 && maxResults > 2) {
    const supportReserve = Math.min(
      supportCandidateCount,
      Math.max(1, Math.floor(maxResults * 0.1)),
      maxResults - 1,
    );
    return Math.max(1, maxResults - supportReserve);
  }
  if (maxResults <= DEFAULT_MAX_RESULTS) return maxResults;
  return Math.max(1, Math.ceil(maxResults * 0.55));
}

function bundleAwareDirectResultLimit(
  maxResults: number,
  supportCandidateCount = 0,
): number {
  if (supportCandidateCount <= 0 || maxResults <= 2) {
    return directResultLimit(maxResults, supportCandidateCount);
  }
  const supportReserve = Math.min(supportCandidateCount, 2, maxResults - 1);
  return Math.max(1, maxResults - supportReserve);
}

function tailRecallDirectResultLimit(
  maxResults: number,
  supportCandidateCount = 0,
): number {
    const supportReserve = Math.min(
      supportCandidateCount,
      Math.ceil(maxResults * tailRecallReserveFraction()),
      maxResults - 1,
    );
  return Math.max(1, maxResults - supportReserve);
}

function buildSameFamilySupportCandidates(
  args: BuildCodeRankedEntriesArgs,
  primaryFile: FileCandidate,
  floor: number,
  eligibleFamilySupportPaths: ReadonlySet<string>,
): SupportClusterCandidate[] {
  const primaryFamily = sourceFamilyKey(primaryFile.source_path);
  const primaryFacts = getCodeSource(args.db, primaryFile.source_path)?.facts;
  const primaryEvidence = primaryFacts
    ? scoreCodeFamilyEvidence({
        query: args.query,
        candidate: primaryFacts,
      })
    : undefined;

  const out: SupportClusterCandidate[] = [];
  for (const source of listCodeSources(args.db)) {
    const path = source.facts.file_path;
    if (path === primaryFile.source_path) continue;
    if (shouldSkipCodePath(args, path)) continue;
    const familyEvidence = scoreCodeFamilyEvidence({
      query: args.query,
      primary: primaryFacts,
      candidate: source.facts,
    });
    const samePathFamily = primaryFamily !== null && sourceFamilyKey(path) === primaryFamily;
    if (!samePathFamily && !eligibleFamilySupportPaths.has(path)) continue;
    const familyCentered =
      familyEvidence.support_admissible &&
      (primaryEvidence?.support_admissible ?? false) &&
      codeFamilyEvidenceCentersOnPrimary(familyEvidence);
    if (!samePathFamily && !familyCentered) continue;
    const reason = familyEvidence.support_admissible
      ? "code_family_evidence"
      : "same_family_substrate";
    const relevance = supportRelevance({
      facts: source.facts,
      path,
      reason,
      floor,
      familyEvidence,
    });
    if (relevance <= 0) continue;
    out.push({
      source_path: path,
      seed_source_path: primaryFile.source_path,
      seed_parent_score: primaryFile.parent_score,
      distance: 1,
      reason,
      relevance,
      ...(familyEvidence.support_admissible
        ? { family_evidence: familyEvidence }
        : {}),
    });
  }
  return out;
}

function codeFamilyEvidenceCentersOnPrimary(
  evidence: CodeFamilyEvidence,
): boolean {
  return (
    evidence.reasons.includes("primary_family") ||
    evidence.reasons.includes("source_profile_companion") ||
    evidence.reasons.includes("import_workflow_companion")
  );
}

function annotateDirectSupportEntries(
  db: Db,
  directEntries: CodeRankedEntry[],
  primaryFile: FileCandidate | undefined,
  supportCandidates: SupportClusterCandidate[],
): CodeRankedEntry[] {
  if (!primaryFile) return directEntries;
  const supportByPath = new Map(
    supportCandidates.map((candidate) => [candidate.source_path, candidate]),
  );
  const out: CodeRankedEntry[] = [];
  const seenSupportPaths = new Set<string>();
  let primaryAnnotated = false;
  for (const entry of directEntries) {
    if (entry.source_path === primaryFile.source_path) {
      if (primaryAnnotated) {
        out.push(entry);
      } else {
        out.push(
          withSupportCluster(entry, {
            role: "primary",
            seed_source_path: primaryFile.source_path,
            distance: 0,
          reason: "primary_winner",
          relevance: 1,
        }),
        );
        primaryAnnotated = true;
      }
      continue;
    }
    const support = supportByPath.get(entry.source_path);
    if (!support) {
      out.push(entry);
      continue;
    }
    if (seenSupportPaths.has(entry.source_path)) continue;
    seenSupportPaths.add(entry.source_path);
    out.push(projectDirectSupportEntry(db, entry, support));
  }
  return out;
}

function projectDirectSupportEntry(
  db: Db,
  entry: CodeRankedEntry,
  support: SupportClusterCandidate,
): CodeRankedEntry {
  const supportCluster: CodeSupportCluster = {
    role: "support",
    seed_source_path: support.seed_source_path,
    distance: support.distance,
    reason: support.reason,
    relevance: support.relevance,
    ...(support.family_evidence
      ? { family_evidence: support.family_evidence }
      : {}),
    ...(support.facility_evidence
      ? { facility_evidence: support.facility_evidence }
      : {}),
  };
  const retrievalConfidence = codeRetrievalConfidenceForSupport(
    support,
    entry.score,
    entry.retrieval_confidence,
  );
  const compact = compactSupportChunk(db, entry.source_path, entry.tokens);
  if (!compact) {
    return withSupportCluster(
      { ...entry, retrieval_confidence: retrievalConfidence },
      supportCluster,
      true,
    );
  }
  return toRankedEntry(compact, entry.score, {
    import_traversed: true,
    support_cluster: supportCluster,
    retrieval_confidence: retrievalConfidence,
  });
}

function compactSupportChunk(
  db: Db,
  source_path: string,
  currentTokens: number,
): StoredCodeChunk | null {
  const chunks = listCodeChunksForSource(db, source_path);
  const orientation = chunks.find((chunk) => chunk.code_role === "orientation");
  if (orientation && orientation.token_count < currentTokens) return orientation;
  return null;
}

function supportProjectionChunk(
  db: Db,
  source_path: string,
): StoredCodeChunk | null {
  const chunks = listCodeChunksForSource(db, source_path);
  const primary =
    chunks.find((chunk) => chunk.code_role !== "orientation") ?? chunks[0] ?? null;
  if (!primary) return null;
  return compactSupportChunk(db, source_path, primary.token_count) ?? primary;
}

function withSupportCluster(
  entry: CodeRankedEntry,
  support_cluster: CodeSupportCluster,
  import_traversed = entry.import_traversed,
): CodeRankedEntry {
  return {
    ...entry,
    ...(import_traversed ? { import_traversed: true } : {}),
    support_cluster,
    contexttrail: codeContextTrail(entry, { import_traversed, support_cluster }),
  };
}

function admitSupportClusterCandidates(
  args: BuildCodeRankedEntriesArgs,
  candidates: SupportClusterCandidate[],
  directEntries: CodeRankedEntry[],
): SupportClusterCandidate[] {
  const maxSupportResults =
    args.import_traversed_max_results ??
      (tailRecallExpansionPromoted() &&
          (args.max_results ?? DEFAULT_MAX_RESULTS) > DEFAULT_MAX_RESULTS
        ? expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS)
        : DEFAULT_IMPORT_TRAVERSED_MAX_RESULTS);
  const maxSupportTokens =
    args.import_traversed_max_tokens ??
      (tailRecallExpansionPromoted() &&
          (args.max_results ?? DEFAULT_MAX_RESULTS) > DEFAULT_MAX_RESULTS
        ? expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS)
        : DEFAULT_IMPORT_TRAVERSED_MAX_TOKENS);
  if (maxSupportResults <= 0 || maxSupportTokens <= 0) return [];

  const directTokensByPath = new Map(
    directEntries.map((entry) => [
      entry.source_path,
      projectedSupportTokenCount(args.db, entry.source_path, entry.tokens),
    ]),
  );
  const out: SupportClusterCandidate[] = [];
  let usedTokens = 0;

  if (ownerFanoutPromoted() && (args.max_results ?? DEFAULT_MAX_RESULTS) > DEFAULT_MAX_RESULTS) {
    usedTokens = admitSupportCandidatesInto({
      args,
      candidates: candidates.filter((candidate) =>
        candidate.reason === "support_config"
      ),
      directTokensByPath,
      out,
      maxResults: SUPPORT_CONFIG_FANOUT_LIMIT,
      maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      usedTokens,
      skipDirectEntries: true,
    });

    usedTokens = admitSupportCandidatesInto({
      args,
      candidates: candidates.filter((candidate) =>
        candidate.reason === "shared_support_import"
      ),
      directTokensByPath,
      out,
      maxResults: SUPPORT_CONFIG_FANOUT_LIMIT + SHARED_SUPPORT_IMPORT_FANOUT_LIMIT,
      maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      usedTokens,
      skipDirectEntries: true,
    });

  }

  if (ownerFanoutPromoted() && (args.max_results ?? DEFAULT_MAX_RESULTS) > DEFAULT_MAX_RESULTS) {
    usedTokens = admitSupportCandidatesInto({
      args,
      candidates: candidates.filter((candidate) =>
        candidate.reason === "owner_fanout" &&
        candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE
      ),
      directTokensByPath,
      out,
      maxResults: expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      usedTokens,
      skipDirectEntries: true,
    });

    if (packageDependencyFanoutPromoted()) {
      usedTokens = admitSupportCandidatesInto({
        args,
        candidates: candidates.filter((candidate) =>
          candidate.reason === "package_dependency_fanout" &&
          candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE
        ),
        directTokensByPath,
        out,
        maxResults: Math.min(
          expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
          SUPPORT_CONFIG_FANOUT_LIMIT +
            SHARED_SUPPORT_IMPORT_FANOUT_LIMIT +
            PACKAGE_DEPENDENCY_FANOUT_LIMIT,
        ),
        maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
        usedTokens,
        skipDirectEntries: true,
      });
    }

    if (symbolReferenceFanoutPromoted()) {
      usedTokens = admitSupportCandidatesInto({
        args,
        candidates: candidates.filter((candidate) =>
          candidate.reason === "symbol_reference_fanout" &&
          candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE
        ),
        directTokensByPath,
        out,
        maxResults: Math.min(
          expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
          SUPPORT_CONFIG_FANOUT_LIMIT +
            SHARED_SUPPORT_IMPORT_FANOUT_LIMIT +
            SYMBOL_REFERENCE_FANOUT_LIMIT,
        ),
        maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
        usedTokens,
        skipDirectEntries: true,
      });
    }

    if (cochangeFanoutPromoted()) {
      usedTokens = admitSupportCandidatesInto({
        args,
        candidates: candidates.filter((candidate) =>
          candidate.reason === "cochange_fanout" &&
          candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE
        ),
        directTokensByPath,
        out,
        maxResults: Math.min(
          expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
          SUPPORT_CONFIG_FANOUT_LIMIT +
            SHARED_SUPPORT_IMPORT_FANOUT_LIMIT +
            COCHANGE_FANOUT_LIMIT,
        ),
        maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
        usedTokens,
        skipDirectEntries: true,
      });
    }

    if (roleFamilyFanoutPromoted()) {
      usedTokens = admitSupportCandidatesInto({
        args,
        candidates: candidates.filter((candidate) =>
          candidate.reason === "role_family_fanout" &&
          candidate.relevance >= OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE
        ),
        directTokensByPath,
        out,
        maxResults: Math.min(
          expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
          SUPPORT_CONFIG_FANOUT_LIMIT +
            SHARED_SUPPORT_IMPORT_FANOUT_LIMIT +
            ROLE_FAMILY_FANOUT_LIMIT,
        ),
        maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
        usedTokens,
        skipDirectEntries: true,
      });
    }
  }

  usedTokens = admitSupportCandidatesInto({
    args,
    candidates: candidates.filter((candidate) =>
      candidate.reason !== "support_substrate_bundle" &&
      candidate.reason !== "owner_fanout" &&
      candidate.reason !== "package_dependency_fanout" &&
      candidate.reason !== "role_family_fanout" &&
      candidate.reason !== "symbol_reference_fanout" &&
      candidate.reason !== "cochange_fanout" &&
      candidate.reason !== "support_config" &&
      candidate.reason !== "shared_support_import"
    ),
    directTokensByPath,
    out,
    maxResults: maxSupportResults,
    maxTokens: maxSupportTokens,
    usedTokens,
  });

  if (supportSubstrateBundlePromoted() && (args.max_results ?? DEFAULT_MAX_RESULTS) > DEFAULT_MAX_RESULTS) {
    usedTokens = admitSupportCandidatesInto({
      args,
      candidates: candidates.filter((candidate) =>
        candidate.reason === "support_substrate_bundle"
      ),
      directTokensByPath,
      out,
      maxResults: expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      usedTokens,
      skipDirectEntries: true,
    });
  }

  if (ownerFanoutPromoted() && (args.max_results ?? DEFAULT_MAX_RESULTS) > DEFAULT_MAX_RESULTS) {
    usedTokens = admitSupportCandidatesInto({
      args,
      candidates: candidates.filter((candidate) =>
        candidate.reason === "owner_fanout" &&
        candidate.relevance < OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE
      ),
      directTokensByPath,
      out,
      maxResults: expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      usedTokens,
      skipDirectEntries: true,
    });
  }

  if (
    ownerFanoutPromoted() &&
    roleFamilyFanoutPromoted() &&
    (args.max_results ?? DEFAULT_MAX_RESULTS) > DEFAULT_MAX_RESULTS
  ) {
    admitSupportCandidatesInto({
      args,
      candidates: candidates.filter((candidate) =>
        candidate.reason === "role_family_fanout" &&
        candidate.relevance < OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE
      ),
      directTokensByPath,
      out,
      maxResults: expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      usedTokens,
      skipDirectEntries: true,
    });
  }

  if (
    ownerFanoutPromoted() &&
    symbolReferenceFanoutPromoted() &&
    (args.max_results ?? DEFAULT_MAX_RESULTS) > DEFAULT_MAX_RESULTS
  ) {
    admitSupportCandidatesInto({
      args,
      candidates: candidates.filter((candidate) =>
        candidate.reason === "symbol_reference_fanout" &&
        candidate.relevance < OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE
      ),
      directTokensByPath,
      out,
      maxResults: expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      usedTokens,
      skipDirectEntries: true,
    });
  }

  if (
    ownerFanoutPromoted() &&
    cochangeFanoutPromoted() &&
    (args.max_results ?? DEFAULT_MAX_RESULTS) > DEFAULT_MAX_RESULTS
  ) {
    admitSupportCandidatesInto({
      args,
      candidates: candidates.filter((candidate) =>
        candidate.reason === "cochange_fanout" &&
        candidate.relevance < OWNER_FANOUT_HIGH_CONFIDENCE_RELEVANCE
      ),
      directTokensByPath,
      out,
      maxResults: expandedTailSupportLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      maxTokens: expandedTailSupportTokenLimit(args.max_results ?? DEFAULT_MAX_RESULTS),
      usedTokens,
      skipDirectEntries: true,
    });
  }

  return out;
}

function admitSupportCandidatesInto(args: {
  args: BuildCodeRankedEntriesArgs;
  candidates: SupportClusterCandidate[];
  directTokensByPath: ReadonlyMap<string, number>;
  out: SupportClusterCandidate[];
  maxResults: number;
  maxTokens: number;
  usedTokens: number;
  skipDirectEntries?: boolean;
}): number {
  let usedTokens = args.usedTokens;
  const seen = new Set(args.out.map((candidate) => candidate.source_path));
  for (const candidate of args.candidates) {
    if (args.out.length >= args.maxResults) break;
    if (seen.has(candidate.source_path)) continue;
    if (args.skipDirectEntries && args.directTokensByPath.has(candidate.source_path)) {
      continue;
    }
    const tokens = args.directTokensByPath.get(candidate.source_path) ??
      supportCandidateTokenCount(args.args.db, candidate.source_path);
    if (tokens === undefined) continue;
    if (usedTokens + tokens > args.maxTokens) continue;
    args.out.push(candidate);
    seen.add(candidate.source_path);
    usedTokens += tokens;
  }
  return usedTokens;
}

function expandedTailSupportLimit(maxResults: number): number {
  return Math.max(
    DEFAULT_IMPORT_TRAVERSED_MAX_RESULTS,
    Math.min(maxResults - 1, Math.ceil(maxResults * tailRecallReserveFraction())),
  );
}

function expandedTailSupportTokenLimit(maxResults: number): number {
  return Math.max(
    DEFAULT_IMPORT_TRAVERSED_MAX_TOKENS,
    Math.ceil(maxResults * 220),
  );
}

function tailRecallReserveFraction(): number {
  const raw = process.env.RETRIEVAL_CODE_LANE_TAIL_RECALL_RESERVE_FRACTION;
  if (raw === undefined) return DEFAULT_TAIL_RECALL_RESERVE_FRACTION;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TAIL_RECALL_RESERVE_FRACTION;
  return Math.min(0.8, Math.max(0.05, parsed));
}

function projectedSupportTokenCount(
  db: Db,
  source_path: string,
  currentTokens: number,
): number {
  return compactSupportChunk(db, source_path, currentTokens)?.token_count ?? currentTokens;
}

function supportCandidateTokenCount(
  db: Db,
  source_path: string,
): number | undefined {
  return supportProjectionChunk(db, source_path)?.token_count;
}

function materializeImportEntries(
  args: BuildCodeRankedEntriesArgs,
  directEntries: CodeRankedEntry[],
  supportCandidates: SupportClusterCandidate[],
  floor: number,
  maxResults: number,
): CodeRankedEntry[] {
  if (directEntries.length >= maxResults || supportCandidates.length === 0) {
    return [];
  }

  const directPaths = new Set(directEntries.map((entry) => entry.source_path));
  const inheritedFraction =
    args.import_inherited_score_fraction ?? IMPORT_INHERITED_SCORE_FRACTION;
  const maxTraversedResults =
    args.import_traversed_max_results ??
      (tailRecallExpansionPromoted() && maxResults > DEFAULT_MAX_RESULTS
        ? expandedTailSupportLimit(maxResults)
        : DEFAULT_IMPORT_TRAVERSED_MAX_RESULTS);
  const maxTraversedTokens =
    args.import_traversed_max_tokens ??
      (tailRecallExpansionPromoted() && maxResults > DEFAULT_MAX_RESULTS
        ? expandedTailSupportTokenLimit(maxResults)
        : DEFAULT_IMPORT_TRAVERSED_MAX_TOKENS);

  const candidates: Array<
    CodeRankedEntry & { distance: number; relevance: number; support_order: number }
  > = [];
  for (const [supportOrder, support] of supportCandidates.entries()) {
    if (directPaths.has(support.source_path)) {
      continue;
    }
    const file = buildTraversedSupportFileCandidate(args.db, support.source_path);
    if (!file) continue;
    const score = clamp01(
      Math.max(
        floor,
        support.seed_parent_score * inheritedFraction * support.relevance / Math.max(1, support.distance),
      ),
    );
    const supportCluster: CodeSupportCluster = {
      role: "support",
      seed_source_path: support.seed_source_path,
      distance: support.distance,
      reason: support.reason,
      relevance: support.relevance,
      ...(support.family_evidence
        ? { family_evidence: support.family_evidence }
        : {}),
      ...(support.facility_evidence
        ? { facility_evidence: support.facility_evidence }
        : {}),
    };
    candidates.push({
      ...toRankedEntry(file.primary.chunk, score, {
        import_traversed: true,
        support_cluster: supportCluster,
        retrieval_confidence: codeRetrievalConfidenceForSupport(support, score),
      }),
      distance: support.distance,
      relevance: support.relevance,
      support_order: supportOrder,
    });
  }

  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.support_order - b.support_order ||
      b.relevance - a.relevance ||
      a.tokens - b.tokens ||
      a.id.localeCompare(b.id),
  );

  const out: CodeRankedEntry[] = [];
  let usedTokens = 0;
  for (const candidate of candidates) {
    if (out.length >= maxTraversedResults) break;
    if (directEntries.length + out.length >= maxResults) break;
    if (usedTokens + candidate.tokens > maxTraversedTokens) continue;
    out.push(candidate);
    usedTokens += candidate.tokens;
  }
  return out;
}

function buildTraversedSupportFileCandidate(
  db: Db,
  source_path: string,
): FileCandidate | null {
  const primary = supportProjectionChunk(db, source_path);
  if (!primary) return null;
  return {
    source_path,
    parent_score: 0,
    primary: {
      chunk: primary,
      score: 0,
      anchor_priority: 0,
      lexical_priority: 0,
      path_priority: 0,
      channel: "chunk_fts",
      channel_rank: 1,
    },
    orientation: undefined,
    file_rrf_score: 0,
    file_signal_count: 1,
    source_fact_coverage: 0,
  };
}

function orderSupportClusterEntries(
  args: BuildCodeRankedEntriesArgs,
  primaryFile: FileCandidate | undefined,
  directEntries: CodeRankedEntry[],
  importEntries: CodeRankedEntry[],
): CodeRankedEntry[] {
  if (!primaryFile) return [...directEntries, ...importEntries];

  const primary: CodeRankedEntry[] = [];
  const primaryCompanions: CodeRankedEntry[] = [];
  const supports: CodeRankedEntry[] = [];
  const rest: CodeRankedEntry[] = [];
  const seen = new Set<string>();

  for (const entry of [...directEntries, ...importEntries]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (entry.support_cluster?.role === "primary") {
      primary.push(entry);
    } else if (entry.support_cluster?.role === "support") {
      supports.push(entry);
    } else if (entry.source_path === primaryFile.source_path) {
      primaryCompanions.push(entry);
    } else {
      rest.push(entry);
    }
  }

  if (supports.length === 0) return [...directEntries, ...importEntries];

  supports.sort(compareSupportEntryForCluster);
  const firstSlateSupports = supports.filter(
    (entry) =>
      entry.support_cluster?.reason !== "support_substrate_bundle" &&
      entry.support_cluster?.reason !== "owner_fanout" &&
      entry.support_cluster?.reason !== "package_dependency_fanout" &&
      entry.support_cluster?.reason !== "role_family_fanout" &&
      entry.support_cluster?.reason !== "symbol_reference_fanout" &&
      entry.support_cluster?.reason !== "cochange_fanout" &&
      entry.support_cluster?.reason !== "support_config" &&
      entry.support_cluster?.reason !== "shared_support_import",
  );
  const sharedSupportImports = supports.filter(
    (entry) => entry.support_cluster?.reason === "shared_support_import",
  );
  const supportConfigSupports = supports.filter(
    (entry) => entry.support_cluster?.reason === "support_config",
  );
  const fanoutSupports = supports.filter(
    (entry) => entry.support_cluster?.reason === "owner_fanout",
  );
  const packageDependencySupports = supports.filter(
    (entry) => entry.support_cluster?.reason === "package_dependency_fanout",
  );
  const roleFamilySupports = supports.filter(
    (entry) => entry.support_cluster?.reason === "role_family_fanout",
  );
  const symbolReferenceSupports = supports.filter(
    (entry) => entry.support_cluster?.reason === "symbol_reference_fanout",
  );
  const cochangeSupports = supports.filter(
    (entry) => entry.support_cluster?.reason === "cochange_fanout",
  );
  const substrateSupports = supports.filter(
    (entry) => entry.support_cluster?.reason === "support_substrate_bundle",
  );
  const [bestSupport, ...remainingSupports] = firstSlateSupports;
  const activeRest = rest
    .filter((entry) => !isPassiveCodeEntry(entry))
    .sort(compareActiveRestEntry);
  const passiveRest = rest.filter(isPassiveCodeEntry);
  const identityCompanion = pickNamedComponentCompanion(args, [
    ...remainingSupports,
    ...activeRest,
  ]);
  const remainingSupportsWithoutIdentity = removeEntry(
    remainingSupports,
    identityCompanion,
  );
  const activeRestWithoutIdentity = removeEntry(
    activeRest,
    identityCompanion,
  );
  const persistenceCompanion = pickPersistenceCompanion(args, [
    ...remainingSupportsWithoutIdentity,
    ...activeRestWithoutIdentity,
  ]);
  const remainingSupportsWithoutPersistence = removeEntry(
    remainingSupportsWithoutIdentity,
    persistenceCompanion,
  );
  const activeRestWithoutPersistence = removeEntry(
    activeRestWithoutIdentity,
    persistenceCompanion,
  );
  const carrierCompanion = pickCarrierCompanion(args, [
    ...remainingSupportsWithoutPersistence,
    ...activeRestWithoutPersistence,
  ]);
  const remainingSupportsWithoutCarrier = removeEntry(
    remainingSupportsWithoutPersistence,
    carrierCompanion,
  );
  const activeRestWithoutCarrier = removeEntry(
    activeRestWithoutPersistence,
    carrierCompanion,
  );
  const [bestActiveRest, ...remainingActiveRest] = activeRestWithoutCarrier;
  return [
    ...primary,
    ...(bestSupport ? [bestSupport] : []),
    ...(identityCompanion ? [identityCompanion] : []),
    ...(persistenceCompanion ? [persistenceCompanion] : []),
    ...(carrierCompanion ? [carrierCompanion] : []),
    ...(bestActiveRest ? [bestActiveRest] : []),
    ...remainingSupportsWithoutCarrier,
    ...primaryCompanions,
    ...remainingActiveRest,
    ...passiveRest,
    ...sharedSupportImports,
    ...supportConfigSupports,
    ...fanoutSupports,
    ...symbolReferenceSupports,
    ...cochangeSupports,
    ...packageDependencySupports,
    ...roleFamilySupports,
    ...substrateSupports,
  ];
}

function pickNamedComponentCompanion(
  args: BuildCodeRankedEntriesArgs,
  entries: CodeRankedEntry[],
): CodeRankedEntry | undefined {
  return entries
    .filter((entry) => isNamedComponentCompanionCandidate(args, entry))
    .sort((a, b) => compareNamedComponentCompanion(args, a, b))[0];
}

function isNamedComponentCompanionCandidate(
  args: BuildCodeRankedEntriesArgs,
  entry: CodeRankedEntry,
): boolean {
  if (isPassiveCodeEntry(entry)) return false;
  if (isExtractedFieldIdentityWiringQuery(args.query, entry.source_path)) {
    return false;
  }
  return basenameQueryIdentityScore(args, entry.source_path) >= 2 &&
    queryNamesBasenameIdentity(args.query, entry.source_path);
}

function compareNamedComponentCompanion(
  args: BuildCodeRankedEntriesArgs,
  a: CodeRankedEntry,
  b: CodeRankedEntry,
): number {
  const aScore = namedComponentCompanionScore(args, a);
  const bScore = namedComponentCompanionScore(args, b);
  if (bScore !== aScore) return bScore - aScore;
  if (b.score !== a.score) return b.score - a.score;
  if (a.tokens !== b.tokens) return a.tokens - b.tokens;
  return a.source_path.localeCompare(b.source_path);
}

function namedComponentCompanionScore(
  args: BuildCodeRankedEntriesArgs,
  entry: CodeRankedEntry,
): number {
  let score = basenameQueryIdentityScore(args, entry.source_path) * 10;
  score += directPathTokenMatches(args, entry) * 2;
  score += directIdentityTokenMatches(args, entry);
  if (isDurableStatePath(entry.source_path)) score += 3;
  if (entry.support_cluster?.role === "support") score += 1;
  return score;
}

function pickPersistenceCompanion(
  args: BuildCodeRankedEntriesArgs,
  entries: CodeRankedEntry[],
): CodeRankedEntry | undefined {
  const hasFamilyBackedPersistence = entries.some((entry) =>
    entry.support_cluster?.family_evidence?.reasons.includes(
      "persistence_companion",
    ),
  );
  if (!hasFamilyBackedPersistence) return undefined;
  return entries
    .filter((entry) => isPersistenceCompanionCandidate(args, entry))
    .sort((a, b) => comparePersistenceCompanion(args, a, b))[0];
}

function isPersistenceCompanionCandidate(
  args: BuildCodeRankedEntriesArgs,
  entry: CodeRankedEntry,
): boolean {
  if (isPassiveCodeEntry(entry)) return false;
  const evidence = entry.support_cluster?.family_evidence;
  const familyBacked = evidence?.reasons.includes("persistence_companion") ?? false;
  if (!familyBacked && !isDurableStatePath(entry.source_path)) return false;
  if (directIdentityTokenMatches(args, entry) === 0) return false;
  return directPathTokenMatches(args, entry) > 0 ||
    isDurableStatePath(entry.source_path);
}

function comparePersistenceCompanion(
  args: BuildCodeRankedEntriesArgs,
  a: CodeRankedEntry,
  b: CodeRankedEntry,
): number {
  const aScore = persistenceCompanionScore(args, a);
  const bScore = persistenceCompanionScore(args, b);
  if (bScore !== aScore) return bScore - aScore;
  if (b.score !== a.score) return b.score - a.score;
  if (a.tokens !== b.tokens) return a.tokens - b.tokens;
  return a.source_path.localeCompare(b.source_path);
}

function persistenceCompanionScore(
  args: BuildCodeRankedEntriesArgs,
  entry: CodeRankedEntry,
): number {
  const facts = getCodeSource(args.db, entry.source_path)?.facts;
  const evidence = entry.support_cluster?.family_evidence;
  const roles = new Set(evidence?.roles ?? []);
  const directMatches = directIdentityTokenMatches(args, entry);
  const directPathMatches = directPathTokenMatches(args, entry);
  const basenameScore = basenameQueryIdentityScore(args, entry.source_path);

  let score = 0;
  score += basenameScore * 6;
  score += directPathMatches * 8;
  score += directMatches * 2;
  if (roles.has("schema") || roles.has("database")) score += 2;
  if (roles.has("store") || roles.has("index") || roles.has("type")) score += 1;
  if (isDurableStatePath(facts?.file_path ?? entry.source_path)) score += 1;
  return score;
}

function directPathTokenMatches(
  args: BuildCodeRankedEntriesArgs,
  entry: CodeRankedEntry,
): number {
  const directTokens = directQueryTokens(args, entry);
  if (directTokens.length === 0) return 0;
  const facts = getCodeSource(args.db, entry.source_path)?.facts;
  const pathTokens = tokensFromCodeIdentity(facts?.file_path ?? entry.source_path);
  return directTokens.filter((token) => pathTokens.has(token)).length;
}

function directIdentityTokenMatches(
  args: BuildCodeRankedEntriesArgs,
  entry: CodeRankedEntry,
): number {
  const directTokens = directQueryTokens(args, entry);
  if (directTokens.length === 0) return 0;
  const facts = getCodeSource(args.db, entry.source_path)?.facts;
  const identityTokens = codeIdentityTokens(facts, entry.source_path);
  return directTokens.filter((token) => identityTokens.has(token)).length;
}

function directQueryTokens(
  args: BuildCodeRankedEntriesArgs,
  entry: CodeRankedEntry,
): string[] {
  const evidenceTokens = entry.support_cluster?.family_evidence?.direct_query_tokens;
  if (evidenceTokens && evidenceTokens.length > 0) return evidenceTokens;
  return [...tokensFromCodeIdentity(args.query)];
}

function basenameQueryIdentityScore(
  args: BuildCodeRankedEntriesArgs,
  sourcePath: string,
): number {
  const queryTokens = tokensFromCodeIdentity(args.query);
  const basenameTokens = basenameIdentityTokens(sourcePath);
  if (basenameTokens.length === 0) return 0;
  const matched = basenameTokens.filter((token) => queryTokens.has(token)).length;
  const exactIdentity = matched === basenameTokens.length ? 1 : 0;
  return exactIdentity + matched / basenameTokens.length;
}

function basenameIdentityTokens(sourcePath: string): string[] {
  const basename = sourceBasenameWithoutExtension(sourcePath);
  if (!basename) return [];
  return [...tokensFromCodeIdentity(basename)];
}

function queryNamesBasenameIdentity(query: string, sourcePath: string): boolean {
  const basename = sourceBasenameWithoutExtension(sourcePath);
  const basenameTokens = basenameIdentityTokens(sourcePath);
  if (!basename || basenameTokens.length === 0) return false;
  const queryTokens = tokensFromCodeIdentity(query);
  if (!basenameTokens.every((token) => queryTokens.has(token))) return false;

  if (basenameTokens.length === 1) {
    const token = basenameTokens[0]!;
    return /\d/.test(token) || isDurableStatePath(sourcePath);
  }

  const normalizedQuery = query.toLowerCase();
  const queryAtoms = new Set(
    normalizedQuery
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
  const normalizedBasename = basename.toLowerCase();
  const compactBasename = normalizedBasename.replace(/[^a-z0-9]+/g, "");
  const underscoreBasename = normalizedBasename.replace(/[^a-z0-9]+/g, "_");
  const hyphenBasename = normalizedBasename.replace(/[^a-z0-9]+/g, "-");
  return normalizedQuery.includes(underscoreBasename) ||
    normalizedQuery.includes(hyphenBasename) ||
    queryAtoms.has(compactBasename);
}

function sourceBasenameWithoutExtension(sourcePath: string): string | undefined {
  return sourcePath
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "");
}

function isExtractedFieldIdentityWiringQuery(
  query: string,
  sourcePath: string,
): boolean {
  if (!/\b(?:field|flag|import[-_ ]?time|schema|wir(?:e|ed|ing))\b/i.test(query)) {
    return false;
  }
  const basenameTokens = new Set(basenameIdentityTokens(sourcePath));
  return EXTRACTED_FIELD_IDENTITY_TOKENS.some((token) =>
    basenameTokens.has(token),
  );
}

const EXTRACTED_FIELD_IDENTITY_TOKENS = [
  "alias",
  "entity",
  "field",
  "heading",
  "metadata",
  "purpose",
  "topology",
];

function codeIdentityTokens(
  facts: CodeSourceFacts | undefined,
  sourcePath: string,
): Set<string> {
  return tokensFromCodeIdentity([
    facts?.file_path ?? sourcePath,
    ...(facts?.exported_symbols.map((symbol) => symbol.name) ?? []),
  ].join(" "));
}

function tokensFromCodeIdentity(text: string): Set<string> {
  return new Set(
    text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1)
      .flatMap(expandCodeIdentityToken)
      .map(singularizeFamilyToken),
  );
}

function expandCodeIdentityToken(token: string): string[] {
  if (token === "bm25f") return ["bm25f", "bm25"];
  return [token];
}

function pickCarrierCompanion(
  args: BuildCodeRankedEntriesArgs,
  entries: CodeRankedEntry[],
): CodeRankedEntry | undefined {
  if (!wantsCarrierCompanion(args.query)) return undefined;
  return entries
    .filter((entry) => SOURCE_PROFILE_CARRIER_PATTERN.test(entry.source_path))
    .sort(compareCarrierCompanion)[0];
}

function compareCarrierCompanion(
  a: CodeRankedEntry,
  b: CodeRankedEntry,
): number {
  const aSupport = a.support_cluster?.role === "support" ? 1 : 0;
  const bSupport = b.support_cluster?.role === "support" ? 1 : 0;
  if (bSupport !== aSupport) return bSupport - aSupport;
  if (b.score !== a.score) return b.score - a.score;
  if (a.tokens !== b.tokens) return a.tokens - b.tokens;
  return a.source_path.localeCompare(b.source_path);
}

function removeEntry<T extends { id: string }>(
  entries: T[],
  entry: T | undefined,
): T[] {
  if (!entry) return entries;
  return entries.filter((candidate) => candidate.id !== entry.id);
}

function compareActiveRestEntry(
  a: CodeRankedEntry,
  b: CodeRankedEntry,
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.tokens !== b.tokens) return a.tokens - b.tokens;
  return a.source_path.localeCompare(b.source_path);
}

const SOURCE_PROFILE_CARRIER_PATTERN =
  /\bsource[-_]?profiles?\b|\bsource[-_]?cards?\b/i;

function wantsCarrierCompanion(query: string): boolean {
  const normalized = query.toLowerCase();
  if (/\bsource[-_ ]?profiles?\b/.test(normalized)) return true;
  if (/\bdoc[-_ ]?purpose\b/.test(normalized)) return true;
  if (/\bstructural\b.*\bcontext\b|\bcontext\b.*\bstructural\b/.test(normalized)) {
    return true;
  }
  const importWiring =
    /\bimport[-_ ]?time\b|\bimport\b|\bwiring\b|\bwire\b/.test(normalized);
  if (!importWiring) return false;
  const queryTokens = tokensFromCodeIdentity(normalized);
  if (
    hasAnyCodeIdentityToken(queryTokens, [
      "alias",
      "entity",
      "fence",
      "heading",
      "metadata",
      "nav",
      "purpose",
      "topology",
    ])
  ) {
    return true;
  }
  return /\b(alias(?:es)?|entit(?:y|ies)|fence|heading|metadata|nav|topology)\b/.test(
    normalized,
  );
}

function hasAnyCodeIdentityToken(
  tokens: Set<string>,
  candidates: readonly string[],
): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function isPassiveCodeEntry(entry: CodeRankedEntry): boolean {
  return PASSIVE_NEIGHBOR_PATTERN.test(
    `${entry.source_path} ${entry.body}`.toLowerCase(),
  );
}

function isDurableStatePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return /(?:^|\/)(?:store|stores|db|database|schema|schemas|model|models|types)(?:\/|$)/.test(
    normalized,
  );
}

function rerankFirstSlateByCodeFamilyEvidence(
  args: BuildCodeRankedEntriesArgs,
  files: FileCandidate[],
): FileCandidate[] {
  if (files.length <= 1) return files;
  const primary = files[0]!;
  const primaryFacts = getCodeSource(args.db, primary.source_path)?.facts;
  const annotated = files.slice(1).map((file) => {
    const facts = getCodeSource(args.db, file.source_path)?.facts;
    const evidence = facts
      ? scoreCodeFamilyEvidence({
          query: args.query,
          primary: primaryFacts,
          candidate: facts,
        })
      : undefined;
    return { file, evidence };
  });

  annotated.sort((a, b) => {
    const aPromoted = a.evidence?.first_slate_promotable ?? false;
    const bPromoted = b.evidence?.first_slate_promotable ?? false;
    if (aPromoted !== bPromoted) return aPromoted ? -1 : 1;
    const aEvidence = a.evidence?.score ?? 0;
    const bEvidence = b.evidence?.score ?? 0;
    if (aPromoted && bPromoted && bEvidence !== aEvidence) {
      return bEvidence - aEvidence;
    }
    if (b.file.parent_score !== a.file.parent_score) {
      return b.file.parent_score - a.file.parent_score;
    }
    return a.file.source_path.localeCompare(b.file.source_path);
  });

  return [primary, ...annotated.map(({ file }) => file)];
}

function compareSupportEntryForCluster(
  a: CodeRankedEntry,
  b: CodeRankedEntry,
): number {
  const aCluster = a.support_cluster;
  const bCluster = b.support_cluster;
  const distanceBias =
    (aCluster?.distance ?? Number.POSITIVE_INFINITY) -
    (bCluster?.distance ?? Number.POSITIVE_INFINITY);
  if (distanceBias !== 0) return distanceBias;
  const relevanceBias = (bCluster?.relevance ?? 0) - (aCluster?.relevance ?? 0);
  if (Math.abs(relevanceBias) > 0.15) return relevanceBias;
  const reasonBias =
    supportReasonPriority(aCluster?.reason ?? "nearby_import") -
    supportReasonPriority(bCluster?.reason ?? "nearby_import");
  if (reasonBias !== 0) return reasonBias;
  if (relevanceBias !== 0) return relevanceBias;
  if (a.tokens !== b.tokens) return a.tokens - b.tokens;
  return a.source_path.localeCompare(b.source_path);
}

function pickPrimaryHit(
  args: BuildCodeRankedEntriesArgs,
  hits: ChunkHit[],
): ChunkHit | null {
  const prefersDeclaration =
    (args.query_anchors?.symbols?.length ?? 0) > 0 ||
    args.query_intent === "exact_symbol" ||
    args.query_intent === "cross_module";
  if (!prefersDeclaration) {
    return hits[0] ?? null;
  }
  return hits.find((hit) => hit.chunk.code_role !== "orientation") ?? hits[0] ?? null;
}

function pickOrientationCompanion(
  db: Db,
  primary: ChunkHit,
  hits: ChunkHit[],
  wantsOrientation: boolean,
): ChunkHit | undefined {
  if (!wantsOrientation) return undefined;
  if (primary.chunk.code_role === "orientation") return undefined;
  const direct = hits.find((hit) => hit.chunk.code_role === "orientation");
  if (direct) return direct;
  const stored = listCodeChunksForSource(db, primary.chunk.source_path).find(
    (chunk) => chunk.code_role === "orientation",
  );
  return stored
    ? {
      chunk: stored,
      score: primary.score * 0.85,
      anchor_priority: chunkAnchorPriority(undefined, stored),
      lexical_priority: 0,
      path_priority: 0,
      channel: primary.channel,
      channel_rank: primary.channel_rank,
      file_rrf_score: primary.file_rrf_score,
      file_signal_count: primary.file_signal_count,
      source_fact_coverage: primary.source_fact_coverage,
    }
    : undefined;
}

function wantsOrientationCompanion(args: BuildCodeRankedEntriesArgs): boolean {
  return (
    (args.query_anchors?.files?.length ?? 0) > 0 ||
    (args.query_anchors?.symbols?.length ?? 0) > 0 ||
    args.query_intent === "exact_symbol" ||
    args.query_intent === "cross_module"
  );
}

function toRankedEntry(
  chunk: StoredCodeChunk,
  score: number,
  opts: {
    import_traversed?: boolean;
    support_cluster?: CodeSupportCluster;
    retrieval_confidence?: CodeRetrievalConfidence;
  } = {},
): CodeRankedEntry {
  return {
    id: chunk.version_id,
    kind: "code",
    scope: {},
    tokens: chunk.token_count,
    score,
    body: chunk.body,
    contexttrail: codeContextTrail(chunk, opts),
    type_bias_applied: false,
    source_path: chunk.source_path,
    start_line: chunk.start_line,
    end_line: chunk.end_line,
    symbol_path: chunk.symbol_path,
    code_role: chunk.code_role,
    declaration_kind: chunk.declaration_kind,
    ...(opts.import_traversed ? { import_traversed: true } : {}),
    parent_score: score,
    ...(opts.support_cluster ? { support_cluster: opts.support_cluster } : {}),
    retrieval_confidence: opts.retrieval_confidence ??
      genericCodeRetrievalConfidence(score),
  };
}

function supportReason(
  direction: "outgoing" | "incoming",
  distance: number,
): SupportClusterCandidate["reason"] {
  if (distance > 1) return "nearby_import";
  return direction === "outgoing" ? "outgoing_import" : "incoming_import";
}

function supportRelevance(args: {
  path: string;
  facts: CodeSourceFacts | undefined;
  reason: SupportClusterCandidate["reason"];
  floor: number;
  familyEvidence?: CodeFamilyEvidence;
}): number {
  const haystack = [
    args.path,
    args.facts?.file_purpose ?? "",
    ...(args.facts?.exported_symbols.map((symbol) => symbol.name) ?? []),
    ...(args.facts?.exported_signatures ?? []),
  ].join(" ").toLowerCase();

  if (args.familyEvidence?.support_admissible) {
    return clamp01(Math.max(0.62, args.familyEvidence.score));
  }

  if (args.reason === "same_family_substrate") {
    return PASSIVE_NEIGHBOR_PATTERN.test(haystack) ? 0 : 1;
  }

  let score = 0.55;
  if (args.reason === "outgoing_import") score += 0.15;
  if (args.reason === "incoming_import") score += 0.05;
  if (args.reason === "nearby_import") score -= 0.1;
  if (IMPLEMENTATION_SUPPORT_PATTERN.test(haystack)) score += 0.25;
  if (PASSIVE_NEIGHBOR_PATTERN.test(haystack)) score -= 0.35;
  return clamp01(score < Math.max(args.floor, SUPPORT_CLUSTER_RELEVANCE_FLOOR) ? 0 : score);
}

function compareSupportClusterCandidate(
  a: SupportClusterCandidate,
  b: SupportClusterCandidate,
): number {
  const relevanceDelta = b.relevance - a.relevance;
  if (Math.abs(relevanceDelta) > 0.15) return relevanceDelta;
  if (a.distance !== b.distance) return a.distance - b.distance;
  const roleFamilySpecificBias = roleFamilySpecificReasonBias(a.reason, b.reason);
  if (roleFamilySpecificBias !== 0 && Math.abs(relevanceDelta) <= 0.1) {
    return roleFamilySpecificBias;
  }
  if (relevanceDelta !== 0) return relevanceDelta;
  const facilityBias =
    supportFacilityPriority(b) - supportFacilityPriority(a);
  if (facilityBias !== 0) return facilityBias;
  const reasonBias = supportReasonPriority(a.reason) - supportReasonPriority(b.reason);
  if (reasonBias !== 0) return reasonBias;
  if (b.seed_parent_score !== a.seed_parent_score) return b.seed_parent_score - a.seed_parent_score;
  if (a.seed_source_path !== b.seed_source_path) {
    return a.seed_source_path.localeCompare(b.seed_source_path);
  }
  return a.source_path.localeCompare(b.source_path);
}

function roleFamilySpecificReasonBias(
  left: SupportClusterCandidate["reason"],
  right: SupportClusterCandidate["reason"],
): number {
  if (left === "role_family_fanout" && isSpecificFanoutReason(right)) return 1;
  if (right === "role_family_fanout" && isSpecificFanoutReason(left)) return -1;
  return 0;
}

function isSpecificFanoutReason(reason: SupportClusterCandidate["reason"]): boolean {
  return reason === "owner_fanout" ||
    reason === "package_dependency_fanout" ||
    reason === "support_config" ||
    reason === "shared_support_import";
}

function supportFacilityPriority(candidate: SupportClusterCandidate): number {
  const evidence = candidate.facility_evidence;
  if (!evidence) return 0;
  const tags = new Set(evidence.facility_tags);
  const sourcePath = candidate.source_path.toLowerCase();
  const pathTokens = sourcePathTokenSet(sourcePath);
  const basename = sourceBasename(sourcePath);
  let score = evidence.direct_query_tokens.length * 10 +
    Math.min(20, evidence.shared_domain_tokens.length * 4);
  if (tags.has("chunk_type_carrier")) score += 28;
  if (tags.has("db_connection")) score += 24;
  if (tags.has("source_profile_store")) score += 18;
  if (tags.has("source_profile_type_carrier")) score += 16;
  if (tags.has("code_source_store")) score += 16;
  if (tags.has("retrieval_candidate_projection")) score += 16;
  if (tags.has("schema_carrier")) score += 22;
  if (tags.has("migration_or_reindex")) score += 18;
  if (tags.has("import_command")) score += 14;
  if (tags.has("cli_entrypoint")) score += 10;
  if (isCanonicalFacilityCarrier(tags, basename)) score += 12;
  if (isCliEntrypointCarrier(tags, pathTokens, basename)) score += 12;
  if (isStoreCollectionCarrier(tags, pathTokens)) score += 28;
  if (
    tags.has("retrieval_candidate_projection") &&
    hasAnyPathToken(pathTokens, ["candidate", "fused", "projection", "rerank"])
  ) {
    score += 10;
  }
  return score;
}

function isCanonicalFacilityCarrier(
  tags: ReadonlySet<string>,
  basename: string,
): boolean {
  if (tags.has("db_connection") && ["db", "database", "connection"].includes(basename)) {
    return true;
  }
  if (tags.has("schema_carrier") && ["schema", "schemas"].includes(basename)) {
    return true;
  }
  return tags.has("chunk_type_carrier") && basename === "chunk";
}

function isCliEntrypointCarrier(
  tags: ReadonlySet<string>,
  pathTokens: ReadonlySet<string>,
  basename: string,
): boolean {
  if (!tags.has("cli_entrypoint")) return false;
  return hasAnyPathToken(pathTokens, ["bin", "cli", "cmd", "command"]) ||
    ["cli", "index", "main"].includes(basename);
}

function isStoreCollectionCarrier(
  tags: ReadonlySet<string>,
  pathTokens: ReadonlySet<string>,
): boolean {
  return tags.has("code_source_store") &&
    hasAnyPathToken(pathTokens, ["chunk", "code", "profile", "source"]);
}

function sourcePathTokenSet(sourcePath: string): Set<string> {
  return new Set(
    sourcePath
      .replace(/\.[a-z0-9]+$/i, "")
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length > 0)
      .flatMap((token) => [
        token,
        singularizePathToken(token),
        ...expandFtsQueryToken(token).flatMap((expanded) => [
          expanded,
          singularizePathToken(expanded),
        ]),
      ])
      .map((token) => token.toLowerCase()),
  );
}

function singularizePathToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (
    token.endsWith("s") &&
    token.length > 3 &&
    token !== "vcs" &&
    token !== "css" &&
    !token.endsWith("ss")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function sourceBasename(sourcePath: string): string {
  return sourcePath
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "") ?? "";
}

function hasAnyPathToken(
  tokens: ReadonlySet<string>,
  candidates: readonly string[],
): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function supportReasonPriority(reason: SupportClusterCandidate["reason"]): number {
  switch (reason) {
    case "code_family_evidence":
      return 0;
    case "support_substrate_bundle":
      return 1;
    case "same_family_substrate":
      return 2;
    case "outgoing_import":
      return 3;
    case "incoming_import":
      return 4;
    case "shared_support_import":
      return 5;
    case "support_config":
      return 5;
    case "owner_fanout":
      return 5;
    case "package_dependency_fanout":
      return 5;
    case "role_family_fanout":
      return 5;
    case "symbol_reference_fanout":
      return 5;
    case "cochange_fanout":
      return 5;
    case "nearby_import":
      return 6;
    case "primary_winner":
      return -1;
  }
}

function sourceFamilyKey(source_path: string): string | null {
  const basename = source_path
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  if (!basename) return null;
  const tokens = basename
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
    .map(singularizeFamilyToken);
  if (tokens.length < 2) return null;
  return tokens.join("-");
}

function singularizeFamilyToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (
    token.endsWith("s") &&
    token.length > 3 &&
    token !== "source" &&
    !token.endsWith("ss")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

const IMPLEMENTATION_SUPPORT_PATTERN =
  /\b(schema|db|database|store|storage|chunk|chunks|model|models|type|types|interface|source[-_ ]?profile|source[-_ ]?card|profile|config|codec|mapper|substrate|persistence|read[-_ ]?model|cli|command|cmd|index)\b/;
const PASSIVE_NEIGHBOR_PATTERN =
  /\b(example|demo|fixture|report|comparison|benchmark|probe|metrics|validation)\b/;

function shouldSkipCodePath(
  args: BuildCodeRankedEntriesArgs,
  path: string,
): boolean {
  if (isMeasurementOrToolingPath(path) && !allowsMeasurementOrTooling(args)) {
    return true;
  }
  if (isGeneratedArtifactPath(path) && !allowsGeneratedArtifacts(args)) {
    return true;
  }
  return false;
}

function isMeasurementOrToolingPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  return (
    normalized.startsWith("src/eval/") ||
    hasCodePathSegment(normalized, "benchmark") ||
    hasCodePathSegment(normalized, "benchmarks") ||
    hasCodePathSegment(normalized, "benches") ||
    hasCodePathSegment(normalized, "type-tests") ||
    hasCodePathSegment(normalized, "test") ||
    normalized.startsWith("tests/") ||
    hasCodePathSegment(normalized, "fixtures") ||
    hasCodePathSegment(normalized, "examples") ||
    normalized.startsWith("scripts/") ||
    normalized.includes("/__snapshots__/") ||
    normalized.includes("/__tests__/") ||
    normalized.includes(".test.")
  );
}

function isGeneratedArtifactPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  return (
    hasCodePathSegment(normalized, "generated") ||
    hasCodePathSegment(normalized, "__generated__") ||
    /(?:^|\/)generated(?:[_-][^/]*)?\.(?:ts|tsx|js|jsx|py|go|rs)$/.test(normalized) ||
    /(?:^|\/)[^/]*generated[^/]*\.(?:ts|tsx|js|jsx|py|go|rs)$/.test(normalized)
  );
}

function allowsMeasurementOrTooling(args: BuildCodeRankedEntriesArgs): boolean {
  if ((args.query_anchors?.files ?? []).some(isMeasurementOrToolingPath)) {
    return true;
  }
  return MEASUREMENT_TASK_PATTERN.test(args.query);
}

function allowsGeneratedArtifacts(args: BuildCodeRankedEntriesArgs): boolean {
  if ((args.query_anchors?.files ?? []).some(isGeneratedArtifactPath)) {
    return true;
  }
  return GENERATED_ARTIFACT_TASK_PATTERN.test(args.query);
}

const MEASUREMENT_TASK_PATTERN =
  /\b(eval|evaluation|test|tests|testing|type[-_ ]?tests?|fixture|fixtures|example|examples|demo|demos|bench|benches|benchmark|benchmarks|probe|report|metrics|validation|harness|comparison)\b/i;
const GENERATED_ARTIFACT_TASK_PATTERN =
  /\b(codegen|generator|generate|generates|generated[-_ ](?:code|file|files|output|types?))\b/i;

function hasCodePathSegment(path: string, segment: string): boolean {
  return path === segment || path.startsWith(`${segment}/`) ||
    path.includes(`/${segment}/`) || path.endsWith(`/${segment}`);
}

function fileAnchorBoost(
  anchors: QueryAnchors | undefined,
  chunk: StoredCodeChunk,
): number {
  const files = anchors?.files ?? [];
  if (files.some((file) => pathMatches(file, chunk.source_path))) return 0.2;
  return 0;
}

function symbolBoost(
  anchors: QueryAnchors | undefined,
  chunk: StoredCodeChunk,
): number {
  if (!chunk.symbol_path) return 0;
  const symbols = anchors?.symbols ?? [];
  if (symbols.some((symbol) => symbol === chunk.symbol_path)) return 0.25;
  if (symbols.some((symbol) => chunk.symbol_path?.endsWith(symbol))) return 0.15;
  return 0;
}

function chunkAnchorPriority(
  anchors: QueryAnchors | undefined,
  chunk: StoredCodeChunk,
): number {
  const symbols = anchors?.symbols ?? [];
  if (
    chunk.symbol_path &&
    symbols.some((symbol) => symbol === chunk.symbol_path)
  ) {
    return 3;
  }
  if (
    chunk.symbol_path &&
    symbols.some((symbol) => chunk.symbol_path?.endsWith(symbol))
  ) {
    return 2;
  }
  const files = anchors?.files ?? [];
  if (files.some((file) => pathMatches(file, chunk.source_path))) {
    return 1;
  }
  return 0;
}

function roleBoost(
  queryIntent: string | undefined,
  anchors: QueryAnchors | undefined,
  chunk: StoredCodeChunk,
): number {
  const anchored = (anchors?.files?.length ?? 0) > 0 || (anchors?.symbols?.length ?? 0) > 0;
  if ((queryIntent === "exact_symbol" || anchored) && chunk.code_role !== "orientation") {
    return 0.1;
  }
  if (queryIntent === "broad_domain" && chunk.code_role === "orientation") {
    return 0.08;
  }
  return 0;
}

function declarationBoost(
  queryIntent: string | undefined,
  chunk: StoredCodeChunk,
): number {
  if (queryIntent === "exact_symbol") {
    if (
      chunk.declaration_kind === "method" ||
      chunk.declaration_kind === "function" ||
      chunk.declaration_kind === "property"
    ) {
      return 0.05;
    }
  }
  return 0;
}

function compareChunkHit(a: ChunkHit, b: ChunkHit): number {
  if (b.anchor_priority !== a.anchor_priority) {
    return b.anchor_priority - a.anchor_priority;
  }
  if (b.lexical_priority !== a.lexical_priority) {
    return b.lexical_priority - a.lexical_priority;
  }
  if (b.score !== a.score) return b.score - a.score;
  if (a.chunk.code_role !== b.chunk.code_role) {
    return a.chunk.code_role === "orientation" ? 1 : -1;
  }
  return a.chunk.version_id.localeCompare(b.chunk.version_id);
}

function lexicalCodeMatch(
  query: string,
  chunk: StoredCodeChunk,
): { boost: number; priority: number; pathPriority: number } {
  const queryTokens = codeLexicalTokenSet(query);
  const queryCompacts = codeCompactTokenSet(query);
  if (queryTokens.size === 0 && queryCompacts.size === 0) {
    return { boost: 0, priority: 0, pathPriority: 0 };
  }

  let boost = 0;
  let priority = 0;
  let pathPriority = 0;
  const symbolCompact = compactIdentifier(chunk.symbol_path ?? "");
  if (symbolCompact && queryCompacts.has(symbolCompact)) {
    if (GENERIC_EXACT_SYMBOL_TOKENS.has(symbolCompact)) {
      boost += 0.08;
    } else {
      boost += 0.36;
      priority = Math.max(priority, 3);
    }
  }

  const exactBodyIdentifierHits = exactBodyIdentifierMatches(query, chunk.body);
  if (exactBodyIdentifierHits > 0) {
    boost += Math.min(0.24, exactBodyIdentifierHits * 0.16);
    priority = Math.max(priority, 4);
  }

  const symbolTokens = codeLexicalTokens(chunk.symbol_path ?? "");
  const symbolTokenHits = countMatches(symbolTokens, queryTokens);
  if (symbolTokenHits > 0) {
    boost += Math.min(0.18, symbolTokenHits * 0.08);
  }

  const basenameTokens = codeLexicalTokens(pathBasenameStem(chunk.source_path));
  const basenameHits = countMatches(basenameTokens, queryTokens);
  if (basenameHits > 0) {
    boost += Math.min(0.2, basenameHits * 0.12);
    pathPriority += basenameHits * 2;
  }

  const pathTokens = codeLexicalTokens(chunk.source_path);
  const pathHits = countMatches(pathTokens, queryTokens);
  if (pathHits > 0) {
    boost += Math.min(0.18, pathHits * 0.04);
    pathPriority += pathHits;
  }

  if (isPathShapedCodeQuery(query)) {
    const alignment = pathAlignmentPriority(query, chunk.source_path);
    if (alignment > 0) {
      boost += Math.min(0.16, alignment * 0.01);
      pathPriority += alignment;
    }
  }

  return {
    boost: Math.min(0.5, boost),
    priority,
    pathPriority,
  };
}

function pathAlignmentPriority(query: string, sourcePath: string): number {
  const queryTokens = cachedUniqueOrderedCodeLexicalTokens(
    query,
    PATH_ALIGNMENT_QUERY_CACHE,
  );
  const pathTokens = cachedUniqueOrderedCodeLexicalTokens(
    sourcePath,
    PATH_ALIGNMENT_SOURCE_CACHE,
  );
  if (queryTokens.length === 0 || pathTokens.length === 0) return 0;

  const ordered = orderedPathQueryMatches(pathTokens, queryTokens);
  const contiguous = longestContiguousPathQueryRun(pathTokens, queryTokens);
  const adjacent = adjacentPathQueryPairMatches(pathTokens, queryTokens);
  const suffix = pathQuerySuffixRun(pathTokens, queryTokens);
  if (ordered < 2 && suffix === 0) return 0;
  return ordered * 2 + contiguous * 3 + adjacent * 5 + suffix * 4;
}

const PATH_ALIGNMENT_QUERY_CACHE = new Map<string, string[]>();
const PATH_ALIGNMENT_SOURCE_CACHE = new Map<string, string[]>();

function cachedUniqueOrderedCodeLexicalTokens(
  text: string,
  cache: Map<string, string[]>,
): string[] {
  const cached = cache.get(text);
  if (cached) return cached;
  if (cache.size > 4096) cache.clear();
  const tokens = uniqueOrderedCodeLexicalTokens(text);
  cache.set(text, tokens);
  return tokens;
}

function uniqueOrderedCodeLexicalTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of codeLexicalTokens(text)) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function orderedPathQueryMatches(
  pathTokens: readonly string[],
  queryTokens: readonly string[],
): number {
  let queryIndex = 0;
  let matches = 0;
  for (const token of pathTokens) {
    const found = queryTokens.indexOf(token, queryIndex);
    if (found === -1) continue;
    queryIndex = found + 1;
    matches++;
  }
  return matches;
}

function longestContiguousPathQueryRun(
  pathTokens: readonly string[],
  queryTokens: readonly string[],
): number {
  let best = 0;
  for (let start = 0; start < pathTokens.length; start++) {
    let queryIndex = 0;
    let run = 0;
    for (let index = start; index < pathTokens.length; index++) {
      const found = queryTokens.indexOf(pathTokens[index]!, queryIndex);
      if (found === -1) break;
      queryIndex = found + 1;
      run++;
    }
    best = Math.max(best, run);
  }
  return best;
}

function adjacentPathQueryPairMatches(
  pathTokens: readonly string[],
  queryTokens: readonly string[],
): number {
  if (pathTokens.length < 2 || queryTokens.length < 2) return 0;
  const queryPairs = new Set<string>();
  for (let i = 0; i < queryTokens.length - 1; i++) {
    queryPairs.add(`${queryTokens[i]}\0${queryTokens[i + 1]}`);
  }
  const matched = new Set<string>();
  for (let i = 0; i < pathTokens.length - 1; i++) {
    const pair = `${pathTokens[i]}\0${pathTokens[i + 1]}`;
    if (queryPairs.has(pair)) matched.add(pair);
  }
  return matched.size;
}

function pathQuerySuffixRun(
  pathTokens: readonly string[],
  queryTokens: readonly string[],
): number {
  let run = 0;
  let pathIndex = pathTokens.length - 1;
  let queryIndex = queryTokens.length - 1;
  while (pathIndex >= 0 && queryIndex >= 0) {
    if (pathTokens[pathIndex] !== queryTokens[queryIndex]) break;
    run++;
    pathIndex--;
    queryIndex--;
  }
  return run;
}

function isPathShapedCodeQuery(query: string): boolean {
  const cached = PATH_SHAPED_QUERY_CACHE.get(query);
  if (cached !== undefined) return cached;
  const tokens = codeLexicalTokenSet(query);
  let pathShaped = false;
  if (query.includes("/") || query.includes("\\")) {
    pathShaped = true;
  } else if (looksLikeSourceImplementationPathQuery(query, tokens)) {
    pathShaped = true;
  } else {
    let rootHits = 0;
    for (const token of tokens) {
      if (PATH_SHAPED_ROOT_TOKENS.has(token)) rootHits++;
    }
    pathShaped = rootHits > 0 && tokens.size >= 3;
  }
  if (PATH_SHAPED_QUERY_CACHE.size > 1024) PATH_SHAPED_QUERY_CACHE.clear();
  PATH_SHAPED_QUERY_CACHE.set(query, pathShaped);
  return pathShaped;
}

const PATH_SHAPED_QUERY_CACHE = new Map<string, boolean>();

function looksLikeSourceImplementationPathQuery(
  query: string,
  tokens: ReadonlySet<string>,
): boolean {
  return /\bsource\b/i.test(query) &&
    /\bimplement(?:ation|ing)?\b/i.test(query) &&
    tokens.size >= 4;
}

function countMatches(tokens: readonly string[], queryTokens: ReadonlySet<string>): number {
  let count = 0;
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (queryTokens.has(token)) count++;
  }
  return count;
}

function pathBasenameStem(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "") ?? "";
}

function codeLexicalTokenSet(text: string): Set<string> {
  return new Set(codeLexicalTokens(text));
}

function codeCompactTokenSet(text: string): Set<string> {
  return new Set(
    (text.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) ?? [])
      .map(compactIdentifier)
      .filter((token) => token.length >= 2 && !CODE_TASK_QUERY_STOPWORDS.has(token)),
  );
}

function exactBodyIdentifierMatches(query: string, body: string): number {
  const queryIdentifiers = codeShapedQueryIdentifierCompacts(query);
  if (queryIdentifiers.size === 0) return 0;
  const bodyIdentifiers = codeIdentifierCompacts(body);
  let hits = 0;
  for (const token of queryIdentifiers) {
    if (bodyIdentifiers.has(token)) hits++;
  }
  return hits;
}

function codeShapedQueryIdentifierCompacts(text: string): Set<string> {
  return new Set(
    (text.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) ?? [])
      .filter(isCodeShapedQueryIdentifier)
      .map(compactIdentifier)
      .filter((token) =>
        token.length >= 4 &&
        !CODE_TASK_QUERY_STOPWORDS.has(token) &&
        !GENERIC_EXACT_SYMBOL_TOKENS.has(token)
      ),
  );
}

function codeIdentifierCompacts(text: string): Set<string> {
  return new Set(
    (text.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) ?? [])
      .map(compactIdentifier)
      .filter((token) => token.length >= 2),
  );
}

function isCodeShapedQueryIdentifier(token: string): boolean {
  return token.includes("_") || token.includes("$") || /\d/.test(token) ||
    /[a-z][A-Z]/.test(token);
}

function codeLexicalTokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !CODE_TASK_QUERY_STOPWORDS.has(token))
    .flatMap((token) => {
      const singular = singularizeFamilyToken(token);
      return singular === token ? [token] : [token, singular];
    });
}

function compactIdentifier(text: string): string {
  return text.replace(/[^A-Za-z0-9_$]+/g, "").toLowerCase();
}

function pathMatches(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function ftsSafeQuery(raw: string): string {
  const tokens = ftsSafeQueryTokens(raw);
  if (tokens.length === 0) return "";
  return [...new Set(tokens)].map((token) => `"${token}"`).join(" OR ");
}

function ftsSafeAllQuery(raw: string): string {
  const tokens = ftsSafeQueryTokens(raw);
  if (tokens.length === 0) return "";
  return [...new Set(tokens)].map((token) => `"${token}"`).join(" ");
}

function ftsSafeQueryTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_./:-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .filter((token) => !CODE_TASK_QUERY_STOPWORDS.has(token))
    .filter((token) => !token.endsWith("-") && !token.startsWith("-"))
    .flatMap(expandFtsQueryToken);
}

function expandFtsQueryToken(token: string): string[] {
  if (token === "bm25f") return ["bm25f", "bm25"];
  return [token];
}

const CODE_TASK_QUERY_STOPWORDS = new Set([
  "code",
  "context",
  "debug",
  "file",
  "files",
  "for",
  "implement",
  "implementation",
  "implementing",
  "is",
  "minimal",
  "modify",
  "needed",
  "rank",
  "safely",
  "source",
  "where",
]);

const PATH_SHAPED_ROOT_TOKENS = new Set([
  "apps",
  "cmd",
  "crate",
  "crates",
  "internal",
  "lib",
  "libs",
  "package",
  "packages",
  "pkg",
  "reporter",
  "reporters",
  "src",
  "source",
  "util",
  "utils",
]);

const GENERIC_EXACT_SYMBOL_TOKENS = new Set([
  "build",
  "config",
  "configuration",
  "create",
  "default",
  "get",
  "index",
  "init",
  "json",
  "load",
  "main",
  "make",
  "new",
  "options",
  "parse",
  "process",
  "read",
  "run",
  "schema",
  "set",
  "source",
  "start",
  "string",
  "update",
  "write",
]);

const GENERIC_SYMBOL_REFERENCE_TOKENS = new Set([
  "adapter",
  "client",
  "component",
  "context",
  "data",
  "error",
  "event",
  "handler",
  "helper",
  "input",
  "manager",
  "module",
  "node",
  "output",
  "plugin",
  "provider",
  "request",
  "response",
  "result",
  "service",
  "state",
  "store",
  "test",
  "type",
  "util",
  "utils",
  "value",
]);
