import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../../config/defaults.js";
import {
  compileQueryScopes,
  makeInMemoryAnchorLookup,
} from "../../retrieve/query-scope.js";
import { makeSourceProfileAnchorLookup } from "../../retrieve/source-profile-anchor-lookup.js";
import type { Card } from "../../types/card.js";
import type { ChunkScope, DocChunk } from "../../types/chunk.js";
import type { SourceAlias, SourceProfile } from "../../types/source-profile.js";

const emptyConfig = ConfigSchema.parse({ code_scopes: [] });

function scope(module: string): ChunkScope {
  return { layer: "module", module, source: {} };
}

function chunk(version_id: string, source_path: string, chunkScope: ChunkScope): DocChunk {
  return {
    stable_key: `stable-${version_id}`,
    version_id,
    source_path,
    doc_id: `doc-${version_id}`,
    heading_path: ["Synthetic"],
    heading_level: 1,
    chunk_index: 1,
    chunk_count: 1,
    title: "Synthetic",
    body: "body",
    token_count: 10,
    chunk_content_hash: `hash-${version_id}`,
    start_line: 1,
    end_line: 1,
    status: "current",
    source_content_hash: `source-${version_id}`,
    indexed_at: "2026-05-08T00:00:00Z",
    scope: chunkScope,
  };
}

function profile(
  source_path: string,
  overrides: Partial<SourceProfile> = {},
): SourceProfile {
  return {
    source_content_hash: `source-${source_path}`,
    title: overrides.title ?? source_path,
    h1: overrides.h1 ?? null,
    intro: overrides.intro ?? null,
    heading_outline: overrides.heading_outline ?? [],
    doc_role: "canonical",
    role_source: "default",
    doc_purpose: "guide",
    purpose_source: "default",
    aliases: overrides.aliases ?? [],
    summary: null,
    summary_source: "empty",
    questions_answered: [],
    questions_answered_source: "empty",
    chunk_count: 1,
    token_count: 10,
    indexed_at: "2026-05-08T00:00:00Z",
    ...overrides,
    source_path,
  };
}

function alias(kind: SourceAlias["kind"], value: string): SourceAlias {
  return { kind, value, confidence: "high", origin: kind === "package" ? "package_name" : kind };
}

function classify(args: {
  file: string;
  task?: string;
  profiles?: SourceProfile[];
  chunks?: DocChunk[];
  cards?: Card[];
}) {
  return compileQueryScopes({
    anchors: { files: [args.file] },
    config: emptyConfig,
    lookup: makeInMemoryAnchorLookup({
      chunks: [],
      cards: args.cards ?? [],
      anchorsByChunkVersionId: new Map(),
    }),
    source_lookup: makeSourceProfileAnchorLookup({
      profiles: args.profiles ?? [],
      chunks: args.chunks ?? [],
    }),
    task: args.task ?? "",
  });
}

function card(id: string, files: string[]): Card {
  return {
    id,
    type: "constraint",
    title: id,
    body: "body",
    authority: "accepted",
    scope: scope("cards"),
    symbol_anchors: [],
    file_anchors: files,
    route_anchors: [],
    links: [],
    freshness_state: "verified",
    freshness_reason: "all_links_current",
    author_review_state: "unreviewed",
    token_count: 10,
    source_path: `.contexttrail/cards/${id}.md`,
    source_hash: "hash",
    updated_at: "2026-05-08T00:00:00Z",
  };
}

