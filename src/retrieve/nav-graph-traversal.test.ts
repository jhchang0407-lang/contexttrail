import { describe, it, expect } from "vitest";
import { expandNavSiblings, type NavGraphFacts } from "./nav-graph-traversal.js";

const facts = (
  source_path: string,
  nav_section_id: string | null,
  nav_provenance: NavGraphFacts["nav_provenance"] = "explicit_config",
): NavGraphFacts => ({ source_path, nav_section_id, nav_provenance });

describe("expandNavSiblings", () => {
  const navFacts: NavGraphFacts[] = [
    facts("schemas/arrays.md", "schemas"),
    facts("schemas/objects.md", "schemas"),
    facts("schemas/unions.md", "schemas"),
    facts("schemas/enums.md", "schemas"),
    facts("advanced/async.md", "advanced"),
    facts("advanced/extend.md", "advanced"),
    facts("index.md", null),
  ];

  it("surfaces same-section siblings of each seed", () => {
    const out = expandNavSiblings({
      seeds: ["schemas/arrays.md"],
      navFacts,
    });
    expect(out.has("schemas/arrays.md")).toBe(true);
    expect(out.has("schemas/objects.md")).toBe(true);
    expect(out.has("schemas/unions.md")).toBe(true);
    expect(out.has("schemas/enums.md")).toBe(true);
    expect(out.has("advanced/async.md")).toBe(false);
  });

  it("does not double-expand a section when multiple seeds share it", () => {
    const out = expandNavSiblings({
      seeds: ["schemas/arrays.md", "schemas/objects.md"],
      navFacts,
    });
    expect(out.size).toBeGreaterThanOrEqual(4);
    expect(out.size).toBeLessThanOrEqual(navFacts.length);
  });

  it("caps siblings per section", () => {
    const many: NavGraphFacts[] = Array.from({ length: 20 }, (_, i) =>
      facts(`schemas/s${i}.md`, "schemas"),
    );
    const out = expandNavSiblings({
      seeds: ["schemas/s0.md"],
      navFacts: many,
      maxSiblingsPerSection: 5,
    });
    // seed + 5 siblings = 6
    expect(out.size).toBeLessThanOrEqual(6);
  });

  it("refuses to expand structural-provenance siblings when directoryFallback is off", () => {
    const mixedFacts: NavGraphFacts[] = [
      facts("guide/intro.md", "guide", "structural"),
      facts("guide/getting-started.md", "guide", "structural"),
      facts("guide/advanced.md", "guide", "structural"),
    ];
    const out = expandNavSiblings({
      seeds: ["guide/intro.md"],
      navFacts: mixedFacts,
      directoryFallback: false,
    });
    expect(out.has("guide/intro.md")).toBe(true);
    expect(out.has("guide/getting-started.md")).toBe(false);
  });

  it("expands same-directory siblings via the structural fallback when nav data is absent", () => {
    const noNav: NavGraphFacts[] = [
      facts("guide/intro.md", null, "none"),
      facts("guide/getting-started.md", null, "none"),
      facts("guide/advanced.md", null, "none"),
      facts("api/reference.md", null, "none"),
    ];
    const out = expandNavSiblings({
      seeds: ["guide/intro.md"],
      navFacts: noNav,
    });
    expect(out.has("guide/getting-started.md")).toBe(true);
    expect(out.has("guide/advanced.md")).toBe(true);
    expect(out.has("api/reference.md")).toBe(false);
  });

  it("treats index.md as a section landing, surfacing its grandparent-dir siblings", () => {
    const nested: NavGraphFacts[] = [
      facts("docs/(get-started)/intro/index.md", null, "none"),
      facts("docs/(get-started)/install/index.md", null, "none"),
      facts("docs/(advanced)/extend/index.md", null, "none"),
    ];
    const out = expandNavSiblings({
      seeds: ["docs/(get-started)/intro/index.md"],
      navFacts: nested,
    });
    expect(out.has("docs/(get-started)/install/index.md")).toBe(true);
    expect(out.has("docs/(advanced)/extend/index.md")).toBe(false);
  });

  it("expands when provenance is explicit_config or frontmatter", () => {
    const mixedFacts: NavGraphFacts[] = [
      facts("a.md", "sec", "explicit_config"),
      facts("b.md", "sec", "explicit_config"),
      facts("c.md", "sec", "frontmatter"),
    ];
    const out = expandNavSiblings({
      seeds: ["a.md"],
      navFacts: mixedFacts,
    });
    expect(out.has("b.md")).toBe(true);
    expect(out.has("c.md")).toBe(true);
  });

  it("returns seed unchanged when seed has no nav_section_id", () => {
    const out = expandNavSiblings({
      seeds: ["index.md"],
      navFacts,
    });
    expect([...out].sort()).toEqual(["index.md"]);
  });

  it("returns seed unchanged when no navFacts provided", () => {
    const out = expandNavSiblings({
      seeds: ["x.md"],
      navFacts: [],
    });
    expect([...out].sort()).toEqual(["x.md"]);
  });
});
