/**
 * THO-135 / PRD-0013 V2.5.2 — corpus import coverage classification.
 *
 * Pure function; eval-only. Distinguishes "the import never saw this source"
 * from any retrieval-stage failure so reports can attribute Zod-style misses
 * (where `wiki/optionality.md` was never indexed) to corpus coverage rather
 * than ranking.
 */
export type ImportCoverageInput = {
  expected_sources: string[];
  imported_sources: string[];
};

export type ImportCoverageResult = {
  /** Set of imported source paths for fast lookup. */
  imported_set: Set<string>;
  /** Expected sources missing from the imported inventory, in expected order. */
  not_imported_sources: string[];
};

export function computeImportCoverage(
  input: ImportCoverageInput,
): ImportCoverageResult {
  const imported_set = new Set(input.imported_sources);
  const not_imported_sources = input.expected_sources.filter(
    (path) => !imported_set.has(path),
  );
  return { imported_set, not_imported_sources };
}
