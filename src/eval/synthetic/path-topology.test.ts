/**
 * Synthetic property tests for path-topology extractors.
 *
 * Each rule generates 200 random inputs and certifies the property at
 * Wilson lower-95 ≥ 95%. Adversarial cases cover known-tricky shapes per
 * rule (mixed-case extensions, deep nesting, multi-conflict landings,
 * version-LIKE non-versions, etc.).
 *
 * Composition + boost-ordering tests for the source-rerank consumer
 * live in the boost-composition sections further down; the earlier
 * sections cover the extractors only.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  computePathDepth,
  detectIsIndexFile,
  detectIsSectionLanding,
  detectPackageSegment,
  detectVersionSegment,
} from "../../retrieve/path-topology.js";
import {
  PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS,
  PATH_TOPOLOGY_DEPTH_DECAY_PER_LEVEL,
  PATH_TOPOLOGY_INDEX_BOOST,
  PATH_TOPOLOGY_LANDING_BOOST,
  PATH_TOPOLOGY_PACKAGE_MATCH_BOOST,
  PATH_TOPOLOGY_VERSION_MATCH_BOOST,
  computePathTopologyBoost,
  pathTopologyBoostsEnabledFromEnv,
  scoreSourceRerank,
  tokenizeForRerank,
} from "../../retrieve/source-rerank.js";
import type { ProfileEnrichedSourceCandidate } from "../../retrieve/source-candidates.js";
import type { SourceProfile } from "../../types/source-profile.js";
import { wilson95Lower } from "./stats.js";

const PROPERTY_LOWER_95 = 0.95;
const PROPERTY_RUNS = 200;

// ──────────────────────────────────────────────────────────────────────────
// detectIsIndexFile
// ──────────────────────────────────────────────────────────────────────────

describe("detectIsIndexFile — adversarial cases", () => {
  it("recognizes canonical index basenames with markdown extensions", () => {
    expect(detectIsIndexFile("index.md")).toBe(true);
    expect(detectIsIndexFile("readme.md")).toBe(true);
    expect(detectIsIndexFile("_index.md")).toBe(true);
    expect(detectIsIndexFile("docs/guide/index.mdx")).toBe(true);
    expect(detectIsIndexFile("docs/guide/README.markdown")).toBe(true);
  });

  it("is case-insensitive on basename and extension", () => {
    expect(detectIsIndexFile("Index.md")).toBe(true);
    expect(detectIsIndexFile("README.MD")).toBe(true);
    expect(detectIsIndexFile("readme.MDX")).toBe(true);
    expect(detectIsIndexFile("_INDEX.markdown")).toBe(true);
  });

  it("rejects non-markdown extensions", () => {
    expect(detectIsIndexFile("index.txt")).toBe(false);
    expect(detectIsIndexFile("index.html")).toBe(false);
    expect(detectIsIndexFile("INDEX.html")).toBe(false);
    expect(detectIsIndexFile("readme.rst")).toBe(false);
  });

  it("rejects extensionless basenames", () => {
    expect(detectIsIndexFile("index")).toBe(false);
    expect(detectIsIndexFile("docs/readme")).toBe(false);
  });

  it("rejects non-index basenames", () => {
    expect(detectIsIndexFile("guide.md")).toBe(false);
    expect(detectIsIndexFile("docs/concepts/middleware.md")).toBe(false);
    expect(detectIsIndexFile("indexer.md")).toBe(false);
    expect(detectIsIndexFile("readmes.md")).toBe(false);
  });

  it("handles paths with multiple dots (last segment wins)", () => {
    expect(detectIsIndexFile("my.config.md")).toBe(false);
    expect(detectIsIndexFile("docs/index.draft.md")).toBe(false);
    // basename with multiple dots: 'index.draft' is not in the canonical set
  });
});

describe("detectIsIndexFile — property", () => {
  it("matches the spec on 200 random paths at lower-95 ≥ 95%", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.tuple(
          fc.constantFrom(
            "index", "Index", "INDEX",
            "readme", "Readme", "README",
            "_index", "_INDEX",
            "guide", "concepts", "middleware", "indexer", "readmes",
            "my.config", "config",
          ),
          fc.constantFrom(
            ".md", ".MD", ".mdx", ".MDX", ".markdown", ".MARKDOWN",
            ".txt", ".html", ".rst", "",
          ),
          fc.array(
            fc.constantFrom("docs", "guide", "src", "deep", "very", "section"),
            { maxLength: 4 },
          ),
        ),
        ([basename, ext, parents]) => {
          total += 1;
          const path = [...parents, `${basename}${ext}`].join("/");
          const expected =
            ["index", "readme", "_index"].includes(basename.toLowerCase()) &&
            [".md", ".mdx", ".markdown"].includes(ext.toLowerCase());
          if (detectIsIndexFile(path) === expected) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computePathDepth
// ──────────────────────────────────────────────────────────────────────────

describe("computePathDepth — adversarial cases", () => {
  it("counts directory segments under the import root", () => {
    expect(computePathDepth("mocking.md", "")).toBe(0);
    expect(computePathDepth("guide/mocking.md", "")).toBe(1);
    expect(computePathDepth("guide/mocking/modules.md", "")).toBe(2);
    expect(computePathDepth("a/b/c/d/file.md", "")).toBe(4);
  });

  it("strips a leading import_root prefix when supplied", () => {
    expect(computePathDepth("docs/guide/mocking.md", "docs")).toBe(1);
    expect(computePathDepth("docs/guide/mocking.md", "docs/")).toBe(1);
    expect(computePathDepth("/docs/guide/mocking.md", "/docs")).toBe(1);
  });

  it("normalizes leading/trailing/double slashes", () => {
    expect(computePathDepth("/guide/mocking.md", "")).toBe(1);
    expect(computePathDepth("guide//mocking.md", "")).toBe(1);
    expect(computePathDepth("//guide///mocking.md/", "")).toBe(1);
  });

  it("handles backslashes (windows-style separators)", () => {
    expect(computePathDepth("guide\\mocking.md", "")).toBe(1);
    expect(computePathDepth("a\\b\\c\\d.md", "")).toBe(3);
  });

  it("ignores . segments and counts as the parent for ..", () => {
    expect(computePathDepth("guide/./mocking.md", "")).toBe(1);
    expect(computePathDepth("./guide/mocking.md", "")).toBe(1);
  });
});

describe("computePathDepth — property", () => {
  it("matches the spec on 200 random paths at lower-95 ≥ 95%", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(
            fc.constantFrom("docs", "guide", "src", "section", "deep", "very", "really"),
            { minLength: 0, maxLength: 6 },
          ),
          fc.constantFrom("file", "index", "readme", "page", "doc"),
          fc.constantFrom(".md", ".mdx", ".markdown"),
        ),
        ([dirs, base, ext]) => {
          total += 1;
          const path = [...dirs, `${base}${ext}`].join("/");
          if (computePathDepth(path, "") === dirs.length) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// detectIsSectionLanding
// ──────────────────────────────────────────────────────────────────────────

describe("detectIsSectionLanding — case (i): Foo.md + Foo/ exists", () => {
  it("flags Foo.md when sibling Foo/ directory exists", () => {
    const all = new Set(["mocking.md", "mocking/modules.md", "mocking/api.md"]);
    expect(detectIsSectionLanding("mocking.md", all)).toBe(true);
  });

  it("does NOT flag children of Foo/ as landing", () => {
    const all = new Set(["mocking.md", "mocking/modules.md"]);
    expect(detectIsSectionLanding("mocking/modules.md", all)).toBe(false);
  });

  it("works at deeper nesting", () => {
    const all = new Set([
      "guide/concepts/mocking.md",
      "guide/concepts/mocking/modules.md",
    ]);
    expect(detectIsSectionLanding("guide/concepts/mocking.md", all)).toBe(true);
  });
});

describe("detectIsSectionLanding — case (ii): Foo/index.md alone", () => {
  it("flags Foo/index.md when parent Foo.md does not exist", () => {
    const all = new Set([
      "mocking/index.md",
      "mocking/modules.md",
    ]);
    expect(detectIsSectionLanding("mocking/index.md", all)).toBe(true);
  });

  it("recognizes README.md and _index.md alongside index.md", () => {
    const all1 = new Set(["mocking/README.md", "mocking/modules.md"]);
    expect(detectIsSectionLanding("mocking/README.md", all1)).toBe(true);
    const all2 = new Set(["mocking/_index.md", "mocking/modules.md"]);
    expect(detectIsSectionLanding("mocking/_index.md", all2)).toBe(true);
  });
});

describe("detectIsSectionLanding — case (iii): both Foo.md and Foo/index.md", () => {
  it("flags Foo.md and NOT Foo/index.md when both exist", () => {
    const all = new Set([
      "mocking.md",
      "mocking/index.md",
      "mocking/modules.md",
    ]);
    expect(detectIsSectionLanding("mocking.md", all)).toBe(true);
    expect(detectIsSectionLanding("mocking/index.md", all)).toBe(false);
  });

  it("handles multi-conflict (Foo.md + Foo/index.md + Foo/README.md)", () => {
    const all = new Set([
      "mocking.md",
      "mocking/index.md",
      "mocking/README.md",
      "mocking/modules.md",
    ]);
    expect(detectIsSectionLanding("mocking.md", all)).toBe(true);
    expect(detectIsSectionLanding("mocking/index.md", all)).toBe(false);
    expect(detectIsSectionLanding("mocking/README.md", all)).toBe(false);
  });
});

describe("detectIsSectionLanding — case (iv): child only", () => {
  it("flags nothing when only children exist (no parent .md, no index)", () => {
    const all = new Set([
      "mocking/modules.md",
      "mocking/api.md",
    ]);
    expect(detectIsSectionLanding("mocking/modules.md", all)).toBe(false);
    expect(detectIsSectionLanding("mocking/api.md", all)).toBe(false);
  });
});

describe("detectIsSectionLanding — non-canonical inputs", () => {
  it("returns false for paths whose extension is not markdown", () => {
    const all = new Set(["mocking.txt", "mocking/modules.md"]);
    expect(detectIsSectionLanding("mocking.txt", all)).toBe(false);
  });

  it("returns false for arbitrary leaf files in case (i) sibling", () => {
    const all = new Set(["foo/bar.md", "foo/baz.md", "foo.md"]);
    expect(detectIsSectionLanding("foo/bar.md", all)).toBe(false);
    expect(detectIsSectionLanding("foo/baz.md", all)).toBe(false);
  });
});

describe("detectIsSectionLanding — property", () => {
  it("matches the four-case spec on 200 random corpora at lower-95 ≥ 95%", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.tuple(
          fc.constantFrom("foo", "bar", "guide", "concepts/mocking", "src/lib/auth"),
          fc.boolean(), // parent .md exists?
          fc.boolean(), // index/readme/_index inside Foo/ exists?
          fc.constantFrom("index", "README", "_index"),
          fc.array(
            fc.constantFrom("modules", "api", "config", "advanced", "page"),
            { minLength: 0, maxLength: 3 },
          ),
        ),
        ([root, hasParent, hasIndex, indexBase, children]) => {
          total += 1;
          const all = new Set<string>();
          if (hasParent) all.add(`${root}.md`);
          if (hasIndex) all.add(`${root}/${indexBase}.md`);
          for (const c of children) all.add(`${root}/${c}.md`);
          // Case (i) requires Foo/ to actually contain something — a
          // bare Foo.md with no siblings is not a landing.
          const fooDirExists = hasIndex || children.length > 0;
          const parentLandingExpected = hasParent && fooDirExists;
          const indexLandingExpected = hasIndex && !hasParent;
          let ok = true;
          if (hasParent) {
            if (detectIsSectionLanding(`${root}.md`, all) !== parentLandingExpected) {
              ok = false;
            }
          }
          if (hasIndex) {
            if (
              detectIsSectionLanding(`${root}/${indexBase}.md`, all) !==
              indexLandingExpected
            ) {
              ok = false;
            }
          }
          for (const c of children) {
            if (detectIsSectionLanding(`${root}/${c}.md`, all) !== false) ok = false;
          }
          if (ok) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// detectPackageSegment
// ──────────────────────────────────────────────────────────────────────────

describe("detectPackageSegment — adversarial cases", () => {
  it("captures <name> from packages/<name>/", () => {
    expect(detectPackageSegment("packages/foo/README.md")).toBe("foo");
    expect(detectPackageSegment("packages/eslint-plugin/index.md")).toBe("eslint-plugin");
    expect(detectPackageSegment("docs/packages/foo/page.md")).toBe("foo");
  });

  it("captures from apps/, crates/, sdk/", () => {
    expect(detectPackageSegment("apps/web/page.md")).toBe("web");
    expect(detectPackageSegment("crates/parser/README.md")).toBe("parser");
    expect(detectPackageSegment("sdk/client/api.md")).toBe("client");
  });

  it("first-match wins on nested patterns (outer)", () => {
    expect(detectPackageSegment("packages/a/apps/b/index.md")).toBe("a");
    expect(detectPackageSegment("apps/web/packages/inner/page.md")).toBe("web");
  });

  it("returns null when no marker is present", () => {
    expect(detectPackageSegment("docs/guide/mocking.md")).toBe(null);
    expect(detectPackageSegment("readme.md")).toBe(null);
  });

  it("ignores package-LIKE substrings off segment boundaries", () => {
    expect(detectPackageSegment("my-packages/foo/page.md")).toBe(null);
    expect(detectPackageSegment("docs/sub-apps/foo.md")).toBe(null);
  });

  it("handles backslash separators", () => {
    expect(detectPackageSegment("packages\\foo\\index.md")).toBe("foo");
  });
});

describe("detectPackageSegment — property", () => {
  it("matches the spec on 200 random paths at lower-95 ≥ 95%", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(
            fc.constantFrom("docs", "guide", "subdir", "section"),
            { maxLength: 3 },
          ),
          fc.option(
            fc.tuple(
              fc.constantFrom("packages", "apps", "crates", "sdk"),
              fc.constantFrom("foo", "bar-baz", "client", "core", "eslint-plugin"),
            ),
            { nil: undefined },
          ),
          fc.array(
            fc.constantFrom("inner", "module", "lib", "x"),
            { maxLength: 2 },
          ),
          fc.constantFrom("index.md", "page.md", "README.md"),
        ),
        ([prefix, marker, suffix, leaf]) => {
          total += 1;
          const parts: string[] = [...prefix];
          const expected = marker ? marker[1] : null;
          if (marker) parts.push(marker[0], marker[1]);
          parts.push(...suffix);
          parts.push(leaf);
          const path = parts.join("/");
          if (detectPackageSegment(path) === expected) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// detectVersionSegment
// ──────────────────────────────────────────────────────────────────────────

describe("detectVersionSegment — adversarial cases", () => {
  it("captures vN and vN.x version markers", () => {
    expect(detectVersionSegment("docs/v3/index.md")).toBe("v3");
    expect(detectVersionSegment("docs/v4.x/api.md")).toBe("v4.x");
    expect(detectVersionSegment("docs/v10/page.md")).toBe("v10");
  });

  it("captures bare N.x", () => {
    expect(detectVersionSegment("docs/2.x/api.md")).toBe("2.x");
    expect(detectVersionSegment("docs/3.x/index.md")).toBe("3.x");
  });

  it("captures literal markers", () => {
    expect(detectVersionSegment("docs/next/index.md")).toBe("next");
    expect(detectVersionSegment("docs/beta/index.md")).toBe("beta");
    expect(detectVersionSegment("docs/latest/index.md")).toBe("latest");
    expect(detectVersionSegment("docs/legacy/api.md")).toBe("legacy");
    expect(detectVersionSegment("docs/deprecated/page.md")).toBe("deprecated");
  });

  it("outer-segment wins on multiple markers", () => {
    expect(detectVersionSegment("docs/v3/legacy/file.md")).toBe("v3");
    expect(detectVersionSegment("docs/legacy/v2/file.md")).toBe("legacy");
  });

  it("rejects version-LIKE non-version basenames", () => {
    // 'v8engine' is not a version segment — must be on segment boundary
    expect(detectVersionSegment("docs/v8engine.md")).toBe(null);
    expect(detectVersionSegment("docs/nextgen/page.md")).toBe(null);
    expect(detectVersionSegment("docs/legacy-archive/page.md")).toBe(null);
  });

  it("rejects numeric-only segments without .x", () => {
    // A bare '42' is not a version
    expect(detectVersionSegment("docs/42/page.md")).toBe(null);
    expect(detectVersionSegment("docs/3/page.md")).toBe(null);
  });

  it("returns null when no marker is present", () => {
    expect(detectVersionSegment("docs/guide/mocking.md")).toBe(null);
    expect(detectVersionSegment("readme.md")).toBe(null);
  });
});

describe("detectVersionSegment — property", () => {
  it("matches the spec on 200 random paths at lower-95 ≥ 95%", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(
            fc.constantFrom("docs", "guide", "section", "package"),
            { maxLength: 3 },
          ),
          fc.option(
            fc.constantFrom(
              "v1", "v2", "v3", "v4.x", "v10",
              "2.x", "3.x",
              "next", "beta", "latest", "legacy", "deprecated",
            ),
            { nil: undefined },
          ),
          fc.array(
            fc.constantFrom("api", "guide", "section", "page"),
            { maxLength: 2 },
          ),
          fc.constantFrom("index.md", "page.md", "README.md"),
        ),
        ([prefix, version, suffix, leaf]) => {
          total += 1;
          const parts: string[] = [...prefix];
          if (version) parts.push(version);
          parts.push(...suffix);
          parts.push(leaf);
          const path = parts.join("/");
          // Suffix entries may include 'next', 'beta', etc. but with our pool
          // (api/guide/section/page) they don't, so version is unambiguous.
          if (detectVersionSegment(path) === (version ?? null)) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Boost composition + ordering
// ──────────────────────────────────────────────────────────────────────────

describe("computePathTopologyBoost — composition magnitudes", () => {
  it("returns 0 when profile is null", () => {
    expect(computePathTopologyBoost({ profile: null, query_tokens: [] })).toBe(0);
  });

  it("returns 0 when no topology fields are set", () => {
    expect(
      computePathTopologyBoost({
        profile: {},
        query_tokens: ["mocking"],
      }),
    ).toBe(0);
  });

  it("adds landing boost (+0.35) when is_section_landing=true", () => {
    expect(
      computePathTopologyBoost({
        profile: { is_section_landing: true },
        query_tokens: [],
      }),
    ).toBeCloseTo(PATH_TOPOLOGY_LANDING_BOOST);
  });

  it("adds index boost (+0.20) when is_index_file=true", () => {
    expect(
      computePathTopologyBoost({
        profile: { is_index_file: true },
        query_tokens: [],
      }),
    ).toBeCloseTo(PATH_TOPOLOGY_INDEX_BOOST);
  });

  it("composes landing + index to +0.55 additively", () => {
    expect(
      computePathTopologyBoost({
        profile: {
          is_section_landing: true,
          is_index_file: true,
        },
        query_tokens: [],
      }),
    ).toBeCloseTo(PATH_TOPOLOGY_LANDING_BOOST + PATH_TOPOLOGY_INDEX_BOOST);
  });

  it("adds package match boost when package_segment matches a query token", () => {
    expect(
      computePathTopologyBoost({
        profile: { package_segment: "eslint-plugin" },
        query_tokens: tokenizeForRerank("how to use eslint plugin"),
      }),
    ).toBeCloseTo(PATH_TOPOLOGY_PACKAGE_MATCH_BOOST);
  });

  it("does not add package boost when query lacks the token", () => {
    expect(
      computePathTopologyBoost({
        profile: { package_segment: "eslint-plugin" },
        query_tokens: tokenizeForRerank("mocking"),
      }),
    ).toBe(0);
  });

  it("adds version match boost when version_segment matches a query token", () => {
    expect(
      computePathTopologyBoost({
        profile: { version_segment: "v3" },
        query_tokens: tokenizeForRerank("zod v3 readme"),
      }),
    ).toBeCloseTo(PATH_TOPOLOGY_VERSION_MATCH_BOOST);
  });

  it("applies depth decay −0.05 per level beyond depth 2", () => {
    const free = PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS;
    const decay = PATH_TOPOLOGY_DEPTH_DECAY_PER_LEVEL;
    expect(
      computePathTopologyBoost({
        profile: { path_depth: free },
        query_tokens: [],
      }),
    ).toBe(0);
    expect(
      computePathTopologyBoost({
        profile: { path_depth: free + 1 },
        query_tokens: [],
      }),
    ).toBeCloseTo(-decay);
    expect(
      computePathTopologyBoost({
        profile: { path_depth: free + 4 },
        query_tokens: [],
      }),
    ).toBeCloseTo(-4 * decay);
  });

  it("composes all signals additively", () => {
    const total =
      PATH_TOPOLOGY_LANDING_BOOST +
      PATH_TOPOLOGY_INDEX_BOOST +
      PATH_TOPOLOGY_PACKAGE_MATCH_BOOST +
      PATH_TOPOLOGY_VERSION_MATCH_BOOST -
      PATH_TOPOLOGY_DEPTH_DECAY_PER_LEVEL * 2;
    expect(
      computePathTopologyBoost({
        profile: {
          is_section_landing: true,
          is_index_file: true,
          package_segment: "eslint-plugin",
          version_segment: "v3",
          path_depth: PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS + 2,
        },
        query_tokens: tokenizeForRerank("zod v3 eslint plugin readme"),
      }),
    ).toBeCloseTo(total);
  });

  it("conditional_only mode applies only query-gated boosts (package + version)", () => {
    const expected =
      PATH_TOPOLOGY_PACKAGE_MATCH_BOOST + PATH_TOPOLOGY_VERSION_MATCH_BOOST;
    expect(
      computePathTopologyBoost({
        profile: {
          is_section_landing: true,
          is_index_file: true,
          package_segment: "eslint-plugin",
          version_segment: "v3",
          path_depth: PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS + 2,
        },
        query_tokens: tokenizeForRerank("zod v3 eslint plugin readme"),
        conditional_only: true,
      }),
    ).toBeCloseTo(expected);
  });

  it("conditional_only mode emits zero when query does not mention the package or version", () => {
    expect(
      computePathTopologyBoost({
        profile: {
          is_section_landing: true,
          is_index_file: true,
          package_segment: "eslint-plugin",
          version_segment: "v3",
          path_depth: PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS + 2,
        },
        query_tokens: tokenizeForRerank("how do I write tests"),
        conditional_only: true,
      }),
    ).toBe(0);
  });
});

describe("computePathTopologyBoost — pairwise ordering property", () => {
  it("landed candidate ranks strictly higher than non-landed twin (200/200, lower-95 ≥ 95%)", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.boolean(), // is_index_file (same on both)
        fc.integer({ min: 0, max: 5 }), // path_depth (same on both)
        (sameIndex, sameDepth) => {
          total += 1;
          const landed = computePathTopologyBoost({
            profile: {
              is_section_landing: true,
              is_index_file: sameIndex,
              path_depth: sameDepth,
            },
            query_tokens: [],
          });
          const notLanded = computePathTopologyBoost({
            profile: {
              is_section_landing: false,
              is_index_file: sameIndex,
              path_depth: sameDepth,
            },
            query_tokens: [],
          });
          if (landed > notLanded) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });

  it("index candidate ranks strictly higher than non-index twin (200/200, lower-95 ≥ 95%)", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.boolean(), // is_section_landing (same on both)
        fc.integer({ min: 0, max: 5 }),
        (sameLanding, sameDepth) => {
          total += 1;
          const idx = computePathTopologyBoost({
            profile: {
              is_index_file: true,
              is_section_landing: sameLanding,
              path_depth: sameDepth,
            },
            query_tokens: [],
          });
          const notIdx = computePathTopologyBoost({
            profile: {
              is_index_file: false,
              is_section_landing: sameLanding,
              path_depth: sameDepth,
            },
            query_tokens: [],
          });
          if (idx > notIdx) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });

  it("path_depth decay: deeper candidate's score is lower by exactly −0.05 × delta (200/200)", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.integer({
          min: PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS,
          max: PATH_TOPOLOGY_DEPTH_DECAY_FREE_LEVELS + 8,
        }),
        fc.integer({ min: 1, max: 6 }),
        (baseDepth, delta) => {
          total += 1;
          const shallow = computePathTopologyBoost({
            profile: { path_depth: baseDepth },
            query_tokens: [],
          });
          const deep = computePathTopologyBoost({
            profile: { path_depth: baseDepth + delta },
            query_tokens: [],
          });
          const expectedDelta = -PATH_TOPOLOGY_DEPTH_DECAY_PER_LEVEL * delta;
          if (Math.abs(deep - shallow - expectedDelta) < 1e-9) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Feature flag wiring into scoreSourceRerank
// ──────────────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<SourceProfile> = {}): SourceProfile {
  return {
    source_path: "docs/foo.md",
    source_content_hash: "h0",
    title: "Foo",
    h1: "Foo",
    intro: "Foo intro",
    heading_outline: [{ level: 1, text: "Foo", slug: "foo" }],
    doc_role: "canonical",
    role_source: "default",
    doc_purpose: "concept",
    purpose_source: "path_rule",
    aliases: [],
    summary: null,
    summary_source: "empty",
    questions_answered: [],
    questions_answered_source: "empty",
    chunk_count: 1,
    token_count: 100,
    indexed_at: "2026-05-08T00:00:00Z",
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<ProfileEnrichedSourceCandidate> = {},
): ProfileEnrichedSourceCandidate {
  return {
    rank: 1,
    source_path: "docs/foo.md",
    best_chunk_rank: 1,
    best_chunk_score: 0.5,
    contributing_chunks: [{ version_id: "v1", rank: 1, final_score: 0.5 }],
    profile: makeProfile(),
    ...overrides,
  };
}

describe("scoreSourceRerank — RETRIEVAL_PATH_TOPOLOGY_BOOSTS flag wiring", () => {
  it("does not change the score when the flag is off", () => {
    const cand = makeCandidate({
      profile: makeProfile({
        is_section_landing: true,
        is_index_file: true,
        path_depth: 1,
      }),
    });
    const off = scoreSourceRerank({
      candidate: cand,
      query_tokens: ["foo"],
      intent: "broad_domain",
      enable_path_topology_boosts: false,
    });
    const on = scoreSourceRerank({
      candidate: cand,
      query_tokens: ["foo"],
      intent: "broad_domain",
      enable_path_topology_boosts: true,
    });
    expect(on.score - off.score).toBeCloseTo(
      PATH_TOPOLOGY_LANDING_BOOST + PATH_TOPOLOGY_INDEX_BOOST,
    );
  });

  it("default-off matches PATH_TOPOLOGY_BOOSTS_DEFAULT_ON when env unset", () => {
    const previous = process.env.RETRIEVAL_PATH_TOPOLOGY_BOOSTS;
    delete process.env.RETRIEVAL_PATH_TOPOLOGY_BOOSTS;
    try {
      // The constant exposes the default; pathTopologyBoostsEnabledFromEnv
      // returns it when the env var is unset.
      expect(pathTopologyBoostsEnabledFromEnv()).toBe(false);
    } finally {
      if (previous !== undefined) {
        process.env.RETRIEVAL_PATH_TOPOLOGY_BOOSTS = previous;
      }
    }
  });

  it("env=on enables boosts at score time", () => {
    const previous = process.env.RETRIEVAL_PATH_TOPOLOGY_BOOSTS;
    process.env.RETRIEVAL_PATH_TOPOLOGY_BOOSTS = "on";
    try {
      const cand = makeCandidate({
        profile: makeProfile({ is_section_landing: true, path_depth: 1 }),
      });
      const off = scoreSourceRerank({
        candidate: cand,
        query_tokens: ["foo"],
        intent: "broad_domain",
        enable_path_topology_boosts: false,
      });
      const envOn = scoreSourceRerank({
        candidate: cand,
        query_tokens: ["foo"],
        intent: "broad_domain",
      });
      expect(envOn.score - off.score).toBeCloseTo(PATH_TOPOLOGY_LANDING_BOOST);
    } finally {
      if (previous === undefined) delete process.env.RETRIEVAL_PATH_TOPOLOGY_BOOSTS;
      else process.env.RETRIEVAL_PATH_TOPOLOGY_BOOSTS = previous;
    }
  });
});
