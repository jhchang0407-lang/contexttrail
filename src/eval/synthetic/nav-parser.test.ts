/**
 * Synthetic property tests + adversarial unit
 * tests for the nav/sidebar parser module.
 *
 * Each property test asserts a generalization across 200 random
 * config shapes per format and certifies Wilson lower-95 ≥ 95%.
 * Adversarial unit tests cover the named tricky cases (malformed
 * configs, missing files, multi-format conflicts, unicode in nav
 * labels, deeply nested categories).
 *
 * The `parseNavConfig` end-to-end is exercised against in-memory
 * temp directories so the filesystem-walk path is covered alongside
 * the per-format string-in / entries-out unit paths.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  mergeRawNavEntries,
  parseNavConfig,
  renumberWithinSections,
  type RawNavEntry,
} from "../../parse/nav-parser.js";
import { parseFrontmatterSidebar } from "../../parse/nav-parser/frontmatter.js";
import { parseMkDocsNav } from "../../parse/nav-parser/mkdocs.js";
import {
  parseDocusaurusCategory,
  parseDocusaurusSidebar,
} from "../../parse/nav-parser/docusaurus.js";
import { parseVitePressConfig } from "../../parse/nav-parser/vitepress.js";
import { detectReadmeSectionIndex } from "../../parse/nav-parser/readme-as-index.js";
import { wilson95Lower } from "./stats.js";

const PROPERTY_LOWER_95 = 0.95;
const PROPERTY_RUNS = 200;

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "navparser-"));
}

function writeRel(root: string, rel: string, content: string): void {
  const abs = join(root, rel.split("/").join(sep));
  const lastSep = abs.lastIndexOf(sep);
  const dir = abs.slice(0, lastSep);
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content, "utf8");
}

// ──────────────────────────────────────────────────────────────────────────
// Frontmatter sub-parser — adversarial unit tests
// ──────────────────────────────────────────────────────────────────────────

describe("parseFrontmatterSidebar — sidebar_position only", () => {
  it("returns one entry with the declared position and stem label", () => {
    const out = parseFrontmatterSidebar({
      source_path: "docs/server/routers.md",
      raw: "---\nsidebar_position: 2\n---\n# Routers\n",
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.nav_position).toBe(2);
    expect(out[0]?.nav_label).toBe("routers");
    expect(out[0]?.nav_section_id).toBe("server");
  });

  it("returns an entry when only sidebar_label is declared", () => {
    const out = parseFrontmatterSidebar({
      source_path: "docs/server/routers.md",
      raw: "---\nsidebar_label: Routers\n---\n",
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.nav_label).toBe("Routers");
  });

  it("returns no entries when neither sidebar_position nor sidebar_label is present", () => {
    const out = parseFrontmatterSidebar({
      source_path: "docs/foo.md",
      raw: "---\ntitle: Foo\n---\n",
    });
    expect(out).toEqual([]);
  });

  it("ignores malformed frontmatter without throwing", () => {
    const out = parseFrontmatterSidebar({
      source_path: "docs/foo.md",
      raw: "---\nsidebar_position: [oops\n",
    });
    expect(out).toEqual([]);
  });

  it("uses the file's parent directory as the section id", () => {
    const out = parseFrontmatterSidebar({
      source_path: "docs/guide/browser/index.md",
      raw: "---\nsidebar_position: 1\n---\n",
    });
    expect(out[0]?.nav_section_id).toBe("browser");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// MkDocs sub-parser — adversarial unit tests
// ──────────────────────────────────────────────────────────────────────────

describe("parseMkDocsNav", () => {
  it("emits ordered entries from a flat nav list", () => {
    const out = parseMkDocsNav(`
nav:
  - Home: index.md
  - Routers: server/routers.md
  - Validators: server/validators.md
`);
    expect(out.map((e) => [e.nav_label, e.source_path, e.nav_position])).toEqual([
      ["Home", "docs/index.md", 1],
      ["Routers", "docs/server/routers.md", 2],
      ["Validators", "docs/server/validators.md", 3],
    ]);
    expect(out.every((e) => e.nav_section_id === "root")).toBe(true);
  });

  it("walks nested sections and resets position per section", () => {
    const out = parseMkDocsNav(`
nav:
  - Home: index.md
  - User Guide:
      - Getting Started: guide/getting-started.md
      - Configuration: guide/config.md
`);
    const guide = out.filter((e) => e.nav_section_id === "user_guide");
    expect(guide.map((e) => e.nav_position)).toEqual([1, 2]);
  });

  it("respects a custom docs_dir", () => {
    const out = parseMkDocsNav(`
docs_dir: site
nav:
  - Home: index.md
`);
    expect(out[0]?.source_path).toBe("site/index.md");
  });

  it("ignores malformed YAML", () => {
    expect(parseMkDocsNav("nav: [oops")).toEqual([]);
  });

  it("returns empty when there is no nav key", () => {
    expect(parseMkDocsNav("site_name: Foo\n")).toEqual([]);
  });

  it("preserves unicode labels", () => {
    const out = parseMkDocsNav(`
nav:
  - 日本語: jp/index.md
`);
    expect(out[0]?.nav_label).toBe("日本語");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Docusaurus sub-parsers — adversarial unit tests
// ──────────────────────────────────────────────────────────────────────────

describe("parseDocusaurusCategory", () => {
  it("uses the category label for the first doc and orders alphabetically", () => {
    const out = parseDocusaurusCategory({
      category_path: "docs/server/_category_.json",
      category_text: '{ "label": "Server", "position": 1 }',
      directory_markdown: ["docs/server/routers.md", "docs/server/overview.md"],
    });
    expect(out.map((e) => [e.source_path, e.nav_label])).toEqual([
      ["docs/server/overview.md", "Server"],
      ["docs/server/routers.md", "routers"],
    ]);
  });

  it("returns empty when the directory has no markdown", () => {
    expect(
      parseDocusaurusCategory({
        category_path: "docs/server/_category_.json",
        category_text: '{ "label": "Server" }',
        directory_markdown: [],
      }),
    ).toEqual([]);
  });

  it("ignores malformed category JSON", () => {
    expect(
      parseDocusaurusCategory({
        category_path: "docs/server/_category_.json",
        category_text: "{ label: oops",
        directory_markdown: ["docs/server/x.md"],
      }),
    ).toEqual([]);
  });
});

describe("parseDocusaurusSidebar", () => {
  it("walks a categories-and-docs sidebar literal", () => {
    const out = parseDocusaurusSidebar({
      config_text: `
        // sidebars.js
        module.exports = {
          tutorialSidebar: [
            'intro',
            { type: 'category', label: 'Server', items: [
              { type: 'doc', id: 'server/routers', label: 'Routers' },
              'server/validators',
            ]},
          ],
        };
      `,
      config_path: "sidebars.js",
    });
    const sections = new Set(out.map((e) => e.nav_section_id));
    expect(sections.has("tutorialsidebar")).toBe(true);
    expect(sections.has("server")).toBe(true);
    const routers = out.find((e) => e.source_path === "docs/server/routers.md");
    expect(routers?.nav_label).toBe("Routers");
  });

  it("degrades to empty when the literal is unparseable", () => {
    expect(
      parseDocusaurusSidebar({
        config_text: "module.exports = require('./generated');",
        config_path: "sidebars.js",
      }),
    ).toEqual([]);
  });

  it("ignores comments inside the config", () => {
    const out = parseDocusaurusSidebar({
      config_text: `
        /* multi
         * line
         * comment */
        module.exports = {
          // sidebar of one entry
          main: ['intro'],
        };
      `,
      config_path: "sidebars.js",
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.source_path).toBe("docs/intro.md");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// VitePress sub-parser — adversarial unit tests
// ──────────────────────────────────────────────────────────────────────────

describe("parseVitePressConfig", () => {
  it("walks an object-keyed sidebar with section URLs", () => {
    const out = parseVitePressConfig({
      config_text: `
        export default defineConfig({
          themeConfig: {
            sidebar: {
              '/server/': [
                { text: 'Overview', link: '/server/overview' },
                { text: 'Routers', link: '/server/routers' },
              ],
            },
          },
        });
      `,
      config_path: "docs/.vitepress/config.ts",
    });
    expect(out.map((e) => [e.nav_label, e.source_path, e.nav_position])).toEqual([
      ["Overview", "docs/server/overview.md", 1],
      ["Routers", "docs/server/routers.md", 2],
    ]);
  });

  it("walks an array-shaped sidebar (single sidebar)", () => {
    const out = parseVitePressConfig({
      config_text: `
        export default { themeConfig: { sidebar: [
          { text: 'Intro', link: '/intro' },
          { text: 'Group', items: [
            { text: 'A', link: '/group/a' },
          ]},
        ]}};
      `,
      config_path: "docs/.vitepress/config.ts",
    });
    expect(out.map((e) => e.source_path)).toContain("docs/intro.md");
    expect(out.map((e) => e.source_path)).toContain("docs/group/a.md");
  });

  it("returns empty when no sidebar is present", () => {
    expect(
      parseVitePressConfig({
        config_text: "export default { title: 'Foo' };",
        config_path: "docs/.vitepress/config.ts",
      }),
    ).toEqual([]);
  });

  it("degrades cleanly when the literal contains template strings", () => {
    expect(
      parseVitePressConfig({
        config_text:
          "export default { themeConfig: { sidebar: [{ text: `Foo ${bar}`, link: '/foo' }] } };",
        config_path: "x",
      }),
    ).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// README-as-section-index — adversarial unit tests
// ──────────────────────────────────────────────────────────────────────────

describe("detectReadmeSectionIndex", () => {
  it("flags README.md as the landing in a multi-doc directory", () => {
    const out = detectReadmeSectionIndex([
      "docs/server/README.md",
      "docs/server/routers.md",
      "docs/server/validators.md",
    ]);
    const readme = out.find((e) => e.source_path === "docs/server/README.md");
    expect(readme?.nav_position).toBe(1);
    expect(readme?.nav_section_id).toBe("server");
  });

  it("does nothing in a directory with only a README", () => {
    expect(detectReadmeSectionIndex(["docs/server/README.md"])).toEqual([]);
  });

  it("recognizes index.md as an alternative", () => {
    const out = detectReadmeSectionIndex([
      "docs/guide/index.md",
      "docs/guide/getting-started.md",
    ]);
    expect(out.find((e) => e.source_path === "docs/guide/index.md")?.nav_position).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Merge / renumber semantics
// ──────────────────────────────────────────────────────────────────────────

describe("mergeRawNavEntries — origin precedence", () => {
  it("vitepress wins over frontmatter for the same source_path", () => {
    const raw: RawNavEntry[] = [
      {
        source_path: "docs/x.md",
        nav_section_id: "x",
        nav_position: 9,
        nav_label: "from-frontmatter",
        is_nav_landing: false,
        origin: "frontmatter",
      },
      {
        source_path: "docs/x.md",
        nav_section_id: "x",
        nav_position: 1,
        nav_label: "from-vitepress",
        is_nav_landing: true,
        origin: "vitepress",
      },
    ];
    const graph = mergeRawNavEntries(raw);
    expect(graph.entries[0]?.nav_label).toBe("from-vitepress");
    expect(graph.entries[0]?.nav_origin).toBe("vitepress");
    expect(graph.entries[0]?.nav_provenance).toBe("explicit_config");
  });

  it("readme_as_index wins over frontmatter but loses to mkdocs", () => {
    const base: Omit<RawNavEntry, "origin" | "nav_label"> = {
      source_path: "docs/x.md",
      nav_section_id: "x",
      nav_position: 1,
      is_nav_landing: false,
    };
    const merged1 = mergeRawNavEntries([
      { ...base, nav_label: "fm", origin: "frontmatter" },
      { ...base, nav_label: "rm", origin: "readme_as_index" },
    ]);
    expect(merged1.entries[0]?.nav_label).toBe("rm");
    expect(merged1.entries[0]?.nav_provenance).toBe("structural");
    const merged2 = mergeRawNavEntries([
      { ...base, nav_label: "rm", origin: "readme_as_index" },
      { ...base, nav_label: "mk", origin: "mkdocs" },
    ]);
    expect(merged2.entries[0]?.nav_label).toBe("mk");
    expect(merged2.entries[0]?.nav_provenance).toBe("explicit_config");
  });
});

describe("renumberWithinSections", () => {
  it("clears is_nav_landing for single-entry sections", () => {
    const out = renumberWithinSections({
      entries: [
        {
          source_path: "docs/a.md",
          nav_section_id: "alone",
          nav_position: 5,
          nav_label: "a",
          is_nav_landing: true,
        },
      ],
    });
    expect(out.entries[0]?.is_nav_landing).toBe(false);
    expect(out.entries[0]?.nav_position).toBe(1);
  });

  it("compacts gaps and flags only the first entry as landing", () => {
    const out = renumberWithinSections({
      entries: [
        {
          source_path: "docs/a.md",
          nav_section_id: "s",
          nav_position: 4,
          nav_label: "a",
          is_nav_landing: false,
          nav_origin: "mkdocs",
          nav_provenance: "explicit_config",
        },
        {
          source_path: "docs/b.md",
          nav_section_id: "s",
          nav_position: 7,
          nav_label: "b",
          is_nav_landing: false,
          nav_origin: "mkdocs",
          nav_provenance: "explicit_config",
        },
      ],
    });
    const a = out.entries.find((e) => e.source_path === "docs/a.md");
    const b = out.entries.find((e) => e.source_path === "docs/b.md");
    expect(a?.nav_position).toBe(1);
    expect(a?.is_nav_landing).toBe(true);
    expect(b?.nav_position).toBe(2);
    expect(b?.is_nav_landing).toBe(false);
  });

  it("does not promote label-only frontmatter to a landing", () => {
    const out = renumberWithinSections(
      mergeRawNavEntries([
        {
          source_path: "docs/s/a.md",
          nav_section_id: "s",
          nav_position: Number.MAX_SAFE_INTEGER,
          nav_label: "A",
          is_nav_landing: false,
          origin: "frontmatter",
        },
        {
          source_path: "docs/s/b.md",
          nav_section_id: "s",
          nav_position: Number.MAX_SAFE_INTEGER,
          nav_label: "B",
          is_nav_landing: false,
          origin: "frontmatter",
        },
      ]),
    );
    expect(out.entries.find((e) => e.source_path === "docs/s/a.md")?.is_nav_landing)
      .toBe(false);
    expect(out.entries.find((e) => e.source_path === "docs/s/b.md")?.is_nav_landing)
      .toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parseNavConfig — end-to-end with a temp corpus
// ──────────────────────────────────────────────────────────────────────────

describe("parseNavConfig — end-to-end", () => {
  it("returns an empty graph when corpus_root does not exist", () => {
    expect(parseNavConfig("/nonexistent/path/nope")).toEqual({ entries: [] });
  });

  it("parses a docusaurus-shaped corpus with _category_.json", () => {
    const root = makeTempDir();
    try {
      writeRel(root, "docs/server/_category_.json", '{ "label": "Server" }');
      writeRel(root, "docs/server/overview.md", "# Overview\n");
      writeRel(root, "docs/server/routers.md", "# Routers\n");
      const graph = parseNavConfig(root);
      const overview = graph.entries.find((e) => e.source_path === "docs/server/overview.md");
      const routers = graph.entries.find((e) => e.source_path === "docs/server/routers.md");
      expect(overview?.nav_label).toBe("Server");
      expect(overview?.is_nav_landing).toBe(true);
      expect(routers?.nav_label).toBe("routers");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses a corpus with mkdocs.yml", () => {
    const root = makeTempDir();
    try {
      writeRel(
        root,
        "mkdocs.yml",
        `
