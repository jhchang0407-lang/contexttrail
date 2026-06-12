/**
 * RETRIEVAL_HEADING_ALIASES feature flag.
 *
 * Gates the broader heading-evidence match path in multi-path candidate
 * generation and source-rerank's heading_token_coverage feature.
 * Default off until promotion gates pass on real-corpus eval.
 *
 * Lives in its own module so that the candidate-gen layer
 * (`multi-path-candidates.ts`) can read the flag without importing
 * `source-rerank.ts` (which would create a circular dependency through
 * the rerank → candidates path).
 */

/**
 * Flag default flipped to `true` after the
 * promotion gates passed on real-corpus eval. The +1 top-1 lift came
 * from `vitest-anchored-snapshot` (heading "Snapshot" exact-matched
 * the query phrase), with zero answer-bearing per-case regressions
 * and all honesty gates intact (148/148, 147/148, 3/3).
 */
export const HEADING_ALIASES_DEFAULT_ON = true;

export function headingAliasesEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_HEADING_ALIASES;
  if (raw === undefined) return HEADING_ALIASES_DEFAULT_ON;
  const lower = raw.toLowerCase();
  if (lower === "on") return true;
  if (lower === "off") return false;
  return HEADING_ALIASES_DEFAULT_ON;
}

/**
 * Normalize a query token sequence into a single lowercase phrase
 * with collapsed whitespace and stripped non-alphanumerics. Used for
 * phrase-substring matching against `HeadingAlias.normalized`.
 */
export function normalizedQueryPhrase(query_tokens: string[]): string {
  return query_tokens
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True iff the normalized query phrase shares a substring containment
 * with any heading alias's normalized form (either direction):
 *
 *   - alias contains query  → query phrase is mentioned in the heading
 *   - query contains alias  → heading phrase is mentioned in the query
 *
 * Both directions are useful: the first surfaces docs whose heading
 * is exactly what the user asked; the second surfaces docs whose
 * heading is a meaningful prefix of a longer query (the user added
 * noise tokens around the real topic). Empty queries / phrases never
 * match.
 */
export function headingAliasPhraseMatch(
  query_tokens: string[],
  heading_aliases: { normalized: string }[] | undefined,
): boolean {
  if (!heading_aliases || heading_aliases.length === 0) return false;
  const phrase = normalizedQueryPhrase(query_tokens);
  if (!phrase) return false;
  for (const alias of heading_aliases) {
    const aliasNormalized = alias.normalized
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!aliasNormalized) continue;
    if (aliasNormalized === phrase) return true;
    if (aliasNormalized.includes(phrase)) return true;
    if (phrase.includes(aliasNormalized)) return true;
  }
  return false;
}
