import type {
  CodeFacilityEvidenceSummary,
  CodeSourceFacts,
} from "../types/code-source.js";

export const CODE_FACILITY_TAGS = [
  "db_connection",
  "schema_carrier",
  "migration_or_reindex",
  "cli_entrypoint",
  "import_command",
  "source_profile_type_carrier",
  "source_profile_store",
  "source_card_projection",
  "code_source_store",
  "chunk_type_carrier",
  "feature_flag_carrier",
  "structural_context_extractor",
  "retrieval_candidate_projection",
] as const;
export type CodeFacilityTag = (typeof CODE_FACILITY_TAGS)[number];

export const CODE_FACILITY_QUERY_INTENTS = [
  "persistence_schema",
  "import_wiring",
  "source_profile_field",
  "flag_wiring",
  "structural_context",
  "retrieval_candidate",
] as const;
export type CodeFacilityQueryIntent =
  (typeof CODE_FACILITY_QUERY_INTENTS)[number];

export type CodeFacilityEvidenceReason =
  | "query_facility_intent"
  | "candidate_facility_tag"
  | "owner_domain_agreement"
  | "direct_query_token";

export function inferCodeFacilityTags(
  facts: CodeSourceFacts,
): CodeFacilityTag[] {
  const path = normalizedPath(facts.file_path);
  const basename = sourceBasename(path);
  const tokens = tokensFromFacts(facts, { includeImports: false });
  const tags = new Set<CodeFacilityTag>();

  if (
    hasPathSegment(path, "store") &&
    (basename === "db" ||
      hasAny(tokens, ["connection", "connect", "database", "open", "sqlite"]))
  ) {
    tags.add("db_connection");
  }

  if (
    basename.includes("schema") ||
    hasAny(tokens, ["column", "ddl", "schema", "sql", "sqlite", "table"])
  ) {
    tags.add("schema_carrier");
  }

  if (
    basename.includes("reindex") ||
    basename.includes("migrat") ||
    hasAny(tokens, ["migrate", "migration", "reindex"])
  ) {
    tags.add("migration_or_reindex");
  }

  if (
    hasPathSegment(path, "cli") ||
    hasPathSegment(path, "cmd") ||
    hasAny(tokens, ["cli", "command", "entrypoint"])
  ) {
    tags.add("cli_entrypoint");
  }

  if (
    (tags.has("cli_entrypoint") || hasPathSegment(path, "cli")) &&
    hasAny(tokens, ["import", "index", "reindex"])
  ) {
    tags.add("import_command");
  }

  if (
    hasSourceProfile(tokens) &&
    hasAny(tokens, ["interface", "shared", "type"])
  ) {
    tags.add("source_profile_type_carrier");
  }

  if (
    hasSourceProfile(tokens) &&
    hasAny(tokens, ["persist", "storage", "store", "upsert"])
  ) {
    tags.add("source_profile_store");
  }

  if (
    hasSourceCard(tokens) &&
    hasAny(tokens, ["context", "pack", "project", "projection", "retrieve"])
  ) {
    tags.add("source_card_projection");
  }

  if (
    (hasAny(tokens, ["codesource", "fts", "source"]) &&
      hasAny(tokens, ["persist", "search", "store", "upsert"])) ||
    (hasPathSegment(path, "store") &&
      hasAny(tokens, ["chunk", "profile", "source"]) &&
      hasAny(tokens, ["persist", "store", "upsert"]))
  ) {
    tags.add("code_source_store");
  }

  if (hasPathSegment(path, "types") && basename === "chunk") {
    tags.add("chunk_type_carrier");
  }

  if (
    basename.includes("flag") ||
    hasAny(tokens, ["env", "flag", "promoted", "toggle"])
  ) {
    tags.add("feature_flag_carrier");
  }

  if (
    hasAny(tokens, ["structural"]) &&
    hasAny(tokens, ["chunk", "context", "extract", "parse"])
  ) {
    tags.add("structural_context_extractor");
  }

  if (
    hasAny(tokens, ["candidate", "facet", "fused", "projection", "rerank"]) ||
    (hasAny(tokens, ["retrieve", "retrieval"]) &&
      hasAny(tokens, ["path", "source", "topology"]))
  ) {
    tags.add("retrieval_candidate_projection");
  }

  return [...tags].sort();
}

