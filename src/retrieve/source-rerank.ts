/**
 * Deterministic source rerank scorer (PRD-0012 / Slice 2 v2 / THO-129).
 *
 * Feature-vector-shaped scorer over profile-enriched source candidates. The
 * output is shaped like a future learning-to-rank input but every coefficient
 * is hand-set so we can ship without judged labels (PRD-0012: "no LTR until
 * 200+ judged cases across 8+ corpora"). No dense retrieval, RRF, cross
 * encoder, or LLM rerank.
 */
import type {
  ProfileEnrichedSourceCandidate,
} from "./source-candidates.js";
import type { DocPurpose, SourceProfile } from "../types/source-profile.js";
import { tokenize as tokenizeRetrievalText } from "./tokenize.js";
import {
  applyCloseCallTiebreakers,
  tiebreakersEnabledFromEnv,
  type CloseCallTiebreakerEntry,
} from "./source-rerank-tiebreakers.js";
import {
  headingAliasesEnabledFromEnv,
  headingAliasPhraseMatch,
} from "./heading-aliases-flag.js";
import { codeFenceEntitiesEnabledFromEnv } from "./code-fence-entities-flag.js";
import type { CodeFenceEntity } from "./code-fence-entities.js";
import { navMetadataEnabledFromEnv } from "./nav-metadata-flag.js";
import {
  anchorIntentFallbackEnabledFromEnv,
  hierarchyInheritanceEnabledFromEnv,
  pathTopologyBoostsEnabledFromEnv,
  pathTopologyConditionalBoostsEnabledFromEnv,
  PATH_TOPOLOGY_BOOSTS_DEFAULT_ON,
  PATH_TOPOLOGY_CONDITIONAL_BOOSTS_DEFAULT_ON,
  HIERARCHY_INHERITANCE_DEFAULT_ON,
} from "./source-rerank-flags.js";
import {
  classifyQueryIntent,
  QUERY_INTENTS,
  type IntentInputs,
  type QueryIntent,
} from "./query-intent.js";

export {
  anchorIntentFallbackEnabledFromEnv,
  hierarchyInheritanceEnabledFromEnv,
  pathTopologyBoostsEnabledFromEnv,
  pathTopologyConditionalBoostsEnabledFromEnv,
  PATH_TOPOLOGY_BOOSTS_DEFAULT_ON,
  PATH_TOPOLOGY_CONDITIONAL_BOOSTS_DEFAULT_ON,
  HIERARCHY_INHERITANCE_DEFAULT_ON,
};
export { classifyQueryIntent, QUERY_INTENTS, type IntentInputs, type QueryIntent };

/**
 * PRD-0023 / slice 23.3: principled additive boosts derived from
 * import-time path-topology fields on `SourceProfile`. Magnitudes are
 * fixed and not tuned against the failing cohort — if they don't
 * deliver, we revisit the principle, not the values.
 */
export const PATH_TOPOLOGY_LANDING_BOOST = 0.35;
export const PATH_TOPOLOGY_INDEX_BOOST = 0.20;
export const PATH_TOPOLOGY_PACKAGE_MATCH_BOOST = 0.30;
export const PATH_TOPOLOGY_VERSION_MATCH_BOOST = 0.30;
export const PATH_TOPOLOGY_DEPTH_DECAY_PER_LEVEL = 0.05;
export const PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS = 2;

/**
 * Default state of the RETRIEVAL_PATH_TOPOLOGY_BOOSTS flag when the
 * env var is unset. Starts `false` while slice 23.3 is shadow-only.
 * Flips to `true` after promotion gates pass on real-corpus eval.
 */
/**
 * Conditional-only subset of PRD-0023 path topology: applies the
 * `package_segment` and `version_segment` boosts that self-gate on
 * query-token match, but skips the unconditional landing/index/depth
 * boosts that caused the rolled-back uniform-boost regression. The
 * conditional boosts only fire when the query independently mentions
 * the package or version segment, so they cannot wash out signal the
 * way landing boosts did. Defaults `true`.
 */
/**
 * Hierarchy inheritance: a section-landing or index page gets a small
 * post-scoring boost from its strongest descendant when the parent is
 * itself a credible match. The boost is `min(parent.score, bestChild) *
 * HIERARCHY_INHERITANCE_FRACTION`, so a parent that does not match the
 * query independently never inherits — this is the structural fix to
 * the rolled-back PRD-0023 failure mode where every `index.md` got a
 * uniform boost regardless of relevance.
 *
 * Triggers only for broad_domain / decision_lookup intents, where the
 * canonical answer is more likely to be the section landing than a
 * deep child. Anchored / exact_symbol queries already have stronger
 * non-structural signals.
 */
export const HIERARCHY_INHERITANCE_FRACTION = 0.15;

/**
 * Default state of the RETRIEVAL_HIERARCHY_INHERITANCE flag when the env
 * var is unset. Defaults `true` after the structural principle measured
 * +1 top-1 / +1 top-3 on the 174-case real-corpus panel with zero
 * regressions and no tuning to specific cases. Flip to `false` to
 * disable for shadow-comparison runs.
 */
/**
 * Returns the directory prefix (with trailing slash) that this source
 * acts as the section-landing for, or null when the path does not look
 * like a landing page.
 *
 * Three forms are recognised:
 *   - "foo/index.md"   → "foo/"      (folder index)
 *   - "foo/README.md"  → "foo/"      (universal README convention)
 *   - "foo/bar.md"     → "foo/bar/"  (named landing for foo/bar/*)
 *
 * README.md is treated as a peer of index.md because it's the canonical
 * landing for its directory across nearly every OSS docs corpus —
 * recognising it lets siblings like ERROR_HANDLING.md inherit credit
 * to the README rather than the other way around.
 *
 * The named-landing form is the typical "vitepress / docusaurus" shape
 * where `mocking.md` sits next to a `mocking/` subdir of more pages.
 */
