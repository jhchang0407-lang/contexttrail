/**
 * THO-144 / PRD-0014 V3.2 — source card builder.
 *
 * A SourceCard is a stable retrieval-metadata record for one candidate source.
 * Cards do NOT become Context Objects — final Context Packs continue to cite
 * Doc Chunks and Cards only. Cards exist so V3 modules (top-N aboutness
 * verifier, source-selection decision, optional pairwise rerank) compare
 * candidates on the same shape of evidence:
 *
 *   - source identity and rank in the candidate set
 *   - SourceProfile signals (title, purpose, role, headings, aliases)
 *   - candidate-path evidence (best chunk, contributing count, fused agreement)
 *   - top chunk evidence so source-level decisions stay grounded
 *   - token coverage against title / path / headings
 *   - optional coverage decision from the coverage verifier
 *
 * Stability is the load-bearing property: a `serializeSourceCard` two
 * identical inputs produce identical output across runs, so eval and explain
 * traces are diffable.
 */
import type { ProfileEnrichedSourceCandidate } from "./source-candidates.js";
import type {
  AliasKind,
  DocPurpose,
} from "../types/source-profile.js";
import type { DocRole } from "../types/chunk.js";
import type { QueryIntent } from "./source-rerank.js";
import { tokenize as tokenizeRetrievalText } from "./tokenize.js";
import {
  extractPhraseProximity,
  type PhraseProximityEvidence,
} from "./phrase-proximity.js";
import {
  classifySourceRole,
  type SourceRoleClassification,
} from "./source-role.js";
import {
  buildSourceFamilyGraph,
  type SourceFamilyMember,
} from "./source-family.js";
import type { HeadingAlias } from "./heading-aliases.js";
import type { CodeFenceEntity } from "./code-fence-entities.js";

export type SourceCardCoverageDecision = {
  verdict: "supported" | "partial" | "unsupported" | "needs_anchors";
  signals: string[];
};

export type SourceCardProfileSignals = {
  title: string;
  doc_purpose: DocPurpose;
  doc_role: DocRole;
  heading_count: number;
  alias_kinds: AliasKind[];
  /** Whether the source has a non-empty intro for aboutness reasoning. */
  has_intro: boolean;
};

/**
 * PRD-0023 / slice 23.2: import-time path-topology fields forwarded
 * from `SourceProfile`. Source-rerank consumes these directly at
 * ranking time (slice 23.3) without re-computing extractors.
 */
export type SourceCardPathTopology = {
  path_depth?: number;
  is_index_file?: boolean;
  is_section_landing?: boolean;
  package_segment?: string | null;
  version_segment?: string | null;
};

/**
 * PRD-0027 / slice 27.1.2: import-time nav-metadata fields forwarded
 * from `SourceProfile`. Source-rerank's slice 27.1.3 wiring consumes
 * `nav_label` (alias substrate) and `is_nav_landing`
 * (`overview_owner_score`); `nav_section_id` and `nav_position` are
 * diagnostic-only in v1.
 */
export type SourceCardNavMetadata = {
  nav_section_id?: string | null;
  nav_position?: number | null;
  nav_label?: string | null;
  is_nav_landing?: boolean;
  nav_origin?: string | null;
  nav_provenance?: string | null;
};

export type SourceCardCandidatePathEvidence = {
  best_chunk_rank: number;
  best_chunk_score: number;
  contributing_chunk_count: number;
  fused_rank: number | null;
  fused_path_count: number;
};

export type SourceCardTopChunkEvidence = {
  version_id: string;
  rank: number;
  final_score: number;
};

export type SourceCardTokenCoverage = {
  title_token_coverage: number;
  path_token_coverage: number;
  heading_token_coverage: number;
  /** Coverage against the deterministic source intro. Optional for legacy
   *  tests/cards built before intro evidence was part of SourceCard. */
  intro_token_coverage?: number;
};

