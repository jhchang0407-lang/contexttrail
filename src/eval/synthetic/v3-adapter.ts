/**
 * Adapter: SyntheticCase → V3 deterministic ranker output.
 *
 * Pipeline:
 *   1. SyntheticDoc[] → ProfileEnrichedSourceCandidate[]
 *   2. buildSourceCardsFromCandidates
 *   3. classifyTopNAboutness
 *   4. decideSourceSelection
 *   5. return selected_sources paths
 *
 * If selection fails closed, fall back to candidate rank order so the
 * runner gets *some* ranking and we can see what V3 displayed before
 * fail-close kicked in.
 */
import type { SyntheticCase, SyntheticDoc } from "./generators.js";
import type { ProfileEnrichedSourceCandidate } from "../../retrieve/source-candidates.js";
import type { SourceProfile } from "../../types/source-profile.js";
import { buildSourceCardsFromCandidates } from "../../retrieve/source-card.js";
import { classifyTopNAboutness } from "../../retrieve/aboutness.js";
import {
  decideSourceSelection,
  type SourceSelectionDecision,
} from "../../retrieve/source-selection-decision.js";
import { tokenizeForRerank } from "../../retrieve/source-rerank.js";

/**
 * V4.11 — full V3 decision metadata for abstention measurement. Returns
 * the ranking AND the underlying SourceSelectionDecision so callers can
 * observe `fail_closed` directly instead of inferring it from a fallback
 * ranking. The previous unsupported_sanity stub treated all non-empty
 * rankings as "confidently picked", but the adapter masks fail_closed
 * by falling back to candidate order.
 */
export type SyntheticV3DecisionResult = {
  ranking: string[];
  fail_closed: boolean;
  decision: SourceSelectionDecision;
};

export function syntheticV3Decision(c: SyntheticCase): SyntheticV3DecisionResult {
  const queryTokens = tokenizeForRerank(c.query);
  const candidates = buildSyntheticCandidates(c.corpus, queryTokens);
  const cards = buildSourceCardsFromCandidates({
    candidates,
    query_tokens: queryTokens,
    query_intent: c.intent,
    top_n: candidates.length,
  });
  const aboutness = classifyTopNAboutness({
    cards,
    query_intent: c.intent,
  });
  const decision = decideSourceSelection({
    cards,
    aboutness,
    query_intent: c.intent,
  });
  const ranking = decision.fail_closed
    ? candidates.map((cand) => cand.source_path)
    : decision.selected_sources.map((s) => s.source_path);
  return { ranking, fail_closed: decision.fail_closed, decision };
}

export function syntheticV3Ranker(c: SyntheticCase): string[] {
  const queryTokens = tokenizeForRerank(c.query);
  const candidates = buildSyntheticCandidates(c.corpus, queryTokens);
  const cards = buildSourceCardsFromCandidates({
    candidates,
    query_tokens: queryTokens,
    query_intent: c.intent,
    top_n: candidates.length,
  });
  const aboutness = classifyTopNAboutness({
    cards,
    query_intent: c.intent,
  });
  const decision = decideSourceSelection({
    cards,
    aboutness,
    query_intent: c.intent,
  });
  if (decision.fail_closed) {
    // Fall back to candidate rank order so the runner still has output.
    return candidates.map((cand) => cand.source_path);
  }
  return decision.selected_sources.map((s) => s.source_path);
}

export function syntheticLexicalRanker(c: SyntheticCase): string[] {
  const queryTokens = tokenizeForRerank(c.query);
  return buildSyntheticCandidates(c.corpus, queryTokens).map((cand) => cand.source_path);
}

export function buildSyntheticCandidates(
  corpus: SyntheticDoc[],
  queryTokens: string[],
): ProfileEnrichedSourceCandidate[] {
  const scored = corpus.map((doc) => ({
    doc,
    score: lexicalScore(doc, queryTokens),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.doc.source_path.localeCompare(b.doc.source_path);
  });
  return scored.map(({ doc, score }, idx) => toCandidate(doc, idx + 1, score));
}

function toCandidate(
  doc: SyntheticDoc,
  rank: number,
  score: number,
): ProfileEnrichedSourceCandidate {
  return {
    rank,
    source_path: doc.source_path,
    best_chunk_rank: rank,
    best_chunk_score: score,
    contributing_chunks: [
      { version_id: `${doc.source_path}#0`, rank, final_score: score },
    ],
    profile: toProfile(doc),
    fused_rank: rank,
    fused_path_count: 1,
  };
}

function toProfile(doc: SyntheticDoc): SourceProfile {
  return {
    source_path: doc.source_path,
    source_content_hash: `hash:${doc.source_path}`,
    title: doc.title,
    h1: doc.h1,
    intro: doc.intro,
    heading_outline: doc.headings.map((text) => ({
      level: 2,
      text,
      slug: text.toLowerCase().replace(/\s+/g, "-"),
    })),
    doc_role: doc.doc_role,
    role_source: "default",
    doc_purpose: doc.doc_purpose,
    purpose_source: "default",
    aliases: [
      { kind: "title", value: doc.title, confidence: "high", origin: "title" },
    ],
    summary: null,
    summary_source: "empty",
    questions_answered: doc.questions_answered ?? [],
    questions_answered_source: doc.questions_answered?.length
      ? "heading_question_extraction"
      : "empty",
    chunk_count: 1,
    token_count: doc.body_tokens.length,
    indexed_at: "2026-05-08T00:00:00Z",
  };
}

function lexicalScore(doc: SyntheticDoc, queryTokens: string[]): number {
  // Synthetic first-pass scorer. This intentionally behaves like a noisy
  // lexical retrieval stage: title/path exactness helps, but dense body
  // mentions and heading overlap can still let the wrong source rank early.
  const titleTokens = tokenizeForRerank(doc.title);
  const pathTokens = tokenizeForRerank(doc.source_path);
  const headingTokens = doc.headings.flatMap((heading) => tokenizeForRerank(heading));
  const introTokens = tokenizeForRerank(doc.intro);
  return (
    weightedOverlap(queryTokens, titleTokens, 3.0) +
    weightedOverlap(queryTokens, pathTokens, 2.2) +
    weightedOverlap(queryTokens, headingTokens, 1.6) +
    weightedOverlap(queryTokens, introTokens, 0.8) +
    weightedFrequency(queryTokens, doc.body_tokens, 0.45)
  );
}

function weightedOverlap(
  queryTokens: string[],
  fieldTokens: string[],
  weight: number,
): number {
  if (queryTokens.length === 0 || fieldTokens.length === 0) return 0;
  const field = new Set(fieldTokens);
  let hits = 0;
  for (const token of queryTokens) {
    if (field.has(token)) hits += 1;
  }
  return (hits / queryTokens.length) * weight;
}

function weightedFrequency(
  queryTokens: string[],
  fieldTokens: string[],
  weight: number,
): number {
  if (queryTokens.length === 0 || fieldTokens.length === 0) return 0;
  let hits = 0;
  for (const token of fieldTokens) {
    if (queryTokens.includes(token)) hits += 1;
  }
  return (hits / Math.max(1, queryTokens.length)) * weight;
}
