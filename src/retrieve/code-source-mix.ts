/**
 * Chunk-first code retrieval lane.
 *
 * Queries `code_chunks_fts` directly, aggregates child evidence back to parent
 * files, selects one best chunk per file first, optionally adds an
 * orientation companion, and only then performs bounded file-graph late
 * augmentation.
 */
import type { Db } from "../store/db.js";
import {
  getCodeChunkByVersionId,
  listCodeChunksForSource,
  listCurrentCodeChunks,
  searchCodeChunksFts,
} from "../store/code-chunks.js";
import { listCodeGraphNeighbors } from "../store/code-graph.js";
import { getCodeSource, listCodeSources } from "../store/code-sources.js";
import { codeSourceIndexEnabledFromEnv } from "./code-source-flag.js";
import { codeContextTrail } from "./contexttrail.js";
import {
  scoreCodeFamilyEvidence,
  type CodeFamilyEvidence,
} from "./code-family-evidence.js";
import type { QueryAnchors } from "./score.js";
import type {
  CodeChunkRole,
  CodeDeclarationKind,
  CodeSourceFacts,
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
};

type FileCandidate = {
  source_path: string;
  parent_score: number;
  primary: ChunkHit;
  orientation?: ChunkHit;
};

type SupportClusterCandidate = {
  source_path: string;
  seed_source_path: string;
  seed_parent_score: number;
  distance: number;
  reason: CodeSupportCluster["reason"];
  relevance: number;
  family_evidence?: CodeFamilyEvidence;
};

const DEFAULT_MAX_RESULTS = 10;
const SCORE_FLOOR = 0.05;
const DEFAULT_IMPORT_HOPS = 2;
const IMPORT_INHERITED_SCORE_FRACTION = 0.5;
const DEFAULT_IMPORT_TRAVERSED_MAX_RESULTS = 14;
const DEFAULT_IMPORT_TRAVERSED_MAX_TOKENS = 4000;
const SUPPORT_CLUSTER_RELEVANCE_FLOOR = 0.55;
const DIRECT_COMPACT_PROJECTION_TOKEN_THRESHOLD = 700;

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
  const hits = searchCodeChunksFts(effectiveArgs.db, query, limit);
  if (hits.length === 0) return [];

  const floor = effectiveArgs.score_floor ?? SCORE_FLOOR;
  const worst = Math.max(...hits.map((h) => Math.abs(h.bm25)), 1);
  const directHits = [
    ...hydrateDirectHits(effectiveArgs, hits, worst, floor),
    ...hydrateExactSymbolFallbackHits(effectiveArgs, floor),
    ...hydratePathFallbackHits(effectiveArgs, floor),
  ];
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
  const supportReserveCount = supportCandidatePool.filter(
    (candidate) => !directFilePaths.has(candidate.source_path),
  ).length;
  const directLimit =
    rankingMethod === "bundle-aware"
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
): ChunkHit[] {
  const seen = new Set<string>();
  const out: ChunkHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.version_id)) continue;
    seen.add(hit.version_id);
    const chunk = getCodeChunkByVersionId(args.db, hit.version_id);
    if (!chunk) continue;
    if (isMeasurementOrToolingPath(chunk.source_path) && !allowsMeasurementOrTooling(args)) {
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
    });
  }
  return out.sort(compareChunkHit);
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
    if (isMeasurementOrToolingPath(chunk.source_path) && !allowsMeasurementOrTooling(args)) {
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
    });
  }
  return out
    .sort(
      (a, b) =>
        b.path_priority - a.path_priority ||
        b.score - a.score ||
        a.chunk.source_path.localeCompare(b.chunk.source_path),
    )
    .slice(0, Math.max(12, args.max_results ?? DEFAULT_MAX_RESULTS));
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
    if (isMeasurementOrToolingPath(chunk.source_path) && !allowsMeasurementOrTooling(args)) {
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
    });
  }
  return out
    .sort(
      (a, b) =>
        b.lexical_priority - a.lexical_priority ||
        b.score - a.score ||
        a.chunk.source_path.localeCompare(b.chunk.source_path),
    )
    .slice(0, Math.max(12, args.max_results ?? DEFAULT_MAX_RESULTS));
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
    const parent_score =
      primary.score + Math.min(0.08, 0.04 * Math.max(0, distinctHits - 1));
    files.push({
      source_path,
      parent_score: clamp01(parent_score),
      primary,
      orientation,
    });
  }

  const pathShaped = isPathShapedCodeQuery(args.query);
  return files.sort((a, b) => {
    const anchorBias = b.primary.anchor_priority - a.primary.anchor_priority;
    if (anchorBias !== 0) return anchorBias;
    if (pathShaped) {
      const pathBias = b.primary.path_priority - a.primary.path_priority;
      if (pathBias !== 0) return pathBias;
    }
    const lexicalBias = b.primary.lexical_priority - a.primary.lexical_priority;
    if (lexicalBias !== 0) return lexicalBias;
    if (b.parent_score !== a.parent_score) return b.parent_score - a.parent_score;
    return a.source_path.localeCompare(b.source_path);
  });
}