export type SourceCard = {
  schema_version: 1;
  rank: number;
  source_path: string;
  query_intent: QueryIntent;
  query_tokens: string[];
  profile_signals: SourceCardProfileSignals | null;
  candidate_path_evidence: SourceCardCandidatePathEvidence;
  top_chunk_evidence: SourceCardTopChunkEvidence;
  token_coverage: SourceCardTokenCoverage;
  coverage_decision: SourceCardCoverageDecision | null;
  /** PRD-0016 P16.2 / THO-160: deterministic phrase/proximity feature
   *  record. Populated only when the source-card builder is given the
   *  raw task string; null otherwise (legacy callers, eval probes that
   *  pre-tokenize). Diagnostic only — PRD-0016 P16.5 will consume this
   *  for the pairwise adjudicator. */
  phrase_proximity: PhraseProximityEvidence | null;
  /** PRD-0016 P16.3 / THO-161: deterministic source role and
   *  canonicality classification with provenance + confidence. Always
   *  populated; degrades to role="unknown" / confidence="unknown"
   *  rather than forcing a label when evidence is weak. */
  source_role: SourceRoleClassification;
  /** PRD-0016 P16.4 / THO-162: deterministic source-family membership
   *  for the candidate set. Populated only by
   *  buildSourceCardsFromCandidates (the per-card builder cannot see
   *  the full top-N set). Diagnostic only — PRD-0016 P16.7
   *  (ambiguity-aware packing) is the next consumer. */
  source_family: SourceFamilyMember | null;
  /** Case-preserving anchor symbols from the original request. Used by
   *  the adjudicator (THO-164 expansion) to detect when a candidate's
   *  path basename matches an anchored symbol verbatim — a strong
   *  precision signal that survives the stemmer (which collapses
   *  `useQuery` and `useQueries` to the same stem). */
  anchor_symbols: string[];
  /** PRD-0023 / slice 23.2: path-topology fields forwarded from the
   *  source profile so source-rerank can consume them at ranking time
   *  without re-computing extractors. */
  path_topology: SourceCardPathTopology;
  /** PRD-0024 / slice 24.1.2: import-time heading aliases forwarded
   *  from the source profile. Consumed by source-rerank's existing
   *  heading_token_coverage feature for exact / suffix /
   *  token-normalized matches, and by the alias-based candidate
   *  generation substrate. Empty when the candidate has no profile
   *  or the doc has no headings. */
  heading_aliases: HeadingAlias[];
  /** PRD-0024 / slice 24.2.2: import-time code-fence entities
   *  forwarded from the source profile. Consumed by the existing
   *  alias substrate and source-rerank's existing alias_hit_count /
   *  owner_identity_score features for exact-only matches when the
   *  RETRIEVAL_CODE_FENCE_ENTITIES flag is on. Empty when the
   *  candidate has no profile or the doc has no fenced code. */
  code_fence_entities: CodeFenceEntity[];
  /** PRD-0027 / slice 27.1.2: import-time nav-metadata fields
   *  forwarded from the source profile. The slice 27.1.3 wiring
   *  consumes `nav_label` (alias substrate) and `is_nav_landing`
   *  (overview-owner-score); `nav_section_id` and `nav_position` are
   *  diagnostic-only in v1. Empty object when the candidate has no
   *  profile or the doc was not present in the corpus's NavGraph. */
  nav_metadata: SourceCardNavMetadata;
};

export type BuildSourceCardArgs = {
  candidate: ProfileEnrichedSourceCandidate;
  query_tokens: string[];
  query_intent: QueryIntent;
  rank: number;
  coverage?: SourceCardCoverageDecision;
  /** Raw task string. When supplied, the card carries phrase/proximity
   *  evidence against the candidate's path/title/h1/headings/intro for
   *  diagnostic surfaces (THO-160). */
  task?: string;
  /** Other top-N candidate paths for sibling-index canonicality
   *  detection (THO-161). Optional — when omitted, only path-internal
   *  cues run. */
  sibling_paths?: string[];
  /** Case-preserving anchor symbols (from request.query_anchors.symbols).
   *  Forwarded onto the card for the adjudicator's
   *  basename-exact-match signal. */
  anchor_symbols?: string[];
};

