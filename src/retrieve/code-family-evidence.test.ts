import { describe, expect, it } from "vitest";
import type { CodeSourceFacts } from "../types/code-source.js";
import { scoreCodeFamilyEvidence } from "./code-family-evidence.js";

function facts(
  file_path: string,
  file_purpose: string,
  exported_symbols: CodeSourceFacts["exported_symbols"] = [],
): CodeSourceFacts {
  return {
    file_path,
    file_purpose,
    exported_symbols,
    exported_signatures: exported_symbols.map(
      (symbol) => `export ${symbol.kind} ${symbol.name}`,
    ),
    imports: [],
  };
}

describe("scoreCodeFamilyEvidence", () => {
  it("recognizes SourceProfile implementation-family companions without fixture aliases", () => {
    const primary = facts(
      "src/parse/source-profile.ts",
      "Builds SourceProfile metadata during import.",
      [{ name: "buildSourceProfile", kind: "function" }],
    );
    const typeCompanion = facts(
      "src/types/source-profile.ts",
      "Shared SourceProfile type definitions.",
      [{ name: "SourceProfile", kind: "interface" }],
    );
    const schemaCompanion = facts(
      "src/store/schema.ts",
      "SQLite schema substrate for SourceProfile persistence.",
      [{ name: "createSchema", kind: "function" }],
    );
    const passiveReport = facts(
      "src/eval/source-profile-report.ts",
      "Measurement report for SourceProfile diagnostics.",
      [{ name: "renderSourceProfileReport", kind: "function" }],
    );

    const query = "SourceProfile schema buildSourceProfile";

    const typeEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: typeCompanion,
    });
    const schemaEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: schemaCompanion,
    });
    const reportEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: passiveReport,
    });

    expect(typeEvidence.families).toContain("source_profile");
    expect(typeEvidence.roles).toContain("type");
    expect(typeEvidence.first_slate_promotable).toBe(true);
    expect(typeEvidence.support_admissible).toBe(true);

    expect(schemaEvidence.families).toContain("persistence");
    expect(schemaEvidence.roles).toContain("schema");
    expect(schemaEvidence.reasons).toContain("source_profile_companion");
    expect(schemaEvidence.first_slate_promotable).toBe(true);
    expect(schemaEvidence.support_admissible).toBe(true);

    expect(reportEvidence.first_slate_promotable).toBe(false);
    expect(reportEvidence.support_admissible).toBe(false);
  });
});