function allowsUnanchoredLexicalBoost(args: BuildCodeRankedEntriesArgs): boolean {
  return (
    (args.query_anchors?.files?.length ?? 0) === 0 &&
    (args.query_anchors?.symbols?.length ?? 0) === 0
  );
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
    out.push(toRankedEntry(chunk, file.parent_score));
  }
  for (const file of primaryFiles) {
    if (!file.orientation) continue;
    if (emittedStableKeys.has(file.orientation.chunk.stable_key)) continue;
    if (out.length >= maxResults) break;
    out.push(
      toRankedEntry(
        file.orientation.chunk,
        clamp01(Math.min(file.parent_score, file.orientation.score + 0.02)),
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
          if (isMeasurementOrToolingPath(neighbor)) continue;
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

  return [...byPath.values()].sort(compareSupportClusterCandidate);
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
    if (isMeasurementOrToolingPath(path)) continue;
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
  };
  const compact = compactSupportChunk(db, entry.source_path, entry.tokens);
  if (!compact) return withSupportCluster(entry, supportCluster, true);
  return toRankedEntry(compact, entry.score, {
    import_traversed: true,
    support_cluster: supportCluster,
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
    args.import_traversed_max_results ?? DEFAULT_IMPORT_TRAVERSED_MAX_RESULTS;
  const maxSupportTokens =
    args.import_traversed_max_tokens ?? DEFAULT_IMPORT_TRAVERSED_MAX_TOKENS;
  if (maxSupportResults <= 0 || maxSupportTokens <= 0) return [];

  const directTokensByPath = new Map(
    directEntries.map((entry) => [
      entry.source_path,
      projectedSupportTokenCount(args.db, entry.source_path, entry.tokens),
    ]),
  );
  const out: SupportClusterCandidate[] = [];
  let usedTokens = 0;

  for (const candidate of candidates) {
    if (out.length >= maxSupportResults) break;
    const tokens = directTokensByPath.get(candidate.source_path) ??
      supportCandidateTokenCount(args.db, candidate.source_path);
    if (tokens === undefined) continue;
    if (usedTokens + tokens > maxSupportTokens) continue;
    out.push(candidate);
    usedTokens += tokens;
  }

  return out;
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
    args.import_traversed_max_results ?? DEFAULT_IMPORT_TRAVERSED_MAX_RESULTS;
  const maxTraversedTokens =
    args.import_traversed_max_tokens ?? DEFAULT_IMPORT_TRAVERSED_MAX_TOKENS;

  const candidates: Array<CodeRankedEntry & { distance: number; relevance: number }> = [];
  for (const support of supportCandidates) {
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
    candidates.push({
      ...toRankedEntry(file.primary.chunk, score, {
        import_traversed: true,
        support_cluster: {
          role: "support",
          seed_source_path: support.seed_source_path,
          distance: support.distance,
          reason: support.reason,
          relevance: support.relevance,
          ...(support.family_evidence
            ? { family_evidence: support.family_evidence }
            : {}),
        },
      }),
      distance: support.distance,
      relevance: support.relevance,
    });
  }

  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
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
    primary: { chunk: primary, score: 0, anchor_priority: 0, lexical_priority: 0, path_priority: 0 },
    orientation: undefined,
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
  const [bestSupport, ...remainingSupports] = supports;
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
  opts: { import_traversed?: boolean; support_cluster?: CodeSupportCluster } = {},
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
  if (relevanceDelta !== 0) return relevanceDelta;
  const reasonBias = supportReasonPriority(a.reason) - supportReasonPriority(b.reason);
  if (reasonBias !== 0) return reasonBias;
  if (b.seed_parent_score !== a.seed_parent_score) return b.seed_parent_score - a.seed_parent_score;
  if (a.seed_source_path !== b.seed_source_path) {
    return a.seed_source_path.localeCompare(b.seed_source_path);
  }
  return a.source_path.localeCompare(b.source_path);
}

function supportReasonPriority(reason: SupportClusterCandidate["reason"]): number {
  switch (reason) {
    case "code_family_evidence":
      return 0;
    case "same_family_substrate":
      return 1;
    case "outgoing_import":
      return 2;
    case "incoming_import":
      return 3;
    case "nearby_import":
      return 4;
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

function isMeasurementOrToolingPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  return (
    normalized.startsWith("src/eval/") ||
    normalized.startsWith("tests/") ||
    normalized.startsWith("scripts/") ||
    normalized.includes("/__snapshots__/") ||
    normalized.includes(".test.")
  );
}

function allowsMeasurementOrTooling(args: BuildCodeRankedEntriesArgs): boolean {
  if ((args.query_anchors?.files ?? []).some(isMeasurementOrToolingPath)) {
    return true;
  }
  return MEASUREMENT_TASK_PATTERN.test(args.query);
}

const MEASUREMENT_TASK_PATTERN =
  /\b(eval|evaluation|test|tests|testing|fixture|fixtures|benchmark|probe|report|metrics|validation|harness|comparison)\b/i;

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

  return {
    boost: Math.min(0.5, boost),
    priority,
    pathPriority,
  };
}

function isPathShapedCodeQuery(query: string): boolean {
  const tokens = codeLexicalTokenSet(query);
  if (query.includes("/") || query.includes("\\")) return true;
  let rootHits = 0;
  for (const token of tokens) {
    if (PATH_SHAPED_ROOT_TOKENS.has(token)) rootHits++;
  }
  return rootHits > 0 && tokens.size >= 3;
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
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9_./:-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .filter((token) => !CODE_TASK_QUERY_STOPWORDS.has(token))
    .filter((token) => !token.endsWith("-") && !token.startsWith("-"))
    .flatMap(expandFtsQueryToken);
  if (tokens.length === 0) return "";
  return [...new Set(tokens)].map((token) => `"${token}"`).join(" OR ");
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
