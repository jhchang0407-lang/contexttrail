import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocChunk } from "../types/chunk.js";
import type { SourceProfile } from "../types/source-profile.js";
import {
  buildLocalizedGraph,
  chunkContainingLine,
  collectMarkdownLinkReferences,
  expandLocalizedGraphAssembly,
  resolveLocalizedLinkTarget,
  type LocalizedGraph,
  type LocalizedGraphEdge,
} from "./localized-graph-assembly-shadow.js";
import { parse } from "../parse/markdown.js";

const NOW = "2026-05-10T00:00:00Z";

function chunk(overrides: Partial<DocChunk> & {
  version_id: string;
  source_path: string;
  heading_path: string[];
}): DocChunk {
  return {
    stable_key: `${overrides.version_id}:stable`,
    version_id: overrides.version_id,
    source_path: overrides.source_path,
    doc_id: overrides.source_path,
    heading_path: overrides.heading_path,
    heading_level: overrides.heading_level ?? overrides.heading_path.length,
    chunk_index: overrides.chunk_index ?? 1,
    chunk_count: overrides.chunk_count ?? 1,
    title: overrides.title ?? overrides.heading_path[overrides.heading_path.length - 1] ?? "Untitled",
    body: overrides.body ?? "",
    token_count: overrides.token_count ?? 100,
    chunk_content_hash: "chunk-hash",
    start_line: overrides.start_line ?? 1,
    end_line: overrides.end_line ?? 10,
    heading_slug: overrides.heading_slug,
    status: overrides.status ?? "current",
    source_content_hash: "source-hash",
    indexed_at: NOW,
    scope: overrides.scope ?? { layer: "project", source: {} },
    doc_role: overrides.doc_role ?? "canonical",
    role_source: overrides.role_source ?? "default",
  };
}

function profile(source_path: string, p: Partial<SourceProfile> = {}): SourceProfile {
  return {
    source_path,
    source_content_hash: "source-hash",
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
    token_count: 1000,
    indexed_at: NOW,
    ...p,
  };
}

function graph(edges: Partial<LocalizedGraph> = {}): LocalizedGraph {
  return {
    outbound: edges.outbound ?? new Map(),
    inbound: edges.inbound ?? new Map(),
    nav: edges.nav ?? new Map(),
  };
}

function edge(target: DocChunk, p: Partial<LocalizedGraphEdge> = {}): LocalizedGraphEdge {
  return {
    edge_kind: "markdown_link",
    direction: "outbound",
    provenance: "markdown_ast",
    from_chunk_id: "root",
    from_source: "docs/root.md",
    target_chunk_id: target.version_id,
    target_source: target.source_path,
    target_tokens: target.token_count,
    selection_reason: "target_heading_query_overlap",
    score: 1,
    ...p,
  };
}

describe("localized markdown links", () => {
  it("extracts inline and reference links with origin lines", () => {
    const refs = collectMarkdownLinkReferences(
      parse("# Root\n\nSee [Guide](./guide.md).\n\nAlso [Ref][r].\n\n[r]: ./ref.md\n").ast,
      "docs/root.md",
    );
    expect(refs.map((r) => [r.line, r.url, r.label])).toEqual([
      [3, "./guide.md", "Guide"],
      [5, "./ref.md", "Ref"],
    ]);
  });

  it("maps link origin to the containing chunk", () => {
    const chunks = [
      chunk({ version_id: "a", source_path: "docs/root.md", heading_path: ["A"], start_line: 2, end_line: 4 }),
      chunk({ version_id: "b", source_path: "docs/root.md", heading_path: ["B"], start_line: 5, end_line: 8 }),
    ];
    expect(chunkContainingLine(chunks, 3)?.version_id).toBe("a");
    expect(chunkContainingLine(chunks, 6)?.version_id).toBe("b");
  });

  it("resolves relative, root-relative, extensionless, and hash links to chunks", () => {
    const targetIntro = chunk({
      version_id: "intro",
      source_path: "docs/guide/setup.md",
      heading_path: ["Setup"],
      heading_slug: "setup",
    });
    const targetDeep = chunk({
      version_id: "deep",
      source_path: "docs/guide/setup.md",
      heading_path: ["Setup", "Advanced Options"],
      heading_slug: "advanced-options",
      chunk_index: 2,
    });
    const chunksBySource = new Map([["docs/guide/setup.md", [targetIntro, targetDeep]]]);
    const sourceSet = new Set(["docs/guide/setup.md"]);

    expect(resolveLocalizedLinkTarget({
      fromSource: "docs/root.md",
      url: "./guide/setup",
      label: "setup",
      query: "setup",
      sourceSet,
      chunksBySource,
    })?.chunk.version_id).toBe("intro");
    expect(resolveLocalizedLinkTarget({
      fromSource: "docs/root.md",
      url: "/guide/setup",
      label: "setup",
      query: "setup",
      sourceSet,
      chunksBySource,
    })?.chunk.version_id).toBe("intro");
    expect(resolveLocalizedLinkTarget({
      fromSource: "docs/root.md",
      url: "./guide/setup#advanced-options",
      label: "setup",
      query: "setup",
      sourceSet,
      chunksBySource,
    })?.chunk.version_id).toBe("deep");
  });

  it("rejects generic labels unless the target heading matches the task", () => {
    const target = chunk({
      version_id: "advanced",
      source_path: "docs/advanced.md",
      heading_path: ["Advanced Setup"],
      heading_slug: "advanced-setup",
    });
    const chunksBySource = new Map([["docs/advanced.md", [target]]]);
    const sourceSet = new Set(["docs/advanced.md"]);
    expect(resolveLocalizedLinkTarget({
      fromSource: "docs/root.md",
      url: "./advanced.md",
      label: "here",
      query: "unrelated request",
      sourceSet,
      chunksBySource,
    })).toBeUndefined();
    expect(resolveLocalizedLinkTarget({
      fromSource: "docs/root.md",
      url: "./advanced.md",
      label: "here",
      query: "advanced setup",
      sourceSet,
      chunksBySource,
    })?.chunk.version_id).toBe("advanced");
  });

  it("hash links beat intro fallback when building graph edges", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dlg-local-graph-"));
    writeFileSync(join(cwd, "root.md"), "# Root\n\nSee [details](./target.md#deep-section).\n");
    writeFileSync(join(cwd, "target.md"), "# Target\n\n## Deep Section\n\nBody.\n");
    const root = chunk({ version_id: "root", source_path: "root.md", heading_path: ["Root"], start_line: 1, end_line: 3 });
    const intro = chunk({ version_id: "intro", source_path: "target.md", heading_path: ["Target"], heading_slug: "target" });
    const deep = chunk({
      version_id: "deep",
      source_path: "target.md",
      heading_path: ["Target", "Deep Section"],
      heading_slug: "deep-section",
      chunk_index: 2,
    });
    const built = buildLocalizedGraph({
      cwd,
      chunks: [root, intro, deep],
      profiles: [profile("root.md"), profile("target.md")],
      query: "details",
    });
    expect(built.outbound.get("root")?.[0]?.target_chunk_id).toBe("deep");
  });
});

