/**
 * PRD-0024 / THO-219 — deterministic code-fence entity extractor.
 *
 * Pure function over a markdown source. Walks fenced code blocks via
 * the existing markdown AST and emits structured entities by
 * language-aware lightweight pattern matching:
 *
 *   - import          import ... from "x", require("x")
 *   - package_name    non-relative imports + npm/pnpm/yarn install <pkg>
 *   - config_file     well-known config filename literals
 *   - config_key      object keys in config-shaped TS/JS/JSON/YAML fences
 *   - cli_command     command-shaped lines in shell fences
 *   - symbol          exported declarations + named-import bindings
 *   - route           HTTP-route-shaped string literals when the section
 *                     heading mentions HTTP/API/route/endpoint
 *
 * No learned model. No fuzzy matching. Empty/whitespace-only entities
 * dropped. Unsupported languages produce zero entities so a Python
 * source fence never spuriously emits TS-style imports.
 *
 * The lever is *what evidence the existing scoring sees*, not *how the
 * score is computed*. Slice 24.2.3 wires extracted entities through
 * the existing alias substrate and the existing alias_hit_count and
 * owner_identity_score features in source-rerank.
 */
import type { Heading } from "mdast";
import { parse } from "../parse/markdown.js";

export type CodeFenceEntityKind =
  | "import"
  | "package_name"
  | "config_file"
  | "config_key"
  | "cli_command"
  | "symbol"
  | "route";

export type CodeFenceEntity = {
  /** Closed-set entity kind. */
  kind: CodeFenceEntityKind;
  /** Raw entity surface, preserved verbatim (case + punctuation). */
  value: string;
  /** Lowercased, language-appropriate normalization. */
  normalized: string;
  /** Code-fence info string lowercased (`ts`, `typescript`, `sh`, ...). */
  language: string;
  /** Nearest enclosing markdown heading, surface form. Null if none. */
  section_heading: string | null;
};

const TS_JS_LANGS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "typescript",
  "javascript",
  "mjs",
  "cjs",
  "mts",
  "cts",
]);
const SHELL_LANGS = new Set([
  "sh",
  "bash",
  "shell",
  "zsh",
  "console",
  "shellscript",
]);
const JSON_LANGS = new Set(["json", "jsonc", "json5"]);
const YAML_LANGS = new Set(["yaml", "yml"]);

const ROUTE_HEADING_KEYWORDS =
  /\b(http|api|route|routes|endpoint|endpoints|rest|webhook|handler)\b/i;

const CONFIG_FILE_PATTERNS: RegExp[] = [
  /\b[\w.-]+\.config\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|yaml|yml)\b/g,
  /\btsconfig(?:\.[\w-]+)?\.json\b/g,
  /\bpackage(?:-lock)?\.json\b/g,
  /\b\.?(?:eslintrc|prettierrc|babelrc)(?:\.[\w-]+)?(?:\.json|\.yaml|\.yml|\.js|\.cjs|\.mjs)?\b/g,
];

const PACKAGE_INSTALL_RE =
  /^[ \t]*(?:\$\s*)?(?:npm|pnpm|yarn|bun|npx|pnpx)\s+(?:install|add|i)\b([^\n]*)/gim;

// `from "x"` covers static and dynamic-import-like statements.
const FROM_IMPORT_RE = /\bfrom\s+["']([^"']+)["']/g;
// `import "x";` side-effect imports.
const SIDE_EFFECT_IMPORT_RE = /^\s*import\s+["']([^"']+)["']\s*;?/gm;
// `require("x")` CJS imports.
const REQUIRE_RE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
// `import [Foo, ]{ a, b as c } from "x"` — captures the named-import block.
const NAMED_IMPORT_RE =
  /\bimport\s*[^{}'"`]*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
const DEFAULT_IMPORT_RE =
  /\bimport\s+([A-Za-z_]\w*)(?:\s*,\s*(?:\*\s+as\s+\w+|\{[^}]*\}))?\s+from\s+["']([^"']+)["']/g;
const NAMESPACE_IMPORT_RE =
  /\bimport\s*\*\s+as\s+([A-Za-z_]\w*)\s+from\s+["']([^"']+)["']/g;

