import { describe, it, expect } from "vitest";
import { expandLinksKHops, extractCorpusLinks } from "./link-traversal.js";

describe("extractCorpusLinks", () => {
  const corpus = new Set([
    "docs/prd/0021-x.md",
    "docs/adr/0014-y.md",
    "docs/CONTEXT.md",
  ]);

  it("resolves relative markdown links against the source path", () => {
    const body = "See [ADR-0014](../adr/0014-y.md) and [glossary](../CONTEXT.md).";
    expect(
      extractCorpusLinks(body, "docs/prd/0021-x.md", corpus),
    ).toEqual(["docs/adr/0014-y.md", "docs/CONTEXT.md"]);
  });

  it("ignores http/https/anchor/mailto links", () => {
    const body = "[ext](https://example.com), [anchor](#sec), [mail](mailto:x@y.z), [valid](../adr/0014-y.md)";
    expect(extractCorpusLinks(body, "docs/prd/0021-x.md", corpus)).toEqual(["docs/adr/0014-y.md"]);
  });

  it("filters out paths not present in the corpus", () => {
    const body = "[missing](../adr/9999-not-here.md), [present](../adr/0014-y.md)";
    expect(extractCorpusLinks(body, "docs/prd/0021-x.md", corpus)).toEqual(["docs/adr/0014-y.md"]);
  });

  it("strips fragment and query suffixes", () => {
    const body = "[A](../CONTEXT.md#section), [B](../adr/0014-y.md?q=1)";
    expect(extractCorpusLinks(body, "docs/prd/0021-x.md", corpus)).toEqual([
      "docs/CONTEXT.md",
      "docs/adr/0014-y.md",
    ]);
  });

  it("resolves root-relative links from corpus root", () => {
    const body = "See [ADR](/docs/adr/0014-y.md).";
    expect(extractCorpusLinks(body, "docs/prd/0021-x.md", corpus)).toEqual(["docs/adr/0014-y.md"]);
  });

  it("resolves extensionless markdown links", () => {
    const body = "See [ADR](../adr/0014-y).";
    expect(extractCorpusLinks(body, "docs/prd/0021-x.md", corpus)).toEqual(["docs/adr/0014-y.md"]);
  });

  it("resolves directory links to index.md or README.md", () => {
    const directoryCorpus = new Set(["docs/guide/index.md", "docs/reference/README.md"]);
    const body = "[guide](guide/) and [ref](reference)";
    expect(extractCorpusLinks(body, "docs/home.md", directoryCorpus)).toEqual([
      "docs/guide/index.md",
      "docs/reference/README.md",
    ]);
  });
});

describe("expandLinksKHops", () => {
  // Two-level chain: A → B → C
  const corpus = new Set(["A.md", "B.md", "C.md"]);
  const bodies: Record<string, string> = {
    "A.md": "See [B](B.md).",
    "B.md": "See [C](C.md).",
    "C.md": "Terminal.",
  };
  const resolveBody = (p: string) => bodies[p] ?? "";

  it("returns seeds unchanged at maxHops=0", () => {
    const out = expandLinksKHops({
      seeds: ["A.md"],
      corpusSources: corpus,
      resolveBody,
      maxHops: 0,
    });
    expect([...out].sort()).toEqual(["A.md"]);
  });

  it("includes 1-hop neighbors at maxHops=1", () => {
    const out = expandLinksKHops({
      seeds: ["A.md"],
      corpusSources: corpus,
      resolveBody,
      maxHops: 1,
    });
    expect([...out].sort()).toEqual(["A.md", "B.md"]);
  });

  it("traverses transitive links at maxHops=2", () => {
    const out = expandLinksKHops({
      seeds: ["A.md"],
      corpusSources: corpus,
      resolveBody,
      maxHops: 2,
    });
    expect([...out].sort()).toEqual(["A.md", "B.md", "C.md"]);
  });

  it("handles cycles without infinite looping", () => {
    const cyclicBodies: Record<string, string> = {
      "A.md": "See [B](B.md).",
      "B.md": "See [A](A.md).",
    };
    const out = expandLinksKHops({
      seeds: ["A.md"],
      corpusSources: new Set(["A.md", "B.md"]),
      resolveBody: (p) => cyclicBodies[p] ?? "",
      maxHops: 5,
    });
    expect([...out].sort()).toEqual(["A.md", "B.md"]);
  });

  it("expands from multiple seeds in parallel", () => {
    const out = expandLinksKHops({
      seeds: ["A.md", "C.md"],
      corpusSources: corpus,
      resolveBody,
      maxHops: 1,
    });
    expect([...out].sort()).toEqual(["A.md", "B.md", "C.md"]);
  });
});
