/**
 * Multi-path source candidate generation (V2.5.3) with deterministic
 * reciprocal-rank fusion.
 *
 * Source recall in V2 was anchored on a single chunk-lexical path; SourceProfile
 * rerank is good but cannot rescue sources that never made the candidate set.
 * V2.5 emits source-level candidates from independent deterministic paths and
 * fuses them with RRF so a source supported by multiple weak signals can beat
 * a single strong-but-narrow lexical hit.
 *
 * Final Context Packs continue to cite Doc Chunks; this module produces
 * source-level diagnostic candidates only.
 */
import { tokenize } from "./tokenize.js";
import type {
  SourceAlias,
  HeadingOutlineEntry,
} from "../types/source-profile.js";
import type { HeadingAlias } from "./heading-aliases.js";
import type { CodeFenceEntity } from "./code-fence-entities.js";
import {
  headingAliasesEnabledFromEnv,
  normalizedQueryPhrase,
} from "./heading-aliases-flag.js";
import { codeFenceEntitiesEnabledFromEnv } from "./code-fence-entities-flag.js";

export const SOURCE_CANDIDATE_PATHS = [
  "lexical_chunk",
  "path_filename",
  "title_h1",
  "heading",
  "alias",
  "anchor",
  "question_heading",
] as const;
export type SourceCandidatePath = (typeof SOURCE_CANDIDATE_PATHS)[number];

export type PathCandidate = {
  path: SourceCandidatePath;
  source_path: string;
  /** 1-indexed rank within this path. */
  rank: number;
  /** Path-specific raw score (used only for path-internal ordering). */
  score: number;
  /** Human-readable evidence the report can render. */
  reason: string;
  /** Tokens / phrases that produced the match. */
  matched: string[];
};

export type FusedSourceCandidate = {
  /** 1-indexed post-fusion rank. */
  rank: number;
  source_path: string;
  rrf_score: number;
  /** Distinct paths that contributed at least one candidate. */
  path_count: number;
  contributing_paths: PathCandidate[];
};

/** Reciprocal-rank fusion constant — 60 is the standard value from the original RRF paper. */
export const RRF_K = 60;

export function fuseSourceCandidates(
  candidates: PathCandidate[],
): FusedSourceCandidate[] {
  type Acc = {
    source_path: string;
    rrf_score: number;
    paths: Set<SourceCandidatePath>;
    contributing: PathCandidate[];
  };
  const bySource = new Map<string, Acc>();
  for (const c of candidates) {
    const a = bySource.get(c.source_path) ?? {
      source_path: c.source_path,
      rrf_score: 0,
      paths: new Set<SourceCandidatePath>(),
      contributing: [],
    };
    a.rrf_score += 1 / (RRF_K + c.rank);
    a.paths.add(c.path);
    a.contributing.push(c);
    bySource.set(c.source_path, a);
  }
  const ordered = [...bySource.values()].sort((a, b) => {
    if (b.rrf_score !== a.rrf_score) return b.rrf_score - a.rrf_score;
    return a.source_path.localeCompare(b.source_path);
  });
  return ordered.map((a, idx) => ({
    rank: idx + 1,
    source_path: a.source_path,
    rrf_score: a.rrf_score,
    path_count: a.paths.size,
    contributing_paths: a.contributing,
  }));
}

export type LexicalChunkHit = {
  rank: number;
  source_path: string;
  final_score: number;
};

export type MinimalSourceProfile = {
  source_path: string;
  title: string;
  h1: string | null;
  heading_outline: HeadingOutlineEntry[];
  aliases: SourceAlias[];
  questions_answered: string[];
  /** Optional structured heading aliases for
   *  exact / suffix / phrase-substring matching when the
   *  RETRIEVAL_HEADING_ALIASES flag is on. */
  heading_aliases?: HeadingAlias[];
  /** Optional structured code-fence entities
   *  for exact-only matching against query tokens when the
   *  RETRIEVAL_CODE_FENCE_ENTITIES flag is on. */
  code_fence_entities?: CodeFenceEntity[];
};

export type GenerateInput = {
  query_tokens: string[];
  anchors: { files: string[]; symbols: string[]; routes: string[] };
  lexical_chunk_candidates: LexicalChunkHit[];
  profiles: MinimalSourceProfile[];
};

const QUESTION_PREFIX_REGEX = /^(how|what|why|when|where|which|can|does|do|is|are)\b/i;

