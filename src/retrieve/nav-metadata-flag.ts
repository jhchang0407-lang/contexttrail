/**
 * RETRIEVAL_NAV_METADATA feature flag.
 *
 * Gates provenance-aware consumption of import-time nav fields by
 * source-rerank's existing alias substrate (`alias_hit_count`,
 * `owner_identity_score`) and `overview_owner_score`. Default starts
 * off in dev until promotion gates pass on real-corpus eval.
 *
 * Lives in its own module so the candidate-gen layer
 * (`multi-path-candidates.ts`) can read the flag without importing
 * `source-rerank.ts` (which would create a circular dependency
 * through the rerank → candidates path).
 *
 * Match semantics:
 *
 *   - **No new score-component coefficient.** Trusted `nav_label`
 *     evidence feeds the existing alias substrate alongside title /
 *     path / heading aliases; trusted `is_nav_landing` evidence feeds
 *     the existing `overview_owner_score`. No new feature in
 *     `SourceRerankFeatures`.
 *   - **Provenance gate.** Explicit project nav and frontmatter labels
 *     may feed alias matching. Only explicit project nav can feed
 *     overview-owner scoring. Structural README/index fallbacks stay
 *     explain-only.
 *   - **No additive boost.** Nav fields contribute only via existing
 *     features.
 *   - **Diagnostic-only fields.** `nav_section_id`, `nav_position`,
 *     `nav_origin`, and `nav_provenance` surface in explain output
 *     (already on `SourceCard.nav_metadata`) but do not directly enter
 *     ranking math.
 */

/**
 * Default state of the flag when the env var is unset. Starts `false`
 * while nav-metadata consumption is shadow-only. Flipped to `true` only after the
 * promotion gates pass on real-corpus eval — the commit message that
 * flips it documents per-case delta and addressed misses.
 */
export const NAV_METADATA_DEFAULT_ON = false;

export function navMetadataEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_NAV_METADATA;
  if (raw === undefined) return NAV_METADATA_DEFAULT_ON;
  const lower = raw.toLowerCase();
  if (lower === "on") return true;
  if (lower === "off") return false;
  return NAV_METADATA_DEFAULT_ON;
}