function sectionLandingDir(sourcePath: string): string | null {
  // Nested index.md / README.md: landing for the immediate parent directory.
  const indexMatch = sourcePath.match(/^(.*\/)(?:index|README)\.(md|mdx)$/i);
  if (indexMatch) return indexMatch[1] ?? null;
  // Root-level README.md is intentionally NOT treated as a section landing
  // because the implied dir is "", which would make every other path a
  // descendant — the inheritance magnitude would be unbounded. Root
  // READMEs still get their own score; they just don't accrue hierarchy
  // credit from arbitrary descendants.
  const namedMatch = sourcePath.match(/^(.+)\.(md|mdx)$/i);
  if (namedMatch && namedMatch[1]) return `${namedMatch[1]}/`;
  return null;
}

type ScoredCandidate = {
  candidate: { source_path: string; best_chunk_rank: number };
  score: number;
};

export function applyHierarchyInheritance(
  scored: ScoredCandidate[],
  intent: QueryIntent,
): void {
  // The structural rule (parent score must already be credible to
  // inherit) self-gates without an intent filter — a parent that does
  // not match the query independently never inherits, even from a
  // strong child. Keep the parameter for future intent-conditional
  // tuning but apply uniformly today.
  if (intent === "signal_empty") return;
  for (const parent of scored) {
    const dir = sectionLandingDir(parent.candidate.source_path);
    if (!dir) continue;
    let bestChildScore = 0;
    for (const other of scored) {
      if (other === parent) continue;
      const otherPath = other.candidate.source_path;
      if (otherPath.startsWith(dir) && otherPath !== dir) {
        if (other.score > bestChildScore) bestChildScore = other.score;
      }
    }
    if (bestChildScore <= 0) continue;
    const inheritBase = Math.min(parent.score, bestChildScore);
    if (inheritBase <= 0) continue;
    parent.score += inheritBase * HIERARCHY_INHERITANCE_FRACTION;
  }
}

const MIGRATION_INTENT_REGEX =
  /\b(migrate|migration|migrating|migrat|upgrade|upgrading|upgrad|adopt|adopting|adoption|moving\s+(?:\w+\s+){0,6}onto|version|versions|breaking|break|deprecate|deprecated|deprecation|deprecat|changelog|release|releas|release[- ]?notes?)\b/i;
const VERSION_SHAPE_REGEX = /^v?\d+(\.\d+)*$/i;

function queryTokensAskMigration(queryTokens: string[]): boolean {
  const joined = queryTokens.join(" ");
  if (MIGRATION_INTENT_REGEX.test(joined)) return true;
  return (
    queryTokens.some((token) => token === "move") &&
    queryTokens.some((token) => VERSION_SHAPE_REGEX.test(token))
  );
}

export type SourceRerankFeatures = {
  /** Best chunk final_score under this source (lexical evidence today). */
  lexical_chunk_score: number;
  /** Small prior from the best pre-rerank chunk rank; keeps weak profile hints honest. */
  source_rank_prior: number;
  /** Coverage of query tokens against the source title (0..1). */
  title_token_coverage: number;
  /** Coverage of query tokens against the source path stem (0..1). */
  path_token_coverage: number;
  /** Overlap supported by both title and path; strong canonical-source signal. */
  title_path_agreement: number;
  /** Coverage of query tokens against any heading in the heading outline (0..1). */
  heading_token_coverage: number;
  /** Coverage of content-bearing query tokens against the source leaf filename. */
  filename_token_coverage: number;
  /** Coverage of content-bearing query tokens against the deterministic intro. */
  intro_token_coverage: number;
  /** Number of query-token hits against any deterministic alias. */
  alias_hit_count: number;
  /** Structural owner evidence from filename/title/path/aliases, weighted by token rarity. */
  owner_identity_score: number;
  /** Overview/index/readme owner evidence for overview-shaped questions. */
  overview_owner_score: number;
  /** Bonus for purpose/intent compatibility (0 if no profile). */
  purpose_compat_bonus: number;
  /** Negative when migration/changelog/reference distractors are demoted. */
  distractor_penalty: number;
  /** Negative when a broad container is winning only by dense heading/body lexical signal. */
  broad_container_penalty: number;
  /** Negative when a leaf under the matched parent is more specific than the query. */
  leaf_specificity_penalty: number;
  /** Demotion of `archive`/`ideation` doc_role; 0 for canonical. */
  role_penalty: number;
};

export type ScoredSourceRerank = {
  score: number;
  features: SourceRerankFeatures;
};

const PURPOSE_COMPAT: Record<QueryIntent, Partial<Record<DocPurpose, number>>> = {
  decision_lookup: {
    adr: 0.30,
    concept: 0.20,
    runbook: 0.15,
    prd: 0.15,
    guide: 0.10,
    api_reference: 0.0,
    migration: 0.0,
    changelog: 0.0,
  },
  exact_symbol: {
    api_reference: 0.30,
    package_readme: 0.15,
    readme: 0.10,
    guide: 0.05,
    concept: 0.05,
    migration: 0.0,
    changelog: 0.0,
  },
  broad_domain: {
    concept: 0.25,
    quick_start: 0.25,
    guide: 0.20,
    readme: 0.15,
    package_readme: 0.10,
    api_reference: 0.05,
    migration: 0.0,
    changelog: 0.0,
  },
  file_anchored: {
    api_reference: 0.20,
    guide: 0.15,
    runbook: 0.10,
    concept: 0.05,
    migration: 0.0,
  },
  signal_empty: {},
};

