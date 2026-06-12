/**
 * Deterministic pairwise source adjudicator.
 *
 * Compares two top-N source cards on a small set of evidence axes:
 *
 *   - phrase / proximity strength (title/H1/path > heading > intro > body)
 *   - source role compatibility with the active query intent
 *   - canonicality (parent overview vs leaf detail)
 *   - source-family relationship (parent over its own children for
 *     broad/concept queries, otherwise neutral)
 *   - role-specific intent compat (changelog for release intent,
 *     migration for upgrade intent, decision for decision_lookup, …)
 *
 * Each contributing axis emits an enum reason code so the caller can
 * report exactly which signal moved the decision. The function is
 * bounded — it returns winner="tie" with low confidence when no axis
 * is decisive, so the live integration can apply it only to
 * close-call top-N pairs.
 *
 * The adjudicator never makes signal-empty or unsupported cases more
 * confident: when neither candidate has decisive evidence the tie
 * path is taken.
 */
import type { SourceCard } from "./source-card.js";
import type { QueryIntent } from "./source-rerank.js";
import type { PhraseHit, PhraseProximityField } from "./phrase-proximity.js";
import type { SourceRole } from "./source-role.js";
import type { PairwiseRerankAdapter } from "./pairwise-rerank.js";

export type AdjudicationWinner = "a" | "b" | "tie";
export type AdjudicationConfidence = "high" | "medium" | "low";

export type AdjudicationReasonCode =
  | "phrase_proximity_stronger"
  | "role_compat_guide_for_broad"
  | "role_compat_concept_for_broad"
  | "role_compat_overview_for_broad"
  | "role_compat_api_for_exact"
  | "role_compat_decision_for_decision_lookup"
  | "role_compat_changelog_for_release_intent"
  | "role_compat_migration_for_upgrade_intent"
  | "role_compat_troubleshooting_for_symptom"
  | "canonicality_parent_for_broad"
  | "canonicality_leaf_for_exact"
  | "family_parent_over_child"
  | "anchor_provenance_evidence"
  | "coverage_evidence_stronger"
  // Corpus-general precision signals.
  | "anchor_symbol_basename_match"
  | "title_token_coverage_decisive";

export type AdjudicationOutcome = {
  winner: AdjudicationWinner;
  confidence: AdjudicationConfidence;
  margin: number;
  reason_codes: AdjudicationReasonCode[];
};

export type AdjudicateSourcePairArgs = {
  a: SourceCard;
  b: SourceCard;
  query_intent: QueryIntent;
};

/** Per-axis votes accumulate into this small ledger so reason codes
 *  follow the actual movement. */
type Vote = {
  delta: number; // positive favors a; negative favors b
  reason: AdjudicationReasonCode;
};

const HIT_RANK: Record<PhraseHit, number> = {
  exact: 4,
  near: 3,
  ordered: 2,
  scattered: 1,
  none: 0,
};

const STRUCTURAL_FIELDS: ReadonlySet<PhraseProximityField> = new Set([
  "path",
  "title",
  "h1",
  "heading",
]);

export function adjudicateSourcePair(args: AdjudicateSourcePairArgs): AdjudicationOutcome {
  const { a, b, query_intent } = args;
  const votes: Vote[] = [];

  votes.push(...phraseProximityVotes(a, b));
  votes.push(...roleCompatVotes(a, b, query_intent));
  votes.push(...canonicalityVotes(a, b, query_intent));
  votes.push(...familyVotes(a, b, query_intent));
  votes.push(...anchorSymbolBasenameVotes(a, b));
  votes.push(...titleTokenCoverageVotes(a, b));

  // Sum directional votes.
  const margin = votes.reduce((sum, v) => sum + v.delta, 0);
  const winner: AdjudicationWinner = margin > 0 ? "a" : margin < 0 ? "b" : "tie";

  const absMargin = Math.abs(margin);
  const confidence: AdjudicationConfidence =
    absMargin >= 3 ? "high" : absMargin >= 2 ? "medium" : "low";

  // Reason codes from votes that actually moved in the winning
  // direction (or, when tied, from any contributing vote so the
  // caller can see what was looked at).
  const reasonCodes = dedupe(
    votes
      .filter((v) =>
        winner === "a"
          ? v.delta > 0
          : winner === "b"
            ? v.delta < 0
            : v.delta !== 0,
      )
      .map((v) => v.reason),
  );

  return {
    winner,
    confidence,
    margin,
    reason_codes: reasonCodes,
  };
}

