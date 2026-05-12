import { describe, it, expect } from "vitest";
import { buildSourceProfile } from "./source-profile.js";

const NOW = "2026-05-08T00:00:00Z";

function build(args: {
  source_path: string;
  source: string;
  doc_role?: "canonical" | "ideation" | "example" | "archive";
  role_source?: "frontmatter" | "config_pattern" | "default";
  chunk_count?: number;
  token_count?: number;
}) {
  return buildSourceProfile({
    source_path: args.source_path,
    source: args.source,
    source_content_hash: "h0",
    indexed_at: NOW,
    doc_role: args.doc_role ?? "canonical",
    role_source: args.role_source ?? "default",
    chunk_count: args.chunk_count ?? 1,
    token_count: args.token_count ?? 100,
  });
}

describe("buildSourceProfile - title and H1", () => {
  it("frontmatter title takes precedence over H1", () => {
    const p = build({
      source_path: "docs/foo.md",
      source: "---\ntitle: Frontmatter Title\n---\n# H1 Heading\n\nIntro paragraph.\n",
    });
    expect(p.title).toBe("Frontmatter Title");
    expect(p.h1).toBe("H1 Heading");
  });

  it("falls back to H1 when no frontmatter title", () => {
    const p = build({
      source_path: "docs/foo.md",
      source: "# Real Title\n\nIntro.\n",
    });
    expect(p.title).toBe("Real Title");
    expect(p.h1).toBe("Real Title");
  });

  it("falls back to filename when no frontmatter and no H1", () => {
    const p = build({
      source_path: "docs/foo-bar.md",
      source: "Just some prose without any heading.\n",
    });
    expect(p.title).toBe("foo-bar");
    expect(p.h1).toBeNull();
  });
});

describe("buildSourceProfile - intro and summary", () => {
  it("captures the first non-empty paragraph after the H1", () => {
    const p = build({
      source_path: "docs/concepts/foo.md",
      source: "# Topic\n\nFirst intro paragraph.\n\nSecond paragraph.\n",
    });
    expect(p.intro).toBe("First intro paragraph.");
    expect(p.summary).toContain("Topic");
    expect(p.summary).toContain("First intro paragraph.");
    expect(p.summary_source).toBe("deterministic_intro");
  });

  it("returns null intro and summary_source=empty for headingless empty doc", () => {
    const p = build({
      source_path: "docs/empty.md",
      source: "",
    });
    expect(p.intro).toBeNull();
    expect(p.summary).toBeNull();
    expect(p.summary_source).toBe("empty");
  });
});

describe("buildSourceProfile - heading outline", () => {
  it("captures headings with level, text, and slug", () => {
    const p = build({
      source_path: "docs/foo.md",
      source: "# A\n\nintro\n\n## B\n\n### C\n\n## D\n",
    });
    expect(p.heading_outline.map((h) => `${h.level}:${h.text}`)).toEqual([
      "1:A",
      "2:B",
      "3:C",
      "2:D",
    ]);
    const a = p.heading_outline[0]!;
    expect(a.slug).toBe("a");
  });
});

describe("buildSourceProfile - doc_purpose classification", () => {
  it("frontmatter doc_purpose overrides everything", () => {
    const p = build({
      source_path: "docs/anything.md",
      source: "---\ndoc_purpose: runbook\n---\n# Anything\n",
    });
    expect(p.doc_purpose).toBe("runbook");
    expect(p.purpose_source).toBe("frontmatter");
  });

  it("classifies ADR by path", () => {
    const p = build({
      source_path: "docs/adr/0007-something.md",
      source: "# ADR-0007\n\nContext.\n",
    });
    expect(p.doc_purpose).toBe("adr");
  });

  it("classifies PRD by path", () => {
    const p = build({
      source_path: "docs/prd/0010-foo.md",
      source: "# PRD-0010\n",
    });
    expect(p.doc_purpose).toBe("prd");
  });

  it("classifies runbook by path", () => {
    const p = build({
      source_path: "docs/runbooks/incident.md",
      source: "# Incident\n",
    });
    expect(p.doc_purpose).toBe("runbook");
  });

  it("classifies migration by filename", () => {
    const p = build({
      source_path: "docs/migration-guide.md",
      source: "# Upgrading from v3 to v4\n",
    });
    expect(p.doc_purpose).toBe("migration");
  });

  it("classifies changelog by filename", () => {
    const p = build({
      source_path: "CHANGELOG.md",
      source: "# Changelog\n\n## 1.0.0\n",
    });
    expect(p.doc_purpose).toBe("changelog");
  });

  it("classifies quick_start by filename", () => {
    const p = build({
      source_path: "docs/quick-start.md",
      source: "# Quick start\n",
    });
    expect(p.doc_purpose).toBe("quick_start");
  });

  it("classifies readme at repo root", () => {
    const p = build({
      source_path: "README.md",
      source: "# Project\n",
    });
    expect(p.doc_purpose).toBe("readme");
  });

  it("classifies package_readme inside packages/", () => {
    const p = build({
      source_path: "packages/foo/README.md",
      source: "# foo\n",
    });
    expect(p.doc_purpose).toBe("package_readme");
  });

  it("classifies api_reference by title shape", () => {
    const p = build({
      source_path: "docs/api/things.md",
      source: "# API Reference\n",
    });
    expect(p.doc_purpose).toBe("api_reference");
  });

  it("falls back to unknown when no rule applies", () => {
    const p = build({
      source_path: "notes/random.md",
      source: "# Random thoughts\n\nThings.\n",
    });
    expect(p.doc_purpose).toBe("unknown");
    expect(p.purpose_source).toBe("default");
  });
});