export type ScoreArgs = {
  candidate: ProfileEnrichedSourceCandidate;
  query_tokens: string[];
  intent: QueryIntent;
  /**
   * Optional per-query token rarity over the current candidate set. Higher
   * means the token is more discriminative as source-owner evidence.
   */
  query_token_weights?: Map<string, number>;
  /**
   * PRD-0023 / slice 23.3 — when true, additive path-topology boosts
   * are added to the score. When undefined, the boost block falls
   * back to the env flag (which itself defaults to
   * `PATH_TOPOLOGY_BOOSTS_DEFAULT_ON`).
   */
  enable_path_topology_boosts?: boolean;
};

function tokenize(text: string): string[] {
  return tokenizeRetrievalText(text);
}

function tokenizeOwnerSurface(text: string): string[] {
  return tokenizeRetrievalText(text, { splitCodeIdentifiers: false });
}

function coverage(queryTokens: string[], targetTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const set = new Set(targetTokens);
  let hits = 0;
  for (const t of queryTokens) {
    if (set.has(t)) hits += 1;
  }
  return hits / queryTokens.length;
}

export function scoreSourceRerank(args: ScoreArgs): ScoredSourceRerank {
  const { candidate, query_tokens, intent } = args;
  const profile = candidate.profile;
  const lower_query = query_tokens.map((t) => t.toLowerCase());
  const owner_query_tokens = ownerQueryTokens(lower_query);

  const titleTokens = profile ? tokenize(profile.title) : [];
  const pathTokens = tokenize(candidate.source_path);
  const headingTokens = profile
    ? profile.heading_outline.flatMap((h) => tokenize(h.text))
    : [];
  const titleOwnerTokens = profile ? tokenizeOwnerSurface(profile.title) : [];
  const pathOwnerTokens = tokenizeOwnerSurface(candidate.source_path);
  const filenameOwnerTokens = tokenizeOwnerSurface(filenameStem(candidate.source_path));
  const headingOwnerTokens = profile
    ? profile.heading_outline.flatMap((h) => tokenizeOwnerSurface(h.text))
    : [];
  const introOwnerTokens = profile?.intro ? tokenizeOwnerSurface(profile.intro) : [];

  const title_token_coverage = coverage(lower_query, titleTokens);
  const path_token_coverage = coverage(lower_query, pathTokens);
  const title_path_agreement = Math.min(title_token_coverage, path_token_coverage);
  let heading_token_coverage = coverage(lower_query, headingTokens);
  // PRD-0024 / slice 24.1.3: when RETRIEVAL_HEADING_ALIASES is on AND
  // the profile carries structured heading_aliases, broaden the match
  // path. The coefficient is unchanged. Phrase-substring matches
  // (query phrase appears verbatim inside any alias.normalized after
  // alphanumeric normalization) raise heading_token_coverage to 1.0
  // — they are strictly stronger evidence than per-token coverage,
  // which can miss when hyphenation or casing differences fragment
  // the query.
  if (
    headingAliasesEnabledFromEnv() &&
    profile?.heading_aliases &&
    profile.heading_aliases.length > 0 &&
    headingAliasPhraseMatch(lower_query, profile.heading_aliases)
  ) {
    heading_token_coverage = 1;
  }
  const filename_token_coverage = weightedCoverage(
    owner_query_tokens,
    filenameOwnerTokens,
    args.query_token_weights,
  );
  const intro_token_coverage = weightedCoverage(
    owner_query_tokens,
    introOwnerTokens,
    args.query_token_weights,
  );
  // THO-137: prefer the multi-path fused rank for the prior — it captures
  // independent agreement across alias/anchor/title/heading paths instead of
  // a single chunk-lexical signal. Falls back when fusion is not in play.
  const rankForPrior =
    candidate.fused_rank !== undefined && candidate.fused_rank > 0
      ? candidate.fused_rank
      : candidate.best_chunk_rank;
  const source_rank_prior = 1 / Math.sqrt(Math.max(rankForPrior, 1));

  let alias_hit_count = 0;
  const identityAliasTokens: string[] = [];
  if (profile) {
    const aliasTokens = new Set<string>();
    for (const a of profile.aliases) {
      const toks = tokenize(a.value);
      for (const t of toks) aliasTokens.add(t);
      if (
        a.kind === "filename" ||
        a.kind === "path" ||
        a.kind === "title" ||
        a.kind === "package" ||
        a.kind === "symbol" ||
        a.kind === "route"
      ) {
        identityAliasTokens.push(...tokenizeOwnerSurface(a.value));
      }
    }
    // PRD-0024 / slice 24.2.3: extracted code-fence entities feed the
    // existing alias substrate alongside title / path / heading aliases.
    // The match is exact (set-membership over the existing stemmed
    // token space, same shape as the alias path above) — no partial /
    // fuzzy / phrase-substring for entities in v1. Identity-shaped
    // kinds (symbol, route, package, config_file, import) also feed
    // owner_identity_score's token-rarity-weighted overlap path.
    if (codeFenceEntitiesEnabledFromEnv()) {
      for (const e of profile.code_fence_entities ?? []) {
        for (const t of tokenize(e.value)) aliasTokens.add(t);
        if (isIdentityShapedEntity(e.kind)) {
          identityAliasTokens.push(...tokenizeOwnerSurface(e.value));
        }
      }
    }
    // PRD-0027 / slice 27.1.3: nav_label feeds the alias substrate
    // only when provenance says it came from explicit project nav or
    // author frontmatter. Structural fallback labels remain
    // explain-only so README/index guesses do not become ranking
    // authority. No new score-component coefficient.
    if (shouldConsumeNavLabel(profile)) {
      for (const t of tokenize(profile.nav_label)) aliasTokens.add(t);
      identityAliasTokens.push(...tokenizeOwnerSurface(profile.nav_label));
    }
    for (const t of lower_query) {
      if (aliasTokens.has(t)) alias_hit_count += 1;
    }
  }
  const titleOwnerCoverage = weightedCoverage(
    owner_query_tokens,
    titleOwnerTokens,
    args.query_token_weights,
  );
  const pathOwnerCoverage = weightedCoverage(
    owner_query_tokens,
    pathOwnerTokens,
    args.query_token_weights,
  );
  const headingOwnerCoverage = weightedCoverage(
    owner_query_tokens,
    headingOwnerTokens,
    args.query_token_weights,
  );
  const aliasOwnerCoverage = weightedCoverage(
    owner_query_tokens,
    identityAliasTokens,
    args.query_token_weights,
  );
  const strongestIdentityToken = Math.max(
    strongestWeightedHit(owner_query_tokens, filenameOwnerTokens, args.query_token_weights),
    strongestWeightedHit(owner_query_tokens, titleOwnerTokens, args.query_token_weights) * 0.9,
    strongestWeightedHit(owner_query_tokens, pathOwnerTokens, args.query_token_weights) * 0.75,
  );
  const identityTokenHit = Math.max(
    strongestWeightedHit(owner_query_tokens, filenameOwnerTokens, args.query_token_weights),
    strongestWeightedHit(owner_query_tokens, titleOwnerTokens, args.query_token_weights),
  ) > 0;
  const owner_identity_score = computeOwnerIdentityScore({
    filename: filename_token_coverage,
    title: titleOwnerCoverage,
    path: pathOwnerCoverage,
    heading: headingOwnerCoverage,
    intro: intro_token_coverage,
    alias: aliasOwnerCoverage,
    strongest_identity_token: strongestIdentityToken,
    intent,
  });
  const overview_owner_score = computeOverviewOwnerScore({
    candidate,
    query_tokens: lower_query,
    owner_query_tokens,
    topic_coverage: Math.max(
      titleOwnerCoverage,
      pathOwnerCoverage,
      headingOwnerCoverage,
      intro_token_coverage,
      aliasOwnerCoverage,
    ),
  });

  const queryAsksMigration = queryTokensAskMigration(query_tokens);

  // Purpose/intent compatibility — 0 when no profile.
  let purpose_compat_bonus = 0;
  if (profile) {
    const map = PURPOSE_COMPAT[intent] ?? {};
    purpose_compat_bonus = map[profile.doc_purpose] ?? 0;
    if (
      queryAsksMigration &&
      (profile.doc_purpose === "migration" ||
        profile.doc_purpose === "changelog" ||
        profile.doc_purpose === "release_note")
    ) {
      purpose_compat_bonus = Math.max(purpose_compat_bonus, 0.30);
    }
  }

  // Distractor penalty: migration/changelog/release_note demoted unless the
  // query explicitly asks for migration/upgrade/version/breaking.
  let distractor_penalty = 0;
  if (
    profile &&
    (profile.doc_purpose === "migration" ||
      profile.doc_purpose === "changelog" ||
      profile.doc_purpose === "release_note") &&
    !queryAsksMigration
  ) {
    distractor_penalty = -0.20;
  }
  // Reference page demoted for decision/concept queries unless symbol intent.
  if (
    profile &&
    profile.doc_purpose === "api_reference" &&
    intent === "decision_lookup"
  ) {
    distractor_penalty -= 0.10;
  }

  const broad_container_penalty = computeBroadContainerPenalty({
    candidate,
    intent,
    identity_coverage: Math.max(
      filename_token_coverage,
      titleOwnerCoverage,
      pathOwnerCoverage,
      aliasOwnerCoverage,
    ),
    support_coverage: Math.max(headingOwnerCoverage, intro_token_coverage),
    overview_owner_score,
  });
  const leaf_specificity_penalty = computeLeafSpecificityPenalty({
    candidate,
    intent,
    owner_query_tokens,
    title_tokens: titleOwnerTokens,
    filename_tokens: filenameOwnerTokens,
    path_owner_coverage: pathOwnerCoverage,
    title_owner_coverage: titleOwnerCoverage,
    filename_owner_coverage: filename_token_coverage,
    identity_token_hit: identityTokenHit,
    query_token_weights: args.query_token_weights,
  });

  // Role penalty: archive/ideation get a small demotion vs canonical/example.
  let role_penalty = 0;
  if (profile?.doc_role === "archive") role_penalty = -0.15;
  else if (profile?.doc_role === "ideation") role_penalty = -0.05;

  // PRD-0023 / slice 23.3: additive path-topology boosts. Flag-gated
  // so the displayed baseline is preserved until promotion gates pass.
  const enableBoosts =
    args.enable_path_topology_boosts ?? pathTopologyBoostsEnabledFromEnv();
  const enableConditional = pathTopologyConditionalBoostsEnabledFromEnv();
  const path_topology_boost = enableBoosts
    ? computePathTopologyBoost({
        profile,
        query_tokens: lower_query,
      })
    : enableConditional
      ? computePathTopologyBoost({
          profile,
          query_tokens: lower_query,
          conditional_only: true,
        })
      : 0;

  const score =
    candidate.best_chunk_score * 0.62 +
    source_rank_prior * 0.08 +
    title_token_coverage * 0.28 +
    path_token_coverage * 0.30 +
    title_path_agreement * 0.20 +
    heading_token_coverage * 0.05 +
    filename_token_coverage * 0.18 +
    intro_token_coverage * 0.05 +
    Math.min(alias_hit_count, 4) * 0.025 +
    owner_identity_score * 0.72 +
    overview_owner_score * 0.65 +
    purpose_compat_bonus * 0.35 +
    distractor_penalty +
    broad_container_penalty +
    leaf_specificity_penalty +
    role_penalty +
    path_topology_boost;

  return {
    score,
    features: {
      lexical_chunk_score: candidate.best_chunk_score,
      source_rank_prior,
      title_token_coverage,
      path_token_coverage,
      title_path_agreement,
      heading_token_coverage,
      filename_token_coverage,
      intro_token_coverage,
      alias_hit_count,
      owner_identity_score,
      overview_owner_score,
      purpose_compat_bonus,
      distractor_penalty,
      broad_container_penalty,
      leaf_specificity_penalty,
      role_penalty,
    },
  };
}

