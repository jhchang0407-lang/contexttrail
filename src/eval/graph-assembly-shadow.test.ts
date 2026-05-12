import { describe, expect, it } from "vitest";
import type { SourceProfile } from "../types/source-profile.js";
import {
  expandGraphAssemblySources,
  summarizeMode,
  type GraphAssemblyShadowRow,
} from "./graph-assembly-shadow.js";

const NOW = "2026-05-10T00:00:00Z";

function profile(
  source_path: string,
  p: Partial<SourceProfile> = {},
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
    token_count: 100,
    indexed_at: NOW,
    ...p,
  };
}

describe("expandGraphAssemblySources", () => {
  it("explicit mode adds explicit landing and adjacent nav siblings", () => {
    const profiles = [
      profile("docs/guide/index.md", {
        nav_section_id: "guide",
        nav_position: 1,
        is_nav_landing: true,
        nav_provenance: "explicit_config",
      }),
      profile("docs/guide/setup.md", {
        nav_section_id: "guide",
        nav_position: 2,
        nav_provenance: "explicit_config",
      }),
      profile("docs/guide/config.md", {
        nav_section_id: "guide",
        nav_position: 3,
        nav_provenance: "explicit_config",
      }),
    ];
    const out = expandGraphAssemblySources({
      mode: "top1_nav_explicit",
      seedSources: ["docs/guide/setup.md"],
      profiles,
    });
    expect(out.selectedSources).toEqual([
      "docs/guide/setup.md",
      "docs/guide/index.md",
      "docs/guide/config.md",
    ]);
  });

  it("explicit mode ignores structural README/index relationships", () => {
    const profiles = [
      profile("docs/api/README.md", {
        nav_section_id: "api",
        nav_position: 1,
        nav_provenance: "structural",
      }),
      profile("docs/api/routes.md", {
        nav_section_id: "api",
        nav_position: 2,
        nav_provenance: "structural",
      }),
    ];
    const out = expandGraphAssemblySources({
      mode: "top1_nav_explicit",
      seedSources: ["docs/api/routes.md"],
      profiles,
    });
    expect(out.selectedSources).toEqual(["docs/api/routes.md"]);
  });

  it("all mode can use structural relationships as advisory assembly context", () => {
    const profiles = [
      profile("docs/api/README.md", {
        nav_section_id: "api",
        nav_position: 1,
        nav_provenance: "structural",
      }),
      profile("docs/api/routes.md", {
        nav_section_id: "api",
        nav_position: 2,
        nav_provenance: "structural",
      }),
    ];
    const out = expandGraphAssemblySources({
      mode: "top1_nav_all",
      seedSources: ["docs/api/routes.md"],
      profiles,
    });
    expect(out.selectedSources).toEqual([
      "docs/api/routes.md",
      "docs/api/README.md",
    ]);
  });
});

describe("summarizeMode", () => {
  it("counts graph-only full-coverage gains against top3", () => {
    const rows: GraphAssemblyShadowRow[] = [
      {
        repo: "x",
        id: "case",
        requiredSources: ["docs/a.md", "docs/b.md"],
        top1Sources: ["docs/a.md"],
        top3Sources: ["docs/a.md"],
        modes: {
          top1_nav_explicit: {
            mode: "top1_nav_explicit",
            selectedSources: ["docs/a.md", "docs/b.md"],
            selectedTokens: 200,
            expansionReasons: {},
          },
          top3_nav_explicit: {
            mode: "top3_nav_explicit",
            selectedSources: ["docs/a.md"],
            selectedTokens: 100,
            expansionReasons: {},
          },
          top1_nav_all: {
            mode: "top1_nav_all",
            selectedSources: ["docs/a.md"],
            selectedTokens: 100,
            expansionReasons: {},
          },
          top3_nav_all: {
            mode: "top3_nav_all",
            selectedSources: ["docs/a.md"],
            selectedTokens: 100,
            expansionReasons: {},
          },
        },
      },
    ];
    const summary = summarizeMode("top1_nav_explicit", rows);
    expect(summary.seedFullCoverageCases).toBe(0);
    expect(summary.fullCoverageCases).toBe(1);
    expect(summary.newlyCoveredVsSeed).toBe(1);
    expect(summary.newlyCoveredVsTop3).toBe(1);
    expect(summary.avgRequiredCoverage).toBe(1);
  });
});
