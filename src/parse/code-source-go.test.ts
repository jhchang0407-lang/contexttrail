import { describe, it, expect } from "vitest";
import { extractGoCodeSourceFacts } from "./code-source-go.js";

const extract = (content: string, source_path = "pkg/x.go", module_prefix = "example.com/repo") =>
  extractGoCodeSourceFacts({ source_path, content, module_prefix });

describe("extractGoCodeSourceFacts", () => {
  it("returns empty record on empty content", () => {
    const out = extract("");
    expect(out.exported_symbols).toEqual([]);
  });

  it("extracts exported (uppercase) functions only", () => {
    const out = extract([
      "package x",
      "func PublicFn(x int) string { return \"\" }",
      "func privateFn() {}",
    ].join("\n"));
    expect(out.exported_symbols).toEqual([{ name: "PublicFn", kind: "function" }]);
    expect(out.exported_signatures[0]).toMatch(/func PublicFn\(x int\)/);
  });

  it("extracts methods on receivers", () => {
    const out = extract([
      "package x",
      "func (s *Server) Start(ctx context.Context) error { return nil }",
      "func (s *Server) stop() {}",
    ].join("\n"));
    const names = out.exported_symbols.map((s) => s.name);
    expect(names).toContain("Start");
    expect(names).not.toContain("stop");
  });

  it("classifies structs / interfaces / aliases", () => {
    const out = extract([
      "package x",
      "type Server struct {}",
      "type Handler interface {}",
      "type Alias = int",
    ].join("\n"));
    const kinds = new Map(out.exported_symbols.map((s) => [s.name, s.kind]));
    expect(kinds.get("Server")).toBe("class");
    expect(kinds.get("Handler")).toBe("interface");
    expect(kinds.get("Alias")).toBe("type");
  });

  it("extracts top-level const and var", () => {
    const out = extract([
      "package x",
      "const MaxRetries = 5",
      "var DefaultName = \"foo\"",
      "const internalConst = 1",
    ].join("\n"));
    const names = out.exported_symbols.map((s) => s.name).sort();
    expect(names).toContain("MaxRetries");
    expect(names).toContain("DefaultName");
    expect(names).not.toContain("internalConst");
  });

  it("resolves module-prefixed imports to corpus-relative paths", () => {
    const out = extract([
      "package x",
      "import (",
      "  \"example.com/repo/pkg/utils\"",
      "  \"example.com/repo/pkg/auth\"",
      "  \"fmt\"",
      ")",
    ].join("\n"));
    expect(out.imports).toContain("pkg/utils");
    expect(out.imports).toContain("pkg/auth");
    expect(out.imports).toContain("fmt"); // stdlib kept verbatim
  });

  it("handles single-line imports", () => {
    const out = extract([
      "package x",
      "import \"example.com/repo/utils\"",
      "import alias \"example.com/repo/auth\"",
    ].join("\n"));
    expect(out.imports).toContain("utils");
    expect(out.imports).toContain("auth");
  });

  it("captures the package doc comment as file_purpose", () => {
    const out = extract([
      "// Package retriever implements the BM25F ranking layer.",
      "// It is the structural assembly entry point.",
      "package retriever",
      "func Run() {}",
    ].join("\n"));
    expect(out.file_purpose).toMatch(/Package retriever implements the BM25F ranking layer/);
  });

  it("returns null file_purpose when no doc comment precedes package", () => {
    const out = extract([
      "package x",
      "func Fn() {}",
    ].join("\n"));
    expect(out.file_purpose).toBeNull();
  });

  it("does not throw on malformed source", () => {
    const out = extract("func broken(");
    expect(out.exported_symbols).toEqual([]);
  });
});
