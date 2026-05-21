import { describe, expect, it } from "vitest";
import type { CodeSourceFacts } from "../types/code-source.js";
import { scoreCodeRepoFamilyEvidence } from "./code-repo-family-evidence.js";

function facts(overrides: Partial<CodeSourceFacts>): CodeSourceFacts {
  return {
    file_path: overrides.file_path ?? "src/index.ts",
    exported_symbols: overrides.exported_symbols ?? [],
    exported_signatures: overrides.exported_signatures ?? [],
    file_purpose: overrides.file_purpose ?? null,
    imports: overrides.imports ?? [],
  };
}

describe("scoreCodeRepoFamilyEvidence", () => {
  it("identifies package and basename ownership for weak Rust source prompts", () => {
    const owner = scoreCodeRepoFamilyEvidence({
      query: "crates biome configuration vcs source implementation",
      facts: facts({
        file_path: "crates/biome_configuration/src/vcs.rs",
        file_purpose: "Version control configuration.",
        exported_symbols: [{ name: "VcsConfiguration", kind: "type" }],
      }),
    });
    const neighbor = scoreCodeRepoFamilyEvidence({
      query: "crates biome configuration vcs source implementation",
      facts: facts({
        file_path: "crates/biome_analyze/src/rule.rs",
        file_purpose: "Analyzer rule registry.",
        exported_symbols: [{ name: "Rule", kind: "type" }],
      }),
    });

    expect(owner.score).toBeGreaterThan(neighbor.score);
    expect(owner.owner_admissible).toBe(true);
    expect(owner.direct_query_tokens).toEqual([
      "biome",
      "configuration",
      "vcs",
    ]);
    expect(owner.reasons).toEqual(
      expect.arrayContaining(["basename_identity", "package_identity"]),
    );
  });

  it("keeps dialect/driver identity ahead of same-package generic files", () => {
    const owner = scoreCodeRepoFamilyEvidence({
      query: "drizzle orm netlify driver index migrator source implementation",
      facts: facts({
        file_path: "drizzle-orm/src/netlify-db/driver.ts",
        file_purpose: "Netlify database driver.",
        exported_symbols: [{ name: "NetlifyDatabase", kind: "class" }],
      }),
    });
    const generic = scoreCodeRepoFamilyEvidence({
      query: "drizzle orm netlify driver index migrator source implementation",
      facts: facts({
        file_path: "drizzle-orm/src/migrator.ts",
        file_purpose: "Generic SQL migration runner.",
        exported_symbols: [{ name: "migrate", kind: "function" }],
      }),
    });

    expect(owner.score).toBeGreaterThan(generic.score);
    expect(owner.identity_tokens).toEqual(
      expect.arrayContaining(["drizzle", "netlify", "driver"]),
    );
    expect(owner.reasons).toContain("dialect_identity");
  });
});
