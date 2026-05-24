/**
 * PRD-0028 / slice 28.1 — TypeScript AST code-source extractor tests.
 *
 * Example tests cover the representative export shapes called out by the
 * acceptance criteria; the synthetic property test gates at Wilson lower-95
 * ≥ 95% over 200 random programs (matches the slice pattern from PRD-0024
 * 24.1.1 / PRD-0023 23.1).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { extractCodeSourceFacts } from "./code-source.js";
import {
  CODE_SOURCE_PURPOSE_CHAR_BUDGET,
  CODE_SOURCE_SIGNATURE_CHAR_BUDGET,
} from "../types/code-source.js";
import { wilson95Lower } from "../../eval/synthetic/stats.js";

const PROPERTY_RUNS = 200;
const PROPERTY_LOWER_95 = 0.95;

function extract(args: {
  path?: string;
  content: string;
  root?: string;
}) {
  return extractCodeSourceFacts({
    source_path: args.path ?? "src/example.ts",
    content: args.content,
    corpus_root: args.root ?? "",
  });
}

describe("extractCodeSourceFacts — file_path passthrough", () => {
  it("returns the supplied source_path verbatim", () => {
    const r = extract({ path: "src/retrieve/foo.ts", content: "" });
    expect(r.file_path).toBe("src/retrieve/foo.ts");
  });
});

describe("extractCodeSourceFacts — exported symbols", () => {
  it("captures exported function declarations", () => {
    const r = extract({
      content: "export function alpha(x: number): number { return x; }\n",
    });
    expect(r.exported_symbols).toContainEqual({ name: "alpha", kind: "function" });
  });

  it("captures exported type aliases", () => {
    const r = extract({ content: "export type Foo = { a: number };\n" });
    expect(r.exported_symbols).toContainEqual({ name: "Foo", kind: "type" });
  });

  it("captures exported interfaces", () => {
    const r = extract({ content: "export interface Bar { a: number }\n" });
    expect(r.exported_symbols).toContainEqual({ name: "Bar", kind: "interface" });
  });

  it("captures exported classes", () => {
    const r = extract({ content: "export class Baz { x = 1 }\n" });
    expect(r.exported_symbols).toContainEqual({ name: "Baz", kind: "class" });
  });

  it("captures exported const declarations", () => {
    const r = extract({ content: "export const FOO = 1;\n" });
    expect(r.exported_symbols).toContainEqual({ name: "FOO", kind: "const" });
  });

  it("captures exported enums", () => {
    const r = extract({ content: "export enum E { A, B }\n" });
    expect(r.exported_symbols).toContainEqual({ name: "E", kind: "enum" });
  });

  it("captures default function export", () => {
    const r = extract({ content: "export default function widget() {}\n" });
    expect(r.exported_symbols).toContainEqual({ name: "widget", kind: "function" });
  });

  it("captures anonymous default exports as 'default'", () => {
    const r = extract({ content: "export default 42;\n" });
    expect(r.exported_symbols.some((s) => s.name === "default")).toBe(true);
  });

  it("returns no exported symbols when the file has none", () => {
    const r = extract({ content: "const private_ = 1;\n" });
    expect(r.exported_symbols).toEqual([]);
  });

  it("ignores non-exported declarations", () => {
    const r = extract({ content: "function hidden() {}\nexport function shown() {}\n" });
    expect(r.exported_symbols.map((s) => s.name)).toEqual(["shown"]);
  });

  it("captures `export { ... }` re-exports", () => {
    const r = extract({
      content: "function a() {}\nfunction b() {}\nexport { a, b };\n",
    });
    const names = r.exported_symbols.map((s) => s.name).sort();
    expect(names).toEqual(["a", "b"]);
  });
});

describe("extractCodeSourceFacts — signatures", () => {
  it("captures a function signature including parameters and return type", () => {
    const r = extract({
      content: "export function alpha(x: number, y: string): boolean { return true; }\n",
    });
    expect(r.exported_signatures.some((s) => s.includes("alpha"))).toBe(true);
    expect(r.exported_signatures.some((s) => s.includes("number"))).toBe(true);
  });

  it("truncates signatures at 240 chars", () => {
    const longArg = "a".repeat(1000);
    const r = extract({
      content: `export function long(${longArg}: number): void {}\n`,
    });
    for (const sig of r.exported_signatures) {
      expect(sig.length).toBeLessThanOrEqual(CODE_SOURCE_SIGNATURE_CHAR_BUDGET);
    }
  });
});

describe("extractCodeSourceFacts — file_purpose", () => {
  it("captures a leading JSDoc block", () => {
    const r = extract({
      content: "/**\n * This module does X.\n */\nexport const x = 1;\n",
    });
    expect(r.file_purpose).not.toBeNull();
    expect(r.file_purpose!).toContain("This module does X.");
  });

  it("captures a leading // line-comment block", () => {
    const r = extract({
      content: "// Top-line comment describing purpose.\nexport const x = 1;\n",
    });
    expect(r.file_purpose).not.toBeNull();
    expect(r.file_purpose!).toContain("Top-line comment");
  });

  it("returns null when there is no leading comment", () => {
    const r = extract({ content: "export const x = 1;\n" });
    expect(r.file_purpose).toBeNull();
  });

  it("truncates file_purpose at 480 chars", () => {
    const body = "x".repeat(2000);
    const r = extract({
      content: `/**\n * ${body}\n */\nexport const x = 1;\n`,
    });
    expect(r.file_purpose!.length).toBeLessThanOrEqual(CODE_SOURCE_PURPOSE_CHAR_BUDGET);
  });
});