export type RerankInput = {
  candidates: ProfileEnrichedSourceCandidate[];
  query_tokens: string[];
  intent: QueryIntent;
  /** PRD-0022: caller anchors used by close-call tiebreakers. */
  query_anchors?: {
    files?: string[];
    symbols?: string[];
    routes?: string[];
  };
  /**
   * PRD-0022 Rule 2: un-stemmed query tokens (raw lowercase). Used to
   * distinguish surface-form vs stemmed basename matches. Optional —
   * when missing, Rule 2 falls back to query_tokens with degraded
   * surface-match resolution.
   */
  query_raw_tokens?: string[];
  /** PRD-0022: override the env-driven tiebreakers gate (tests). */
  enable_tiebreakers?: boolean;
};

export type RerankedSource = {
  rank: number;
  candidate: ProfileEnrichedSourceCandidate;
  score: number;
  features: SourceRerankFeatures;
  /** Original best_chunk_rank-derived rank, captured before reranking. */
  original_rank: number;
};

export function rerankSourceCandidates(args: RerankInput): RerankedSource[] {
  return rerankSourceCandidatesWithTrace(args).reranked;
}

export type RerankWithTraceResult = {
  reranked: RerankedSource[];
  /** PRD-0022: post-sort tiebreaker explain entries. Empty when the
   *  feature flag is off or no rule fired. */
  tiebreaker_trace: CloseCallTiebreakerEntry[];
};

