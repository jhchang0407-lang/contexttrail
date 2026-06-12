/**
 * Chunk-correctness helper for eval surfaces.
 *
 * Source correctness ("did we pick the right doc?") is already measured.
 * Chunk correctness asks the next question: given that the source is
 * acceptable, did we pick the right section inside it? This module is a
 * pure helper; expectations come from the case fixtures (a list of
 * heading substrings the top-1 chunk's drift should contain).
 *
 * Returns null when the case declares no chunk expectation, so chunk
 * correctness stays an additive metric that does not penalize legacy
 * fixtures.
 */
export function evaluateChunkCorrectness(
  expectedChunkHeadings: string[] | undefined,
  topChunkContextTrail: string | undefined,
): boolean | null {
  if (!expectedChunkHeadings || expectedChunkHeadings.length === 0) return null;
  if (!topChunkContextTrail) return false;
  const haystack = topChunkContextTrail.toLowerCase();
  return expectedChunkHeadings.some((heading) => haystack.includes(heading.toLowerCase()));
}