export function buildSourceCard(args: BuildSourceCardArgs): SourceCard {
  const { candidate, query_tokens, query_intent, rank } = args;
  const profile = candidate.profile;
  const lower = dedupePreserveOrder(query_tokens.map((t) => t.toLowerCase()));

  const titleTokens = profile ? tokenizeRetrievalText(profile.title) : [];
  const pathTokens = tokenizeRetrievalText(candidate.source_path);
  const headingTokens = profile
    ? profile.heading_outline.flatMap((h) => tokenizeRetrievalText(h.text))
    : [];
  const introTokens = profile?.intro
    ? tokenizeRetrievalText(profile.intro)
    : [];

  const profile_signals: SourceCardProfileSignals | null = profile
    ? {
        title: profile.title,
        doc_purpose: profile.doc_purpose,
        doc_role: profile.doc_role,
        heading_count: profile.heading_outline.length,
        alias_kinds: dedupePreserveOrder(profile.aliases.map((a) => a.kind)),
        has_intro: !!profile.intro && profile.intro.trim().length > 0,
      }
    : null;

  const sortedContributing = [...candidate.contributing_chunks].sort(
    (a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.version_id.localeCompare(b.version_id);
    },
  );
  const top = sortedContributing[0] ?? {
    version_id: "",
    rank: candidate.best_chunk_rank,
    final_score: candidate.best_chunk_score,
  };

  const phrase_proximity = args.task
    ? extractPhraseProximity(args.task, {
        path: candidate.source_path,
        title: profile?.title ?? "",
        h1: profile?.h1 ?? "",
        headings: profile?.heading_outline.map((h) => h.text) ?? [],
        intro: profile?.intro ?? "",
        body: "",
      })
    : null;

  const source_role = classifySourceRole({
    source_path: candidate.source_path,
    profile,
    sibling_paths: args.sibling_paths,
  });

  const path_topology: SourceCardPathTopology = profile
    ? {
        path_depth: profile.path_depth,
        is_index_file: profile.is_index_file,
        is_section_landing: profile.is_section_landing,
        package_segment: profile.package_segment,
        version_segment: profile.version_segment,
      }
    : {};

  const nav_metadata: SourceCardNavMetadata = profile
    ? {
        nav_section_id: profile.nav_section_id,
        nav_position: profile.nav_position,
        nav_label: profile.nav_label,
        is_nav_landing: profile.is_nav_landing,
        nav_origin: profile.nav_origin,
        nav_provenance: profile.nav_provenance,
      }
    : {};

  return {
    schema_version: 1,
    rank,
    source_path: candidate.source_path,
    query_intent,
    query_tokens: [...lower],
    profile_signals,
    candidate_path_evidence: {
      best_chunk_rank: candidate.best_chunk_rank,
      best_chunk_score: candidate.best_chunk_score,
      contributing_chunk_count: candidate.contributing_chunks.length,
      fused_rank: candidate.fused_rank ?? null,
      fused_path_count: candidate.fused_path_count ?? 0,
    },
    top_chunk_evidence: {
      version_id: top.version_id,
      rank: top.rank,
      final_score: top.final_score,
    },
    token_coverage: {
      title_token_coverage: coverage(lower, titleTokens),
      path_token_coverage: coverage(lower, pathTokens),
      heading_token_coverage: coverage(lower, headingTokens),
      intro_token_coverage: coverage(lower, introTokens),
    },
    coverage_decision: args.coverage ?? null,
    phrase_proximity,
    source_role,
    source_family: null,
    anchor_symbols: [...(args.anchor_symbols ?? [])],
    path_topology,
    heading_aliases: profile?.heading_aliases ?? [],
    code_fence_entities: profile?.code_fence_entities ?? [],
    nav_metadata,
  };
}

function coverage(queryTokens: string[], targetTokens: string[]): number {
  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;
  const set = new Set(targetTokens);
  let hits = 0;
  for (const t of queryTokens) {
    if (set.has(t)) hits += 1;
  }
  return hits / queryTokens.length;
}

function dedupePreserveOrder<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export function serializeSourceCard(card: SourceCard): string {
  return JSON.stringify(canonicalize(card));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return roundForDiff(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonicalize(obj[key]);
    }
    return out;
  }
  return value;
}

function roundForDiff(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 10000) / 10000;
}

export type BuildSourceCardsArgs = {
  candidates: ProfileEnrichedSourceCandidate[];
  query_tokens: string[];
  query_intent: QueryIntent;
  /** Build cards for the top-N candidates by their existing rank. */
  top_n: number;
  /** Optional coverage decisions keyed by source path. */
  coverage_by_source?: Map<string, SourceCardCoverageDecision>;
  /** Raw task string. Forwarded to each card so phrase/proximity
   *  evidence can be attached to top-N candidate diagnostics
   *  (PRD-0016 P16.2 / THO-160). */
  task?: string;
  /** Case-preserving anchor symbols forwarded to each card for the
   *  adjudicator's basename-exact-match precision signal. */
  anchor_symbols?: string[];
};

/**
 * Build a stable list of source cards for the top-N candidates.
 *
 * The top-N decision and the rank assignment come from the caller — this
 * helper does not re-rank. Cards are emitted in candidate-rank order.
 */
export function buildSourceCardsFromCandidates(
  args: BuildSourceCardsArgs,
): SourceCard[] {
  const sorted = [...args.candidates].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.source_path.localeCompare(b.source_path);
  });
  const top = sorted.slice(0, Math.max(0, args.top_n));
  // THO-161: thread the sibling top-N paths through so each card's
  // canonicality classifier can detect parent/child relationships
  // among the candidate set (e.g. `mocking/modules.md` is a child of
  // a `mocking.md` sibling-index when both appear).
  const siblingPaths = top.map((c) => c.source_path);
  const cards = top.map((cand) =>
    buildSourceCard({
      candidate: cand,
      query_tokens: args.query_tokens,
      query_intent: args.query_intent,
      rank: cand.rank,
      coverage: args.coverage_by_source?.get(cand.source_path),
      task: args.task,
      sibling_paths: siblingPaths,
      anchor_symbols: args.anchor_symbols,
    }),
  );

  // THO-162: build the source-family graph over the top-N set and
  // attach each member back onto its card.
  const familyGraph = buildSourceFamilyGraph(
    top.map((cand) => ({ source_path: cand.source_path, profile: cand.profile })),
  );
  const memberByPath = new Map(familyGraph.members.map((m) => [m.source_path, m]));
  return cards.map((card) => ({
    ...card,
    source_family: memberByPath.get(card.source_path) ?? null,
  }));
}