export function rerankSourceCandidatesWithTrace(
  args: RerankInput,
): RerankWithTraceResult {
  const queryTokenWeights = computeQueryTokenWeights(args.candidates, args.query_tokens);
  const scored = args.candidates.map((c) => {
    const s = scoreSourceRerank({
      candidate: c,
      query_tokens: args.query_tokens,
      intent: args.intent,
      query_token_weights: queryTokenWeights,
    });
    return {
      candidate: c,
      score: s.score,
      features: s.features,
      original_rank: c.rank,
    };
  });
  if (hierarchyInheritanceEnabledFromEnv()) {
    applyHierarchyInheritance(scored, args.intent);
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.candidate.best_chunk_rank !== b.candidate.best_chunk_rank) {
      return a.candidate.best_chunk_rank - b.candidate.best_chunk_rank;
    }
    return a.candidate.source_path.localeCompare(b.candidate.source_path);
  });
  const sorted: RerankedSource[] = scored.map((s, idx) => ({ rank: idx + 1, ...s }));

  const enableTiebreakers =
    args.enable_tiebreakers ?? tiebreakersEnabledFromEnv();
  if (!enableTiebreakers || sorted.length < 2) {
    return { reranked: sorted, tiebreaker_trace: [] };
  }
  const tiebreakerResult = applyCloseCallTiebreakers({
    reranked: sorted,
    query_tokens: args.query_tokens,
    query_raw_tokens: args.query_raw_tokens,
    query_anchors: args.query_anchors,
  });
  return {
    reranked: tiebreakerResult.reranked,
    tiebreaker_trace: tiebreakerResult.trace,
  };
}

export function tokenizeForRerank(query: string): string[] {
  return tokenize(query);
}

const OWNER_QUERY_NOISE_TOKENS = new Set([
  "what",
  "how",
  "why",
  "which",
  "when",
  "where",
  "who",
  "choo",
  "use",
  "us",
  "set",
  "setup",
  "up",
  "config",
  "configur",
  "run",
  "read",
  "write",
  "creat",
  "add",
  "enabl",
  "manag",
  "control",
  "protect",
  "check",
  "handl",
  "wire",
  "work",
  "singl",
  "multipl",
  "on",
  "one",
  "file",
  "test",
  "api",
  "json",
  "ts",
  "js",
]);

const OVERVIEW_QUERY_TOKENS = new Set([
  "what",
  "overview",
  "intro",
  "introduct",
  "explain",
  "concept",
  "basic",
  "orient",
  "understand",
  "pictur",
  "primer",
  "guid",
]);

