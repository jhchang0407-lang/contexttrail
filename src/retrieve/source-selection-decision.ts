/**
 * V3.4 — deterministic source selection decision.
 *
 * Consumes source cards and aboutness observations and returns the selected
 * source order with structured reason codes and score margins.
 *
 * Design points:
 *   - Deterministic. No learned weights, no model calls. Coefficients are
 *     hand-set against named source-selection invariants.
 *   - Fail-closed. If every candidate's aboutness label is `unsupported` (or
 *     the intent is signal_empty), the selection is empty rather than
 *     confidently wrong.
 *   - Reason-coded. Selected entries carry codes (parent_over_leaf,
 *     decision_over_procedural, anchored_over_broad,
 *     changelog_release_intent_preserved) so downstream tooling can ablate
 *     and explain selection movement.
 *   - Locked Cards bypass selection — this module never sees them.
 */
import type { SourceCard } from "./source-card.js";
import type { AboutnessObservation } from "./aboutness.js";
import type { QueryIntent } from "./source-rerank.js";
import { tokenize as tokenizeRetrievalText } from "./tokenize.js";

export const SELECTION_REASON_CODES = [
  "covers_label",
  "parent_over_leaf",
  "decision_over_procedural",
  "anchored_over_broad",
  "changelog_release_intent_preserved",
  "demoted_unsupported",
  "demoted_too_narrow",
  "demoted_too_broad",
  "demoted_adjacent",
  // V3.6: applied only when an optional pairwise rerank adapter
  // promoted a close-call second-place card to the top slot.
  "pairwise_rerank_promoted",
  // V4.2: profile-independent primitive. Fires when exactly one card's
  // title or filename token set matches the query phrase verbatim. Resilient
  // to noisy/missing doc_purpose because it does not read profile labels.
  "title_exact_match_promoted",
  // V5.1: path-structure-INDEPENDENT concept-over-leaves promotion. Fires
  // when the aboutness verifier emits `concept_over_leaves_by_purpose` AND
  // intent is broad/decision. Closes parent_vs_leaf-under-path-noise (path
  // nesting is broken so parent_over_leaf can't fire) and overview_vs_
  // reference (where the bare-titled overview doesn't match a stricter rule).
  "concept_over_leaves_by_purpose_promoted",
  // V5.3: top-3 diversity primitive. Promotes example-purpose docs for
  // broad_domain queries so canonical examples surface alongside the
  // concept doc. Closes the set-cover leak where top-3 filled with
  // concept + same-topic api_reference distractors and the canonical
  // example was never displayed.
  "example_for_broad_domain_promoted",
  // V6: canonical owner title/filename is a high-signal subset of the
  // request (including stable semantic aliases such as i18n/translation or
  // compose/pipeline). This promotes the owner doc over dense mention hits.
  "title_subset_match_promoted",
  // V6: overview-shaped requests should prefer explicit intro/overview
  // landing pages once they have non-unsupported evidence.
  "overview_landing_promoted",
] as const;

export type SelectionReasonCode = (typeof SELECTION_REASON_CODES)[number];

export type SelectedSource = {
  source_path: string;
  rank: number;
  /** Composite score after V3 promotions/demotions. Higher is better. */
  score: number;
  /** Aboutness label as observed by V3.3. */
  aboutness_label: AboutnessObservation["label"];
  reason_codes: SelectionReasonCode[];
};

export type SourceSelectionDecision = {
  selected_sources: SelectedSource[];
  fail_closed: boolean;
  top1_top2_margin: number;
  top1_top3_margin: number;
};

export type DecideSourceSelectionArgs = {
  cards: SourceCard[];
  aboutness: AboutnessObservation[];
  query_intent: QueryIntent;
  trusted_file_anchor_evidence?: boolean;
};

const LABEL_BASE_SCORE: Record<AboutnessObservation["label"], number> = {
  covers: 1.0,
  partial: 0.5,
  adjacent: 0.35,
  too_broad: 0.25,
  too_narrow: 0.25,
  unsupported: 0.0,
};

