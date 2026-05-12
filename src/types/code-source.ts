/**
 * CodeSourceFacts (PRD-0028 / slice 28.1).
 *
 * Deterministic per-file metadata extracted from a TypeScript/TSX source via
 * the TypeScript compiler API. Peer kind to SourceProfile in the index — code
 * files indexed alongside docs so retrieval can surface `.ts` files an
 * engineer must modify alongside the PRDs/ADRs they must read.
 *
 * Boundary: structural metadata only (paths + exported symbols + JSDoc
 * summary + signatures + imports). No code bodies.
 */

export const CODE_SOURCE_EXPORT_KINDS = [
  "function",
  "type",
  "interface",
  "class",
  "const",
  "enum",
] as const;
export type CodeSourceExportKind = (typeof CODE_SOURCE_EXPORT_KINDS)[number];

export type CodeSourceExportedSymbol = {
  name: string;
  kind: CodeSourceExportKind;
};

export const CODE_SOURCE_SIGNATURE_CHAR_BUDGET = 240;
export const CODE_SOURCE_PURPOSE_CHAR_BUDGET = 480;

export type CodeSourceFacts = {
  file_path: string;
  exported_symbols: CodeSourceExportedSymbol[];
  exported_signatures: string[];
  file_purpose: string | null;
  imports: string[];
};