const OVERVIEW_SOURCE_TOKENS = new Set([
  "overview",
  "intro",
  "introduct",
  "readm",
  "index",
  "start",
]);

const BROAD_FILENAME_TOKENS = new Set([
  "index",
  "readm",
  "overview",
  "config",
  "configur",
  "configuration",
  "api",
  "refer",
  "reference",
  "feature",
  "advanced",
]);

function ownerQueryTokens(tokens: string[]): string[] {
  const unique = dedupePreserveOrder(tokens.flatMap((t) => equivalentTokens(t)));
  const filtered = unique.filter((t) => !OWNER_QUERY_NOISE_TOKENS.has(t));
  return filtered.length > 0 ? filtered : unique;
}

function filenameStem(sourcePath: string): string {
  const leaf = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  return leaf.replace(/\.[^.]+$/, "");
}

function parentDirName(sourcePath: string): string {
  const parts = sourcePath.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return "";
  return parts[parts.length - 2] ?? "";
}

function expandedTokenSet(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const token of tokens) {
    for (const equivalent of equivalentTokens(token)) out.add(equivalent);
  }
  return out;
}

function equivalentTokens(token: string): string[] {
  switch (token) {
    case "auth":
    case "authent":
    case "author":
    case "authoriz":
      return ["auth", "authent", "author", "authoriz"];
    case "cli":
    case "command":
    case "line":
    case "interfac":
      return ["cli", "command", "line", "interfac"];
    case "jsonrpc":
    case "json_rpc":
    case "rpc":
      return ["rpc", "jsonrpc", "json_rpc"];
    default:
      return [token];
  }
}

function tokenMatches(token: string, targetExpanded: Set<string>): boolean {
  return equivalentTokens(token).some((equivalent) => targetExpanded.has(equivalent));
}

function tokenWeight(
  token: string,
  weights?: Map<string, number>,
): number {
  if (!weights) return 1;
  return weights.get(token) ?? 1;
}

function weightedCoverage(
  queryTokens: string[],
  targetTokens: string[],
  weights?: Map<string, number>,
): number {
  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;
  const targetExpanded = expandedTokenSet(targetTokens);
  let total = 0;
  let matched = 0;
  for (const token of queryTokens) {
    const w = tokenWeight(token, weights);
    total += w;
    if (tokenMatches(token, targetExpanded)) matched += w;
  }
  // Divide by token count instead of matched-token total so a single common
  // corpus/product token does not become perfect owner evidence by itself.
  return total > 0 ? matched / queryTokens.length : 0;
}

function strongestWeightedHit(
  queryTokens: string[],
  targetTokens: string[],
  weights?: Map<string, number>,
): number {
  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;
  const targetExpanded = expandedTokenSet(targetTokens);
  let maxHit = 0;
  for (const token of queryTokens) {
    const w = tokenWeight(token, weights);
    if (tokenMatches(token, targetExpanded)) maxHit = Math.max(maxHit, w);
  }
  return maxHit;
}

function computeOwnerIdentityScore(args: {
  filename: number;
  title: number;
  path: number;
  heading: number;
  intro: number;
  alias: number;
  strongest_identity_token: number;
  intent: QueryIntent;
}): number {
  const identity = Math.max(
    args.filename,
    args.title * 0.9,
    args.path * 0.78,
    args.alias * 0.72,
    args.strongest_identity_token * 0.82,
  );
  const support = Math.max(args.heading * 0.22, args.intro * 0.25);
  const identitySurfaces = [args.filename, args.title, args.path, args.alias].filter(
    (v) => v >= 0.20,
  ).length;
  const supportSurfaces = [args.heading, args.intro].filter((v) => v >= 0.20).length;
  let score = identity + support;
  if (identitySurfaces >= 2) score += 0.10;
  if (identitySurfaces >= 1 && supportSurfaces >= 1) score += 0.08;
  if (args.intent === "file_anchored" && args.filename > 0 && identitySurfaces >= 2) {
    score += 0.10;
  }
  return clamp01(score);
}

function computeOverviewOwnerScore(args: {
  candidate: ProfileEnrichedSourceCandidate;
  query_tokens: string[];
  owner_query_tokens: string[];
  topic_coverage: number;
}): number {
  if (!queryIsOverviewShape(args.query_tokens)) return 0;
  if (!isOverviewLikeSource(args.candidate)) return 0;
  if (args.topic_coverage <= 0) return 0;
  const leaf = filenameStem(args.candidate.source_path).toLowerCase();
  const leafBonus = leaf === "overview" || leaf === "readme" ? 0.10 : 0;
  const singleTopicBonus = args.owner_query_tokens.length <= 1 ? 0.10 : 0;
  return clamp01(0.52 + args.topic_coverage * 0.35 + leafBonus + singleTopicBonus);
}

function computeBroadContainerPenalty(args: {
  candidate: ProfileEnrichedSourceCandidate;
  intent: QueryIntent;
  identity_coverage: number;
  support_coverage: number;
  overview_owner_score: number;
}): number {
  const profile = args.candidate.profile;
  if (!profile) return 0;
  if (args.overview_owner_score > 0.5) return 0;
  const leafTokens = tokenize(filenameStem(args.candidate.source_path));
  const titleTokens = tokenize(profile.title);
  const broadName =
    leafTokens.some((t) => BROAD_FILENAME_TOKENS.has(t)) ||
    titleTokens.some((t) => BROAD_FILENAME_TOKENS.has(t));
  const largeContainer = profile.token_count >= 2500 || profile.chunk_count >= 15;
  const headingDominant =
    args.support_coverage >= 0.20 && args.identity_coverage < 0.15;
  let penalty = 0;
  if (headingDominant && largeContainer) {
    penalty -= args.intent === "file_anchored" ? 0.22 : 0.15;
  }
  if (headingDominant && broadName) {
    penalty -= 0.12;
  }
  if (
    profile.doc_purpose === "api_reference" &&
    (args.intent === "broad_domain" || args.intent === "file_anchored") &&
    args.identity_coverage < 0.35
  ) {
    penalty -= 0.10;
  }
  if (broadName && args.identity_coverage < 0.20 && args.support_coverage > 0) {
    penalty -= 0.08;
  }
  return Math.max(penalty, -0.42);
}