function phraseProximityVotes(a: SourceCard, b: SourceCard): Vote[] {
  const aProx = a.phrase_proximity;
  const bProx = b.phrase_proximity;
  if (!aProx || !bProx) return [];
  const aRank = HIT_RANK[aProx.best_hit] + (STRUCTURAL_FIELDS.has(aProx.best_field) ? 1 : 0);
  const bRank = HIT_RANK[bProx.best_hit] + (STRUCTURAL_FIELDS.has(bProx.best_field) ? 1 : 0);
  if (aRank === bRank) return [];
  // Scale: a meaningful structural-vs-body or exact-vs-scattered gap
  // is worth ~2 votes; smaller gaps worth 1.
  const diff = aRank - bRank;
  const magnitude = Math.abs(diff) >= 2 ? 2 : 1;
  return [
    {
      delta: diff > 0 ? magnitude : -magnitude,
      reason: "phrase_proximity_stronger",
    },
  ];
}

function roleCompatVotes(a: SourceCard, b: SourceCard, intent: QueryIntent): Vote[] {
  const votes: Vote[] = [];
  const aRole = a.source_role.role;
  const bRole = b.source_role.role;

  // Broad / domain queries prefer overview > guide > concept over
  // leafs — but only when the query has no more specific intent
  // (release / migration / decision / symptom), in which case those
  // role-specific votes below carry more weight.
  const queryWordsBroad = new Set([...a.query_tokens, ...b.query_tokens]);
  const hasSpecificIntent =
    queryWordsBroad.has("changelog") ||
    queryWordsBroad.has("release") ||
    queryWordsBroad.has("releases") ||
    queryWordsBroad.has("migration") ||
    queryWordsBroad.has("migrate") ||
    queryWordsBroad.has("upgrade");

  if (intent === "broad_domain" && !hasSpecificIntent) {
    const aBroad = broadFitScore(aRole);
    const bBroad = broadFitScore(bRole);
    if (aBroad !== bBroad) {
      const reason = pickBroadReason(aBroad >= bBroad ? aRole : bRole);
      if (reason) votes.push({ delta: aBroad - bBroad, reason });
    }
  }

  // Exact-symbol or file-anchored queries prefer api / reference / leaf.
  if (intent === "exact_symbol" || intent === "file_anchored") {
    if (aRole === "api" && bRole !== "api") votes.push({ delta: 1, reason: "role_compat_api_for_exact" });
    else if (bRole === "api" && aRole !== "api") votes.push({ delta: -1, reason: "role_compat_api_for_exact" });
  }

  if (intent === "decision_lookup") {
    if (aRole === "decision" && bRole !== "decision") {
      votes.push({ delta: 2, reason: "role_compat_decision_for_decision_lookup" });
    } else if (bRole === "decision" && aRole !== "decision") {
      votes.push({ delta: -2, reason: "role_compat_decision_for_decision_lookup" });
    } else if (aRole === "concept" && bRole !== "concept" && bRole !== "decision") {
      votes.push({ delta: 1, reason: "role_compat_decision_for_decision_lookup" });
    } else if (bRole === "concept" && aRole !== "concept" && aRole !== "decision") {
      votes.push({ delta: -1, reason: "role_compat_decision_for_decision_lookup" });
    }
  }

  // Symptom-debugging is not part of the QueryIntent enum; we surface
  // a troubleshooting preference when the query tokens look
  // symptom-shaped (error / fix / broken / why).
  const symptomQuery =
    a.query_tokens.some((t) => t === "error" || t === "fix" || t === "broken" || t === "why") ||
    b.query_tokens.some((t) => t === "error" || t === "fix" || t === "broken" || t === "why");
  if (symptomQuery) {
    if (aRole === "troubleshooting" && bRole !== "troubleshooting") {
      votes.push({ delta: 2, reason: "role_compat_troubleshooting_for_symptom" });
    } else if (bRole === "troubleshooting" && aRole !== "troubleshooting") {
      votes.push({ delta: -2, reason: "role_compat_troubleshooting_for_symptom" });
    }
  }

  // Release / migration intent comes from the QUERY tokens, not the
  // QueryIntent enum. Use a heuristic over the SourceCard's query
  // tokens — those are already lowercased and stop-filtered.
  const queryWords = new Set([...a.query_tokens, ...b.query_tokens]);
  const releaseIntent =
    queryWords.has("changelog") || queryWords.has("release") || queryWords.has("releases");
  const upgradeIntent =
    queryWords.has("migration") || queryWords.has("migrate") || queryWords.has("upgrade");

  if (releaseIntent) {
    if (aRole === "changelog" && bRole !== "changelog") {
      votes.push({ delta: 2, reason: "role_compat_changelog_for_release_intent" });
    } else if (bRole === "changelog" && aRole !== "changelog") {
      votes.push({ delta: -2, reason: "role_compat_changelog_for_release_intent" });
    }
  }
  if (upgradeIntent) {
    if (aRole === "migration" && bRole !== "migration") {
      votes.push({ delta: 2, reason: "role_compat_migration_for_upgrade_intent" });
    } else if (bRole === "migration" && aRole !== "migration") {
      votes.push({ delta: -2, reason: "role_compat_migration_for_upgrade_intent" });
    }
  }

  return votes;
}

