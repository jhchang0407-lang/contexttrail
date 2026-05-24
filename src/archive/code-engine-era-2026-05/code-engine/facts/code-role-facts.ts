import type {
  CodeSourceFacts,
  CodeSourceFileRole,
  CodeSourceRoleFacts,
} from "../types/code-source.js";

export function withCodeRoleFacts(facts: CodeSourceFacts): CodeSourceFacts {
  return {
    ...facts,
    role_facts: facts.role_facts ?? inferCodeRoleFacts(facts),
  };
}

export function inferCodeRoleFacts(facts: Pick<CodeSourceFacts, "file_path" | "exported_symbols" | "file_purpose">): CodeSourceRoleFacts {
  const path = normalizeCodePath(facts.file_path);
  const segments = path.split("/").filter(Boolean);
  const basename = sourceBasename(path);
  const stem = basename.replace(/\.[^.]+$/, "");
  const pathTokens = tokenSet([
    path,
    facts.file_purpose ?? "",
    ...facts.exported_symbols.map((symbol) => symbol.name),
  ].join(" "));
  const packageInfo = packageRootInfo(segments);
  const workspaceName = packageInfo?.workspaceName ?? null;
  const fileRoles = fileRolesForPath(path, stem, pathTokens);
  const workspaceFamilyKeys = workspaceName
    ? workspaceFamilyKeysFor(workspaceName)
    : [];
  const moduleFamilyKeys = moduleFamilyKeysFor(segments);
  const pathPatternKeys = pathPatternKeysFor(path, segments, packageInfo);
  const roleTokens = [
    ...fileRoles,
    ...(workspaceName ? lexicalTokens(workspaceName) : []),
    ...workspaceFamilyKeys.flatMap(lexicalTokens),
    ...moduleFamilyKeys.flatMap(lexicalTokens),
    ...pathPatternKeys.flatMap(lexicalTokens),
  ];

  return {
    package_root: packageInfo?.packageRoot ?? null,
    workspace_name: workspaceName,
    workspace_family_keys: unique(workspaceFamilyKeys),
    module_family_keys: unique(moduleFamilyKeys),
    path_pattern_keys: unique(pathPatternKeys),
    file_roles: unique(fileRoles),
    role_tokens: unique(roleTokens),
    is_barrel: fileRoles.includes("barrel"),
    is_support_like: fileRoles.some((role) =>
      SUPPORT_LIKE_ROLES.has(role)
    ),
  };
}

export function codeRoleFactsSummary(facts: CodeSourceFacts): string {
  const roleFacts = facts.role_facts ?? inferCodeRoleFacts(facts);
  const parts: string[] = [];
  if (roleFacts.file_roles.length > 0) {
    parts.push(`Roles: ${roleFacts.file_roles.join(", ")}`);
  }
  if (roleFacts.package_root) parts.push(`Package: ${roleFacts.package_root}`);
  if (roleFacts.workspace_name) parts.push(`Workspace: ${roleFacts.workspace_name}`);
  if (roleFacts.workspace_family_keys.length > 0) {
    parts.push(`Workspace families: ${roleFacts.workspace_family_keys.join(", ")}`);
  }
  if (roleFacts.module_family_keys.length > 0) {
    parts.push(`Module families: ${roleFacts.module_family_keys.join(", ")}`);
  }
  if (roleFacts.path_pattern_keys.length > 0) {
    parts.push(`Path patterns: ${roleFacts.path_pattern_keys.join(", ")}`);
  }
  return parts.join("\n");
}

function normalizeCodePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function sourceBasename(path: string): string {
  return path.split("/").pop() ?? "";
}

function packageRootInfo(
  segments: readonly string[],
): { packageRoot: string; workspaceName: string } | null {
  const markerIndex = segments.findIndex((segment) =>
    PACKAGE_ROOT_MARKERS.has(segment)
  );
  if (markerIndex < 0 || !segments[markerIndex + 1]) return null;
  if (
    segments[markerIndex] === "packages" &&
    segments[markerIndex + 1]?.startsWith("@") &&
    segments[markerIndex + 2]
  ) {
    return {
      packageRoot: `${segments[markerIndex]}/${segments[markerIndex + 1]}/${segments[markerIndex + 2]}`,
      workspaceName: `${segments[markerIndex + 1]}/${segments[markerIndex + 2]}`,
    };
  }
  return {
    packageRoot: `${segments[markerIndex]}/${segments[markerIndex + 1]}`,
    workspaceName: segments[markerIndex + 1]!,
  };
}