function computeLeafSpecificityPenalty(args: {
  candidate: ProfileEnrichedSourceCandidate;
  intent: QueryIntent;
  owner_query_tokens: string[];
  title_tokens: string[];
  filename_tokens: string[];
  path_owner_coverage: number;
  title_owner_coverage: number;
  filename_owner_coverage: number;
  identity_token_hit: boolean;
  query_token_weights?: Map<string, number>;
}): number {
  if (args.intent !== "broad_domain" && args.intent !== "decision_lookup") return 0;
  const leaf = filenameStem(args.candidate.source_path).toLowerCase();
  if (leaf === "index" || leaf === "readme" || leaf === "overview") return 0;
  if (args.identity_token_hit) return 0;
  if (args.path_owner_coverage < 0.20) return 0;
  if (Math.max(args.title_owner_coverage, args.filename_owner_coverage) >= 0.35) {
    return 0;
  }
  const identityTokens = [...args.title_tokens, ...args.filename_tokens].filter(
    (t) => !OWNER_QUERY_NOISE_TOKENS.has(t),
  );
  if (identityTokens.length === 0) return 0;
  const queryExpanded = expandedTokenSet(args.owner_query_tokens);
  const unmatchedIdentityTokens = identityTokens.filter(
    (t) => !equivalentTokens(t).some((equivalent) => queryExpanded.has(equivalent)),
  );
  if (unmatchedIdentityTokens.length === 0) return 0;
  const strongestHit = Math.max(
    strongestWeightedHit(
      args.owner_query_tokens,
      args.title_tokens,
      args.query_token_weights,
    ),
    strongestWeightedHit(
      args.owner_query_tokens,
      args.filename_tokens,
      args.query_token_weights,
    ),
  );
  return strongestHit < 0.5 ? -0.10 : 0;
}

function computeQueryTokenWeights(
  candidates: ProfileEnrichedSourceCandidate[],
  queryTokens: string[],
): Map<string, number> {
  const ownerTokens = ownerQueryTokens(queryTokens.map((t) => t.toLowerCase()));
  const out = new Map<string, number>();
  if (ownerTokens.length === 0 || candidates.length === 0) return out;
  const df = new Map<string, number>();
  for (const token of ownerTokens) df.set(token, 0);
  for (const candidate of candidates) {
    const sourceTokens = expandedTokenSet(sourceStructuralTokens(candidate));
    for (const token of ownerTokens) {
      if (tokenMatches(token, sourceTokens)) {
        df.set(token, (df.get(token) ?? 0) + 1);
      }
    }
  }
  const n = Math.max(candidates.length, 1);
  const maxIdf = Math.log(n + 1);
  for (const token of ownerTokens) {
    const count = df.get(token) ?? 0;
    const raw = count === 0
      ? 0.55
      : 0.20 + Math.log((n + 1) / (count + 1)) / Math.max(maxIdf, 1e-6);
    out.set(token, Math.max(0.18, Math.min(1, raw)));
  }
  return out;
}

function sourceStructuralTokens(candidate: ProfileEnrichedSourceCandidate): string[] {
  const profile = candidate.profile;
  const out = [
    ...tokenizeOwnerSurface(candidate.source_path),
    ...tokenizeOwnerSurface(filenameStem(candidate.source_path)),
  ];
  if (profile) {
    out.push(...tokenizeOwnerSurface(profile.title));
    if (profile.h1) out.push(...tokenizeOwnerSurface(profile.h1));
    if (profile.intro) out.push(...tokenizeOwnerSurface(profile.intro));
    for (const heading of profile.heading_outline) {
      out.push(...tokenizeOwnerSurface(heading.text));
    }
    for (const alias of profile.aliases) out.push(...tokenizeOwnerSurface(alias.value));
    if (shouldConsumeNavLabel(profile)) {
      out.push(...tokenizeOwnerSurface(profile.nav_label));
    }
    // PRD-0024 / slice 24.2.3: entity surfaces feed the DF-weighting
    // loop so query tokens that match identity-shaped entities get
    // the same IDF treatment as alias hits. Gated by the same flag
    // as the consumption paths so the displayed baseline is preserved
    // until promotion.
    if (codeFenceEntitiesEnabledFromEnv()) {
      for (const e of profile.code_fence_entities ?? []) {
        if (isIdentityShapedEntity(e.kind)) {
          out.push(...tokenizeOwnerSurface(e.value));
        }
      }
    }
  }
  return out;
}

function queryIsOverviewShape(queryTokens: string[]): boolean {
  if (queryTokens.some((t) => t !== "what" && OVERVIEW_QUERY_TOKENS.has(t))) {
    return true;
  }
  if (queryTokens.includes("how") && queryTokens.includes("work")) return true;
  if (!queryTokens.includes("what")) return false;
  return ownerQueryTokens(queryTokens).length <= 1;
}

