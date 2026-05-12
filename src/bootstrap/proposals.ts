import type {
  BootstrapProposals,
  CandidateProposalDraft,
  ClarificationProposalDraft,
} from "../inbox/bootstrap.js";
import type { InboxScope, SupportingChunk } from "../inbox/items.js";

type BootstrapChunk = {
  stable_key: string;
  source_path: string;
  heading_path: string[];
  version_id: string;
  body: string;
  scope: {
    layer: InboxScope["layer"];
    company?: string;
    team?: string;
    project?: string;
    module?: string;
    feature?: string;
    domains?: string[];
    files?: string[];
    symbols?: string[];
    routes?: string[];
  };
};

export type BootstrapQueries = {
  listCanonicalChunks(): BootstrapChunk[];
  getConfidentSymbolAnchors(versionId: string): string[];
};

const NORMATIVE_STRONG_PATTERN = /\b(must not|must|never|always|cannot|do not)\b/i;
const NORMATIVE_WEAK_PATTERN = /\b(should not|should)\b/i;
const SYMBOL_NOTE_HINT_PATTERN =
  /\b(coordinates?|entry point|encapsulates?|represents?|owns?|drives?)\b/i;

/**
 * PRD-0036 / 36.4 (B5) — Phase 0 fastapi findings: noise detectors that skip
 * sentences BEFORE the regex tone match runs. Each detector is narrow and
 * high-precision; the structural slot is intentional ("ship the specific
 * filter for the named noise; expand when more noise is named"). Do NOT
 * generalize to a configurable filter system yet — add detectors here when
 * future pilot data names new noise patterns.
 */

// (a) Bot-emoji prefix: GitHub release-note convention. The fastapi pilot had
// ~20 release-note-bot candidates whose body starts with one of these emojis.
// Real codebase constraints never lead with a bot-tag emoji.
export const BOT_EMOJI_PREFIXES = [
  "👷", "📝", "🐛", "✨", "♻️", "➖", "📌", "🔥", "⬆️", "⚡", "🚀",
] as const;

// (b) Translation-glossary: matches "Term: rendered form (do not translate ...)"
// style guide entries (~50 hits on fastapi's contributing.md). Real codebase
// rules don't say "do not translate."
export const TRANSLATION_GLOSSARY_PATTERN =
  /^[A-Z][^:]+:\s+[^()]+\s+\(do not translate/u;

export function isBotEmojiNoise(sentence: string): boolean {
  const trimmed = sentence.trimStart();
  if (!trimmed) return false;
  for (const prefix of BOT_EMOJI_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true;
  }
  return false;
}

export function isTranslationGlossaryNoise(sentence: string): boolean {
  return TRANSLATION_GLOSSARY_PATTERN.test(sentence);
}

/** PRD-0036 / 36.4: returns true if the sentence is a known noise pattern. */
export function isBootstrapNoise(sentence: string): boolean {
  return isBotEmojiNoise(sentence) || isTranslationGlossaryNoise(sentence);
}

function splitCandidateSentences(body: string): string[] {
  return body
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) =>
      line
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .trim(),
    )
    .filter((line) => line.length >= 20 && line.length <= 240);
}

function canonicalizeRule(sentence: string): string {
  const normalized = sentence.replace(/\s+/g, " ").trim();
  if (/[.!?]$/.test(normalized)) return normalized;
  return `${normalized}.`;
}

function dedupeKey(
  candidateType: "constraint" | "symbol_note",
  body: string,
  scope: InboxScope,
  symbolAnchors: string[] = [],
): string {
  const normalized = body.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return JSON.stringify({
    candidate_type: candidateType,
    body: normalized,
    layer: scope.layer,
    company: scope.company,
    team: scope.team,
    project: scope.project,
    module: scope.module,
    feature: scope.feature,
    symbol_anchors: [...symbolAnchors].sort(),
  });
}