function fileRolesForPath(
  path: string,
  stem: string,
  pathTokens: ReadonlySet<string>,
): CodeSourceFileRole[] {
  const roles: CodeSourceFileRole[] = [];
  if (CONFIG_PATH_PATTERN.test(path)) roles.push("config");
  if (
    hasAny(pathTokens, ["build", "compile", "tsup", "rollup", "webpack", "vite"]) ||
    path.includes("/helpers/") ||
    path.includes("/scripts/")
  ) {
    roles.push("build");
  }
  if (["index", "mod", "lib"].includes(stem)) roles.push("barrel");
  if (["index", "mod", "lib", "main", "cli"].includes(stem)) {
    roles.push("entrypoint");
  }
  if (hasAny(pathTokens, ["parser", "parse", "formatter", "format", "syntax", "verbatim", "lexer"])) {
    roles.push("parser_formatter");
  }
  if (hasAny(pathTokens, ["schema", "type", "types", "model", "interface"])) {
    roles.push("schema_type");
  }
  if (hasAny(pathTokens, ["adapter", "driver", "session", "dialect", "store", "storage", "db", "database"])) {
    roles.push("persistence_driver");
  }
  if (hasAny(pathTokens, ["test", "tests", "spec", "fixture", "fixtures", "setup", "mock", "mocks"])) {
    roles.push("test_support");
  }
  if (hasAny(pathTokens, ["helper", "helpers", "util", "utils"])) roles.push("helper");
  if (roles.length === 0) roles.push("implementation");
  return unique(roles);
}

function workspaceFamilyKeysFor(workspaceName: string): string[] {
  const normalized = workspaceName.replace(/^@[^/]+\//, "");
  const tokens = normalized
    .replace(/_/g, "-")
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
  const keys = [normalized.toLowerCase()];
  if (tokens.length >= 2 && WORKSPACE_VARIANT_PREFIXES.has(tokens[0]!)) {
    keys.push(tokens.slice(1).join("-"));
  }
  if (tokens.length >= 2 && WORKSPACE_VARIANT_SUFFIXES.has(tokens.at(-1)!)) {
    keys.push(tokens.slice(0, -1).join("-"));
  }
  if (tokens.length >= 3) {
    keys.push(`${tokens[0]}-*-${tokens.at(-1)}`);
    keys.push(`*-${tokens.slice(1).join("-")}`);
  }
  if (/^biome_[a-z0-9]+_formatter$/.test(normalized)) {
    keys.push("biome_*_formatter");
  }
  if (/^biome-[a-z0-9]+-formatter$/.test(normalized)) {
    keys.push("biome-*-formatter");
  }
  return unique(keys.filter((key) => key.length > 0));
}

function moduleFamilyKeysFor(segments: readonly string[]): string[] {
  const keys: string[] = [];
  for (let index = 0; index < segments.length - 1; index++) {
    if (segments[index] === "src" && segments[index + 1]) {
      keys.push(`src/${segments[index + 1]}`);
      if (segments[index + 2]) {
        keys.push(`src/${segments[index + 1]}/${segments[index + 2]}`);
      }
    }
    if (segments[index] === "library" && segments[index + 1] === "src" && segments[index + 2]) {
      keys.push(`library/src/${segments[index + 2]}`);
    }
    if (segments[index] === "drizzle-orm" && segments[index + 1] === "src" && segments[index + 2]) {
      keys.push(`drizzle-orm/src/${segments[index + 2]}`);
      if (segments[index + 2]!.endsWith("-core")) keys.push("drizzle-orm/src/*-core");
    }
  }
  return unique(keys);
}

function pathPatternKeysFor(
  path: string,
  segments: readonly string[],
  packageInfo: { packageRoot: string; workspaceName: string } | null,
): string[] {
  const withoutExt = path.replace(/\.[^.]+$/, "");
  const keys: string[] = [];
  if (packageInfo) {
    const rest = path.slice(packageInfo.packageRoot.length + 1).replace(/\.[^.]+$/, "");
    const marker = packageInfo.packageRoot.split("/")[0]!;
    keys.push(`${marker}/*/${rest}`);
  }
  keys.push(withCoreWildcard(withoutExt));
  keys.push(withFormatterWildcard(withoutExt));
  if (segments.includes("src")) {
    const srcIndex = segments.indexOf("src");
    keys.push(`*/${segments.slice(srcIndex).join("/").replace(/\.[^.]+$/, "")}`);
  }
  return unique(keys.filter((key) => key && key !== withoutExt));
}

function withCoreWildcard(path: string): string {
  return path.replace(/\/[a-z0-9-]+-core\//g, "/*-core/");
}

function withFormatterWildcard(path: string): string {
  return path
    .replace(/biome_[a-z0-9]+_formatter/g, "biome_*_formatter")
    .replace(/biome-[a-z0-9]+-formatter/g, "biome-*-formatter");
}

function tokenSet(text: string): Set<string> {
  return new Set(lexicalTokens(text));
}

function lexicalTokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function hasAny(tokens: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

const PACKAGE_ROOT_MARKERS = new Set(["apps", "crates", "libs", "packages", "pkg"]);

const WORKSPACE_VARIANT_PREFIXES = new Set([
  "angular",
  "lit",
  "preact",
  "react",
  "solid",
  "svelte",
  "vue",
]);

const WORKSPACE_VARIANT_SUFFIXES = new Set([
  "adapter",
  "client",
  "devtools",
  "plugin",
]);

const SUPPORT_LIKE_ROLES = new Set<CodeSourceFileRole>([
  "config",
  "build",
  "barrel",
  "entrypoint",
  "schema_type",
  "persistence_driver",
  "test_support",
  "helper",
]);

const CONFIG_PATH_PATTERN =
  /(?:^|\/)(?:vite|vitest|jest|playwright|cypress|eslint|prettier|tsup|tsdown|rollup|webpack|tailwind|docusaurus|astro|next|nuxt|svelte|babel|swc|typedoc|commitlint)(?:\.workspace)?\.config\./;