export function decideSourceSelection(
  args: DecideSourceSelectionArgs,
): SourceSelectionDecision {
  if (args.query_intent === "signal_empty") {
    // signal_empty intent originally short-circuited
    // here to fail closed unconditionally. That prevented adjudication
    // on cases where the query mode was misclassified to signal_empty
    // (e.g. user-supplied anchors like `vi.mock` or
    // `test/unit/users.test.ts` that don't recognize as docs cards
    // even though the corpus has the relevant content).
    //
    // Preserve the original safety contract — if every card's
    // aboutness label is `unsupported`, fall through to the natural
    // fail-closed path at the end (when scored is empty). When at
    // least one card carries non-unsupported aboutness, let selection
    // run so the deterministic adjudicator can engage. Confidence
    // policy still caps coverage_confidence at uncertain on
    // signal_empty query mode, so safety honesty is enforced
    // independently of selection ordering.
    const hasUsefulAboutness = args.aboutness.some((o) => o.label !== "unsupported");
    if (!hasUsefulAboutness) return emptyFailClosed();
  }
  const cardByPath = new Map(args.cards.map((c) => [c.source_path, c]));
  const obsByPath = new Map(args.aboutness.map((o) => [o.source_path, o]));
  const conceptSupportExists = args.cards.some((candidate) => {
    const candidateObs = obsByPath.get(candidate.source_path);
    return (
      candidate.profile_signals?.doc_purpose === "concept" &&
      candidateObs !== undefined &&
      candidateObs.label !== "unsupported"
    );
  });

  // V4.2: identify the unique title/filename exact-match owner, if any.
  // The primitive applies only when exactly one card's title-or-filename
  // token set matches the query token set verbatim. Multi-owner ambiguity
  // means the engine must rely on other signals — promotion is suppressed.
  const titleExactMatchPath = uniqueTitleExactMatch(args.cards);
  // V6.1: a title/filename subset owner must yield to the canonical
  // changelog when the query asks about release history and a changelog
  // card carries verifier release-intent evidence. "what changed in X v3"
  // owns the package's CHANGELOG, not the X-topic doc whose title happens
  // to be a subset of the request.
  const releaseIntentChangelogExists = args.cards.some((card) => {
    const o = obsByPath.get(card.source_path);
    return (
      o !== undefined &&
      o.label !== "unsupported" &&
      o.reason_codes.includes("changelog_release_intent") &&
      isChangelogCard(card) &&
      queryAsksReleaseHistory(card.query_tokens)
    );
  });
  const titleSubsetMatchPath =
    titleExactMatchPath === null && !releaseIntentChangelogExists
      ? uniqueTitleSubsetMatch(args.cards)
      : null;

  const scored: SelectedSource[] = [];
  for (const card of args.cards) {
    const o = obsByPath.get(card.source_path);
    if (!o) continue;
    if (o.label === "unsupported") {
      // Tracked as fail-closed below. Do not include in selected_sources.
      continue;
    }

    let score = LABEL_BASE_SCORE[o.label];
    const reasons: SelectionReasonCode[] = [];

    if (o.label === "covers") reasons.push("covers_label");

    // parent_over_leaf — card is the parent of a leaf neighbor that the
    // verifier flagged via parent_vs_leaf and we are at decision/broad intent.
    // Only fire for overview-like parents; arbitrary broad containers such
    // as blogs or utility hubs otherwise outrank the actual owner doc.
    if (
      (args.query_intent === "decision_lookup" ||
        args.query_intent === "broad_domain") &&
      o.reason_codes.includes("parent_vs_leaf") &&
      isParentOfAny(card.source_path, args.cards) &&
      isOverviewLikeCard(card)
    ) {
      score += 0.30;
      reasons.push("parent_over_leaf");
    }

    // decision_over_procedural — concept/adr beats guide/api_reference for
    // decision queries.
    if (
      args.query_intent === "decision_lookup" &&
      o.reason_codes.includes("decision_vs_procedural") &&
      isDecisionDoc(card)
    ) {
      score += 0.30;
      reasons.push("decision_over_procedural");
    }

    // anchored_over_broad — guide-shape exact-topic doc beats broad
    // api_reference container for file_anchored queries.
    if (
      args.query_intent === "file_anchored" &&
      (args.trusted_file_anchor_evidence ?? true) &&
      o.reason_codes.includes("guide_vs_reference") &&
      card.profile_signals?.doc_purpose !== "api_reference"
    ) {
      score += 0.30;
      reasons.push("anchored_over_broad");
    }

    // changelog_release_intent_preserved — when the verifier marked the card
    // as changelog/release intent, lift it only when the query itself asks
    // about versions, upgrades, releases, or changes. Otherwise release notes
    // are a common lexical distractor for ordinary broad-domain tasks.
    //
    // V5.2: bonus bumped from 0.40 → 0.60 so a "partial"-labeled changelog
    // (0.5 base + 0.6 bonus = 1.1) reliably beats a "covers"-labeled dense
    // distractor (1.0). This closes the verbosity × paraphrase leak where
    // a README with v3 in headings was outranking the canonical CHANGELOG.
    // The rule only fires on changelog/release_note-purpose cards, so no
    // other class is affected.
    if (
      o.reason_codes.includes("changelog_release_intent") &&
      isChangelogCard(card) &&
      queryAsksReleaseHistory(card.query_tokens)
    ) {
      score += 0.60;
      reasons.push("changelog_release_intent_preserved");
    }

    // V4.2: title/filename exact-match owner gets a strong promotion that
    // does not depend on doc_purpose. The bonus is sized to dominate label-
    // based scoring so a `partial` exact-match owner beats a `covers` doc
    // that merely mentions the phrase.
    if (titleExactMatchPath === card.source_path) {
      score += 0.50;
      reasons.push("title_exact_match_promoted");
    }
    if (titleSubsetMatchPath === card.source_path) {
      score += 0.65;
      reasons.push("title_subset_match_promoted");
    }

    if (
      args.query_intent === "broad_domain" &&
      queryIsOverviewShape(card.query_tokens) &&
      isPureOverviewLandingQuery(card.query_tokens) &&
      isOverviewLandingCard(card)
    ) {
      score += 0.70;
      reasons.push("overview_landing_promoted");
    }

    // V5.3: example-purpose promotion. For broad_domain queries, a
    // canonical example is a complementary top-3 slot. The +0.55 bonus
    // lifts a "partial"-labeled example (0.5 base + 0.55 = 1.05) above
    // dense api_reference distractors that may have edged into "covers"
    // (1.0). It still loses cleanly to a concept doc that genuinely
    // covers the query (1.0 covers + 0.40 concept_over_leaves = 1.40),
    // so example doesn't displace top-1 — it just guarantees a top-3 slot.
    if (
      args.query_intent === "broad_domain" &&
      card.profile_signals?.doc_purpose === "example" &&
      (o.label === "partial" || o.label === "covers") &&
      conceptSupportExists
    ) {
      score += 0.55;
      reasons.push("example_for_broad_domain_promoted");
    }

    // V5.1: concept_over_leaves_by_purpose — fires for concept-purpose
    // targets when at least 2 leaf-like (guide/api_reference) siblings
    // exist in the candidate set, regardless of path nesting.
    //
    // Gate: target's combined coverage must be >= every other card's
    // (within 1e-9 tolerance for ties). This blocks the over-trigger on
    // compositional queries — when a specific guide has higher coverage
    // (e.g., "{topic} in {mode} mode" matches {topic, mode} fully while
    // the bare-titled topic concept matches only {topic}), the concept
    // is not promoted.
    //
    // V5.4: when the query has explicit overview SHAPE ("what is X",
    // "intro to X", "X overview", etc.), drop the coverage gate. The
    // shape itself signals that the user wants the concept doc, even if
    // a leaf has higher lexical match (e.g., a leaf heading literally
    // says "{topic} basics" which matches the query "{topic} basics"
    // word-for-word — lexically the leaf wins, but the user's question
    // shape says they want the parent overview). This closes the
    // paraphrase × path-noise residual leak.
    const overviewShape = queryIsOverviewShape(card.query_tokens);
    const conceptCoversBest =
      !args.aboutness.some(
        (other) =>
          other.source_path !== card.source_path &&
          other.combined_token_coverage > o.combined_token_coverage + 1e-9,
      );
    if (
      (args.query_intent === "decision_lookup" ||
        args.query_intent === "broad_domain") &&
      o.reason_codes.includes("concept_over_leaves_by_purpose") &&
      card.profile_signals?.doc_purpose === "concept" &&
      (conceptCoversBest || overviewShape)
    ) {
      score += 0.40;
      reasons.push("concept_over_leaves_by_purpose_promoted");
    }

    // Demote-only reasons (kept visible so V3.5 packing/display can see why
    // a card sits below another).
    if (o.label === "too_narrow") reasons.push("demoted_too_narrow");
    if (o.label === "too_broad") reasons.push("demoted_too_broad");
    if (o.label === "adjacent") reasons.push("demoted_adjacent");

    // Tiny rank tiebreak so otherwise-equal candidates preserve incoming order.
    score -= card.rank * 1e-4;

    scored.push({
      source_path: card.source_path,
      rank: card.rank,
      score,
      aboutness_label: o.label,
      reason_codes: dedupePreserveOrder(reasons),
    });
  }

  if (scored.length === 0) {
    return emptyFailClosed();
  }

  const bestConceptScore = scored.reduce<number | null>((best, selected) => {
    const card = cardByPath.get(selected.source_path);
    if (card?.profile_signals?.doc_purpose !== "concept") return best;
    return best === null ? selected.score : Math.max(best, selected.score);
  }, null);

  if (bestConceptScore !== null) {
    for (const selected of scored) {
      const card = cardByPath.get(selected.source_path);
      if (card?.profile_signals?.doc_purpose !== "example") continue;
      if (!selected.reason_codes.includes("example_for_broad_domain_promoted")) continue;
      if (selected.score >= bestConceptScore) {
        selected.score = bestConceptScore - 1e-4;
      }
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.rank - b.rank;
  });

  const top1 = scored[0]?.score ?? 0;
  const top2 = scored[1]?.score ?? 0;
  const top3 = scored[2]?.score ?? 0;

  return {
    selected_sources: scored,
    fail_closed: false,
    top1_top2_margin: top1 - top2,
    top1_top3_margin: top1 - top3,
  };
}