const EXPORT_FUNCTION_RE = /\bexport\s+(?:async\s+)?function\s+(\w+)/g;
const EXPORT_CLASS_RE = /\bexport\s+(?:abstract\s+)?class\s+(\w+)/g;
const EXPORT_INTERFACE_RE = /\bexport\s+interface\s+(\w+)/g;
const EXPORT_TYPE_RE = /\bexport\s+type\s+(\w+)/g;
const EXPORT_CONST_RE = /\bexport\s+(?:const|let|var)\s+([A-Za-z_]\w*)/g;
const EXPORT_DEFAULT_NAMED_RE =
  /\bexport\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_]\w*)/g;
const EXPORT_ENUM_RE = /\bexport\s+(?:const\s+)?enum\s+(\w+)/g;

const ROUTE_LITERAL_RE = /(["'`])(\/[^"'`\s]*)\1/g;

const KNOWN_CLI_PREFIXES = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "pnpx",
  "node",
  "deno",
  "tsx",
  "ts-node",
  "vitest",
  "jest",
  "mocha",
  "playwright",
  "cypress",
  "eslint",
  "prettier",
  "tsc",
  "next",
  "vite",
  "webpack",
  "rollup",
  "esbuild",
  "turbo",
  "nx",
  "rush",
  "git",
  "docker",
  "kubectl",
  "make",
  "cargo",
  "go",
  "python",
  "pip",
  "rails",
]);

export function extractCodeFenceEntities(markdown: string): CodeFenceEntity[] {
  if (!markdown) return [];
  const parsed = parse(markdown);
  const ast = parsed.ast;
  const out: CodeFenceEntity[] = [];
  const headingStack: { depth: number; text: string }[] = [];
  for (const node of ast.children ?? []) {
    if (node.type === "heading") {
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1]!.depth >= node.depth
      ) {
        headingStack.pop();
      }
      const text = headingText(node);
      if (text) headingStack.push({ depth: node.depth, text });
    } else if (node.type === "code") {
      const language = (node.lang ?? "").toLowerCase().trim();
      const code = node.value ?? "";
      const section_heading =
        headingStack.length > 0
          ? headingStack[headingStack.length - 1]!.text
          : null;
      extractFromFence(code, language, section_heading, out);
    }
  }
  return out;
}

function extractFromFence(
  code: string,
  language: string,
  section_heading: string | null,
  out: CodeFenceEntity[],
): void {
  if (!code) return;
  if (TS_JS_LANGS.has(language)) {
    extractTsJs(code, language, section_heading, out);
  } else if (SHELL_LANGS.has(language)) {
    extractShell(code, language, section_heading, out);
  } else if (JSON_LANGS.has(language)) {
    extractJson(code, language, section_heading, out);
  } else if (YAML_LANGS.has(language)) {
    extractYaml(code, language, section_heading, out);
  }
  // Other languages: no entities — guards "no false positives in
  // unsupported languages" (e.g. Python source).
}

function headingText(node: Heading): string {
  return (node.children ?? [])
    .map((c: { type: string; value?: string }) =>
      c.type === "text" || c.type === "inlineCode" ? c.value ?? "" : "",
    )
    .join("")
    .trim();
}

function pushEntity(
  out: CodeFenceEntity[],
  kind: CodeFenceEntityKind,
  rawValue: string,
  language: string,
  section_heading: string | null,
): void {
  const value = rawValue.trim();
  if (!value) return;
  const normalized = value.toLowerCase();
  if (!normalized) return;
  out.push({ kind, value, normalized, language, section_heading });
}