function broadFitScore(role: SourceRole): number {
  switch (role) {
    case "overview":
      return 3;
    case "guide":
      return 2;
    case "concept":
      return 2;
    case "api":
    case "reference":
      return 0;
    case "child_detail":
      return 0;
    case "example":
      return 1;
    default:
      return 1;
  }
}

function pickBroadReason(role: SourceRole): AdjudicationReasonCode | null {
  if (role === "overview") return "role_compat_overview_for_broad";
  if (role === "guide") return "role_compat_guide_for_broad";
  if (role === "concept") return "role_compat_concept_for_broad";
  return null;
}

function canonicalityVotes(a: SourceCard, b: SourceCard, intent: QueryIntent): Vote[] {
  const aCan = a.source_role.canonicality;
  const bCan = b.source_role.canonicality;
  if (aCan === bCan) return [];

  if (intent === "broad_domain" || intent === "decision_lookup") {
    if (aCan === "parent" && bCan !== "parent") {
      return [{ delta: 1, reason: "canonicality_parent_for_broad" }];
    }
    if (bCan === "parent" && aCan !== "parent") {
      return [{ delta: -1, reason: "canonicality_parent_for_broad" }];
    }
  }

  if (intent === "exact_symbol" || intent === "file_anchored") {
    if (aCan === "child" && bCan !== "child") {
      return [{ delta: 1, reason: "canonicality_leaf_for_exact" }];
    }
    if (bCan === "child" && aCan !== "child") {
      return [{ delta: -1, reason: "canonicality_leaf_for_exact" }];
    }
  }

  return [];
}

function familyVotes(a: SourceCard, b: SourceCard, intent: QueryIntent): Vote[] {
  const aFam = a.source_family;
  const bFam = b.source_family;
  if (!aFam || !bFam) return [];
  if (aFam.family_id !== bFam.family_id) return [];

  // Within the same family, broad / concept queries prefer the parent
  // member over its child/sibling/cousin.
  if (intent === "broad_domain" || intent === "decision_lookup") {
    if (aFam.relationship === "parent" && bFam.relationship !== "parent") {
      return [{ delta: 1, reason: "family_parent_over_child" }];
    }
    if (bFam.relationship === "parent" && aFam.relationship !== "parent") {
      return [{ delta: -1, reason: "family_parent_over_child" }];
    }
  }
  return [];
}

