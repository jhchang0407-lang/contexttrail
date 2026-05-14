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
});