export function inferCodeFacilityQueryIntents(
  query: string,
): CodeFacilityQueryIntent[] {
  const tokens = tokensFromText(query);
  const intents = new Set<CodeFacilityQueryIntent>();

  if (
    hasAny(tokens, [
      "column",
      "database",
      "db",
      "field",
      "fts",
      "migration",
      "reindex",
      "schema",
      "sqlite",
      "storage",
      "store",
      "table",
      "virtual",
    ])
  ) {
    intents.add("persistence_schema");
  }

  if (
    hasAny(tokens, ["import", "index", "reindex"]) &&
    hasAny(tokens, ["cli", "command", "time", "wire", "wiring"])
  ) {
    intents.add("import_wiring");
  }

  if (
    hasSourceProfile(tokens) &&
    hasAny(tokens, [
      "alias",
      "card",
      "context",
      "entity",
      "fence",
      "field",
      "heading",
      "index",
      "landing",
      "metadata",
      "nav",
      "package",
      "path",
      "purpose",
      "section",
      "segment",
      "structural",
      "topology",
      "version",
    ])
  ) {
    intents.add("source_profile_field");
  }

  if (
    hasAny(tokens, ["env", "flag", "flip", "promoted", "toggle"]) ||
    /\bflag[-_ ]?flip\b/i.test(query)
  ) {
    intents.add("flag_wiring");
  }

  if (tokens.has("structural") && tokens.has("context")) {
    intents.add("structural_context");
  }

  if (
    hasAny(tokens, [
      "candidate",
      "facet",
      "fused",
      "bm25",
      "projection",
      "rerank",
      "retrieval",
      "score",
      "scoring",
      "topology",
      "weight",
    ])
  ) {
    intents.add("retrieval_candidate");
  }

  return [...intents].sort();
}

export function scoreCodeFacilitySupport(args: {
  query: string;
  seed: CodeSourceFacts;
  candidate: CodeSourceFacts;
}): CodeFacilityEvidenceSummary {
  const queryIntents = inferCodeFacilityQueryIntents(args.query);
  const candidateTags = inferCodeFacilityTags(args.candidate);
  const candidatePath = normalizedPath(args.candidate.file_path);
  const matchingTags = matchingFacilityTags(queryIntents, candidateTags);
  const queryTokens = tokensFromText(args.query);
  const candidateTokens = tokensFromFacts(args.candidate, { includeImports: false });
  const directQueryTokens = [...queryTokens]
    .filter((token) => !DIRECT_QUERY_STOPWORDS.has(token))
    .filter((token) => candidateTokens.has(token))
    .sort();
  const seedDomain = domainTokensFromFacts(args.seed);
  const candidateDomain = domainTokensFromFacts(args.candidate, {
    includeImports: false,
  });
  const sharedDomainTokens = [...seedDomain]
    .filter((token) => candidateDomain.has(token))
    .sort();

  const reasons = new Set<CodeFacilityEvidenceReason>();
  if (queryIntents.length > 0) reasons.add("query_facility_intent");
  if (matchingTags.length > 0) reasons.add("candidate_facility_tag");
  if (sharedDomainTokens.length > 0) reasons.add("owner_domain_agreement");
  if (directQueryTokens.length > 0) reasons.add("direct_query_token");

  const bridgedAgreement =
    hasPersistenceBridge(queryIntents, args.seed, args.candidate) ||
    hasSourceProfileSubstrateBridge(queryIntents, args.seed, args.candidate) ||
    hasStructuralContextSubstrateBridge(queryIntents, args.seed, args.candidate) ||
    hasFlagRetrievalBridge(queryIntents, args.seed, args.candidate);
  const domainAgreement =
    sharedDomainTokens.length > 0 ||
    directQueryTokens.length >= 2 ||
    bridgedAgreement;
  const score = clamp01(
    0.24 +
      matchingTags.length * 0.16 +
      queryIntents.length * 0.05 +
      Math.min(0.16, directQueryTokens.length * 0.04) +
      Math.min(0.18, sharedDomainTokens.length * 0.045) +
      (bridgedAgreement ? 0.08 : 0) +
      (hasHighSignalFacilityTag(matchingTags) ? 0.1 : 0) +
      exactCarrierBoost(matchingTags, candidatePath),
  );
  const supportAdmissible =
    queryIntents.length > 0 &&
    matchingTags.length > 0 &&
    domainAgreement &&
    score >= 0.58;

  return {
    facility_tags: matchingTags,
    query_intents: queryIntents,
    direct_query_tokens: directQueryTokens,
    shared_domain_tokens: sharedDomainTokens,
    reasons: [...reasons],
    score,
    support_admissible: supportAdmissible,
  };
}