function extractTsJs(
  code: string,
  language: string,
  section_heading: string | null,
  out: CodeFenceEntity[],
): void {
  const seenImports = new Set<string>();
  const emitImport = (spec: string): void => {
    if (!spec || seenImports.has(spec)) return;
    seenImports.add(spec);
    pushEntity(out, "import", spec, language, section_heading);
    if (!spec.startsWith(".") && !spec.startsWith("/")) {
      pushEntity(
        out,
        "package_name",
        packageRoot(spec),
        language,
        section_heading,
      );
    }
  };
  for (const m of code.matchAll(FROM_IMPORT_RE)) emitImport(m[1] ?? "");
  for (const m of code.matchAll(SIDE_EFFECT_IMPORT_RE)) emitImport(m[1] ?? "");
  for (const m of code.matchAll(REQUIRE_RE)) emitImport(m[1] ?? "");

  // Symbol entities from named, default, and namespace imports.
  for (const m of code.matchAll(NAMED_IMPORT_RE)) {
    const inside = m[1] ?? "";
    for (const raw of inside.split(",")) {
      const piece = raw.replace(/\s+/g, " ").trim();
      if (!piece) continue;
      const asMatch = piece.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        pushEntity(out, "symbol", asMatch[1]!, language, section_heading);
        pushEntity(out, "symbol", asMatch[2]!, language, section_heading);
      } else if (/^[A-Za-z_]\w*$/.test(piece)) {
        pushEntity(out, "symbol", piece, language, section_heading);
      }
    }
  }
  for (const m of code.matchAll(DEFAULT_IMPORT_RE)) {
    pushEntity(out, "symbol", m[1] ?? "", language, section_heading);
  }
  for (const m of code.matchAll(NAMESPACE_IMPORT_RE)) {
    pushEntity(out, "symbol", m[1] ?? "", language, section_heading);
  }

  // Symbol entities from exported declarations.
  for (const re of [
    EXPORT_FUNCTION_RE,
    EXPORT_CLASS_RE,
    EXPORT_INTERFACE_RE,
    EXPORT_TYPE_RE,
    EXPORT_CONST_RE,
    EXPORT_DEFAULT_NAMED_RE,
    EXPORT_ENUM_RE,
  ]) {
    for (const m of code.matchAll(re)) {
      pushEntity(out, "symbol", m[1] ?? "", language, section_heading);
    }
  }

  // Config-key extraction when the fence shape is config-like.
  if (
    /\bdefineConfig\s*\(/.test(code) ||
    /\bexport\s+default\s*\{/.test(code) ||
    /\bmodule\.exports\s*=\s*\{/.test(code)
  ) {
    extractTsConfigKeys(code, language, section_heading, out);
  }

  // Routes — string literals that look like HTTP routes when the
  // section heading mentions HTTP/API/route/endpoint.
  if (section_heading && ROUTE_HEADING_KEYWORDS.test(section_heading)) {
    for (const m of code.matchAll(ROUTE_LITERAL_RE)) {
      const v = m[2] ?? "";
      if (looksLikeRoute(v)) {
        pushEntity(out, "route", v, language, section_heading);
      }
    }
  }

  scanConfigFiles(code, language, section_heading, out);
}

function packageRoot(spec: string): string {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.slice(0, 2).join("/");
  }
  return spec.split("/")[0]!;
}

function extractTsConfigKeys(
  code: string,
  language: string,
  section_heading: string | null,
  out: CodeFenceEntity[],
): void {
  // Restrict to identifier-shaped keys followed by a value-position token
  // so we avoid type annotations (`name: string`) and label statements.
  const seen = new Set<string>();
  const re =
    /(?:^|[\s,{])([A-Za-z_]\w*)\s*:\s*(?:\{|\[|"|'|`|\d|true|false|null|new\s+|function|\(|defineConfig|async)/g;
  for (const m of code.matchAll(re)) {
    const k = m[1] ?? "";
    if (!k || seen.has(k)) continue;
    seen.add(k);
    pushEntity(out, "config_key", k, language, section_heading);
  }
}

function extractShell(
  code: string,
  language: string,
  section_heading: string | null,
  out: CodeFenceEntity[],
): void {
  const seenCli = new Set<string>();
  for (const rawLine of code.split(/\r?\n/)) {
    const line = stripPrompt(rawLine).trim();
    if (!line || line.startsWith("#")) continue;
    // First whitespace-separated token. Skip env-style assignment lines
    // (`FOO=bar cmd ...`) — they are not the binary itself.
    const firstToken = line.split(/\s+/)[0] ?? "";
    if (!firstToken) continue;
    if (firstToken.includes("=")) continue;
    if (!isCliBinary(firstToken)) continue;
    if (seenCli.has(firstToken)) continue;
    seenCli.add(firstToken);
    pushEntity(out, "cli_command", firstToken, language, section_heading);
  }
  // Package-install operands.
  const seenPkg = new Set<string>();
  for (const m of code.matchAll(PACKAGE_INSTALL_RE)) {
    const tail = m[1] ?? "";
    for (const tok of tail.split(/\s+/)) {
      if (!tok || tok.startsWith("-")) continue;
      const pkg = tok.startsWith("@")
        ? tok.split("@").slice(0, 2).join("@") || tok
        : tok.split("@")[0]!;
      if (!pkg || pkg.length < 2) continue;
      if (!/^[@\w][\w/.@~-]*$/.test(pkg)) continue;
      if (seenPkg.has(pkg)) continue;
      seenPkg.add(pkg);
      pushEntity(out, "package_name", pkg, language, section_heading);
    }
  }
  scanConfigFiles(code, language, section_heading, out);
}

function stripPrompt(line: string): string {
  // Strip common interactive-shell prompts. `#` is intentionally NOT
  // included — it overlaps with comment syntax, and the caller checks
  // for comment lines after this strip.
  return line.replace(/^[$>%]\s+/, "");
}

function isCliBinary(tok: string): boolean {
  if (!/^[a-z][\w.-]*$/i.test(tok)) return false;
  if (tok.length < 2) return false;
  if (KNOWN_CLI_PREFIXES.has(tok.toLowerCase())) return true;
  // Generic binary shape: lowercase letters, digits, dashes, dots.
  return /^[a-z][a-z0-9._-]*$/.test(tok);
}

function extractJson(
  code: string,
  language: string,
  section_heading: string | null,
  out: CodeFenceEntity[],
): void {
  const seen = new Set<string>();
  const emit = (k: string): void => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    pushEntity(out, "config_key", k, language, section_heading);
  };
  // Try strict JSON, then jsonc-stripped, then last-resort regex.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(code);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    try {
      parsed = JSON.parse(stripJsonComments(code));
    } catch {
      parsed = null;
    }
  }
  if (parsed && typeof parsed === "object") {
    walkObjectKeys(parsed, emit);
    return;
  }
  for (const m of code.matchAll(/"([\w.-]+)"\s*:/g)) emit(m[1] ?? "");
}

function stripJsonComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
}

function walkObjectKeys(value: unknown, emit: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkObjectKeys(item, emit);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      emit(k);
      walkObjectKeys(v, emit);
    }
  }
}

