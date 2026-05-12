/**
 * PRD-0024 / THO-216 — deterministic heading-alias extractor.
 *
 * Pure function over the existing `SourceProfile.heading_outline`. Each
 * entry projects to a normalized search-form alias keyed by depth and
 * section path (the chain of strictly-shallower ancestor headings).
 *
 * The lever is *what evidence the existing scoring sees*, not *how the
 * score is computed*. This module exposes structured aliases that:
 *
 *   - candidate generation can index alongside title and path aliases,
 *   - source-rerank's existing `heading_token_coverage` feature can
 *     consume for exact / suffix / token-normalized matches against
 *     normalized heading text.
 *
 * No new score-component coefficients. No semantic inference. Empty or
 * whitespace-only headings are dropped — they carry no evidence.
 */
import type { HeadingOutlineEntry } from "../types/source-profile.js";
import { tokenize } from "./tokenize.js";

export type HeadingAlias = {
  /** Heading text exactly as it appears in the outline (preserved
   *  case, preserved internal punctuation). */
  surface: string;
  /** Lowercased and whitespace-collapsed projection of `surface`. */
  normalized: string;
  /** Tokens produced by the standard retrieval tokenizer over
   *  `surface`. Aligned with how source-rerank's existing
   *  `heading_token_coverage` feature tokenizes its query. */
  tokens: string[];
  /** Heading level: 1 for H1, 2 for H2, etc. */
  depth: number;
  /** Surface form of every strictly-shallower ancestor heading,
   *  outermost first. Empty for top-level headings. */
  section_path: string[];
};

export function extractHeadingAliases(
  headings: HeadingOutlineEntry[],
): HeadingAlias[] {
  const out: HeadingAlias[] = [];
  // Stack of ancestors by depth; we keep entries strictly shallower
  // than the current heading and emit their `surface` as section_path.
  const stack: { depth: number; surface: string }[] = [];

  for (const heading of headings) {
    const surface = heading.text;
    const normalized = surface.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized.length === 0) continue;

    while (stack.length > 0 && stack[stack.length - 1]!.depth >= heading.level) {
      stack.pop();
    }
    const section_path = stack.map((entry) => entry.surface);

    out.push({
      surface,
      normalized,
      tokens: tokenize(surface),
      depth: heading.level,
      section_path,
    });

    stack.push({ depth: heading.level, surface });
  }

  return out;
}