/**
 * Corpus-general precision signal that survives the stemmer.
 *
 * The shared retrieval tokenizer aggressively stems / lowercases (e.g.
 * `useQuery`, `useQueries` and `usequery` all collapse to `usequeri`),
 * which is why a query carrying `useQuery` as an anchor symbol cannot
 * tell `useQuery.md` apart from `useQueries.md` on phrase evidence
 * alone. When the request supplies anchor symbols verbatim, we can
 * compare against the candidate's path basename without stemming and
 * cast a strong vote when exactly one candidate's basename equals an
 * anchor symbol.
 *
 * The match is case-preserving and requires the WHOLE basename stem
 * to equal the symbol — so `useQueries` will never be considered an
 * exact match for `useQuery`. Both candidates matching the same
 * symbol cancel out (no differentiator).
 */
function anchorSymbolBasenameVotes(a: SourceCard, b: SourceCard): Vote[] {
  const anchors = a.anchor_symbols.length > 0 ? a.anchor_symbols : b.anchor_symbols;
  if (!anchors || anchors.length === 0) return [];
  const aMatched = matchedAnchor(a.source_path, anchors);
  const bMatched = matchedAnchor(b.source_path, anchors);
  // Stronger match wins. tier 1 (exact case) > tier 2 (compound
  // containment) > no match. When both match at the same strength,
  // there is no differentiator, so no vote.
  const aStrength = strengthOfMatch(aMatched);
  const bStrength = strengthOfMatch(bMatched);
  if (aStrength === bStrength) return [];
  if (aStrength > bStrength) return [{ delta: 3, reason: "anchor_symbol_basename_match" }];
  return [{ delta: -3, reason: "anchor_symbol_basename_match" }];
}

function strengthOfMatch(match: AnchorMatch | null): number {
  if (!match) return 0;
  return match.tier === 1 ? 2 : 1;
}

type AnchorMatch = { anchor: string; tier: 1 | 2 };

function matchedAnchor(source_path: string, anchors: string[]): AnchorMatch | null {
  const segments = source_path.split("/");
  const basename = segments[segments.length - 1] ?? "";
  const stem = basename.replace(/\.[^.]+$/, "");
  if (!stem) return null;
  // Tier 1 — exact case-preserving match (`useQuery.md` vs anchor
  // `useQuery`). Strongest signal.
  for (const anchor of anchors) {
    if (anchor === stem) return { anchor, tier: 1 };
  }
  // Tier 2 — compound-anchor containment: a multi-segment anchor
  // (like `publicProcedure`, `vi.mock`, or `TestContext`) carries a
  // topic word that matches a candidate's basename. We split the
  // anchor on dots / case-boundaries and the basename on hyphens /
  // underscores; any matching part (case-insensitive, post-porter)
  // counts as a tier-2 hit.
  //
  // The basename forms we consider: the joined form ("test-context"
  // → "testcontext") and each hyphen/underscore-separated piece
  // ("test", "context"). This way a basename like `test-context.md`
  // ties with `context.md` against anchor `TestContext` instead of
  // losing to it.
  const baseForms = basenameForms(stem);
  if (baseForms.length === 0) return null;
  const anchorPartSets = anchors.map(splitAnchorParts);
  for (let i = 0; i < anchors.length; i += 1) {
    const parts = anchorPartSets[i]!;
    for (const baseForm of baseForms) {
      if (parts.includes(baseForm)) return { anchor: anchors[i]!, tier: 2 };
      const baseStem = porterStem(baseForm);
      if (!baseStem || baseStem.length < 4) continue;
      for (const part of parts) {
        if (porterStem(part) === baseStem) return { anchor: anchors[i]!, tier: 2 };
      }
    }
  }
  return null;
}