function emptyFailClosed(): SourceSelectionDecision {
  return {
    selected_sources: [],
    fail_closed: true,
    top1_top2_margin: 0,
    top1_top3_margin: 0,
  };
}

function uniqueTitleSubsetMatch(cards: SourceCard[]): string | null {
  if (cards.length === 0) return null;
  const queryTokens = cards[0]?.query_tokens ?? [];
  if (queryTokens.length === 0) return null;
  const queryTokenSet = new Set(queryTokens);
  const matches: Array<{ source_path: string; score: number }> = [];

  const coveredByPath = new Map<string, Set<string>>();
  for (const card of cards) {
    const titleTokens = tokenizeRetrievalText(card.profile_signals?.title ?? "");
    const filename =
      card.source_path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    const filenameTokens = tokenizeRetrievalText(filename);
    coveredByPath.set(
      card.source_path,
      titleCoveredQueryTokens(titleTokens, filenameTokens, queryTokens),
    );
    const titleScore = titleSubsetScore(titleTokens, queryTokenSet);
    const filenameScore = titleSubsetScore(filenameTokens, queryTokenSet);
    const score = Math.max(titleScore, filenameScore);
    if (score > 0) matches.push({ source_path: card.source_path, score });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.source_path.localeCompare(b.source_path);
  });
  const top = matches[0];
  if (!top) return null;
  if (matches[1] && matches[1].score >= top.score - 1e-9) return null;

  // V6.1: the subset owner must also cover every query token that any
  // candidate's title/filename can cover. A compositional request like
  // "transport with embedded" has a topic anchor AND a mode anchor; the
  // bare topic overview is a clean title subset, but the combined guide's
  // title covers the mode anchor the overview misses. Promoting the
  // narrower owner would bury the doc that answers more of the request.
  const winnerCovered = coveredByPath.get(top.source_path) ?? new Set<string>();
  for (const card of cards) {
    if (card.source_path === top.source_path) continue;
    const covered = coveredByPath.get(card.source_path);
    if (!covered) continue;
    for (const token of covered) {
      if (!winnerCovered.has(token)) return null;
    }
  }
  return top.source_path;
}