function toInboxScope(scope: BootstrapChunk["scope"]): InboxScope {
  return {
    layer: scope.layer,
    company: scope.company,
    team: scope.team,
    project: scope.project,
    module: scope.module,
    feature: scope.feature,
    domains: scope.domains,
    files: scope.files,
    symbols: scope.symbols,
    routes: scope.routes,
  };
}

function titleFor(body: string): string {
  const plain = body.replace(/[.!?]+$/, "");
  return plain.length > 72 ? `${plain.slice(0, 69)}...` : plain;
}

function titleForSymbol(symbol: string): string {
  return `${symbol} local semantics`;
}

export function generateBootstrapProposals(
  queries: BootstrapQueries,
): BootstrapProposals {
  const chunks = queries.listCanonicalChunks();
  const merged = new Map<string, CandidateProposalDraft>();
  const clarifications = new Map<string, ClarificationProposalDraft>();
  let candidateSentences = 0;

  for (const chunk of chunks) {
    const scope = toInboxScope(chunk.scope);
    const chunkSymbols = queries.getConfidentSymbolAnchors(chunk.version_id);
    for (const sentence of splitCandidateSentences(chunk.body)) {
      // PRD-0036 / 36.4 (B5): skip known noise BEFORE the tone-regex fires so
      // these never become candidates or clarifications.
      if (isBootstrapNoise(sentence)) continue;
      const isStrongRule = NORMATIVE_STRONG_PATTERN.test(sentence);
      const isWeakRule = NORMATIVE_WEAK_PATTERN.test(sentence);
      const matchingSymbols = chunkSymbols.filter((symbol) => sentence.includes(symbol));
      const isSymbolNote =
        matchingSymbols.length > 0 && SYMBOL_NOTE_HINT_PATTERN.test(sentence);
      if (!isStrongRule && !isWeakRule && !isSymbolNote) continue;
      candidateSentences++;
      const body = canonicalizeRule(sentence);
      const supportingChunk: SupportingChunk = {
        chunk_stable_key: chunk.stable_key,
        source_path: chunk.source_path,
        heading_path: chunk.heading_path,
        version_id: chunk.version_id,
      };
      if (isWeakRule && !isStrongRule) {
        const key = dedupeKey("constraint", body, scope);
        const existing = clarifications.get(key);
        if (existing) {
          existing.supporting_chunks = [
            ...(existing.supporting_chunks ?? []),
            supportingChunk,
          ];
          continue;
        }
        clarifications.set(key, {
          body,
          scope,
          supporting_chunks: [supportingChunk],
        });
        continue;
      }
      if (isSymbolNote) {
        const symbol = matchingSymbols[0]!;
        const key = dedupeKey("symbol_note", body, scope, [symbol]);
        const existing = merged.get(key);
        if (existing) {
          existing.supporting_chunks.push(supportingChunk);
          continue;
        }
        merged.set(key, {
          candidate_type: "symbol_note",
          title: titleForSymbol(symbol),
          body,
          scope,
          symbol_anchors: [symbol],
          supporting_chunks: [supportingChunk],
        });
        continue;
      }
      const key = dedupeKey("constraint", body, scope);
      const existing = merged.get(key);
      if (existing) {
        existing.supporting_chunks.push(supportingChunk);
        continue;
      }
      merged.set(key, {
        candidate_type: "constraint",
        title: titleFor(body),
        body,
        scope,
        supporting_chunks: [supportingChunk],
      });
    }
  }

  const candidates = [...merged.values()];
  const clarificationDrafts = [...clarifications.values()];
  return {
    candidates,
    clarifications: clarificationDrafts,
    summary: {
      chunks_considered: chunks.length,
      candidate_sentences: candidateSentences,
      constraint_candidates_written: candidates.filter(
        (candidate) => candidate.candidate_type === "constraint",
      ).length,
      symbol_note_candidates_written: candidates.filter(
        (candidate) => candidate.candidate_type === "symbol_note",
      ).length,
      clarification_needs_written: clarificationDrafts.length,
      merged_duplicates: candidateSentences - candidates.length - clarificationDrafts.length,
    },
  };
}