function isOverviewLikeSource(candidate: ProfileEnrichedSourceCandidate): boolean {
  const profile = candidate.profile;
  const leaf = filenameStem(candidate.source_path).toLowerCase();
  if (leaf === "overview" || leaf === "index" || leaf === "readme") return true;
  if (!profile) return false;
  // PRD-0027 / slice 27.1.3: only explicit project nav can make a
  // landing authoritative for overview-owner scoring. Frontmatter
  // landings and structural README/index guesses remain advisory.
  if (shouldConsumeNavLanding(profile)) return true;
  const sourceTokens = [
    ...tokenizeOwnerSurface(profile.title),
    ...tokenizeOwnerSurface(parentDirName(candidate.source_path)),
  ];
  return sourceTokens.some((token) => OVERVIEW_SOURCE_TOKENS.has(token));
}

function shouldConsumeNavLabel(profile: SourceProfile): profile is SourceProfile & { nav_label: string } {
  if (!navMetadataEnabledFromEnv() || !profile.nav_label) return false;
  return (
    profile.nav_provenance === "explicit_config" ||
    profile.nav_provenance === "frontmatter"
  );
}

function shouldConsumeNavLanding(profile: SourceProfile): boolean {
  if (!navMetadataEnabledFromEnv()) return false;
  return (
    profile.is_nav_landing === true &&
    profile.nav_provenance === "explicit_config"
  );
}

/**
 * PRD-0024 / slice 24.2.3 — code-fence entity kinds whose surface
 * carries owner-identity evidence (the same shape as filename / path /
 * title / package / symbol / route aliases). Config keys and CLI
 * commands are evidence the document *uses* a feature but not that
 * it *owns* the named identity, so they participate in
 * alias_hit_count but not in owner_identity_score.
 */
function isIdentityShapedEntity(kind: CodeFenceEntity["kind"]): boolean {
  return (
    kind === "symbol" ||
    kind === "route" ||
    kind === "package_name" ||
    kind === "config_file" ||
    kind === "import"
  );
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

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * PRD-0023 / slice 23.3: principled boost composition over the
 * import-time path-topology fields on `SourceProfile`. Returns 0 when
 * the profile is missing or carries no topology signal.
 *
 * Magnitudes are fixed (no tuning against the failing cohort):
 *
 *   landing       +0.35
 *   index         +0.20
 *   package match +0.30 when the profile's `package_segment` matches
 *                 a tokenized query content token
 *   version match +0.30 when the profile's `version_segment` matches
 *                 a query content token
 *   depth decay   −0.05 per directory level beyond depth 2
 *
 * Maximum positive contribution per candidate from path topology is
 * `+1.15` (landing+index+package+version simultaneously). Depth decay
 * is small per-step so it never dominates other signals.
 */
export type PathTopologyBoostArgs = {
  profile: {
    is_index_file?: boolean;
    is_section_landing?: boolean;
    package_segment?: string | null;
    version_segment?: string | null;
    path_depth?: number;
  } | null;
  query_tokens: string[];
  /**
   * When `true`, skips the unconditional boosts (landing, index, depth
   * decay) and applies only the boosts that self-gate on query-token
   * match (package_segment, version_segment). Used by the default-on
   * conditional pipeline.
   */
  conditional_only?: boolean;
};

export function computePathTopologyBoost(args: PathTopologyBoostArgs): number {
  const { profile, query_tokens, conditional_only } = args;
  if (!profile) return 0;

  let boost = 0;

  if (!conditional_only) {
    if (profile.is_section_landing) boost += PATH_TOPOLOGY_LANDING_BOOST;
    if (profile.is_index_file) boost += PATH_TOPOLOGY_INDEX_BOOST;
  }

  const queryTokenSet = new Set(query_tokens.map((t) => t.toLowerCase()));
  if (
    profile.package_segment &&
    segmentMatchesQueryTokens(profile.package_segment, queryTokenSet)
  ) {
    boost += PATH_TOPOLOGY_PACKAGE_MATCH_BOOST;
  }
  if (
    profile.version_segment &&
    segmentMatchesQueryTokens(profile.version_segment, queryTokenSet)
  ) {
    boost += PATH_TOPOLOGY_VERSION_MATCH_BOOST;
  }

  if (!conditional_only) {
    if (
      typeof profile.path_depth === "number" &&
      profile.path_depth > PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS
    ) {
      const beyond = profile.path_depth - PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS;
      boost -= PATH_TOPOLOGY_DEPTH_DECAY_PER_LEVEL * beyond;
    }
  }

  return boost;
}

/**
 * A path-topology segment matches the query when any tokenized form of
 * the segment overlaps with a query token. The segment is first split
 * on path-segment separators (`-`, `_`, `.`) before stemming so
 * `eslint-plugin` matches a query containing `eslint` or `plugin`.
 * The exact-string lowercase form is also accepted so segments that
 * the stemmer collapses (`v3` → `v3`) don't lose their match.
 */
function segmentMatchesQueryTokens(
  segment: string,
  queryTokenSet: Set<string>,
): boolean {
  const segmentLower = segment.toLowerCase();
  if (queryTokenSet.has(segmentLower)) return true;
  const parts = segmentLower.split(/[-_.]+/).filter((p) => p.length > 0);
  for (const part of parts) {
    if (queryTokenSet.has(part)) return true;
    for (const token of tokenize(part)) {
      if (queryTokenSet.has(token)) return true;
    }
  }
  return false;
}