/** Return the comparable forms of a basename stem: the lowercase
 *  joined form (`test-context` → `testcontext`), the lowercase whole
 *  (same as joined when no separator), and each hyphen / underscore
 *  separated piece, all length ≥ 3. */
function basenameForms(stem: string): string[] {
  const lower = stem.toLowerCase();
  const out = new Set<string>();
  if (lower.length >= 3) out.add(lower);
  const joined = lower.replace(/[-_]/g, "");
  if (joined.length >= 3) out.add(joined);
  for (const part of lower.split(/[-_]+/)) {
    if (part.length >= 3) out.add(part);
  }
  // Filter to clean alphanumeric forms only — versioned basenames
  // like `0001-something` carry digit-prefixes that the porter stem
  // doesn't handle gracefully.
  return [...out].filter((f) => /^[a-z][a-z0-9]*$/.test(f));
}

/** Split a compound anchor symbol into meaningful lowercase parts:
 *  `publicProcedure` → ["publicprocedure", "public", "procedure"]
 *  `vi.mock`         → ["vi.mock", "vi", "mock"]
 *  Single-word lowercase anchors return just themselves. */
function splitAnchorParts(anchor: string): string[] {
  const lower = anchor.toLowerCase();
  const parts = new Set<string>();
  parts.add(lower);
  for (const piece of anchor.split(/[.\-_/]+/)) {
    if (!piece) continue;
    parts.add(piece.toLowerCase());
    // camelCase / PascalCase split: split before each uppercase that
    // follows a lowercase letter.
    let buf = "";
    for (let i = 0; i < piece.length; i += 1) {
      const ch = piece[i]!;
      const prev = piece[i - 1];
      if (i > 0 && prev && /[a-z0-9]/.test(prev) && /[A-Z]/.test(ch)) {
        if (buf.length >= 2) parts.add(buf.toLowerCase());
        buf = ch;
      } else {
        buf += ch;
      }
    }
    if (buf.length >= 2) parts.add(buf.toLowerCase());
  }
  return [...parts].filter((p) => p.length >= 3);
}

/**
 * Title-token-coverage decisive difference.
 *
 * When one candidate's title (or H1 — combined here) carries a query
 * token that the other's title/H1 does not, that is a strong
 * structural signal: titles are a curated, low-noise field. We vote
 * only on a meaningful gap (≥ 0.25 absolute coverage difference) so
 * tied titles or near-ties don't fire.
 *
 * Path-token-coverage is intentionally NOT folded in — paths share
 * many parent-dir tokens (`docs/`, `packages/`) which inflate
 * coverage symmetrically and would not differentiate candidates.
 */
function titleTokenCoverageVotes(a: SourceCard, b: SourceCard): Vote[] {
  const aT = a.token_coverage.title_token_coverage;
  const bT = b.token_coverage.title_token_coverage;
  const diff = aT - bT;
  if (Math.abs(diff) < 0.3) return [];
  const winnerCoverage = diff > 0 ? aT : bT;
  if (winnerCoverage < 0.5) return [];

  // Generic project / file tokens (`turbo`, `json`, project name) inflate
  // title coverage symmetrically — e.g. the query "configure glob inputs
  // and outputs in turbo.json" lights up `configuration.md`'s title
  // ("Configuring turbo.json") on `configur`/`turbo`/`json` while
  // `globs.md` only hits the topical `glob`. We require the winning
  // candidate's path basename stem to also be in the query AND the
  // losing candidate's basename to NOT be in the query — that proves
  // the title win is topical, not driven by project-name overlap.
  const aBaseStem = stemOfBasename(a.source_path);
  const bBaseStem = stemOfBasename(b.source_path);
  const aBasenameInQuery = aBaseStem ? a.query_tokens.includes(aBaseStem) : false;
  const bBasenameInQuery = bBaseStem ? b.query_tokens.includes(bBaseStem) : false;
  const winnerBasenameInQuery = diff > 0 ? aBasenameInQuery : bBasenameInQuery;
  const loserBasenameInQuery = diff > 0 ? bBasenameInQuery : aBasenameInQuery;
  if (!winnerBasenameInQuery || loserBasenameInQuery) return [];

  // Weight 3 so a decisive, basename-corroborated title win can
  // overcome the canonicality_parent_for_broad + family_parent_over_
  // child votes (each +1) that fire when an index.md sits next to a
  // topic leaf.
  return [
    {
      delta: diff > 0 ? 3 : -3,
      reason: "title_token_coverage_decisive",
    },
  ];
}