describe("buildSourceProfile - aliases", () => {
  it("extracts path, title, filename aliases", () => {
    const p = build({
      source_path: "docs/concepts/shadow-database.md",
      source: "# Shadow database\n\nIntro.\n",
    });
    const kinds = p.aliases.map((a) => a.kind);
    expect(kinds).toContain("path");
    expect(kinds).toContain("title");
    expect(kinds).toContain("filename");
    const filename = p.aliases.find((a) => a.kind === "filename");
    expect(filename?.value).toBe("shadow-database");
  });

  it("extracts heading aliases from H2/H3 headings", () => {
    const p = build({
      source_path: "docs/foo.md",
      source: "# A\n\n## generators\n\n## migrations\n",
    });
    const headings = p.aliases.filter((a) => a.kind === "heading").map((a) => a.value);
    expect(headings).toContain("generators");
    expect(headings).toContain("migrations");
  });

  it("extracts symbol aliases from frontmatter", () => {
    const p = build({
      source_path: "docs/api.md",
      source: "---\nsymbols:\n  - useQuery\n  - useMutation\n---\n# API\n",
    });
    const symbols = p.aliases.filter((a) => a.kind === "symbol").map((a) => a.value);
    expect(symbols).toEqual(expect.arrayContaining(["useQuery", "useMutation"]));
  });

  it("deduplicates aliases by (kind, value)", () => {
    const p = build({
      source_path: "docs/typescript.md",
      source: "# typescript\n\n## TypeScript\n",
    });
    const seen = new Set<string>();
    for (const a of p.aliases) {
      const key = `${a.kind}:${a.value.toLowerCase()}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("buildSourceProfile - questions_answered", () => {
  it("extracts question-shaped headings", () => {
    const p = build({
      source_path: "docs/faq.md",
      source: "# FAQ\n\n## How do I install?\n\n## Why is X slow?\n\n## Setup\n",
    });
    expect(p.questions_answered).toEqual([
      "How do I install?",
      "Why is X slow?",
    ]);
    expect(p.questions_answered_source).toBe("heading_question_extraction");
  });

  it("returns empty list and source=empty when no question-shaped headings", () => {
    const p = build({
      source_path: "docs/foo.md",
      source: "# Topic\n\n## Setup\n\n## Notes\n",
    });
    expect(p.questions_answered).toEqual([]);
    expect(p.questions_answered_source).toBe("empty");
  });
});

describe("buildSourceProfile - counts and provenance", () => {
  it("preserves chunk_count, token_count, source_content_hash, indexed_at", () => {
    const p = build({
      source_path: "docs/foo.md",
      source: "# A\n",
      chunk_count: 5,
      token_count: 1234,
    });
    expect(p.chunk_count).toBe(5);
    expect(p.token_count).toBe(1234);
    expect(p.source_content_hash).toBe("h0");
    expect(p.indexed_at).toBe(NOW);
  });
});

describe("buildSourceProfile - PRD-0024 heading_aliases", () => {
  it("populates heading_aliases from the heading outline", () => {
    const p = build({
      source_path: "docs/guide/mocking.md",
      source: "# Mocking\n\n## Module Mocking\n\n### vi.mock helpers\n",
    });
    expect(p.heading_aliases?.length).toBe(3);
    expect(p.heading_aliases?.[0]?.surface).toBe("Mocking");
    expect(p.heading_aliases?.[0]?.depth).toBe(1);
    expect(p.heading_aliases?.[0]?.section_path).toEqual([]);
    expect(p.heading_aliases?.[1]?.surface).toBe("Module Mocking");
    expect(p.heading_aliases?.[1]?.section_path).toEqual(["Mocking"]);
    expect(p.heading_aliases?.[2]?.section_path).toEqual([
      "Mocking",
      "Module Mocking",
    ]);
  });

  it("returns an empty array for documents with no headings", () => {
    const p = build({
      source_path: "docs/blank.md",
      source: "Just prose with no headings.\n",
    });
    expect(p.heading_aliases).toEqual([]);
  });
});

describe("buildSourceProfile - PRD-0024 / 24.2.2 code_fence_entities", () => {
  it("populates code_fence_entities from a TS fence (vitest-shaped)", () => {
    const p = build({
      source_path: "docs/guide/mocking.md",
      source: [
        "# Mocking",
        "",
        "```ts",
        'import { vi, describe, it } from "vitest";',
        "",
        "describe('mocking', () => {",
        "  it('mocks a module', () => {",
        "    vi.mock('./module');",
        "  });",
        "});",
        "```",
        "",
      ].join("\n"),
    });
    const symbols = (p.code_fence_entities ?? [])
      .filter((e) => e.kind === "symbol")
      .map((e) => e.value)
      .sort();
    expect(symbols).toContain("vi");
    expect(symbols).toContain("describe");
    expect(symbols).toContain("it");
    const pkgs = (p.code_fence_entities ?? [])
      .filter((e) => e.kind === "package_name")
      .map((e) => e.value);
    expect(pkgs).toContain("vitest");
  });

  it("populates code_fence_entities from a tRPC-shaped router fixture", () => {
    const p = build({
      source_path: "docs/server/routers.md",
      source: [
        "# Routers",
        "",
        "```ts",
        'import { router, publicProcedure } from "@trpc/server";',
        "",
        "export const appRouter = router({",
        "  hello: publicProcedure.query(() => 'ok'),",
        "});",
        "```",
        "",
      ].join("\n"),
    });
    const e = p.code_fence_entities ?? [];
    const symbols = e.filter((x) => x.kind === "symbol").map((x) => x.value).sort();
    expect(symbols).toContain("router");
    expect(symbols).toContain("publicProcedure");
    expect(symbols).toContain("appRouter");
    const pkgs = e.filter((x) => x.kind === "package_name").map((x) => x.value);
    expect(pkgs).toContain("@trpc/server");
  });

  it("populates code_fence_entities from a zod-shaped error-handling fixture", () => {
    const p = build({
      source_path: "docs/zod/error-handling.md",
      source: [
        "# Error handling",
        "",
        "```ts",
        'import { z, ZodError } from "zod";',
        "",
        "try {",
        "  z.object({ name: z.string() }).parse(input);",
        "} catch (err) {",
        "  if (err instanceof ZodError) console.error(err.issues);",
        "}",
        "```",
        "",
      ].join("\n"),
    });
    const symbols = (p.code_fence_entities ?? [])
      .filter((x) => x.kind === "symbol")
      .map((x) => x.value);
    expect(symbols).toContain("z");
    expect(symbols).toContain("ZodError");
  });

  it("populates code_fence_entities from a hono-shaped install + import fixture", () => {
    const p = build({
      source_path: "docs/hono/quick-start.md",
      source: [
        "# Quick start",
        "",
        "```sh",
        "npm install hono",
        "```",
        "",
        "```ts",
        'import { Hono } from "hono";',
        "const app = new Hono();",
        "```",
        "",
      ].join("\n"),
    });
    const e = p.code_fence_entities ?? [];
    const pkgs = e.filter((x) => x.kind === "package_name").map((x) => x.value);
    expect(pkgs).toContain("hono");
    const symbols = e.filter((x) => x.kind === "symbol").map((x) => x.value);
    expect(symbols).toContain("Hono");
  });

  it("populates code_fence_entities from a prisma-shaped schema-config fixture", () => {
    const p = build({
      source_path: "docs/prisma/schema.md",
      source: [
        "# Prisma schema",
        "",
        "Edit `package.json` and `tsconfig.json` to set things up.",
        "",
        "```json",
        '{ "name": "demo", "scripts": { "test": "vitest" } }',
        "```",
        "",
      ].join("\n"),
    });
    const e = p.code_fence_entities ?? [];
    const keys = e.filter((x) => x.kind === "config_key").map((x) => x.value).sort();
    expect(keys).toContain("name");
    expect(keys).toContain("scripts");
    expect(keys).toContain("test");
  });

  it("returns an empty array for documents with no fenced code", () => {
    const p = build({
      source_path: "docs/blank.md",
      source: "Just prose.\n",
    });
    expect(p.code_fence_entities).toEqual([]);
  });
});