const INTENT_FACILITY_TAGS: Record<
  CodeFacilityQueryIntent,
  readonly CodeFacilityTag[]
> = {
  persistence_schema: [
    "schema_carrier",
    "db_connection",
    "migration_or_reindex",
    "cli_entrypoint",
    "import_command",
    "code_source_store",
    "chunk_type_carrier",
  ],
  import_wiring: [
    "cli_entrypoint",
    "import_command",
    "db_connection",
    "source_profile_store",
    "source_card_projection",
    "code_source_store",
  ],
  source_profile_field: [
    "source_profile_type_carrier",
    "source_profile_store",
    "db_connection",
    "schema_carrier",
    "source_card_projection",
    "structural_context_extractor",
    "import_command",
  ],
  flag_wiring: [
    "feature_flag_carrier",
    "retrieval_candidate_projection",
  ],
  structural_context: [
    "structural_context_extractor",
    "source_profile_type_carrier",
    "feature_flag_carrier",
    "code_source_store",
    "chunk_type_carrier",
    "db_connection",
    "schema_carrier",
  ],
  retrieval_candidate: [
    "retrieval_candidate_projection",
    "source_card_projection",
    "code_source_store",
  ],
};

const DIRECT_QUERY_STOPWORDS = new Set([
  "add",
  "change",
  "code",
  "file",
  "field",
  "implementation",
  "source",
  "src",
  "support",
  "wire",
  "wiring",
]);

const DOMAIN_STOPWORDS = new Set([
  "arg",
  "args",
  "async",
  "await",
  "boolean",
  "class",
  "cli",
  "cmd",
  "code",
  "command",
  "const",
  "export",
  "file",
  "from",
  "function",
  "index",
  "interface",
  "main",
  "number",
  "return",
  "source",
  "src",
  "string",
  "go",
  "js",
  "jsx",
  "py",
  "rs",
  "test",
  "tests",
  "ts",
  "tsx",
  "type",
  "void",
]);

function matchingFacilityTags(
  intents: readonly CodeFacilityQueryIntent[],
  tags: readonly CodeFacilityTag[],
): CodeFacilityTag[] {
  const allowed = new Set(
    intents.flatMap((intent) => [...INTENT_FACILITY_TAGS[intent]]),
  );
  return tags.filter((tag) => allowed.has(tag)).sort();
}

function hasPersistenceBridge(
  intents: readonly CodeFacilityQueryIntent[],
  seed: CodeSourceFacts,
  candidate: CodeSourceFacts,
): boolean {
  if (!intents.includes("persistence_schema")) return false;
  const seedTokens = tokensFromFacts(seed);
  const candidateTags = inferCodeFacilityTags(candidate);
  return (
    candidateTags.some((tag) =>
      tag === "db_connection" ||
      tag === "schema_carrier" ||
      tag === "migration_or_reindex" ||
      tag === "cli_entrypoint" ||
      tag === "import_command" ||
      tag === "chunk_type_carrier"
    ) &&
    hasAny(seedTokens, ["chunk", "database", "db", "fts", "schema", "store", "table"])
  );
}

function hasSourceProfileSubstrateBridge(
  intents: readonly CodeFacilityQueryIntent[],
  seed: CodeSourceFacts,
  candidate: CodeSourceFacts,
): boolean {
  if (!intents.includes("source_profile_field")) return false;
  const seedTokens = tokensFromFacts(seed);
  const candidateTags = inferCodeFacilityTags(candidate);
  return (
    hasSourceProfile(seedTokens) &&
    candidateTags.some((tag) =>
      tag === "db_connection" ||
      tag === "schema_carrier" ||
      tag === "source_profile_store" ||
      tag === "source_profile_type_carrier" ||
      tag === "source_card_projection" ||
      tag === "import_command"
    )
  );
}

