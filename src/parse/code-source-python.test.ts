import { describe, it, expect } from "vitest";
import { extractPythonCodeSourceFacts } from "./code-source-python.js";

const extract = (content: string, source_path = "src/x.py") =>
  extractPythonCodeSourceFacts({ source_path, content, corpus_root: "/repo" });

describe("extractPythonCodeSourceFacts", () => {
  it("returns empty record on empty content", () => {
    const out = extract("");
    expect(out.exported_symbols).toEqual([]);
    expect(out.exported_signatures).toEqual([]);
    expect(out.imports).toEqual([]);
    expect(out.file_purpose).toBeNull();
  });

  it("extracts top-level functions with their signatures", () => {
    const out = extract([
      "def public_fn(x: int, y: str = 'a') -> bool:",
      "    return True",
      "",
      "async def async_fn() -> None:",
      "    pass",
    ].join("\n"));
    const names = out.exported_symbols.map((s) => s.name).sort();
    expect(names).toEqual(["async_fn", "public_fn"]);
    expect(out.exported_signatures.join(" | ")).toMatch(/def public_fn\(x: int, y: str = 'a'\) -> bool/);
    expect(out.exported_signatures.join(" | ")).toMatch(/def async_fn\(\) -> None/);
  });

  it("hides private (underscore-prefixed) names", () => {
    const out = extract([
      "def _private():",
      "    pass",
      "def public():",
      "    pass",
    ].join("\n"));
    expect(out.exported_symbols.map((s) => s.name)).toEqual(["public"]);
  });

  it("extracts top-level classes with their bases", () => {
    const out = extract([
      "class Foo(Bar, Baz):",
      "    pass",
      "",
      "class Standalone:",
      "    pass",
    ].join("\n"));
    expect(out.exported_symbols).toEqual([
      { name: "Foo", kind: "class" },
      { name: "Standalone", kind: "class" },
    ]);
  });

  it("extracts UPPER_SNAKE module-level constants", () => {
    const out = extract([
      "MAX_RETRIES = 5",
      "DEFAULT_NAME: str = 'foo'",
      "lower_not_const = 1  # not extracted",
    ].join("\n"));
    const names = out.exported_symbols.map((s) => s.name).sort();
    expect(names).toEqual(["DEFAULT_NAME", "MAX_RETRIES"]);
  });

  it("extracts PEP-613 TypeAlias declarations as type kind", () => {
    const out = extract("UserId: TypeAlias = int");
    expect(out.exported_symbols).toContainEqual({ name: "UserId", kind: "type" });
  });

  it("resolves relative imports to corpus-relative paths (no .py)", () => {
    const out = extract([
      "from .utils import format",
      "from ..pkg.helpers import a, b",
      "import top.level.mod",
    ].join("\n"), "src/feature/main.py");
    expect(out.imports).toContain("src/feature/utils");
    expect(out.imports).toContain("src/pkg/helpers");
    expect(out.imports).toContain("top/level/mod");
  });

  it("captures the module docstring as file_purpose", () => {
    const out = extract([
      '"""Module purpose: do X. Y. Z."""',
      "",
      "def fn(): pass",
    ].join("\n"));
    expect(out.file_purpose).toMatch(/Module purpose: do X\. Y\. Z\./);
  });

  it("ignores nested defs inside classes / functions (only top-level)", () => {
    const out = extract([
      "class Outer:",
      "    def method(self):",  // indented — NOT top-level
      "        pass",
      "",
      "def top_fn():",
      "    pass",
    ].join("\n"));
    const names = out.exported_symbols.map((s) => s.name).sort();
    expect(names).toEqual(["Outer", "top_fn"]);
  });

  it("does not throw on malformed source", () => {
    const out = extract("def broken(:");
    expect(out.exported_symbols).toEqual([]);
  });

  it("dedupes repeated definitions (e.g., overload stubs)", () => {
    const out = extract([
      "def fn(x: int) -> int: ...",
      "def fn(x: str) -> str:",
      "    return x",
    ].join("\n"));
    expect(out.exported_symbols).toEqual([{ name: "fn", kind: "function" }]);
  });

  it("clamps oversized signatures", () => {
    const longArgs = "x: int, ".repeat(80);
    const out = extract(`def big(${longArgs}) -> None: pass`);
    expect(out.exported_signatures[0]!.length).toBeLessThanOrEqual(241); // budget + ellipsis
  });

  it("clamps oversized module docstrings", () => {
    const long = "x ".repeat(400);
    const out = extract(`"""${long}"""`);
    expect(out.file_purpose!.length).toBeLessThanOrEqual(481);
  });
});