/**
 * Query tokens a card's title/filename can vouch for, using the same
 * meaningful-token filter and semantic aliases as titleSubsetScore so
 * generic words ("guide", "api") cannot veto a promotion.
 */
function titleCoveredQueryTokens(
  titleTokens: string[],
  filenameTokens: string[],
  queryTokens: string[],
): Set<string> {
  const cardTokens = [...titleTokens, ...filenameTokens].filter(
    (token) =>
      token.length > 1 &&
      !/^\d+$/.test(token) &&
      !TITLE_SUBSET_GENERIC_TOKENS.has(token),
  );
  const expanded = new Set(cardTokens.flatMap(selectionEquivalentTokens));
  const covered = new Set<string>();
  for (const queryToken of queryTokens) {
    if (
      selectionEquivalentTokens(queryToken).some((equivalent) =>
        expanded.has(equivalent),
      )
    ) {
      covered.add(queryToken);
    }
  }
  return covered;
}

const TITLE_SUBSET_GENERIC_TOKENS = new Set([
  "advanced",
  "api",
  "basic",
  "concept",
  "config",
  "configur",
  "doc",
  "docs",
  "error",
  "file",
  "get",
  "getting",
  "guide",
  "index",
  "intro",
  "introduct",
  "main",
  "overview",
  "readm",
  "refer",
  "reference",
  "schema",
  "start",
]);

