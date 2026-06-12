/**
 * RETRIEVAL_CODE_FENCE_ENTITIES feature flag.
 *
 * Gates the broader code-fence-entity match path in multi-path
 * candidate generation and source-rerank's existing alias_hit_count /
 * owner_identity_score features. Default starts off in dev until
 * promotion gates pass on real-corpus eval.
 *
 * Lives in its own module so the candidate-gen layer
 * (`multi-path-candidates.ts`) can read the flag without importing
 * `source-rerank.ts` (which would create a circular dependency through
 * the rerank → candidates path).
 *
 * Match semantics, locked when the feature was specified:
 *
 *   - **Exact only.** A query token matches an entity exactly when
 *     the existing retrieval tokenizer would produce the same stemmed
 *     token from the entity's surface. No partial / fuzzy /
 *     phrase-substring (heading aliases get phrase-substring because
 *     heading text is prose; code-fence entities are structured
 *     tokens).
 *   - **No additive boost.** A candidate gets credit only when the
 *     query explicitly mentions an extracted entity by name through
 *     the existing alias_hit_count / owner_identity_score paths.
 */

/**
 * Default state of the flag when the env var is unset. Starts `false`
 * while the feature is shadow-only. Flipped to `true` only after the
 * promotion gates pass on real-corpus eval — at which point the
 * commit message documents the per-case delta and addressed misses.
 */
export const CODE_FENCE_ENTITIES_DEFAULT_ON = false;

export function codeFenceEntitiesEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_CODE_FENCE_ENTITIES;
  if (raw === undefined) return CODE_FENCE_ENTITIES_DEFAULT_ON;
  const lower = raw.toLowerCase();
  if (lower === "on") return true;
  if (lower === "off") return false;
  return CODE_FENCE_ENTITIES_DEFAULT_ON;
}