export function generateMultiPathSourceCandidates(
  input: GenerateInput,
): PathCandidate[] {
  const out: PathCandidate[] = [];
  // Apply the same tokenizer that source profiles indexed with so query/source
  // sides share a stem space (Routing→rout, ZodOptional→zod,optional,…).
  const queryLower = input.query_tokens.flatMap((t) => tokenize(t));
  const querySet = new Set(queryLower);

  // 1. lexical_chunk: dedupe per source, take best (lowest) chunk rank.
  const bestChunkBySource = new Map<string, LexicalChunkHit>();
  for (const hit of input.lexical_chunk_candidates) {
    if (!hit.source_path) continue;
    const existing = bestChunkBySource.get(hit.source_path);
    if (!existing || hit.rank < existing.rank) {
      bestChunkBySource.set(hit.source_path, hit);
    }
  }
  const lexicalSorted = [...bestChunkBySource.values()].sort((a, b) => a.rank - b.rank);
  lexicalSorted.forEach((hit, i) => {
    out.push({
      path: "lexical_chunk",
      source_path: hit.source_path,
      rank: i + 1,
      score: hit.final_score,
      reason: `chunk lexical rank ${hit.rank} (score ${hit.final_score.toFixed(3)})`,
      matched: [],
    });
  });

  // 2. path_filename: query tokens hit the source path / filename.
  const pathHits: Array<{ profile: MinimalSourceProfile; coverage: number; matched: string[] }> = [];
  for (const profile of input.profiles) {
    const pathTokens = tokenize(profile.source_path);
    const matched = uniqueIntersection(queryLower, pathTokens);
    if (matched.length === 0) continue;
    pathHits.push({
      profile,
      coverage: matched.length / Math.max(queryLower.length, 1),
      matched,
    });
  }
  pathHits.sort((a, b) => b.coverage - a.coverage || a.profile.source_path.localeCompare(b.profile.source_path));
  pathHits.forEach((hit, i) => {
    out.push({
      path: "path_filename",
      source_path: hit.profile.source_path,
      rank: i + 1,
      score: hit.coverage,
      reason: `path/filename matched ${hit.matched.length} query token(s)`,
      matched: hit.matched,
    });
  });

  // 3. title_h1: query tokens hit title / h1.
  const titleHits: Array<{ profile: MinimalSourceProfile; coverage: number; matched: string[] }> = [];
  for (const profile of input.profiles) {
    const titleTokens = [
      ...tokenize(profile.title),
      ...(profile.h1 ? tokenize(profile.h1) : []),
    ];
    const matched = uniqueIntersection(queryLower, titleTokens);
    if (matched.length === 0) continue;
    titleHits.push({
      profile,
      coverage: matched.length / Math.max(queryLower.length, 1),
      matched,
    });
  }
  titleHits.sort((a, b) => b.coverage - a.coverage || a.profile.source_path.localeCompare(b.profile.source_path));
  titleHits.forEach((hit, i) => {
    out.push({
      path: "title_h1",
      source_path: hit.profile.source_path,
      rank: i + 1,
      score: hit.coverage,
      reason: `title/h1 matched ${hit.matched.join(", ")}`,
      matched: hit.matched,
    });
  });

  // 4. heading: query tokens hit any heading-outline entry.
  // When RETRIEVAL_HEADING_ALIASES is on AND
  // the profile carries structured heading_aliases, also surface
  // candidates whose normalized alias contains the query phrase as a
  // substring (catches hyphenation / casing differences that
  // tokenize-then-intersect misses).
  const headingAliasFlag = headingAliasesEnabledFromEnv();
  const queryPhrase = normalizedQueryPhrase(input.query_tokens);
  const headingHits: Array<{ profile: MinimalSourceProfile; matchCount: number; matched: string[] }> = [];
  for (const profile of input.profiles) {
    const headingTokens = profile.heading_outline.flatMap((h) => tokenize(h.text));
    const matched = uniqueIntersection(queryLower, headingTokens);
    let matchCount = matched.length;
    let allMatched = matched;
    if (
      headingAliasFlag &&
      profile.heading_aliases &&
      profile.heading_aliases.length > 0 &&
      queryPhrase.length > 0
    ) {
      for (const alias of profile.heading_aliases) {
        const aliasPhrase = alias.normalized
          .replace(/[^a-z0-9 ]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!aliasPhrase) continue;
        if (
          aliasPhrase === queryPhrase ||
          aliasPhrase.includes(queryPhrase) ||
          queryPhrase.includes(aliasPhrase)
        ) {
          // Phrase match is strictly stronger than per-token; surface
          // the alias surface as evidence and bump matchCount.
          if (!allMatched.includes(`heading:${alias.surface}`)) {
            allMatched = [...allMatched, `heading:${alias.surface}`];
            matchCount += queryLower.length || 1;
          }
          break;
        }
      }
    }
    if (matchCount === 0) continue;
    headingHits.push({ profile, matchCount, matched: allMatched });
  }
  headingHits.sort((a, b) => b.matchCount - a.matchCount || a.profile.source_path.localeCompare(b.profile.source_path));
  headingHits.forEach((hit, i) => {
    out.push({
      path: "heading",
      source_path: hit.profile.source_path,
      rank: i + 1,
      score: hit.matchCount,
      reason: `heading matched ${hit.matched.join(", ")}`,
      matched: hit.matched,
    });
  });

  // 5. alias: query tokens hit any deterministic alias value.
  // When RETRIEVAL_CODE_FENCE_ENTITIES is on AND the
  // profile carries structured code_fence_entities, also surface
  // candidates whose entity tokens (tokenized through the existing
  // retrieval tokenizer) overlap query tokens — exact-only, same
  // shape as the alias path.
  const codeFenceEntityFlag = codeFenceEntitiesEnabledFromEnv();
  const aliasHits: Array<{ profile: MinimalSourceProfile; hitCount: number; matched: string[] }> = [];
  for (const profile of input.profiles) {
    const matched: string[] = [];
    for (const alias of profile.aliases) {
      const aliasTokens = tokenize(alias.value);
      for (const t of aliasTokens) if (querySet.has(t)) matched.push(alias.value);
    }
    if (codeFenceEntityFlag && profile.code_fence_entities) {
      for (const entity of profile.code_fence_entities) {
        const entityTokens = tokenize(entity.value);
        for (const t of entityTokens) {
          if (querySet.has(t)) {
            matched.push(`code_fence:${entity.kind}:${entity.value}`);
            break;
          }
        }
      }
    }
    const dedup = Array.from(new Set(matched));
    if (dedup.length === 0) continue;
    aliasHits.push({ profile, hitCount: dedup.length, matched: dedup });
  }
  aliasHits.sort((a, b) => b.hitCount - a.hitCount || a.profile.source_path.localeCompare(b.profile.source_path));
  aliasHits.forEach((hit, i) => {
    out.push({
      path: "alias",
      source_path: hit.profile.source_path,
      rank: i + 1,
      score: hit.hitCount,
      reason: `alias hit on ${hit.matched.join(", ")}`,
      matched: hit.matched,
    });
  });

  // 6. anchor: request file/symbol/route anchor matches the source path.
  const anchorSources = new Set<string>();
  const anchorMatched: Map<string, string[]> = new Map();
  for (const file of input.anchors.files) {
    for (const profile of input.profiles) {
      if (profile.source_path === file || profile.source_path.endsWith(`/${file}`)) {
        anchorSources.add(profile.source_path);
        const arr = anchorMatched.get(profile.source_path) ?? [];
        arr.push(`file:${file}`);
        anchorMatched.set(profile.source_path, arr);
      }
    }
  }
  for (const symbol of input.anchors.symbols) {
    const symLower = symbol.toLowerCase();
    for (const profile of input.profiles) {
      const aliasMatch = profile.aliases.some(
        (a) =>
          (a.kind === "symbol" || a.kind === "route") &&
          a.value.toLowerCase() === symLower,
      );
      if (aliasMatch) {
        anchorSources.add(profile.source_path);
        const arr = anchorMatched.get(profile.source_path) ?? [];
        arr.push(`symbol:${symbol}`);
        anchorMatched.set(profile.source_path, arr);
      }
    }
  }
  const anchorList = [...anchorSources].sort();
  anchorList.forEach((src, i) => {
    const m = anchorMatched.get(src) ?? [];
    out.push({
      path: "anchor",
      source_path: src,
      rank: i + 1,
      score: m.length,
      reason: `anchor matched ${m.join(", ")}`,
      matched: m,
    });
  });

  // 7. question_heading: query is question-shaped and a profile's recorded
  // questions share at least 2 content tokens with the query.
  const queryIsQuestion = QUESTION_PREFIX_REGEX.test(input.query_tokens.join(" "));
  if (queryIsQuestion) {
    const qHits: Array<{ profile: MinimalSourceProfile; overlap: number; matched: string[] }> = [];
    for (const profile of input.profiles) {
      let bestOverlap = 0;
      let bestMatched: string[] = [];
      for (const q of profile.questions_answered) {
        const qTokens = tokenize(q);
        const matched = uniqueIntersection(queryLower, qTokens);
        if (matched.length >= 2 && matched.length > bestOverlap) {
          bestOverlap = matched.length;
          bestMatched = matched;
        }
      }
      if (bestOverlap > 0) qHits.push({ profile, overlap: bestOverlap, matched: bestMatched });
    }
    qHits.sort((a, b) => b.overlap - a.overlap || a.profile.source_path.localeCompare(b.profile.source_path));
    qHits.forEach((hit, i) => {
      out.push({
        path: "question_heading",
        source_path: hit.profile.source_path,
        rank: i + 1,
        score: hit.overlap,
        reason: `question heading matched ${hit.matched.join(", ")}`,
        matched: hit.matched,
      });
    });
  }

  return out;
}

function uniqueIntersection(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of a) {
    if (setB.has(t) && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