function stemOfBasename(source_path: string): string | null {
  const segments = source_path.split("/");
  const basename = segments[segments.length - 1] ?? "";
  const stem = basename.replace(/\.[^.]+$/, "");
  if (!stem) return null;
  // Match the query-side tokenizer's normalization: lowercase + porter
  // stem on the alphanumeric stem. Single-char and multi-token
  // basenames (with `-`, `_`) do not produce a clean stem here, so we
  // bail out — the basename signal is most valuable on single-word
  // basenames (snapshots / globs / mocking / overview).
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(stem)) return null;
  return tokenizeForRerankFirstToken(stem);
}

function tokenizeForRerankFirstToken(word: string): string | null {
  // Local thin wrapper so we don't pull in the heavy tokenize import
  // chain just for a single-token stem.
  // We deliberately mirror the query-token normalization: lowercase
  // and porter stem.
  const stem = porterStem(word.toLowerCase());
  return stem.length >= 2 ? stem : null;
}

// Tiny copy of the porter step the shared tokenizer applies. Avoids a
// circular import — the adjudicator already imports types from a module
// that imports `tokenize`.
import { porter as porterStem } from "./tokenize.js";

function dedupe<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** Minimum |margin| at which the adapter recommends a swap. The
 *  adjudicator errs on the side of caution: a weak preference must
 *  NOT swap the live top-1, because the V5.8 / V5.11 / V5.12 reverts
 *  proved that broad re-ranks regress more cases than they fix. */
const ADJUDICATOR_LIVE_MIN_MARGIN = 2;

/** Reason codes that, on their own, are NOT enough to swap the live
 *  top-1. They are structural / shape preferences (canonicality,
 *  family, broad-fit role) — exactly the cohort the V5.x reverts
 *  showed will mis-promote unrelated parents and adjacent overviews.
 *  A swap requires at least one reason code OUTSIDE this set
 *  (phrase/proximity, or a specific-intent role match like
 *  decision/release/upgrade/troubleshooting/api). */
const NEUTRAL_SWAP_REASONS: ReadonlySet<AdjudicationReasonCode> = new Set([
  "canonicality_parent_for_broad",
  "canonicality_leaf_for_exact",
  "family_parent_over_child",
  "role_compat_overview_for_broad",
  "role_compat_guide_for_broad",
  "role_compat_concept_for_broad",
]);

/**
 * Build a `PairwiseRerankAdapter` that wraps the deterministic
 * adjudicator. The adapter only recommends "b" (swap) when the
 * adjudicator's confidence is high or medium AND |margin| meets the
 * conservative live-rollout threshold; otherwise it recommends "a"
 * (keep the current order). Reasons forwarded to the ablation log are
 * the adjudicator's reason codes, so movement is fully attributable.
 *
 * Used by the source-rerank pipeline.
 */
export function buildAdjudicatorAdapter(intent: QueryIntent): PairwiseRerankAdapter {
  return (a, b) => {
    const out = adjudicateSourcePair({ a, b, query_intent: intent });
    const decisiveReasons = out.reason_codes.filter((r) => !NEUTRAL_SWAP_REASONS.has(r));
    const swap =
      out.winner === "b" &&
      (out.confidence === "high" || out.confidence === "medium") &&
      Math.abs(out.margin) >= ADJUDICATOR_LIVE_MIN_MARGIN &&
      decisiveReasons.length > 0;
    return {
      preferred: swap ? "b" : "a",
      reasons: out.reason_codes.length > 0 ? out.reason_codes : ["adjudicator_no_decisive_evidence"],
    };
  };
}