function titleSubsetScore(tokens: string[], queryTokenSet: Set<string>): number {
  const meaningfulTokens = dedupePreserveOrder(tokens).filter(
    (token) =>
      token.length > 1 &&
      !/^\d+$/.test(token) &&
      !TITLE_SUBSET_GENERIC_TOKENS.has(token),
  );
  if (meaningfulTokens.length === 0) return 0;

  let semanticOnlyMatch = false;
  for (const token of meaningfulTokens) {
    const match = titleSubsetTokenMatch(token, queryTokenSet);
    if (!match.matched) return 0;
    if (match.semanticOnly) semanticOnlyMatch = true;
  }

  const hasSpecificToken = meaningfulTokens.some((token) => token.length >= 5);
  if (!hasSpecificToken) return 0;
  if (meaningfulTokens.length === 1 && !semanticOnlyMatch) return 0;

  return meaningfulTokens.length + (semanticOnlyMatch ? 0.5 : 0);
}

function titleSubsetTokenMatch(
  token: string,
  queryTokenSet: Set<string>,
): { matched: boolean; semanticOnly: boolean } {
  if (queryTokenSet.has(token)) return { matched: true, semanticOnly: false };
  for (const equivalent of selectionEquivalentTokens(token)) {
    if (equivalent !== token && queryTokenSet.has(equivalent)) {
      return { matched: true, semanticOnly: true };
    }
  }
  return { matched: false, semanticOnly: false };
}