function extractYaml(
  code: string,
  language: string,
  section_heading: string | null,
  out: CodeFenceEntity[],
): void {
  const seen = new Set<string>();
  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "");
    const m = line.match(/^\s*([A-Za-z_][\w-]*)\s*:/);
    if (!m) continue;
    const k = m[1] ?? "";
    if (!k || seen.has(k)) continue;
    seen.add(k);
    pushEntity(out, "config_key", k, language, section_heading);
  }
}

function scanConfigFiles(
  code: string,
  language: string,
  section_heading: string | null,
  out: CodeFenceEntity[],
): void {
  const seen = new Set<string>();
  for (const re of CONFIG_FILE_PATTERNS) {
    for (const m of code.matchAll(re)) {
      const v = m[0] ?? "";
      const norm = v.toLowerCase();
      if (!v || seen.has(norm)) continue;
      seen.add(norm);
      pushEntity(out, "config_file", v, language, section_heading);
    }
  }
}

function looksLikeRoute(s: string): boolean {
  if (!s.startsWith("/")) return false;
  if (/\s/.test(s)) return false;
  // Filesystem-looking — known source/asset extension.
  if (
    /\.(?:ts|tsx|js|mjs|cjs|jsx|json|yaml|yml|md|mdx|html|css|svg|png|jpg|jpeg|gif|webp|ico|map)$/i.test(
      s,
    )
  ) {
    return false;
  }
  // At least one alpha/route-segment character after the leading slash.
  return /\/[A-Za-z0-9_:{}-]/.test(s);
}
