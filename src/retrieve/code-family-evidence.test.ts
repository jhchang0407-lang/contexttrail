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

  it("recognizes persistence substrate companions without admitting generic storage neighbors", () => {
    const primary = facts(
      "src/store/cards.ts",
      "Card persistence layer.",
      [{ name: "upsertCard", kind: "function" }],
    );
    const schemaCompanion = facts(
      "src/store/schema.ts",
      "SQLite schema substrate for card persistence tables.",
      [{ name: "createSchema", kind: "function" }],
    );
    const chunkStorageCompanion = facts(
      "src/store/code-chunks.ts",
      "Chunk storage helpers for persisted retrieval records.",
      [{ name: "replaceCodeChunksForSource", kind: "function" }],
    );
    const unrelatedStorage = facts(
      "src/store/session-storage.ts",
      "Session storage helpers for UI preferences.",
      [{ name: "saveSessionStorage", kind: "function" }],
    );

    const query = "card persistence storage createSchema replaceCodeChunksForSource";

    const schemaEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: schemaCompanion,
    });
    const chunkEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: chunkStorageCompanion,
    });
    const unrelatedEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: unrelatedStorage,
    });

    expect(schemaEvidence.reasons).toContain("persistence_companion");
    expect(schemaEvidence.support_admissible).toBe(true);
    expect(chunkEvidence.reasons).toContain("persistence_companion");
    expect(chunkEvidence.support_admissible).toBe(true);
    expect(unrelatedEvidence.reasons).not.toContain("persistence_companion");
    expect(unrelatedEvidence.support_admissible).toBe(false);
    expect(unrelatedEvidence.first_slate_promotable).toBe(false);
  });

  it("recognizes import workflow companions from stable facts and excludes passive reports", () => {
    const primary = facts(
      "src/cli/import.ts",
      "CLI import and reindex workflow entrypoint.",
      [{ name: "runImport", kind: "function" }],
    );
    const parserCompanion = facts(
      "src/parse/chunker.ts",
      "Parser and chunker for import-time indexing.",
      [{ name: "chunkMarkdown", kind: "function" }],
    );
    const indexStorageCompanion = facts(
      "src/store/code-chunks.ts",
      "Persists code chunks for the retrieval index.",
      [{ name: "replaceCodeChunksForSource", kind: "function" }],
    );
    const passiveReport = facts(
      "src/eval/import-workflow-report.ts",
      "Report for import workflow validation metrics.",
      [{ name: "renderImportWorkflowReport", kind: "function" }],
    );

    const query = "CLI import reindex chunkMarkdown replaceCodeChunksForSource storage";

    const parserEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: parserCompanion,
    });
    const storageEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: indexStorageCompanion,
    });
    const reportEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: passiveReport,
    });

    expect(parserEvidence.reasons).toContain("import_workflow_companion");
    expect(parserEvidence.support_admissible).toBe(true);
    expect(storageEvidence.reasons).toContain("import_workflow_companion");
    expect(storageEvidence.reasons).toContain("persistence_companion");
    expect(storageEvidence.support_admissible).toBe(true);
    expect(reportEvidence.support_admissible).toBe(false);
  });

  it("treats import-time extracted-field wiring as SourceProfile carrier evidence", () => {
    const extractor = facts(
      "src/retrieve/code-fence-entities.ts",
      "Extracts code fence entities from markdown.",
      [{ name: "extractCodeFenceEntities", kind: "function" }],
    );
    const parserCarrier = facts(
      "src/parse/source-profile.ts",
      "Builds SourceProfile metadata during import.",
      [{ name: "buildSourceProfile", kind: "function" }],
    );
    const typeCarrier = facts(
      "src/types/source-profile.ts",
      "Shared SourceProfile field definitions.",
      [{ name: "SourceProfile", kind: "interface" }],
    );
    const unrelatedParser = facts(
      "src/parse/markdown.ts",
      "Generic markdown parser helpers.",
      [{ name: "parseMarkdown", kind: "function" }],
    );

    const query = "code_fence_entities import-time wiring";

    const parserEvidence = scoreCodeFamilyEvidence({
      query,
      primary: extractor,
      candidate: parserCarrier,
    });
    const typeEvidence = scoreCodeFamilyEvidence({
      query,
      primary: extractor,
      candidate: typeCarrier,
    });
    const unrelatedEvidence = scoreCodeFamilyEvidence({
      query,
      primary: extractor,
      candidate: unrelatedParser,
    });

    expect(parserEvidence.reasons).toContain("source_profile_companion");
    expect(parserEvidence.support_admissible).toBe(true);
    expect(parserEvidence.first_slate_promotable).toBe(true);
    expect(typeEvidence.reasons).toContain("source_profile_companion");
    expect(typeEvidence.support_admissible).toBe(true);
    expect(unrelatedEvidence.reasons).not.toContain("source_profile_companion");
  });

  it("recognizes retrieval-index artifact companions without repository aliases", () => {
    const primary = facts(
      "src/retrieve/index-runner.ts",
      "Builds a retrieval index for artifacts.",
      [{ name: "buildRetrievalIndex", kind: "function" }],
    );
    const artifactIndex = facts(
      "src/artifacts/index-store.ts",
      "Stores artifact index records for retrieval search.",
      [{ name: "writeArtifactIndex", kind: "function" }],
    );

    const evidence = scoreCodeFamilyEvidence({
      query: "build artifact retrieval index writeArtifactIndex search",
      primary,
      candidate: artifactIndex,
    });

    expect(evidence.families).toContain("retrieval_index");
    expect(evidence.roles).toContain("index");
    expect(evidence.reasons).toContain("query_family");
    expect(evidence.support_admissible).toBe(true);
  });

  it("does not broaden SourceProfile companion evidence to source-card files", () => {
    const primary = facts(
      "src/parse/source-profile.ts",
      "Builds SourceProfile metadata during import.",
      [{ name: "buildSourceProfile", kind: "function" }],
    );
    const sourceCard = facts(
      "src/retrieve/source-card.ts",
      "Renders source cards for retrieval context.",
      [{ name: "renderSourceCard", kind: "function" }],
    );

    const evidence = scoreCodeFamilyEvidence({
      query: "SourceProfile storage support",
      primary,
      candidate: sourceCard,
    });

    expect(evidence.families).toContain("source_card");
    expect(evidence.roles).toContain("source_card");
    expect(evidence.reasons).not.toContain("source_profile_companion");
    expect(evidence.first_slate_promotable).toBe(false);
    expect(evidence.support_admissible).toBe(false);
  });

  it("does not infer a broad generic CLI workflow family without eval lift", () => {
    const primary = facts(
      "src/commands/reset.ts",
      "CLI command that resets stale lock and run state.",
      [{ name: "resetRunState", kind: "function" }],
    );
    const manifestCompanion = facts(
      "src/runs/manifest.ts",
      "Run manifest storage for command runner artifacts.",
      [{ name: "writeRunManifest", kind: "function" }],
    );
    const validatorCompanion = facts(
      "src/policy/validator.ts",
      "Worker result validator and policy classification.",
      [{ name: "validateWorkerOutput", kind: "function" }],
    );
    const passiveReport = facts(
      "src/reports/manifest-report.ts",
      "Metrics report for manifest validation examples.",
      [{ name: "renderManifestReport", kind: "function" }],
    );

    const query = "reset command runner clears lock state and writes manifest";

    const manifestEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: manifestCompanion,
    });
    const validatorEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: validatorCompanion,
    });
    const reportEvidence = scoreCodeFamilyEvidence({
      query,
      primary,
      candidate: passiveReport,
    });

    expect(manifestEvidence.families).not.toContain("cli_workflow");
    expect(manifestEvidence.families).toEqual(
      expect.arrayContaining(["import_workflow", "persistence"]),
    );
    expect(manifestEvidence.roles).toEqual(
      expect.arrayContaining(["cli", "store"]),
    );
    expect(manifestEvidence.support_admissible).toBe(true);
    expect(manifestEvidence.first_slate_promotable).toBe(true);

    expect(validatorEvidence.families).not.toContain("cli_workflow");
    expect(validatorEvidence.support_admissible).toBe(false);
    expect(validatorEvidence.first_slate_promotable).toBe(false);

    expect(reportEvidence.support_admissible).toBe(false);
  });
});