function hasStructuralContextSubstrateBridge(
  intents: readonly CodeFacilityQueryIntent[],
  seed: CodeSourceFacts,
  candidate: CodeSourceFacts,
): boolean {
  if (!intents.includes("structural_context")) return false;
  const seedTokens = tokensFromFacts(seed);
  const candidateTags = inferCodeFacilityTags(candidate);
  return (
    hasAny(seedTokens, ["bm25", "chunk", "context", "retrieve", "retrieval", "structural"]) &&
    candidateTags.some((tag) =>
      tag === "code_source_store" ||
      tag === "db_connection" ||
      tag === "schema_carrier" ||
      tag === "source_profile_type_carrier" ||
      tag === "structural_context_extractor" ||
      tag === "chunk_type_carrier"
    )
  );
}

function hasFlagRetrievalBridge(
  intents: readonly CodeFacilityQueryIntent[],
  seed: CodeSourceFacts,
  candidate: CodeSourceFacts,
): boolean {
  if (!intents.includes("flag_wiring")) return false;
  const seedTokens = tokensFromFacts(seed);
  const candidateTags = inferCodeFacilityTags(candidate);
  return (
    hasAny(seedTokens, ["env", "flag", "promoted", "toggle"]) &&
    candidateTags.includes("retrieval_candidate_projection")
  );
}

function hasHighSignalFacilityTag(tags: readonly CodeFacilityTag[]): boolean {
  return tags.some((tag) =>
    tag === "source_profile_type_carrier" ||
    tag === "source_profile_store" ||
    tag === "schema_carrier" ||
    tag === "db_connection" ||
    tag === "chunk_type_carrier" ||
    tag === "feature_flag_carrier" ||
    tag === "retrieval_candidate_projection"
  );
}

function exactCarrierBoost(
  tags: readonly CodeFacilityTag[],
  path: string,
): number {
  const basename = sourceBasename(path);
  const pathTokens = tokensFromText(path);
  if (basename === "db" && tags.includes("db_connection")) return 0.25;
  if (basename === "schema" && tags.includes("schema_carrier")) return 0.25;
  if (basename === "chunk" && tags.includes("chunk_type_carrier")) return 0.25;
  if (
    (tags.includes("cli_entrypoint") || tags.includes("import_command")) &&
    (hasPathSegment(path, "cli") || hasPathSegment(path, "cmd")) &&
    hasAny(pathTokens, ["cli", "cmd", "command", "import", "index", "main", "reindex"])
  ) {
    return 0.34;
  }
  if (
    tags.includes("code_source_store") &&
    hasPathSegment(path, "store") &&
    hasAny(pathTokens, ["chunk", "code", "profile", "source"])
  ) {
    return 0.34;
  }
  return 0;
}

function tokensFromFacts(
  facts: CodeSourceFacts,
  opts: { includeImports?: boolean } = {},
): Set<string> {
  return tokensFromText(
    [
      facts.file_path,
      facts.file_purpose ?? "",
      ...facts.exported_symbols.map((symbol) => symbol.name),
      ...facts.exported_signatures,
      ...(opts.includeImports === false ? [] : facts.imports),
    ].join(" "),
  );
}

function domainTokensFromFacts(
  facts: CodeSourceFacts,
  opts: { includeImports?: boolean } = {},
): Set<string> {
  return new Set(
    [...tokensFromFacts(facts, opts)].filter((token) => !DOMAIN_STOPWORDS.has(token)),
  );
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
      .flatMap(expandCompoundToken)
      .map(singularize),
  );
}

function expandCompoundToken(token: string): string[] {
  if (token === "sourceprofile" || token === "sourceprofiles") {
    return ["sourceprofile", "source", "profile"];
  }
  if (token === "sourcecard" || token === "sourcecards") {
    return ["sourcecard", "source", "card"];
  }
  if (token === "codesource" || token === "codesources") {
    return ["codesource", "code", "source"];
  }
  return [token];
}

function hasSourceProfile(tokens: Set<string>): boolean {
  return tokens.has("sourceprofile") ||
    (tokens.has("source") && tokens.has("profile"));
}

function hasSourceCard(tokens: Set<string>): boolean {
  return tokens.has("sourcecard") || (tokens.has("source") && tokens.has("card"));
}

function hasAny(tokens: Set<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function sourceBasename(path: string): string {
  return path
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "") ?? "";
}

function hasPathSegment(path: string, segment: string): boolean {
  return path === segment || path.startsWith(`${segment}/`) ||
    path.includes(`/${segment}/`) || path.endsWith(`/${segment}`);
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