describe("extractCodeSourceFacts — imports", () => {
  it("resolves a relative import to a corpus-relative path", () => {
    const r = extract({
      path: "src/retrieve/foo.ts",
      content: "import { bar } from './bar.js';\nimport { baz } from '../store/baz.js';\nexport const x = 1;\n",
    });
    expect(r.imports).toContain("src/retrieve/bar");
    expect(r.imports).toContain("src/store/baz");
  });

  it("keeps package imports for graph resolution but skips platform built-ins", () => {
    const r = extract({
      path: "src/retrieve/foo.ts",
      content: "import fs from 'node:fs';\nimport { z } from 'zod';\nexport const x = 1;\n",
    });
    expect(r.imports).toEqual(["zod"]);
  });
});

describe("extractCodeSourceFacts — malformed input", () => {
  it("returns an empty-shaped record when source is malformed (does not throw)", () => {
    const r = extract({ content: "export function (((( {{{ \n" });
    expect(r.exported_symbols).toBeDefined();
    expect(r.file_purpose === null || typeof r.file_purpose === "string").toBe(true);
    expect(Array.isArray(r.imports)).toBe(true);
    expect(Array.isArray(r.exported_signatures)).toBe(true);
  });

  it("returns an empty record for empty content", () => {
    const r = extract({ content: "" });
    expect(r.exported_symbols).toEqual([]);
    expect(r.exported_signatures).toEqual([]);
    expect(r.file_purpose).toBeNull();
    expect(r.imports).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Synthetic property test: 200 random programs at lower-95 ≥ 95%
// ──────────────────────────────────────────────────────────────────────────

type Decl =
  | { kind: "function"; name: string }
  | { kind: "type"; name: string }
  | { kind: "interface"; name: string }
  | { kind: "class"; name: string }
  | { kind: "const"; name: string }
  | { kind: "enum"; name: string };

function renderDecl(d: Decl, exported: boolean): string {
  const prefix = exported ? "export " : "";
  switch (d.kind) {
    case "function":
      return `${prefix}function ${d.name}(x: number): number { return x; }\n`;
    case "type":
      return `${prefix}type ${d.name} = { a: number };\n`;
    case "interface":
      return `${prefix}interface ${d.name} { a: number }\n`;
    case "class":
      return `${prefix}class ${d.name} { x = 1 }\n`;
    case "const":
      return `${prefix}const ${d.name} = 1;\n`;
    case "enum":
      return `${prefix}enum ${d.name} { A, B }\n`;
  }
}

describe("extractCodeSourceFacts — synthetic property gate", () => {
  it("recovers all exported declarations + skips unexported ones at lower-95 ≥ 95%", () => {
    let passed = 0;
    let total = 0;
    const nameArb = fc
      .stringMatching(/^[A-Za-z][A-Za-z0-9]{0,12}$/)
      .filter((s) => s.length > 0);
    const declArb: fc.Arbitrary<{ decl: Decl; exported: boolean }> = fc.record({
      decl: fc.oneof(
        nameArb.map((n) => ({ kind: "function" as const, name: n })),
        nameArb.map((n) => ({ kind: "type" as const, name: n })),
        nameArb.map((n) => ({ kind: "interface" as const, name: n })),
        nameArb.map((n) => ({ kind: "class" as const, name: n })),
        nameArb.map((n) => ({ kind: "const" as const, name: n.toUpperCase() })),
        nameArb.map((n) => ({ kind: "enum" as const, name: n })),
      ),
      exported: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(declArb, { minLength: 0, maxLength: 8 }),
        fc.boolean(),
        (decls, withComment) => {
          total += 1;
          // Dedup by name (TS rejects collisions).
          const seen = new Set<string>();
          const filtered = decls.filter((d) => {
            if (seen.has(d.decl.name)) return false;
            seen.add(d.decl.name);
            return true;
          });
          const body =
            (withComment ? "/** purpose */\n" : "") +
            filtered.map((d) => renderDecl(d.decl, d.exported)).join("");
          const r = extract({ content: body });
          const expectedNames = new Set(
            filtered.filter((d) => d.exported).map((d) => d.decl.name),
          );
          const actualNames = new Set(r.exported_symbols.map((s) => s.name));
          const namesMatch =
            expectedNames.size === actualNames.size &&
            [...expectedNames].every((n) => actualNames.has(n));
          const purposeOk = withComment
            ? r.file_purpose !== null
            : r.file_purpose === null;
          if (namesMatch && purposeOk) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});