describe("buildSourceProfile - PRD-0023 path topology fields", () => {
  function buildWithCorpus(args: {
    source_path: string;
    source: string;
    all_source_paths?: Set<string>;
  }) {
    return buildSourceProfile({
      source_path: args.source_path,
      source: args.source,
      source_content_hash: "h0",
      indexed_at: NOW,
      doc_role: "canonical",
      role_source: "default",
      chunk_count: 1,
      token_count: 100,
      all_source_paths: args.all_source_paths,
    });
  }

  it("populates path_depth from the source path", () => {
    const p = buildWithCorpus({
      source_path: "docs/guide/mocking.md",
      source: "# Mocking\n",
    });
    expect(p.path_depth).toBe(2);
  });

  it("populates is_index_file for index/readme/_index markdown leaves", () => {
    const p = buildWithCorpus({
      source_path: "docs/guide/index.md",
      source: "# Guide\n",
    });
    expect(p.is_index_file).toBe(true);
  });

  it("sets is_index_file=false for non-canonical leaves", () => {
    const p = buildWithCorpus({
      source_path: "docs/guide/mocking.md",
      source: "# Mocking\n",
    });
    expect(p.is_index_file).toBe(false);
  });

  it("populates is_section_landing using all_source_paths (case i)", () => {
    const all = new Set([
      "docs/mocking.md",
      "docs/mocking/modules.md",
    ]);
    const p = buildWithCorpus({
      source_path: "docs/mocking.md",
      source: "# Mocking\n",
      all_source_paths: all,
    });
    expect(p.is_section_landing).toBe(true);
  });

  it("leaves is_section_landing undefined when all_source_paths is missing", () => {
    const p = buildWithCorpus({
      source_path: "docs/mocking.md",
      source: "# Mocking\n",
    });
    expect(p.is_section_landing).toBeUndefined();
  });

  it("populates package_segment from path", () => {
    const p = buildWithCorpus({
      source_path: "packages/eslint-plugin/README.md",
      source: "# eslint-plugin\n",
    });
    expect(p.package_segment).toBe("eslint-plugin");
  });

  it("returns null package_segment when no marker", () => {
    const p = buildWithCorpus({
      source_path: "docs/guide/foo.md",
      source: "# Foo\n",
    });
    expect(p.package_segment).toBe(null);
  });

  it("populates version_segment from path", () => {
    const p = buildWithCorpus({
      source_path: "docs/v3/api.md",
      source: "# API\n",
    });
    expect(p.version_segment).toBe("v3");
  });

  it("returns null version_segment when no marker", () => {
    const p = buildWithCorpus({
      source_path: "docs/guide/foo.md",
      source: "# Foo\n",
    });
    expect(p.version_segment).toBe(null);
  });
});

