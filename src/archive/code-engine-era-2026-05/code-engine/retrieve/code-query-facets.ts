export type CodeQueryFacet = {
  query: string;
  reason: "dotted_identity" | "conventional_scope" | "code_identifier";
};

export function buildCodeQueryFacets(query: string): CodeQueryFacet[] {
  const facets: CodeQueryFacet[] = [];
  const scope = conventionalScopeFacet(query);
  if (scope) {
    facets.push({ query: scope, reason: "conventional_scope" });
  }
  for (const identity of dottedIdentityFacets(query)) {
    facets.push({ query: identity, reason: "dotted_identity" });
  }
  for (const identifier of codeIdentifierFacets(query)) {
    facets.push({ query: identifier, reason: "code_identifier" });
  }
  return dedupeFacets(facets).slice(0, 8);
}

function dottedIdentityFacets(query: string): string[] {
  const out: string[] = [];
  const pattern = /\b[A-Za-z_][A-Za-z0-9_]*(?:[./_-][A-Za-z0-9_]+)+\b/g;
  for (const match of query.matchAll(pattern)) {
    const parts = codeFacetTokens(match[0] ?? "");
    if (parts.length >= 2) out.push(parts.join(" "));
  }
  return out;
}

function conventionalScopeFacet(query: string): string | null {
  const match =
    /\b(?:feat|fix|refactor|perf|test|docs|chore|ci|build)(?:\(([^)]+)\))?!?:/i
      .exec(query);
  if (!match?.[1]) return null;
  const tokens = codeFacetTokens(match[1]);
  return tokens.length > 0 ? tokens.join(" ") : null;
}

function codeIdentifierFacets(query: string): string[] {
  const out: string[] = [];
  for (const match of query.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)) {
    const token = match[0] ?? "";
    if (!isCodeShapedIdentifier(token)) continue;
    const parts = codeFacetTokens(token);
    if (parts.length >= 2) out.push(parts.join(" "));
  }
  return out;
}

function isCodeShapedIdentifier(token: string): boolean {
  return token.includes("_") || token.includes("$") || /\d/.test(token) ||
    /[a-z][A-Z]/.test(token);
}

function codeFacetTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2)
        .filter((token) => !CODE_QUERY_FACET_STOPWORDS.has(token)),
    ),
  ];
}

function dedupeFacets(facets: CodeQueryFacet[]): CodeQueryFacet[] {
  const seen = new Set<string>();
  const out: CodeQueryFacet[] = [];
  for (const facet of facets) {
    if (seen.has(facet.query)) continue;
    seen.add(facet.query);
    out.push(facet);
  }
  return out;
}

const CODE_QUERY_FACET_STOPWORDS = new Set([
  "core",
  "misc",
  "source",
]);