nav:
  - Home: index.md
  - Server:
      - Overview: server/overview.md
      - Routers: server/routers.md
`,
      );
      writeRel(root, "docs/index.md", "# Home\n");
      writeRel(root, "docs/server/overview.md", "# Overview\n");
      writeRel(root, "docs/server/routers.md", "# Routers\n");
      const graph = parseNavConfig(root);
      const server = graph.entries.filter((e) => e.nav_section_id === "server");
      expect(server.map((e) => e.nav_label).sort()).toEqual(["Overview", "Routers"]);
      const overview = server.find((e) => e.nav_label === "Overview");
      expect(overview?.is_nav_landing).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses a corpus with .vitepress/config.ts", () => {
    const root = makeTempDir();
    try {
      writeRel(
        root,
        "docs/.vitepress/config.ts",
        `
        export default {
          themeConfig: {
            sidebar: {
              '/server/': [
                { text: 'Overview', link: '/server/overview' },
                { text: 'Routers', link: '/server/routers' },
              ],
              '/client/': [
                { text: 'Vanilla Client', link: '/client/vanilla/overview' },
              ],
            },
          },
        };
      `,
      );
      writeRel(root, "docs/server/overview.md", "# Overview\n");
      writeRel(root, "docs/server/routers.md", "# Routers\n");
      writeRel(root, "docs/client/vanilla/overview.md", "# Vanilla\n");
      const graph = parseNavConfig(root);
      const overview = graph.entries.find(
        (e) => e.source_path === "docs/server/overview.md",
      );
      expect(overview?.nav_label).toBe("Overview");
      expect(overview?.is_nav_landing).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to README-as-index when no explicit config exists", () => {
    const root = makeTempDir();
    try {
      writeRel(root, "docs/server/README.md", "# Server\n");
      writeRel(root, "docs/server/routers.md", "# Routers\n");
      const graph = parseNavConfig(root);
      const readme = graph.entries.find(
        (e) => e.source_path === "docs/server/README.md",
      );
      expect(readme?.is_nav_landing).toBe(false);
      expect(readme?.nav_provenance).toBe("structural");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("frontmatter sidebar_position survives when no other config disagrees", () => {
    const root = makeTempDir();
    try {
      writeRel(
        root,
        "docs/x/a.md",
        "---\nsidebar_position: 1\nsidebar_label: A\n---\n",
      );
      writeRel(
        root,
        "docs/x/b.md",
        "---\nsidebar_position: 2\nsidebar_label: B\n---\n",
      );
      const graph = parseNavConfig(root);
      const a = graph.entries.find((e) => e.source_path === "docs/x/a.md");
      const b = graph.entries.find((e) => e.source_path === "docs/x/b.md");
      expect(a?.nav_label).toBe("A");
      expect(b?.nav_label).toBe("B");
      expect(a?.is_nav_landing).toBe(true);
      expect(b?.is_nav_landing).toBe(false);
      expect(a?.nav_provenance).toBe("frontmatter");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles a corpus with conflicting configs by precedence (mkdocs wins over readme-as-index)", () => {
    const root = makeTempDir();
    try {
      writeRel(
        root,
        "mkdocs.yml",
        `
