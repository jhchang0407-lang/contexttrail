import { describe, expect, it } from "vitest";
import { extractCodeIndexArtifactsFor } from "./code-source-dispatch.js";

describe("extractCodeIndexArtifactsFor", () => {
  it("captures orientation, top-level declarations, and class methods from one ts parse walk", () => {
    const { facts, chunks } = extractCodeIndexArtifactsFor({
      source_path: "src/retrieve/example.ts",
      content: `/** Build the retrieval plan. */
import { helper } from "./helper.js";

export function buildPlan(): string {
  return helper();
}

function internalHelper(): string {
  return buildPlan();
}

export class Planner {
  execute(): string {
    return buildPlan();
  }
}
`,
      corpus_root: "",
    });

    expect(facts.exported_symbols).toContainEqual({
      name: "buildPlan",
      kind: "function",
    });

    const orientation = chunks.find((chunk) => chunk.code_role === "orientation");
    expect(orientation?.body).toContain('import { helper } from "./helper.js";');

    expect(
      chunks.some(
        (chunk) =>
          chunk.symbol_path === "buildPlan" &&
          chunk.declaration_kind === "function",
      ),
    ).toBe(true);
    expect(
      chunks.some(
        (chunk) =>
          chunk.symbol_path === "internalHelper" &&
          chunk.declaration_kind === "function",
      ),
    ).toBe(true);
    expect(
      chunks.some(
        (chunk) =>
          chunk.symbol_path === "Planner.execute" &&
          chunk.declaration_kind === "method",
      ),
    ).toBe(true);
  });

  it("keeps JSX chunks intact and covers common implementation shapes", () => {
    const jsx = extractCodeIndexArtifactsFor({
      source_path: "src/ui/view.jsx",
      content: "export const View = () => <><span a={1}>x</span></>\n",
      corpus_root: "",
    });
    expect(jsx.chunks[0]?.body).toContain("</span></>");

    const defaultAnonFn = extractCodeIndexArtifactsFor({
      source_path: "src/runtime/default-fn.ts",
      content: `export default function () {
  return 1;
}
`,
      corpus_root: "",
    });
    expect(defaultAnonFn.chunks.some((chunk) => chunk.symbol_path === "default")).toBe(true);

    const defaultAnonClass = extractCodeIndexArtifactsFor({
      source_path: "src/runtime/default-class.ts",
      content: `export default class {
  run() {
    return 2;
  }
}
`,
      corpus_root: "",
    });
    expect(defaultAnonClass.chunks.some((chunk) => chunk.symbol_path === "default")).toBe(true);
    expect(defaultAnonClass.chunks.some((chunk) => chunk.symbol_path === "default.run")).toBe(true);

    const classField = extractCodeIndexArtifactsFor({
      source_path: "src/runtime/handlers.ts",
      content: `export class Foo {
  handler = () => 1;
  private hidden() {
    return 2;
  }
}
`,
      corpus_root: "",
    });
    expect(
      classField.chunks.some(
        (chunk) =>
          chunk.symbol_path === "Foo.handler" &&
          chunk.declaration_kind === "property",
      ),
    ).toBe(true);
    expect(
      classField.chunks.find((chunk) => chunk.symbol_path === "Foo.hidden")?.exported,
    ).toBe(false);

    const multiDecl = extractCodeIndexArtifactsFor({
      source_path: "src/runtime/vars.ts",
      content: "const a = 1, b = 2\n",
      corpus_root: "",
    });
    expect(multiDecl.chunks.find((chunk) => chunk.symbol_path === "a")?.body).toBe("const a = 1");
    expect(multiDecl.chunks.find((chunk) => chunk.symbol_path === "b")?.body).toBe("const b = 2");
  });

  it("emits a generic orientation chunk for non-TypeScript languages", () => {
    const rust = extractCodeIndexArtifactsFor({
      source_path: "src/lessopen.rs",
      content: `//! lessopen integration.

use crate::config::Config;

fn render_lessopen(config: Config) -> String {
  String::new()
}

fn add_file() {
  // Prevent cache archive symlink reads from escaping the archive root.
  source_path.symlink_metadata();
}
`,
      corpus_root: "",
    });

    expect(rust.facts.file_path).toBe("src/lessopen.rs");
    expect(rust.chunks.length).toBeGreaterThan(1);
    expect(rust.chunks[0]).toMatchObject({
      source_path: "src/lessopen.rs",
      stable_key: "src/lessopen.rs::orientation",
      symbol_path: null,
      code_role: "orientation",
      declaration_kind: null,
      exported: false,
      start_line: 1,
    });
    expect(rust.chunks[0]?.body).toContain("src/lessopen.rs");
    expect(rust.chunks[0]?.body).toContain("lessopen integration");
    expect(rust.chunks[0]?.body).toContain("config/Config");
    expect(rust.chunks[0]?.body).toContain("symlink");
    expect(rust.chunks[0]?.body).toContain("archive");
    expect(rust.chunks).toContainEqual(
      expect.objectContaining({
        source_path: "src/lessopen.rs",
        symbol_path: "add_file",
        code_role: "declaration",
        declaration_kind: "function",
        exported: false,
      }),
    );
  });

  it("adds compact body vocabulary for generic-language orientation chunks", () => {
    const python = extractCodeIndexArtifactsFor({
      source_path: "src/flask/sansio/app.py",
      content: `
class App:
    def _check_setup_finished(self, f_name: str) -> None:
        """Use case-insensitive comparison instead of only lower case."""
        return None
`,
      corpus_root: "",
    });

    expect(python.chunks[0]?.body).toContain("case");
    expect(python.chunks[0]?.body).toContain("insensitive");
    expect(python.chunks[0]?.body).toContain("comparison");
  });

  it("emits generic declaration chunks for Rust impl methods", () => {
    const rust = extractCodeIndexArtifactsFor({
      source_path: "src/archive/cache.rs",
      content: `
pub struct CacheArchive {
    root: PathBuf,
}

impl CacheArchive {
    pub fn add_file(&mut self, source_path: &Path) -> Result<()> {
        source_path.symlink_metadata()?;
        Ok(())
    }

    fn normalize_entry_name(&self, source_path: &Path) -> String {
        source_path.display().to_string()
    }
}
`,
      corpus_root: "",
    });

    expect(rust.chunks).toContainEqual(
      expect.objectContaining({
        source_path: "src/archive/cache.rs",
        symbol_path: "CacheArchive.add_file",
        code_role: "declaration",
        declaration_kind: "method",
        exported: true,
      }),
    );
    expect(
      rust.chunks.find((chunk) => chunk.symbol_path === "CacheArchive.add_file")?.body,
    ).toContain("symlink_metadata");
    expect(
      rust.chunks.find(
        (chunk) => chunk.symbol_path === "CacheArchive.normalize_entry_name",
      )?.exported,
    ).toBe(false);
  });

  it("emits generic declaration chunks for Python class methods", () => {
    const python = extractCodeIndexArtifactsFor({
      source_path: "src/flask/sansio/app.py",
      content: `
class App:
    def _check_setup_finished(self, f_name: str) -> None:
        """Use case-insensitive comparison instead of only lower case."""
        if self._got_first_request:
            raise AssertionError(f_name)

    async def dispatch_request(self) -> Response:
        return await self.ensure_async(self.view_functions["index"])()
`,
      corpus_root: "",
    });

    expect(python.chunks).toContainEqual(
      expect.objectContaining({
        source_path: "src/flask/sansio/app.py",
        symbol_path: "App._check_setup_finished",
        code_role: "declaration",
        declaration_kind: "method",
        exported: false,
      }),
    );
    expect(
      python.chunks.find((chunk) => chunk.symbol_path === "App.dispatch_request")?.body,
    ).toContain("ensure_async");
  });

  it("emits generic declaration chunks for Go receiver methods", () => {
    const go = extractCodeIndexArtifactsFor({
      source_path: "internal/server/server.go",
      content: `
package server

type Server struct {
    addr string
}

func (s *Server) Start(ctx context.Context) error {
    return s.listenAndServe(ctx)
}

func (s *Server) listenAndServe(ctx context.Context) error {
    return nil
}

func NewServer(addr string) *Server {
    return &Server{addr: addr}
}
`,
      corpus_root: "",
    });

    expect(go.chunks).toContainEqual(
      expect.objectContaining({
        source_path: "internal/server/server.go",
        symbol_path: "Server.Start",
        code_role: "declaration",
        declaration_kind: "method",
        exported: true,
      }),
    );
    expect(
      go.chunks.find((chunk) => chunk.symbol_path === "Server.listenAndServe")
        ?.exported,
    ).toBe(false);
    expect(
      go.chunks.find((chunk) => chunk.symbol_path === "NewServer")
        ?.declaration_kind,
    ).toBe("function");
  });

  it("keeps enough generic declaration chunks for larger non-TypeScript files", () => {
    const content = Array.from(
      { length: 65 },
      (_, index) => `pub fn parser_case_${index}() {}`,
    ).join("\n");
    const rust = extractCodeIndexArtifactsFor({
      source_path: "crates/parser/src/generated_nodes.rs",
      content,
      corpus_root: "",
    });

    expect(
      rust.chunks.some((chunk) => chunk.symbol_path === "parser_case_64"),
    ).toBe(true);
  });
});
