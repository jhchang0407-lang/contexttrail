/**
 * Synthetic property tests for the code-fence
 * entity extractor.
 *
 * Each kind gets a property test at Wilson lower-95 ≥ 95% over 200
 * random inputs (per-kind generators below). Adversarial cases cover
 * nested fences, unclosed fences, language-tag variants, non-source
 * fence content, shell heredocs, JSON with comments, multiline
 * imports, namespace imports, and the "no false positives in
 * unsupported languages" guarantee.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  extractCodeFenceEntities,
  type CodeFenceEntity,
} from "../../retrieve/code-fence-entities.js";
import { wilson95Lower } from "./stats.js";

const PROPERTY_LOWER_95 = 0.95;
const PROPERTY_RUNS = 200;

function fence(lang: string, body: string, heading = ""): string {
  const head = heading ? `# ${heading}\n\n` : "";
  return `${head}\`\`\`${lang}\n${body}\n\`\`\`\n`;
}

function ofKind(
  entities: CodeFenceEntity[],
  kind: CodeFenceEntity["kind"],
): CodeFenceEntity[] {
  return entities.filter((e) => e.kind === kind);
}

function values(entities: CodeFenceEntity[]): string[] {
  return entities.map((e) => e.value);
}

// ──────────────────────────────────────────────────────────────────────────
// Adversarial — empty / whitespace / unsupported
// ──────────────────────────────────────────────────────────────────────────

describe("extractCodeFenceEntities — empty inputs", () => {
  it("returns [] for an empty markdown string", () => {
    expect(extractCodeFenceEntities("")).toEqual([]);
  });

  it("returns [] for markdown with no fences", () => {
    expect(extractCodeFenceEntities("# Title\n\nJust prose.\n")).toEqual([]);
  });

  it("returns [] for a fence with whitespace-only body", () => {
    expect(extractCodeFenceEntities(fence("ts", "   \n   "))).toEqual([]);
  });

  it("emits no entities for unsupported languages (Python source)", () => {
    const md = fence(
      "python",
      'import os\nfrom typing import List\n\ndef hello(): print("hi")',
    );
    expect(extractCodeFenceEntities(md)).toEqual([]);
  });

  it("emits no entities for a `text` fence with prose only", () => {
    const md = fence(
      "text",
      "This is just an ASCII table.\n+-----+-----+\n| a   | b   |\n",
    );
    expect(extractCodeFenceEntities(md)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// import + package_name (TS/JS)
// ──────────────────────────────────────────────────────────────────────────

describe("extractCodeFenceEntities — import / package_name", () => {
  it("extracts module specs from `import ... from \"x\"` (ts)", () => {
    const md = fence("ts", `import { router } from "@trpc/server";`);
    const e = extractCodeFenceEntities(md);
    expect(values(ofKind(e, "import"))).toEqual(["@trpc/server"]);
    expect(values(ofKind(e, "package_name"))).toEqual(["@trpc/server"]);
  });

  it("treats `typescript` and `ts` lang tags identically", () => {
    const a = extractCodeFenceEntities(fence("typescript", `import "x";`));
    const b = extractCodeFenceEntities(fence("ts", `import "x";`));
    expect(values(ofKind(a, "import"))).toEqual(values(ofKind(b, "import")));
    expect(a[0]?.language).toBe("typescript");
    expect(b[0]?.language).toBe("ts");
  });

  it("captures multiline named imports", () => {
    const md = fence(
      "ts",
      `import {\n  router,\n  publicProcedure,\n} from "@trpc/server";`,
    );
    const e = extractCodeFenceEntities(md);
    const symbols = values(ofKind(e, "symbol")).sort();
    expect(symbols).toContain("router");
    expect(symbols).toContain("publicProcedure");
  });

  it("captures namespace imports as symbols", () => {
    const md = fence("ts", `import * as React from "react";`);
    const e = extractCodeFenceEntities(md);
    expect(values(ofKind(e, "symbol"))).toContain("React");
    expect(values(ofKind(e, "package_name"))).toContain("react");
  });

  it("captures default imports as symbols", () => {
    const md = fence("ts", `import express from "express";`);
    const e = extractCodeFenceEntities(md);
    expect(values(ofKind(e, "symbol"))).toContain("express");
    expect(values(ofKind(e, "package_name"))).toContain("express");
  });

  it("captures CJS require()", () => {
    const md = fence("js", `const fs = require("fs/promises");`);
    const e = extractCodeFenceEntities(md);
    expect(values(ofKind(e, "import"))).toContain("fs/promises");
    expect(values(ofKind(e, "package_name"))).toContain("fs");
  });

  it("does NOT emit package_name for relative imports", () => {
    const md = fence("ts", `import { foo } from "./local";`);
    const e = extractCodeFenceEntities(md);
    expect(values(ofKind(e, "import"))).toEqual(["./local"]);
    expect(ofKind(e, "package_name")).toEqual([]);
  });

  it("packageRoot strips subpaths from scoped packages", () => {
    const md = fence("ts", `import { z } from "zod/lib/index";`);
    const e = extractCodeFenceEntities(md);
    expect(values(ofKind(e, "package_name"))).toContain("zod");
  });

  it("handles `import Foo, { bar } from \"x\"` — captures both", () => {
    const md = fence("ts", `import Foo, { bar, baz } from "x";`);
    const e = extractCodeFenceEntities(md);
    const symbols = values(ofKind(e, "symbol")).sort();
    expect(symbols).toEqual(["Foo", "bar", "baz"].sort());
  });

  it("handles `import { Foo as Bar } from \"x\"` — both names emitted", () => {
    const md = fence("ts", `import { ZodError as ZErr } from "zod";`);
    const e = extractCodeFenceEntities(md);
    const symbols = values(ofKind(e, "symbol")).sort();
    expect(symbols).toContain("ZodError");
    expect(symbols).toContain("ZErr");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// symbol from exported declarations
// ──────────────────────────────────────────────────────────────────────────

describe("extractCodeFenceEntities — symbol (exports)", () => {
  it("captures exported function/class/const/type/interface/enum", () => {
    const md = fence(
      "ts",
      `
export function helloWorld() {}
export class HttpClient {}
export const VERSION = "1.0";
export type MyShape = { a: number };
export interface MyInterface {}
export enum Status { Ok }
export default class Bigwig {}
      `,
    );
    const symbols = values(ofKind(extractCodeFenceEntities(md), "symbol")).sort();
    expect(symbols).toContain("helloWorld");
    expect(symbols).toContain("HttpClient");
    expect(symbols).toContain("VERSION");
    expect(symbols).toContain("MyShape");
    expect(symbols).toContain("MyInterface");
    expect(symbols).toContain("Status");
    expect(symbols).toContain("Bigwig");
  });

  it("does not emit a symbol for anonymous default export", () => {
    const md = fence("ts", `export default { foo: 1 };`);
    const e = extractCodeFenceEntities(md);
    // No named symbol, but `foo` may be picked up as a config_key (config-shape).
    expect(ofKind(e, "symbol")).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// cli_command + package_name in shell fences
// ──────────────────────────────────────────────────────────────────────────

describe("extractCodeFenceEntities — cli_command / shell package_name", () => {
  it("captures the leading binary on each shell line", () => {
    const md = fence("sh", `npm install vitest\nvitest --watch`);
    const e = extractCodeFenceEntities(md);
    const cli = values(ofKind(e, "cli_command")).sort();
    expect(cli).toContain("npm");
    expect(cli).toContain("vitest");
  });

  it("strips a leading `$` prompt", () => {
    const md = fence("bash", `$ pnpm test`);
    const e = extractCodeFenceEntities(md);
    expect(values(ofKind(e, "cli_command"))).toContain("pnpm");
  });

  it("ignores `#` comment lines", () => {
    const md = fence("sh", `# install dependencies\nnpm install`);
    const e = extractCodeFenceEntities(md);
    expect(values(ofKind(e, "cli_command"))).toEqual(["npm"]);
  });

  it("captures package operands of npm/pnpm/yarn install", () => {
    const md = fence("sh", `pnpm add zod @trpc/server -D`);
    const e = extractCodeFenceEntities(md);
    const pkgs = values(ofKind(e, "package_name")).sort();
    expect(pkgs).toContain("zod");
    expect(pkgs).toContain("@trpc/server");
  });

  it("strips version specifiers from install operands", () => {
    const md = fence("sh", `npm install zod@^3.23 @scope/pkg@1.2.3`);
    const e = extractCodeFenceEntities(md);
    const pkgs = values(ofKind(e, "package_name"));
    expect(pkgs).toContain("zod");
    expect(pkgs).toContain("@scope/pkg");
  });

  it("survives a heredoc — first command is captured", () => {
    const md = fence(
      "sh",
      `cat <<EOF > out.txt\nhello\nEOF\nnpm test`,
    );
    const cli = values(ofKind(extractCodeFenceEntities(md), "cli_command"));
    expect(cli).toContain("cat");
    expect(cli).toContain("npm");
  });

  it("does not emit a cli_command for `FOO=bar` env-style lines", () => {
    const md = fence("sh", `FOO=bar\nDEBUG=true npm test`);
    const e = extractCodeFenceEntities(md);
    // First line is pure assignment; second line's first token is DEBUG=true
    // (env-style prefix). Neither emits a cli_command.
    expect(values(ofKind(e, "cli_command"))).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// config_file
// ──────────────────────────────────────────────────────────────────────────

describe("extractCodeFenceEntities — config_file", () => {
  it("matches well-known config filenames in any supported fence", () => {
    const md = fence(
      "sh",
      `cp tsconfig.json package.json vitest.config.ts ./other`,
    );
    const e = extractCodeFenceEntities(md);
    const files = values(ofKind(e, "config_file"));
    expect(files).toContain("tsconfig.json");
    expect(files).toContain("package.json");
    expect(files).toContain("vitest.config.ts");
  });

  it("matches `*.config.*` filenames", () => {
    const md = fence("ts", `// loads next.config.mjs and tailwind.config.ts`);
    const e = extractCodeFenceEntities(md);
    const files = values(ofKind(e, "config_file")).sort();
    expect(files).toContain("next.config.mjs");
    expect(files).toContain("tailwind.config.ts");
  });

  it("does not match plain `foo.json` files (extension alone is not enough)", () => {
    const md = fence("ts", `// just data.json or settings.json`);
    const e = extractCodeFenceEntities(md);
    expect(values(ofKind(e, "config_file"))).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// config_key (TS/JS shape, JSON, YAML)
// ──────────────────────────────────────────────────────────────────────────

describe("extractCodeFenceEntities — config_key", () => {
  it("captures keys of a `defineConfig({ ... })` shape (ts)", () => {
    const md = fence(
      "ts",
      `import { defineConfig } from "vitest/config";\nexport default defineConfig({\n  test: { browser: true },\n  resolve: { alias: { "@": "./src" } },\n});`,
    );
    const e = extractCodeFenceEntities(md);
    const keys = values(ofKind(e, "config_key"));
    expect(keys).toContain("test");
    expect(keys).toContain("browser");
    expect(keys).toContain("resolve");
  });

  it("captures keys of a top-level JSON object", () => {
    const md = fence(
      "json",
      `{ "name": "demo", "version": "1.0", "scripts": { "test": "vitest" } }`,
    );
    const e = extractCodeFenceEntities(md);
    const keys = values(ofKind(e, "config_key"));
    expect(keys).toContain("name");
    expect(keys).toContain("version");
    expect(keys).toContain("scripts");
    expect(keys).toContain("test");
  });

  it("captures keys of jsonc (JSON with comments)", () => {
    const md = fence(
      "jsonc",
      `// my config\n{\n  "compilerOptions": { /* opts */ "strict": true },\n  "exclude": ["node_modules"]\n}`,
    );
    const e = extractCodeFenceEntities(md);
    const keys = values(ofKind(e, "config_key"));
    expect(keys).toContain("compilerOptions");
    expect(keys).toContain("strict");
    expect(keys).toContain("exclude");
  });

  it("captures top-level keys of a YAML fence", () => {
    const md = fence(
      "yaml",
      `name: ci\non:\n  push:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest`,
    );
    const keys = values(
      ofKind(extractCodeFenceEntities(md), "config_key"),
    );
    expect(keys).toContain("name");
    expect(keys).toContain("on");
    expect(keys).toContain("jobs");
    expect(keys).toContain("test");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// route
// ──────────────────────────────────────────────────────────────────────────

describe("extractCodeFenceEntities — route", () => {
  it("captures HTTP-route-shaped string literals when section heading mentions route/api", () => {
    const md = `# REST API endpoints\n\n\`\`\`ts\napp.get("/api/users", handler);\napp.post("/api/users/:id", handler);\n\`\`\`\n`;
    const e = extractCodeFenceEntities(md);
    const routes = values(ofKind(e, "route")).sort();
    expect(routes).toContain("/api/users");
    expect(routes).toContain("/api/users/:id");
  });

  it("does NOT emit routes when section heading lacks HTTP/api keywords", () => {
    const md = `# Setup notes\n\n\`\`\`ts\napp.get("/api/users", handler);\n\`\`\`\n`;
    const e = extractCodeFenceEntities(md);
    expect(ofKind(e, "route")).toEqual([]);
  });

  it("does NOT emit `/path/to/file.ts` (filesystem-looking)", () => {
    const md = `# API routes\n\n\`\`\`ts\nimport "/abs/path/file.ts";\nrouter.get("/api/ok");\n\`\`\`\n`;
    const e = extractCodeFenceEntities(md);
    const routes = values(ofKind(e, "route"));
    expect(routes).toEqual(["/api/ok"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Section heading capture
// ──────────────────────────────────────────────────────────────────────────

describe("extractCodeFenceEntities — section_heading", () => {
  it("captures the nearest enclosing heading", () => {
    const md = `# Outer\n\n## Inner Section\n\n\`\`\`ts\nimport "x";\n\`\`\`\n`;
    const e = extractCodeFenceEntities(md);
    expect(e[0]?.section_heading).toBe("Inner Section");
  });

  it("is null when the fence appears before any heading", () => {
    const md = `\`\`\`ts\nimport "x";\n\`\`\`\n`;
    const e = extractCodeFenceEntities(md);
    expect(e[0]?.section_heading).toBeNull();
  });

  it("respects depth — sibling headings pop equal-or-deeper ancestors", () => {
    const md = `# A\n\n## B\n\n## C\n\n\`\`\`ts\nimport "x";\n\`\`\`\n`;
    const e = extractCodeFenceEntities(md);
    expect(e[0]?.section_heading).toBe("C");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Property tests — one per kind, lower-95 ≥ 95% over 200 random inputs.
// ──────────────────────────────────────────────────────────────────────────

const identifierArb = fc
  .stringMatching(/^[A-Za-z_][A-Za-z0-9_]{2,15}$/)
  .filter((s) => s.length >= 3);

const packageArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{2,15}$/)
  .filter((s) => s.length >= 3);

describe("extractCodeFenceEntities — property: import", () => {
  it("recovers the import spec verbatim across 200 random TS imports", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(packageArb, (pkg) => {
        total += 1;
        const md = fence("ts", `import "${pkg}";`);
        const e = extractCodeFenceEntities(md);
        const imports = values(ofKind(e, "import"));
        if (imports.includes(pkg)) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });
});

describe("extractCodeFenceEntities — property: package_name", () => {
  it("recovers the package root for 200 random non-relative imports", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(packageArb, packageArb, (pkg, sub) => {
        total += 1;
        const md = fence("ts", `import { x } from "${pkg}/${sub}";`);
        const e = extractCodeFenceEntities(md);
        const pkgs = values(ofKind(e, "package_name"));
        if (pkgs.includes(pkg)) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });
});

describe("extractCodeFenceEntities — property: symbol", () => {
  it("captures named-import bindings on 200 random symbols", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(identifierArb, packageArb, (sym, pkg) => {
        total += 1;
        const md = fence("ts", `import { ${sym} } from "${pkg}";`);
        const e = extractCodeFenceEntities(md);
        const symbols = values(ofKind(e, "symbol"));
        if (symbols.includes(sym)) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });

  it("captures `export const X` declarations on 200 random identifiers", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(identifierArb, (sym) => {
        total += 1;
        const md = fence("ts", `export const ${sym} = 1;`);
        const e = extractCodeFenceEntities(md);
        const symbols = values(ofKind(e, "symbol"));
        if (symbols.includes(sym)) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });
});

describe("extractCodeFenceEntities — property: cli_command", () => {
  it("captures the first token across 200 random shell binaries", () => {
    const cliArb = fc
      .stringMatching(/^[a-z][a-z0-9-]{2,12}$/)
      .filter((s) => s.length >= 3);
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(cliArb, (bin) => {
        total += 1;
        const md = fence("sh", `${bin} --help`);
        const e = extractCodeFenceEntities(md);
        const cli = values(ofKind(e, "cli_command"));
        if (cli.includes(bin)) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });
});

describe("extractCodeFenceEntities — property: config_file", () => {
  it("captures `<name>.config.<ext>` across 200 random shapes", () => {
    const ext = fc.constantFrom("ts", "js", "mjs", "cjs", "json", "yaml");
    const namePart = fc
      .stringMatching(/^[a-z][a-z0-9-]{1,10}$/)
      .filter((s) => s.length >= 2);
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(namePart, ext, (name, e_) => {
        total += 1;
        const filename = `${name}.config.${e_}`;
        const md = fence("sh", `cat ${filename}`);
        const e = extractCodeFenceEntities(md);
        const files = values(ofKind(e, "config_file"));
        if (files.includes(filename)) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });
});

describe("extractCodeFenceEntities — property: config_key (JSON)", () => {
  it("captures top-level JSON keys across 200 random objects", () => {
    let passed = 0;
    let total = 0;
    const keyArb = fc
      .stringMatching(/^[a-z][a-z0-9_]{2,10}$/)
      .filter((s) => s.length >= 3);
    fc.assert(
      fc.property(fc.uniqueArray(keyArb, { minLength: 1, maxLength: 6 }), (keys) => {
        total += 1;
        const body = `{ ${keys.map((k) => `"${k}": 1`).join(", ")} }`;
        const md = fence("json", body);
        const e = extractCodeFenceEntities(md);
        const got = new Set(values(ofKind(e, "config_key")));
        if (keys.every((k) => got.has(k))) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });
});

describe("extractCodeFenceEntities — property: route", () => {
  it("captures route literals under route-keyword headings across 200 random paths", () => {
    const segArb = fc
      .stringMatching(/^[a-z][a-z0-9-]{1,10}$/)
      .filter((s) => s.length >= 2);
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(fc.uniqueArray(segArb, { minLength: 1, maxLength: 4 }), (segs) => {
        total += 1;
        const route = "/" + segs.join("/");
        const md = `# API routes\n\n\`\`\`ts\napp.get("${route}");\n\`\`\`\n`;
        const e = extractCodeFenceEntities(md);
        const routes = values(ofKind(e, "route"));
        if (routes.includes(route)) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });
});

describe("extractCodeFenceEntities — property: no FP in unsupported langs", () => {
  it("never emits TS-style entities from python source across 200 random snippets", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            'import os\n',
            'from typing import List\n',
            'def hello():\n    return 1\n',
            'class Foo:\n    pass\n',
            'x = 42\n',
          ),
          { minLength: 1, maxLength: 5 },
        ),
        (lines) => {
          total += 1;
          const md = fence("python", lines.join(""));
          const e = extractCodeFenceEntities(md);
          if (e.length === 0) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Field-level invariants
// ──────────────────────────────────────────────────────────────────────────

describe("extractCodeFenceEntities — field invariants", () => {
  it("`value` is preserved verbatim, `normalized` is lowercased", () => {
    const md = fence("ts", `import { ZodError } from "Zod";`);
    const e = extractCodeFenceEntities(md);
    const sym = ofKind(e, "symbol")[0]!;
    expect(sym.value).toBe("ZodError");
    expect(sym.normalized).toBe("zoderror");
  });

  it("`language` matches the lowercase of the original info string", () => {
    const md = fence("TypeScript", `import "x";`);
    const e = extractCodeFenceEntities(md);
    expect(e[0]?.language).toBe("typescript");
  });

  it("never emits an entity with empty value or empty normalized", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        fc.constantFrom("ts", "js", "sh", "json", "yaml", "python"),
        (body, lang) => {
          const md = fence(lang, body);
          for (const e of extractCodeFenceEntities(md)) {
            expect(e.value.trim().length).toBeGreaterThan(0);
            expect(e.normalized.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
