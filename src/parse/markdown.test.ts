import { describe, it, expect } from "vitest";
import { parse } from "./markdown.js";

describe("markdown parser (smoke)", () => {
  it("returns ast, frontmatter, lineMap", () => {
    const src = `---\nscope:\n  layer: project\n  project: payments\n---\n\n# Title\n\nbody paragraph.\n\n## Sub\n\nmore.\n`;
    const r = parse(src);
    expect(r.frontmatter).toEqual({
      scope: { layer: "project", project: "payments" },
    });
    expect(r.ast.type).toBe("root");
    expect(typeof r.lineMap.body_offset_lines).toBe("number");
  });

  it("no frontmatter returns empty object", () => {
    const r = parse("# H1\n\nx\n");
    expect(r.frontmatter).toEqual({});
    expect(r.lineMap.body_offset_lines).toBe(0);
  });

  it("ast contains heading nodes with line positions", () => {
    const r = parse("# A\n\npara\n\n## B\n");
    const headings = r.ast.children.filter((n: any) => n.type === "heading");
    expect(headings.length).toBe(2);
    expect((headings[0] as any).position.start.line).toBe(1);
  });
});