function selectionEquivalentTokens(token: string): string[] {
  switch (token) {
    case "i18n":
    case "intern":
    case "languag":
    case "locale":
    case "local":
    case "translat":
      return ["i18n", "intern", "languag", "locale", "local", "translat"];
    case "chain":
    case "compo":
    case "compos":
    case "pipe":
    case "pipelin":
      return ["chain", "compo", "compos", "pipe", "pipelin"];
    case "either":
    case "tag":
    case "union":
      return ["either", "tag", "union"];
    default:
      return [token];
  }
}

function isParentOfAny(parent: string, cards: SourceCard[]): boolean {
  return cards.some(
    (c) => c.source_path !== parent && isStrictAncestorPath(parent, c.source_path),
  );
}

function isDecisionDoc(card: SourceCard): boolean {
  const p = card.profile_signals?.doc_purpose;
  return p === "concept" || p === "adr" || p === "prd";
}

/**
 * V4.2 — return the source_path whose title or filename, after tokenization
 * and stemming, equals the query token set. Returns null when zero or
 * multiple cards match (precision floor: ambiguous owners are not
 * promoted because the engine cannot pick deterministically).
 */
function uniqueTitleExactMatch(cards: SourceCard[]): string | null {
  if (cards.length === 0) return null;
  const queryTokens = cards[0]?.query_tokens ?? [];
  if (queryTokens.length === 0) return null;
  const queryKey = canonicalTokenKey(queryTokens);
  if (queryKey === "") return null;
  const matches: string[] = [];
  for (const card of cards) {
    const titleTokens = tokenizeRetrievalText(card.profile_signals?.title ?? "");
    const filename =
      card.source_path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    const filenameTokens = tokenizeRetrievalText(filename);
    if (
      canonicalTokenKey(titleTokens) === queryKey ||
      canonicalTokenKey(filenameTokens) === queryKey
    ) {
      matches.push(card.source_path);
    }
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function canonicalTokenKey(tokens: string[]): string {
  return [...new Set(tokens)].sort().join("\0");
}

function isChangelogCard(card: SourceCard): boolean {
  const p = card.profile_signals?.doc_purpose;
  if (p === "changelog" || p === "release_note") return true;
  const lower = card.source_path.toLowerCase();
  return (
    lower.endsWith("/changelog.md") ||
    lower.endsWith("changelog.md") ||
    lower.endsWith("/release.md")
  );
}

/**
 * Recognise natural-language release/migration query shapes.
 *
 * The previous implementation only matched stemmed words exactly equal to
 * release vocabulary ("changelog", "releas", "migrat"). It missed the most
 * common phrasings users actually type:
 *
 *   - "what changed in X v3"            → "chang" stem
 *   - "what's new in X"                 → "new" token
 *   - "X migration to v3"               → version-shape token
 *   - "before I adopt X v3"             → adoption + version-shape token
 *   - "moving an app onto X v3"         → move + version-shape token
 *   - "X 3.0 release notes"             → "note" stem (and version shape)
 *   - "breaking changes in X 3"         → "break" already covered
 *
 * Two paths trigger:
 *
 *   1. explicit release-history vocabulary ("what changed", "release
 *      notes", "breaking changes", ...)
 *   2. migration / upgrade language paired with an explicit version
 *      token (v3, 3.0)
 *
 * Unversioned migration requests are intentionally excluded. For broad
 * domain queries like "migrate from eslint and prettier to biome", the
 * canonical owner is the migration guide, not a changelog fragment.
 */
const EXPLICIT_RELEASE_HISTORY_STEM =
  /^(version|break|deprecat|changelog|releas|release|chang|histori|note|fix|new|sinc)$/;
const VERSIONED_MIGRATION_STEM = /^(migrat|upgrad|adopt|move)$/;
const VERSION_SHAPE = /^v?\d+(\.\d+)*$/;

/**
 * V5.4 — overview-shape query detector. Returns true when the query token
 * set carries vocabulary that signals the user wants a high-level concept
 * doc rather than a specific leaf:
 *
 *   "what is X" / "intro to X" / "X overview" / "explain X" /
 *   "X concept" / "X basics" / "help me understand X" /
 *   "I need the big picture on X" / "oriented on X"
 *
 * Stems are matched, so "introduction" → "introduct" still hits "intro".
 * The detector is permissive: when in doubt, assume overview shape — the
 * gate it controls (V5.1 concept promotion) only fires when a concept-
 * purpose card is actually in the candidate set.
 */
const OVERVIEW_VOCAB_STEM = /^(overview|intro|introduct|explain|concept|basic|orient|understand|big|pictur|tldr|primer|guid)$/;

function queryIsOverviewShape(queryTokens: string[]): boolean {
  let hasContentSignal = false;
  let hasWhatQuestion = false;
  for (const token of queryTokens) {
    if (OVERVIEW_VOCAB_STEM.test(token)) hasContentSignal = true;
    if (token === "what") hasWhatQuestion = true;
  }
  // "what is X" / "what does X do" — the question word alone is a strong
  // signal because the stop-word filter has already removed "is" / "does".
  return hasContentSignal || hasWhatQuestion;
}

const OVERVIEW_QUERY_NOISE_TOKENS = new Set([
  "what",
  "which",
  "where",
  "when",
  "who",
  "why",
  "how",
  "do",
  "doe",
  "does",
  "mean",
  "explain",
  "overview",
  "intro",
  "introduct",
  "concept",
  "basic",
  "orient",
  "understand",
  "big",
  "pictur",
  "primer",
  "guid",
]);

function isPureOverviewLandingQuery(queryTokens: string[]): boolean {
  const content = dedupePreserveOrder(queryTokens).filter(
    (token) => !OVERVIEW_QUERY_NOISE_TOKENS.has(token),
  );
  return content.length <= 2;
}

function queryAsksReleaseHistory(queryTokens: string[]): boolean {
  let hasVersionToken = false;
  let hasVersionedMigration = false;
  for (const token of queryTokens) {
    if (EXPLICIT_RELEASE_HISTORY_STEM.test(token)) return true;
    if (VERSIONED_MIGRATION_STEM.test(token)) {
      hasVersionedMigration = true;
    }
    if (VERSION_SHAPE.test(token)) {
      hasVersionToken = true;
    }
  }
  return hasVersionToken && hasVersionedMigration;
}

function isOverviewLikeCard(card: SourceCard): boolean {
  const purpose = card.profile_signals?.doc_purpose;
  if (
    purpose === "concept" ||
    purpose === "guide" ||
    purpose === "quick_start" ||
    purpose === "readme" ||
    purpose === "package_readme"
  ) {
    return true;
  }

  const title = card.profile_signals?.title.toLowerCase() ?? "";
  if (/\b(overview|introduction|intro|concept|guide|basics|primer)\b/.test(title)) {
    return true;
  }

  const basename =
    card.source_path
      .toLowerCase()
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "";
  return (
    basename === "readme" ||
    basename === "index" ||
    basename === "_index" ||
    basename === "overview"
  );
}

function isOverviewLandingCard(card: SourceCard): boolean {
  const title = card.profile_signals?.title.toLowerCase() ?? "";
  const basename =
    card.source_path
      .toLowerCase()
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "";
  return (
    /\b(introduction|intro|overview)\b/.test(title) ||
    basename === "introduction" ||
    basename === "intro" ||
    basename === "overview" ||
    card.source_path.toLowerCase().includes("/introduction/")
  );
}

function isStrictAncestorPath(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return false;
  const ancestorDir = stripExtension(ancestor);
  return descendant.startsWith(ancestorDir + "/");
}

function stripExtension(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  const lastDot = path.lastIndexOf(".");
  if (lastDot > lastSlash) return path.slice(0, lastDot);
  return path;
}

function dedupePreserveOrder<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const i of items) {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out;
}