describe("localized graph expansion", () => {
  it("inbound and nav modes are diagnostic-only and obey caps", () => {
    const root = chunk({ version_id: "root", source_path: "docs/root.md", heading_path: ["Root"], token_count: 100 });
    const out = chunk({ version_id: "out", source_path: "docs/out.md", heading_path: ["Out"], token_count: 110 });
    const inbound = chunk({ version_id: "in", source_path: "docs/in.md", heading_path: ["In"], token_count: 120 });
    const nav = chunk({ version_id: "nav", source_path: "docs/nav.md", heading_path: ["Nav"], token_count: 130 });
    const built = graph({
      outbound: new Map([["root", [edge(out)]]]),
      inbound: new Map([["root", [edge(inbound, { direction: "inbound", from_chunk_id: "in" })]]]),
      nav: new Map([["root", [edge(nav, { edge_kind: "nav_explicit", direction: "nav", provenance: "explicit_config", score: 3 })]]]),
    });
    const common = {
      root,
      graph: built,
      chunks: [root, out, inbound, nav],
      profiles: [profile("docs/root.md"), profile("docs/out.md"), profile("docs/in.md"), profile("docs/nav.md")],
      budgetTokens: 1000,
      queryMode: "anchored" as const,
    };
    expect(expandLocalizedGraphAssembly({ ...common, mode: "root_link_bidir_1" }).added_chunks).toHaveLength(1);
    expect(expandLocalizedGraphAssembly({ ...common, mode: "root_nav_explicit_1" }).added_chunks).toHaveLength(1);
    expect(expandLocalizedGraphAssembly({ ...common, mode: "root_graph_combined_2" }).added_chunks).toHaveLength(2);
  });

  it("uses chunk token mass rather than whole linked source token mass", () => {
    const root = chunk({ version_id: "root", source_path: "docs/root.md", heading_path: ["Root"], token_count: 100 });
    const target = chunk({ version_id: "target", source_path: "docs/target.md", heading_path: ["Target"], token_count: 150 });
    const out = expandLocalizedGraphAssembly({
      mode: "root_link_out_1",
      root,
      graph: graph({ outbound: new Map([["root", [edge(target)]]]) }),
      chunks: [root, target],
      profiles: [
        profile("docs/root.md", { token_count: 1000 }),
        profile("docs/target.md", { token_count: 5000 }),
      ],
      budgetTokens: 1000,
      queryMode: "anchored",
    });
    expect(out.selected_chunk_ids).toEqual(["root", "target"]);
    expect(out.selected_tokens).toBe(250);
    expect(out.whole_source_equivalent_tokens).toBe(6000);
  });

  it("keeps the root but does not expand signal_empty packs", () => {
    const root = chunk({ version_id: "root", source_path: "docs/root.md", heading_path: ["Root"] });
    const target = chunk({ version_id: "target", source_path: "docs/target.md", heading_path: ["Target"] });
    const out = expandLocalizedGraphAssembly({
      mode: "root_link_out_1",
      root,
      graph: graph({ outbound: new Map([["root", [edge(target)]]]) }),
      chunks: [root, target],
      profiles: [profile("docs/root.md"), profile("docs/target.md")],
      budgetTokens: 1000,
      queryMode: "signal_empty",
    });
    expect(out.selected_chunk_ids).toEqual(["root"]);
    expect(out.added_chunks).toEqual([]);
  });
});
