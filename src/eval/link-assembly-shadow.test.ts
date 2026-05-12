import { describe, expect, it } from "vitest";
import type { SourceProfile } from "../types/source-profile.js";
import {
  expandLinkAssemblySources,
  extractMarkdownLinkUrls,
  resolveMarkdownLink,
  summarizeMode,
  type LinkAssemblyShadowRow,
  type SourceLinkGraph,
} from "./link-assembly-shadow.js";
import { parse } from "../parse/markdown.js";

const NOW = "2026-05-10T00:00:00Z";

function profile(
  source_path: string,
  token_count = 100,
): SourceProfile {
  return {
    source_path,
    source_content_hash: "h0",
    title: source_path,
    h1: source_path,
    intro: null,
    heading_outline: [],
    doc_role: "canonical",
    role_source: "default",
    doc_purpose: "guide",
    purpose_source: "default",
    aliases: [],
    summary: null,
    summary_source: "empty",
    questions_answered: [],
    questions_answered_source: "empty",
    chunk_count: 1,
    token_count,
    indexed_at: NOW,
  };
}

function graph(outbound: Record<string, string[]>): SourceLinkGraph {
  const inbound = new Map<string, string[]>();
  for (const [source, targets] of Object.entries(outbound)) {
    for (const target of targets) {
      const arr = inbound.get(target) ?? [];
      arr.push(source);
      inbound.set(target, arr);
    }
  }
  return {
    outbound: new Map(Object.entries(outbound)),
    inbound,
  };
}

describe("extractMarkdownLinkUrls", () => {
  it("extracts inline and reference definition URLs from markdown AST", () => {
    const root = parse("[Guide](./guide.md)\n\n[ref]: ./ref.md\n").ast;
    expect(extractMarkdownLinkUrls(root).sort()).toEqual(["./guide.md", "./ref.md"]);
  });
});

describe("resolveMarkdownLink", () => {
  it("resolves relative extensionless links against the source directory", () => {
    const sourceSet = new Set(["docs/guide/setup.md"]);
    expect(resolveMarkdownLink({
      fromSource: "docs/index.md",
      url: "./guide/setup",
      sourceSet,
    })).toBe("docs/guide/setup.md");
  });

  it("resolves site-root links through the current import root prefix", () => {
    const sourceSet = new Set(["docs/guide/setup.md"]);
    expect(resolveMarkdownLink({
      fromSource: "docs/index.md",
      url: "/guide/setup",
      sourceSet,
    })).toBe("docs/guide/setup.md");
  });

  it("ignores external and same-page links", () => {
    const sourceSet = new Set(["docs/guide/setup.md"]);
    expect(resolveMarkdownLink({
      fromSource: "docs/index.md",
      url: "https://example.com",
      sourceSet,
    })).toBeUndefined();
    expect(resolveMarkdownLink({
      fromSource: "docs/index.md",
      url: "#local",
      sourceSet,
    })).toBeUndefined();
  });
});

describe("expandLinkAssemblySources", () => {
  it("outbound mode adds direct markdown link targets", () => {
    const profiles = [
      profile("docs/a.md"),
      profile("docs/b.md"),
      profile("docs/c.md"),
    ];
    const out = expandLinkAssemblySources({
      mode: "top1_link_out",
      seedSources: ["docs/a.md"],
      profiles,
      linkGraph: graph({ "docs/a.md": ["docs/b.md", "docs/c.md"] }),
    });
    expect(out.selectedSources).toEqual(["docs/a.md", "docs/b.md", "docs/c.md"]);
  });

  it("bidirectional mode adds inbound sources too", () => {
    const profiles = [
      profile("docs/a.md"),
      profile("docs/b.md"),
    ];
    const out = expandLinkAssemblySources({
      mode: "top1_link_bidir",
      seedSources: ["docs/b.md"],
      profiles,
      linkGraph: graph({ "docs/a.md": ["docs/b.md"] }),
    });
    expect(out.selectedSources).toEqual(["docs/b.md", "docs/a.md"]);
  });
});

describe("summarizeMode", () => {
  it("counts link-only full-coverage gains against top3", () => {
    const rows: LinkAssemblyShadowRow[] = [
      {
        repo: "x",
        id: "case",
        requiredSources: ["docs/a.md", "docs/b.md"],
        top1Sources: ["docs/a.md"],
        top3Sources: ["docs/a.md"],
        modes: {
          top1_link_out: {
            mode: "top1_link_out",
            selectedSources: ["docs/a.md", "docs/b.md"],
            selectedTokens: 200,
            expansionReasons: {},
          },
          top3_link_out: {
            mode: "top3_link_out",
            selectedSources: ["docs/a.md"],
            selectedTokens: 100,
            expansionReasons: {},
          },
          top1_link_bidir: {
            mode: "top1_link_bidir",
            selectedSources: ["docs/a.md"],
            selectedTokens: 100,
            expansionReasons: {},
          },
          top3_link_bidir: {
            mode: "top3_link_bidir",
            selectedSources: ["docs/a.md"],
            selectedTokens: 100,
            expansionReasons: {},
          },
        },
      },
    ];
    const summary = summarizeMode("top1_link_out", rows);
    expect(summary.seedFullCoverageCases).toBe(0);
    expect(summary.fullCoverageCases).toBe(1);
    expect(summary.newlyCoveredVsSeed).toBe(1);
    expect(summary.newlyCoveredVsTop3).toBe(1);
  });
});
