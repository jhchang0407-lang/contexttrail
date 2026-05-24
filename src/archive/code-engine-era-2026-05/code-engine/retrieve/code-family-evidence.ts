import type { CodeSourceFacts } from "../types/code-source.js";

export type CodeFamilyKind =
  | "source_profile"
  | "source_card"
  | "persistence"
  | "import_workflow"
  | "retrieval_index";

export type CodeFamilyRole =
  | "type"
  | "parser"
  | "store"
  | "schema"
  | "database"
  | "cli"
  | "index"
  | "source_card";

export type CodeFamilyEvidenceReason =
  | "direct_query_token"
  | "query_family"
  | "primary_family"
  | "source_profile_companion"
  | "persistence_companion"
  | "import_workflow_companion"
  | "passive_neighbor";

export type CodeFamilyEvidence = {
  families: CodeFamilyKind[];
  roles: CodeFamilyRole[];
  direct_query_tokens: string[];
  reasons: CodeFamilyEvidenceReason[];
  score: number;
  first_slate_promotable: boolean;
  support_admissible: boolean;
};

export type ScoreCodeFamilyEvidenceArgs = {
  query: string;
  primary?: CodeSourceFacts;
  candidate: CodeSourceFacts;
};

const DIRECT_TOKEN_STOPWORDS = new Set([
  "src",
  "test",
  "tests",
  "file",
  "code",
  "and",
  "for",
  "from",
  "into",
  "the",
  "with",
  "work",
  "wire",
  "wiring",
  "helper",
  "helpers",
  "persist",
  "persistence",
  "support",
  "shared",
  "source",
  "storage",
  "store",
]);

const PASSIVE_TOKENS = new Set([
  "benchmark",
  "comparison",
  "demo",
  "diagnostic",
  "diagnostics",
  "eval",
  "example",
  "fixture",
  "fixtures",
  "measurement",
  "metrics",
  "probe",
  "report",
  "validation",
]);

export function scoreCodeFamilyEvidence(
  args: ScoreCodeFamilyEvidenceArgs,
): CodeFamilyEvidence {
  const queryTokens = tokensFromText(args.query);
  const candidateTokens = tokensFromFacts(args.candidate);
  const primaryTokens = args.primary ? tokensFromFacts(args.primary) : new Set<string>();

  const queryFamilies = inferFamilies(queryTokens);
  const primaryFamilies = inferFamilies(primaryTokens);
  const candidateFamilies = inferFamilies(candidateTokens);
  const roles = inferRoles(candidateTokens);
  const directQueryTokens = [...queryTokens]
    .filter((token) => !DIRECT_TOKEN_STOPWORDS.has(token))
    .filter((token) => candidateTokens.has(token))
    .sort();
  const passiveNeighbor = [...candidateTokens].some((token) =>
    PASSIVE_TOKENS.has(token),
  );

  const reasons = new Set<CodeFamilyEvidenceReason>();
  const queryFamilyMatch = intersects(queryFamilies, candidateFamilies);
  const primaryFamilyMatch = intersects(primaryFamilies, candidateFamilies);
  const sourceProfileCompanion =
    (queryFamilies.has("source_profile") || primaryFamilies.has("source_profile")) &&
    candidateFamilies.has("source_profile") &&
    hasAnyRole(roles, ["type", "parser", "store", "schema", "database", "source_card", "index"]);
  const persistenceCompanion =
    queryFamilies.has("persistence") &&
    (hasAnyRole(roles, ["schema", "database"]) ||
      (roles.has("store") && directQueryTokens.length > 0));
  const importWorkflowCompanion =
    queryFamilies.has("import_workflow") &&
    hasAnyRole(roles, ["cli", "parser", "index", "store", "schema"]);
  const extractedFieldSourceProfileCompanion =
    isExtractedFieldImportWorkflow(queryTokens, queryFamilies) &&
    candidateFamilies.has("source_profile") &&
    hasAnyRole(roles, ["type", "parser", "store", "schema", "database", "source_card", "index"]);

  if (directQueryTokens.length > 0) reasons.add("direct_query_token");
  if (queryFamilyMatch) reasons.add("query_family");
  if (primaryFamilyMatch) reasons.add("primary_family");
  if (sourceProfileCompanion || extractedFieldSourceProfileCompanion) {
    reasons.add("source_profile_companion");
  }
  if (persistenceCompanion) reasons.add("persistence_companion");
  if (importWorkflowCompanion) reasons.add("import_workflow_companion");
  if (passiveNeighbor) reasons.add("passive_neighbor");

  const hasDirectEvidence =
    directQueryTokens.length > 0 || queryFamilyMatch || persistenceCompanion ||
    importWorkflowCompanion;
  const hasFamilyEvidence =
    queryFamilyMatch || primaryFamilyMatch || sourceProfileCompanion ||
    extractedFieldSourceProfileCompanion || persistenceCompanion ||
    importWorkflowCompanion;
  const broadPersistenceStoreOnly =
    candidateFamilies.has("persistence") &&
    roles.size === 1 &&
    roles.has("store") &&
    directQueryTokens.length === 0 &&
    !persistenceCompanion &&
    !sourceProfileCompanion &&
    !importWorkflowCompanion;
  const score = clamp01(
    directQueryTokens.length * 0.14 +
      (queryFamilyMatch ? 0.28 : 0) +
      (primaryFamilyMatch ? 0.18 : 0) +
      (sourceProfileCompanion ? 0.3 : 0) +
      (extractedFieldSourceProfileCompanion ? 0.36 : 0) +
      (persistenceCompanion ? 0.28 : 0) +
      (importWorkflowCompanion ? 0.28 : 0) +
      Math.min(0.16, roles.size * 0.04) -
      (passiveNeighbor ? 0.5 : 0),
  );
  const supportAdmissible =
    !passiveNeighbor &&
    !broadPersistenceStoreOnly &&
    hasFamilyEvidence &&
    roles.size > 0 &&
    score >= 0.35;
  const firstSlatePromotable =
    supportAdmissible && hasDirectEvidence && score >= 0.5;

  return {
    families: [...candidateFamilies].sort(),
    roles: [...roles].sort(),
    direct_query_tokens: directQueryTokens,
    reasons: [...reasons],
    score,
    first_slate_promotable: firstSlatePromotable,
    support_admissible: supportAdmissible,
  };
}

