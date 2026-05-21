import type { CodeSourceFacts } from "../types/code-source.js";

export type CodeRepoFamilyEvidenceReason =
  | "direct_query_token"
  | "basename_identity"
  | "package_identity"
  | "module_identity"
  | "dialect_identity"
  | "purpose_identity";

export type CodeRepoFamilyEvidence = {
  identity_tokens: string[];
  direct_query_tokens: string[];
  family_tokens: string[];
  module_tokens: string[];
  reasons: CodeRepoFamilyEvidenceReason[];
  score: number;
  owner_admissible: boolean;
  shadow_candidate: boolean;
};

export function scoreCodeRepoFamilyEvidence(args: {
  query: string;
  facts: CodeSourceFacts;
}): CodeRepoFamilyEvidence {
  const queryTokens = tokensFromText(args.query);
  const path = args.facts.file_path.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = path.split("/").filter(Boolean);
  const basename = stripExtension(segments.at(-1) ?? "");
  const basenameTokens = tokensFromText(basename);
  const pathTokens = new Set(segments.flatMap(tokenListFromText));
  const purposeTokens = tokensFromText(args.facts.file_purpose ?? "");
  const symbolTokens = new Set(
    args.facts.exported_symbols.flatMap((symbol) => tokenListFromText(symbol.name)),
  );
  const identityTokens = new Set([
    ...pathTokens,
    ...purposeTokens,
    ...symbolTokens,
  ]);
  const familyTokens = new Set(
    segments
      .slice(0, Math.max(segments.length - 2, 1))
      .flatMap(tokenListFromText)
      .filter((token) => !REPO_FAMILY_STOPWORDS.has(token)),
  );
  const moduleTokens = new Set(
    segments
      .slice(Math.max(0, segments.length - 3), -1)
      .flatMap(tokenListFromText)
      .filter((token) => !REPO_FAMILY_STOPWORDS.has(token)),
  );
  const directQueryTokens = [...queryTokens]
    .filter((token) => !DIRECT_QUERY_STOPWORDS.has(token))
    .filter((token) => identityTokens.has(token))
    .sort();

  const basenameIdentity = directQueryTokens.some((token) =>
    basenameTokens.has(token),
  );
  const familyOverlap = countMatches(familyTokens, queryTokens);
  const moduleOverlap = countMatches(moduleTokens, queryTokens);
  const dialectIdentity =
    basenameIdentity &&
    moduleOverlap > 0 &&
    directQueryTokens.filter((token) => !familyTokens.has(token)).length >= 2;
  const purposeIdentity = countMatches(purposeTokens, queryTokens) >= 2;

  const reasons = new Set<CodeRepoFamilyEvidenceReason>();
  if (directQueryTokens.length > 0) reasons.add("direct_query_token");
  if (basenameIdentity) reasons.add("basename_identity");
  if (familyOverlap >= 2) reasons.add("package_identity");
  if (moduleOverlap > 0) reasons.add("module_identity");
  if (dialectIdentity) reasons.add("dialect_identity");
  if (purposeIdentity) reasons.add("purpose_identity");

  const score = clamp01(
    Math.min(0.45, directQueryTokens.length * 0.11) +
      (basenameIdentity ? 0.24 : 0) +
      Math.min(0.22, familyOverlap * 0.08) +
      Math.min(0.16, moduleOverlap * 0.07) +
      (dialectIdentity ? 0.22 : 0) +
      (purposeIdentity ? 0.08 : 0),
  );

  return {
    identity_tokens: [...identityTokens]
      .filter((token) => !REPO_FAMILY_STOPWORDS.has(token))
      .sort(),
    direct_query_tokens: directQueryTokens,
    family_tokens: [...familyTokens].sort(),
    module_tokens: [...moduleTokens].sort(),
    reasons: [...reasons],
    score,
    owner_admissible: score >= 0.5 && directQueryTokens.length >= 2,
    shadow_candidate: score >= 0.35 && directQueryTokens.length > 0,
  };
}

const DIRECT_QUERY_STOPWORDS = new Set([
  "app",
  "apps",
  "cmd",
  "code",
  "core",
  "crate",
  "crates",
  "file",
  "files",
  "implementation",
  "index",
  "internal",
  "lib",
  "library",
  "module",
  "package",
  "packages",
  "pkg",
  "source",
  "src",
  "test",
  "tests",
]);

const REPO_FAMILY_STOPWORDS = new Set([
  ...DIRECT_QUERY_STOPWORDS,
  "db",
  "database",
  "main",
  "mod",
  "util",
  "utils",
]);

function tokenListFromText(text: string): string[] {
  return [...tokensFromText(text)];
}

function tokensFromText(text: string): Set<string> {
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return new Set(
    spaced
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1)
      .map(singularize),
  );
}

function stripExtension(path: string): string {
  return path.replace(/\.[^.]+$/, "");
}

function singularize(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (
    token.endsWith("s") &&
    token.length > 3 &&
    token !== "vcs" &&
    token !== "css" &&
    !token.endsWith("ss")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function countMatches(
  values: Set<string>,
  queryTokens: Set<string>,
): number {
  let count = 0;
  for (const value of values) {
    if (queryTokens.has(value)) count += 1;
  }
  return count;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