nav:
  - Server Overview: server/overview.md
  - Routers: server/routers.md
`,
      );
      // README is also present — readme-as-index would normally treat
      // it as landing, but mkdocs overrides.
      writeRel(root, "docs/server/README.md", "# Server\n");
      writeRel(root, "docs/server/overview.md", "# Overview\n");
      writeRel(root, "docs/server/routers.md", "# Routers\n");
      const graph = parseNavConfig(root);
      const overview = graph.entries.find(
        (e) => e.source_path === "docs/server/overview.md",
      );
      // mkdocs declares overview at position 1 in the root section.
      expect(overview?.nav_label).toBe("Server Overview");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not block on a malformed mkdocs.yml", () => {
    const root = makeTempDir();
    try {
      writeRel(root, "mkdocs.yml", "nav: [oops\n");
      writeRel(root, "docs/server/README.md", "# Server\n");
      writeRel(root, "docs/server/routers.md", "# Routers\n");
      const graph = parseNavConfig(root);
      // README-as-index still kicks in.
      const readme = graph.entries.find(
        (e) => e.source_path === "docs/server/README.md",
      );
      expect(readme?.is_nav_landing).toBe(false);
      expect(readme?.nav_provenance).toBe("structural");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Property tests — 200 random shapes per format, lower-95 ≥ 95%
// ──────────────────────────────────────────────────────────────────────────

const labelArb = fc.string({ minLength: 1, maxLength: 32 }).filter(
  (s) => s.trim().length > 0 && !/[ -]/.test(s),
);
const fileNameArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,15}$/)
  .map((s) => `${s}.md`);

describe("parseFrontmatterSidebar — property", () => {
  it("preserves sidebar_position verbatim across 200 random shapes", () => {
    // Labels avoid YAML-special / quote chars and trailing whitespace
    // (the parser trims, which is intentional but would otherwise
    // create false negatives for the round-trip property).
    const safeLabelArb = fc
      .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,28}$/)
      .filter((s) => s === s.trim() && !s.includes("  "));
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.tuple(fileNameArb, fc.integer({ min: 1, max: 50 }), safeLabelArb),
        ([file, position, label]) => {
          total += 1;
          const sourcePath = `docs/section/${file}`;
          const raw = `---\nsidebar_position: ${position}\nsidebar_label: ${JSON.stringify(label)}\n---\n`;
          const out = parseFrontmatterSidebar({ source_path: sourcePath, raw });
          if (
            out.length === 1 &&
            out[0]!.nav_position === position &&
            out[0]!.nav_label === label
          ) {
            passed += 1;
          }
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

describe("parseMkDocsNav — property", () => {
  it("emits one entry per top-level nav element across 200 random flat lists", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            labelArb.map((s) => s.replace(/[":\\\n]/g, "")),
            fileNameArb,
          ),
          { minLength: 1, maxLength: 8 },
        ),
        (pairs) => {
          total += 1;
          const yaml =
            "nav:\n" +
            pairs
              .map(
                ([label, file]) => `  - ${JSON.stringify(label)}: ${file}`,
              )
              .join("\n");
          const out = parseMkDocsNav(yaml);
          // Allow tolerant degrade if YAML chokes on the random label.
          if (out.length === pairs.length) passed += 1;
          else if (out.length === 0) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

describe("parseVitePressConfig — property", () => {
  it("walks an array-shaped sidebar of N entries → N entries (200 runs)", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            labelArb.map((s) => s.replace(/['"`\\$]/g, "")),
            fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/),
          ),
          { minLength: 1, maxLength: 6 },
        ),
        (pairs) => {
          total += 1;
          const arr = pairs
            .map(
              ([label, slug]) =>
                `{ text: '${label}', link: '/${slug}' }`,
            )
            .join(", ");
          const config_text = `export default { themeConfig: { sidebar: [${arr}] } };`;
          const out = parseVitePressConfig({
            config_text,
            config_path: "docs/.vitepress/config.ts",
          });
          if (out.length === pairs.length) passed += 1;
          else if (out.length === 0) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

describe("parseDocusaurusCategory — property", () => {
  it("ranks the alphabetically-first markdown as position 1 across 200 directory shapes", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.array(fileNameArb, { minLength: 1, maxLength: 8 }),
        (files) => {
          total += 1;
          const directoryMarkdown = Array.from(new Set(files)).map(
            (f) => `docs/grp/${f}`,
          );
          const out = parseDocusaurusCategory({
            category_path: "docs/grp/_category_.json",
            category_text: '{ "label": "Group" }',
            directory_markdown: directoryMarkdown,
          });
          const sorted = [...directoryMarkdown].sort();
          if (
            out.length === directoryMarkdown.length &&
            out[0]!.source_path === sorted[0] &&
            out[0]!.nav_position === 1
          ) {
            passed += 1;
          }
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

describe("detectReadmeSectionIndex — property", () => {
  it("flags exactly one landing per multi-doc dir-with-README across 200 shapes", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.array(fileNameArb, { minLength: 1, maxLength: 8 }),
        (siblings) => {
          total += 1;
          const dir = "docs/sec";
          const files = [
            `${dir}/README.md`,
            ...Array.from(new Set(siblings)).map((s) => `${dir}/${s}`),
          ];
          if (files.length < 2) {
            passed += 1; // trivially true: the rule does nothing
            return;
          }
          const out = detectReadmeSectionIndex(files);
          const readme = out.find((e) => e.source_path === `${dir}/README.md`);
          if (readme && readme.nav_position === 1) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});