function tokensFromFacts(facts: CodeSourceFacts): Set<string> {
  return tokensFromText(
    [
      facts.file_path,
      facts.file_purpose ?? "",
      ...facts.exported_symbols.map((symbol) => symbol.name),
    ].join(" "),
  );
}

function tokensFromText(text: string): Set<string> {
  const spacedCamel = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const raw = spacedCamel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .flatMap(expandCompoundToken)
    .map(singularize);
  return new Set(raw);
}

function expandCompoundToken(token: string): string[] {
  if (token === "sourceprofile") return ["sourceprofile", "source", "profile"];
  if (token === "sourceprofiles") return ["sourceprofile", "source", "profile"];
  if (token === "sourcecard") return ["sourcecard", "source", "card"];
  if (token === "sourcecards") return ["sourcecard", "source", "card"];
  return [token];
}

function inferFamilies(tokens: Set<string>): Set<CodeFamilyKind> {
  const families = new Set<CodeFamilyKind>();
  if (
    tokens.has("sourceprofile") ||
    (tokens.has("source") && tokens.has("profile"))
  ) {
    families.add("source_profile");
  }
  if (tokens.has("sourcecard") || (tokens.has("source") && tokens.has("card"))) {
    families.add("source_card");
  }
  if (
    hasAny(tokens, [
      "chunk",
      "database",
      "db",
      "migration",
      "persist",
      "persistence",
      "read",
      "reindex",
      "schema",
      "sqlite",
      "storage",
      "store",
      "table",
    ])
  ) {
    families.add("persistence");
  }
  if (
    hasAny(tokens, [
      "cli",
      "cmd",
      "command",
      "extract",
      "import",
      "parse",
      "parser",
      "reindex",
    ])
  ) {
    families.add("import_workflow");
  }
  if (
    hasAny(tokens, [
      "bm25",
      "fts",
      "index",
      "rank",
      "ranking",
      "rerank",
      "retrieval",
      "score",
      "scoring",
      "search",
    ])
  ) {
    families.add("retrieval_index");
  }
  return families;
}

function isExtractedFieldImportWorkflow(
  queryTokens: Set<string>,
  queryFamilies: Set<CodeFamilyKind>,
): boolean {
  return (
    queryFamilies.has("import_workflow") &&
    hasAny(queryTokens, [
      "alias",
      "entity",
      "fence",
      "field",
      "heading",
      "metadata",
      "nav",
      "purpose",
      "topology",
    ])
  );
}

function inferRoles(tokens: Set<string>): Set<CodeFamilyRole> {
  const roles = new Set<CodeFamilyRole>();
  if (hasAny(tokens, ["type", "interface"])) roles.add("type");
  if (hasAny(tokens, ["build", "chunker", "extract", "parse", "parser"])) {
    roles.add("parser");
  }
  if (hasAny(tokens, ["persist", "persistence", "storage", "store"])) {
    roles.add("store");
  }
  if (hasAny(tokens, ["model", "schema", "table"])) roles.add("schema");
  if (hasAny(tokens, ["database", "db", "sqlite"])) roles.add("database");
  if (hasAny(tokens, ["cli", "cmd", "command"])) roles.add("cli");
  if (
    hasAny(tokens, [
      "bm25",
      "fts",
      "index",
      "rank",
      "ranking",
      "rerank",
      "retrieval",
      "score",
      "scoring",
      "search",
    ])
  ) {
    roles.add("index");
  }
  if (tokens.has("sourcecard") || (tokens.has("source") && tokens.has("card"))) {
    roles.add("source_card");
  }
  return roles;
}

function hasAny(tokens: Set<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function hasAnyRole(
  roles: Set<CodeFamilyRole>,
  candidates: readonly CodeFamilyRole[],
): boolean {
  return candidates.some((candidate) => roles.has(candidate));
}

function intersects<T>(left: Set<T>, right: Set<T>): boolean {
  for (const item of left) {
    if (right.has(item)) return true;
  }
  return false;
}

function singularize(token: string): string {
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (
    token.endsWith("s") &&
    token.length > 3 &&
    token !== "source" &&
    !token.endsWith("ss")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