describe("buildSourceProfile - PRD-0027 / 27.1.2 nav fields", () => {
  function buildWithNav(args: {
    source_path: string;
    source?: string;
    nav_graph?: import("./nav-parser.js").NavGraph;
  }) {
    return buildSourceProfile({
      source_path: args.source_path,
      source: args.source ?? "# Title\n",
      source_content_hash: "h0",
      indexed_at: NOW,
      doc_role: "canonical",
      role_source: "default",
      chunk_count: 1,
      token_count: 100,
      nav_graph: args.nav_graph,
    });
  }

  it("leaves all nav fields undefined when no graph is supplied", () => {
    const p = buildWithNav({ source_path: "docs/server/overview.md" });
    expect(p.nav_section_id).toBeUndefined();
    expect(p.nav_position).toBeUndefined();
    expect(p.nav_label).toBeUndefined();
    expect(p.is_nav_landing).toBeUndefined();
    expect(p.nav_origin).toBeUndefined();
    expect(p.nav_provenance).toBeUndefined();
  });

  it("populates fields from a VitePress-shaped fixture", () => {
    const p = buildWithNav({
      source_path: "docs/server/overview.md",
      nav_graph: {
        entries: [
          {
            source_path: "docs/server/overview.md",
            nav_section_id: "_server_",
            nav_position: 1,
            nav_label: "Overview",
            is_nav_landing: true,
            nav_origin: "vitepress",
            nav_provenance: "explicit_config",
          },
          {
            source_path: "docs/server/routers.md",
            nav_section_id: "_server_",
            nav_position: 2,
            nav_label: "Routers",
            is_nav_landing: false,
            nav_origin: "vitepress",
            nav_provenance: "explicit_config",
          },
        ],
      },
    });
    expect(p.nav_section_id).toBe("_server_");
    expect(p.nav_position).toBe(1);
    expect(p.nav_label).toBe("Overview");
    expect(p.is_nav_landing).toBe(true);
    expect(p.nav_origin).toBe("vitepress");
    expect(p.nav_provenance).toBe("explicit_config");
  });

  it("populates fields from a Docusaurus-shaped fixture (category label as landing nav_label)", () => {
    const p = buildWithNav({
      source_path: "docs/server/overview.md",
      nav_graph: {
        entries: [
          {
            source_path: "docs/server/overview.md",
            nav_section_id: "server",
            nav_position: 1,
            nav_label: "Server",
            is_nav_landing: true,
            nav_origin: "docusaurus_category",
            nav_provenance: "explicit_config",
          },
          {
            source_path: "docs/server/routers.md",
            nav_section_id: "server",
            nav_position: 2,
            nav_label: "routers",
            is_nav_landing: false,
            nav_origin: "docusaurus_category",
            nav_provenance: "explicit_config",
          },
        ],
      },
    });
    expect(p.nav_label).toBe("Server");
    expect(p.is_nav_landing).toBe(true);
    expect(p.nav_provenance).toBe("explicit_config");
  });

  it("populates fields from an MkDocs-shaped fixture", () => {
    const p = buildWithNav({
      source_path: "docs/guide/getting-started.md",
      nav_graph: {
        entries: [
          {
            source_path: "docs/index.md",
            nav_section_id: "root",
            nav_position: 1,
            nav_label: "Home",
            is_nav_landing: true,
            nav_origin: "mkdocs",
            nav_provenance: "explicit_config",
          },
          {
            source_path: "docs/guide/getting-started.md",
            nav_section_id: "user_guide",
            nav_position: 1,
            nav_label: "Getting Started",
            is_nav_landing: true,
            nav_origin: "mkdocs",
            nav_provenance: "explicit_config",
          },
        ],
      },
    });
    expect(p.nav_section_id).toBe("user_guide");
    expect(p.nav_label).toBe("Getting Started");
    expect(p.is_nav_landing).toBe(true);
    expect(p.nav_origin).toBe("mkdocs");
  });

  it("populates fields from a frontmatter sidebar_position fixture", () => {
    const p = buildWithNav({
      source_path: "docs/guide/x/a.md",
      source: "---\nsidebar_position: 1\nsidebar_label: A\n---\n# A\n",
      nav_graph: {
        entries: [
          {
            source_path: "docs/guide/x/a.md",
            nav_section_id: "x",
            nav_position: 1,
            nav_label: "A",
            is_nav_landing: true,
            nav_origin: "frontmatter",
            nav_provenance: "frontmatter",
          },
          {
            source_path: "docs/guide/x/b.md",
            nav_section_id: "x",
            nav_position: 2,
            nav_label: "B",
            is_nav_landing: false,
            nav_origin: "frontmatter",
            nav_provenance: "frontmatter",
          },
        ],
      },
    });
    expect(p.nav_section_id).toBe("x");
    expect(p.nav_label).toBe("A");
    expect(p.is_nav_landing).toBe(true);
    expect(p.nav_provenance).toBe("frontmatter");
  });

  it("populates fields from a README-as-section-index fixture", () => {
    const p = buildWithNav({
      source_path: "docs/server/README.md",
      source: "# Server\n",
      nav_graph: {
        entries: [
          {
            source_path: "docs/server/README.md",
            nav_section_id: "server",
            nav_position: 1,
            nav_label: "README",
            is_nav_landing: false,
            nav_origin: "readme_as_index",
            nav_provenance: "structural",
          },
          {
            source_path: "docs/server/routers.md",
            nav_section_id: "server",
            nav_position: 2,
            nav_label: "routers",
            is_nav_landing: false,
            nav_origin: "readme_as_index",
            nav_provenance: "structural",
          },
        ],
      },
    });
    expect(p.nav_label).toBe("README");
    expect(p.is_nav_landing).toBe(false);
    expect(p.nav_provenance).toBe("structural");
  });

  it("leaves fields undefined when the path is absent from the graph", () => {
    const p = buildWithNav({
      source_path: "docs/orphan.md",
      nav_graph: {
        entries: [
          {
            source_path: "docs/x.md",
            nav_section_id: "x",
            nav_position: 1,
            nav_label: "X",
            is_nav_landing: false,
          },
        ],
      },
    });
    expect(p.nav_section_id).toBeUndefined();
    expect(p.nav_label).toBeUndefined();
    expect(p.is_nav_landing).toBeUndefined();
    expect(p.nav_origin).toBeUndefined();
    expect(p.nav_provenance).toBeUndefined();
  });
});
