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
    expect(rust.chunks).toHaveLength(1);
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
});