describe("source-profile file aliases at query-mode compilation", () => {
  it("resolves exact and suffix source paths through source profiles", () => {
    const p = profile("docs/turbo/configuration.md", { title: "Turbo configuration" });
    const c = chunk("config", p.source_path, scope("configuration"));

    const exact = classify({ file: "docs/turbo/configuration.md", profiles: [p], chunks: [c] });
    expect(exact.query_compilation.query_mode).toBe("anchored");
    expect(exact.query_compilation.anchors[0]!.mode).toBe("source_profile_alias");
    expect(exact.query_compilation.anchors[0]!.contributing_anchors[0]).toMatchObject({
      match_source: "source_profile",
      match_kind: "source_path_exact",
      source_path: "docs/turbo/configuration.md",
      confidence: "high",
    });

    const suffix = classify({ file: "turbo/configuration.md", profiles: [p], chunks: [c] });
    expect(suffix.query_compilation.query_mode).toBe("anchored");
    expect(suffix.query_compilation.anchors[0]!.contributing_anchors[0]).toMatchObject({
      match_kind: "source_path_suffix",
      confidence: "high",
    });
  });

  it("resolves source basenames with and without extensions", () => {
    const p = profile("docs/vitest/config.md", { title: "Vitest config" });
    const c = chunk("vitest-config", p.source_path, scope("vitest"));

    const withExtension = classify({ file: "config.md", profiles: [p], chunks: [c] });
    expect(withExtension.query_compilation.query_mode).toBe("anchored");
    expect(withExtension.query_compilation.anchors[0]!.contributing_anchors[0]).toMatchObject({
      match_kind: "source_basename",
      confidence: "medium",
    });

    const extensionless = classify({ file: "config", profiles: [p], chunks: [c] });
    expect(extensionless.query_compilation.query_mode).toBe("anchored");
    expect(extensionless.query_compilation.anchors[0]!.contributing_anchors[0]).toMatchObject({
      match_kind: "source_basename_without_extension",
      confidence: "medium",
    });
  });

  it("uses path, filename, and package aliases from SourceProfile metadata", () => {
    const p = profile("docs/packages/server.md", {
      aliases: [
        alias("path", "docs/server-package"),
        alias("filename", "server-package"),
        alias("package", "@trpc/server"),
      ],
    });
    const c = chunk("server-package", p.source_path, scope("server"));

    expect(
      classify({ file: "docs/server-package", profiles: [p], chunks: [c] })
        .query_compilation.anchors[0]!.contributing_anchors[0],
    ).toMatchObject({ match_kind: "source_alias_path" });
    expect(
      classify({ file: "server-package", profiles: [p], chunks: [c] })
        .query_compilation.anchors[0]!.contributing_anchors[0],
    ).toMatchObject({ match_kind: "source_alias_filename" });
    expect(
      classify({ file: "@trpc/server", profiles: [p], chunks: [c] })
        .query_compilation.anchors[0]!.contributing_anchors[0],
    ).toMatchObject({ match_kind: "source_alias_package" });
  });

  it("extracts filename-like mentions from title, H1, intro, and H2/H3 headings only", () => {
    const p = profile("docs/turbo/globs.md", {
      title: "Configuring turbo.json",
      h1: "turbo.json reference",
      intro: "The turbo.json file controls workspace tasks.",
      heading_outline: [
        { level: 2, text: "Glob inputs and outputs in turbo.json", slug: "globs" },
        { level: 4, text: "ignored.config.ts should not count here", slug: "ignored" },
      ],
    });
    const c = chunk("turbo-globs", p.source_path, scope("globs"));

    const out = classify({ file: "turbo.json", profiles: [p], chunks: [c] });
    expect(out.query_compilation.query_mode).toBe("anchored");
    expect(out.query_compilation.anchors[0]!.contributing_anchors[0]).toMatchObject({
      match_kind: "source_text_filename",
      confidence: "medium",
    });

    const h4Only = classify({ file: "ignored.config.ts", profiles: [p], chunks: [c] });
    expect(h4Only.query_compilation.query_mode).toBe("signal_empty");
  });

  it("allows ambiguous filename fanout only when task tokens support a source", () => {
    const workspaceProfile = profile("docs/workspaces.md", {
      title: "package.json workspaces",
      heading_outline: [{ level: 2, text: "Workspaces", slug: "workspaces" }],
    });
    const scriptsProfile = profile("docs/scripts.md", {
      title: "package.json scripts",
      heading_outline: [{ level: 2, text: "Scripts", slug: "scripts" }],
    });
    const chunks = [
      chunk("workspaces", workspaceProfile.source_path, scope("workspaces")),
      chunk("scripts", scriptsProfile.source_path, scope("scripts")),
    ];

    const supported = classify({
      file: "package.json",
      task: "Configure workspaces in package.json",
      profiles: [workspaceProfile, scriptsProfile],
      chunks,
    });
    expect(supported.query_compilation.query_mode).toBe("anchored");
    expect(supported.query_compilation.anchors[0]!.contributing_anchors).toHaveLength(1);
    expect(supported.query_compilation.anchors[0]!.contributing_anchors[0]).toMatchObject({
      source_path: "docs/workspaces.md",
      confidence: "low",
    });

    const unsupported = classify({
      file: "package.json",
      task: "Use package.json",
      profiles: [workspaceProfile, scriptsProfile],
      chunks,
    });
    expect(unsupported.query_compilation.query_mode).toBe("signal_empty");
    expect(unsupported.query_compilation.anchors[0]!.contributing_anchors).toEqual([]);
  });

  it("keeps unknown files signal_empty and Card anchors exact", () => {
    const unknown = classify({ file: "missing.config.ts" });
    expect(unknown.query_compilation.query_mode).toBe("signal_empty");

    const strictCard = classify({
      file: "src/auth.ts",
      cards: [card("auth-card", ["src/Auth.ts"])],
    });
    expect(strictCard.query_compilation.query_mode).toBe("signal_empty");
    expect(strictCard.query_compilation.anchors[0]!.contributing_anchors).toEqual([]);
  });
});
