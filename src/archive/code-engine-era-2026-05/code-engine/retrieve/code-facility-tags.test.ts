import { describe, expect, it } from "vitest";
import type { CodeSourceFacts } from "../types/code-source.js";
import {
  inferCodeFacilityQueryIntents,
  inferCodeFacilityTags,
  scoreCodeFacilitySupport,
} from "./code-facility-tags.js";

function facts(overrides: Partial<CodeSourceFacts>): CodeSourceFacts {
  return {
    file_path: overrides.file_path ?? "src/index.ts",
    exported_symbols: overrides.exported_symbols ?? [],
    exported_signatures: overrides.exported_signatures ?? [],
    file_purpose: overrides.file_purpose ?? null,
    imports: overrides.imports ?? [],
  };
}

describe("inferCodeFacilityTags", () => {
  it("infers durable support roles from paths, symbols, and source facts", () => {
    expect(
      inferCodeFacilityTags(facts({
        file_path: "src/store/db.ts",
        file_purpose: "SQLite connection lifecycle.",
        exported_symbols: [{ name: "openDb", kind: "function" }],
      })),
    ).toContain("db_connection");

    expect(
      inferCodeFacilityTags(facts({
        file_path: "src/store/schema.ts",
        file_purpose: "Database schema definition.",
        exported_symbols: [{ name: "SCHEMA_SQL", kind: "const" }],
      })),
    ).toContain("schema_carrier");

    expect(
      inferCodeFacilityTags(facts({
        file_path: "src/cli/reindex.ts",
        file_purpose: "CLI reindex workflow entrypoint.",
        exported_symbols: [{ name: "runReindex", kind: "function" }],
      })),
    ).toEqual(expect.arrayContaining([
      "cli_entrypoint",
      "import_command",
      "migration_or_reindex",
    ]));

    expect(
      inferCodeFacilityTags(facts({
        file_path: "src/types/chunk.ts",
        file_purpose: "Shared DocChunk type and chunk status definitions.",
        exported_symbols: [{ name: "DocChunk", kind: "type" }],
      })),
    ).toContain("chunk_type_carrier");
  });

  it("recognizes SourceProfile carrier, store, and extractor facilities", () => {
    expect(
      inferCodeFacilityTags(facts({
        file_path: "src/types/source-profile.ts",
        file_purpose: "Shared SourceProfile field definitions.",
        exported_symbols: [{ name: "SourceProfile", kind: "interface" }],
      })),
    ).toContain("source_profile_type_carrier");

    expect(
      inferCodeFacilityTags(facts({
        file_path: "src/store/source-profiles.ts",
        file_purpose: "Persists SourceProfile records in storage.",
        exported_symbols: [{ name: "upsertSourceProfile", kind: "function" }],
      })),
    ).toContain("source_profile_store");

    expect(
      inferCodeFacilityTags(facts({
        file_path: "src/parse/chunk-structural-context.ts",
        file_purpose: "Extracts structural context for SourceProfile metadata.",
        exported_symbols: [{ name: "extractStructuralContext", kind: "function" }],
      })),
    ).toContain("structural_context_extractor");
  });

  it("does not infer carrier roles from imported substrate paths alone", () => {
    expect(
      inferCodeFacilityTags(facts({
        file_path: "src/retrieve/render.ts",
        file_purpose: "Renders retrieval output.",
        imports: [
          "src/store/db",
          "src/store/schema",
          "src/types/chunk",
        ],
        exported_symbols: [{ name: "renderOutput", kind: "function" }],
      })),
    ).not.toEqual(expect.arrayContaining([
      "db_connection",
      "schema_carrier",
      "chunk_type_carrier",
    ]));
  });
});

describe("inferCodeFacilityQueryIntents", () => {
  it("maps persistence and import-time wording to facility intents", () => {
    expect(
      inferCodeFacilityQueryIntents("chunk-table virtual table recreation reindex"),
    ).toContain("persistence_schema");

    expect(
      inferCodeFacilityQueryIntents(
        "SourceProfile nav-field extension import-time wiring",
      ),
    ).toEqual(expect.arrayContaining([
      "import_wiring",
      "source_profile_field",
    ]));
  });
});

describe("scoreCodeFacilitySupport", () => {
  it("admits schema and db facilities for table/reindex work when the owner carries persistence domain evidence", () => {
    const owner = facts({
      file_path: "src/retrieve/retrieve.ts",
      file_purpose: "Retrieval owner for chunk table reindex work.",
      imports: ["src/store/code-chunks"],
      exported_symbols: [{ name: "retrieve", kind: "function" }],
    });

    const schema = scoreCodeFacilitySupport({
      query: "chunk-table virtual table recreation reindex",
      seed: owner,
      candidate: facts({
        file_path: "src/store/schema.ts",
        file_purpose: "SQLite schema substrate for chunk tables.",
        exported_symbols: [{ name: "SCHEMA_SQL", kind: "const" }],
      }),
    });
    const db = scoreCodeFacilitySupport({
      query: "chunk-table virtual table recreation reindex",
      seed: owner,
      candidate: facts({
        file_path: "src/store/db.ts",
        file_purpose: "SQLite database connection lifecycle.",
        exported_symbols: [{ name: "openDb", kind: "function" }],
      }),
    });

    expect(schema).toMatchObject({
      support_admissible: true,
      facility_tags: expect.arrayContaining(["schema_carrier"]),
      query_intents: expect.arrayContaining(["persistence_schema"]),
    });
    expect(db).toMatchObject({
      support_admissible: true,
      facility_tags: expect.arrayContaining(["db_connection"]),
      query_intents: expect.arrayContaining(["persistence_schema"]),
    });
  });

  it("requires query intent plus owner-domain agreement before facility tags become support", () => {
    const owner = facts({
      file_path: "src/format/css-keyframes.ts",
      file_purpose: "CSS keyframe formatter owner.",
      exported_symbols: [{ name: "formatKeyframes", kind: "function" }],
    });
    const schema = facts({
      file_path: "src/store/schema.ts",
      file_purpose: "SQLite schema substrate.",
      exported_symbols: [{ name: "SCHEMA_SQL", kind: "const" }],
    });

    expect(
      scoreCodeFacilitySupport({
        query: "format CSS keyframes",
        seed: owner,
        candidate: schema,
      }),
    ).toMatchObject({
      support_admissible: false,
      query_intents: [],
    });

    expect(
      scoreCodeFacilitySupport({
        query: "schema table migration",
        seed: owner,
        candidate: schema,
      }),
    ).toMatchObject({
      support_admissible: false,
      facility_tags: expect.arrayContaining(["schema_carrier"]),
      query_intents: expect.arrayContaining(["persistence_schema"]),
    });
  });

  it("admits SourceProfile field substrate carriers through a narrow owner bridge", () => {
    const owner = facts({
      file_path: "src/parse/source-profile.ts",
      file_purpose: "Builds SourceProfile nav field metadata.",
      exported_symbols: [{ name: "buildSourceProfile", kind: "function" }],
    });

    expect(
      scoreCodeFacilitySupport({
        query: "SourceProfile nav-field extension import-time wiring",
        seed: owner,
        candidate: facts({
          file_path: "src/store/db.ts",
          file_purpose: "SQLite database connection lifecycle.",
          exported_symbols: [{ name: "openDb", kind: "function" }],
        }),
      }),
    ).toMatchObject({
      support_admissible: true,
      facility_tags: expect.arrayContaining(["db_connection"]),
      query_intents: expect.arrayContaining(["source_profile_field"]),
    });
  });

  it("admits chunk type carriers for chunk persistence schema work", () => {
    const owner = facts({
      file_path: "src/store/chunks.ts",
      file_purpose: "Persists doc chunks into the SQLite FTS table.",
      exported_symbols: [{ name: "upsertChunk", kind: "function" }],
    });

    expect(
      scoreCodeFacilitySupport({
        query: "FTS5 schema migration chunk reindex",
        seed: owner,
        candidate: facts({
          file_path: "src/types/chunk.ts",
          file_purpose: "Shared DocChunk type and chunk status definitions.",
          exported_symbols: [{ name: "DocChunk", kind: "type" }],
        }),
      }),
    ).toMatchObject({
      support_admissible: true,
      facility_tags: expect.arrayContaining(["chunk_type_carrier"]),
      query_intents: expect.arrayContaining(["persistence_schema"]),
    });
  });

  it("admits sparse CLI entrypoints through generic command carrier shape", () => {
    const owner = facts({
      file_path: "src/store/chunks.ts",
      file_purpose: "Persists doc chunks into the SQLite FTS table.",
      exported_symbols: [{ name: "upsertChunk", kind: "function" }],
    });

    const support = scoreCodeFacilitySupport({
      query: "chunk-table virtual table recreation reindex",
      seed: owner,
      candidate: facts({
        file_path: "src/cli/main.ts",
      }),
    });

    expect(support).toMatchObject({
      support_admissible: true,
      facility_tags: expect.arrayContaining(["cli_entrypoint"]),
      query_intents: expect.arrayContaining(["persistence_schema"]),
    });
    expect(support.score).toBeGreaterThanOrEqual(0.85);
  });

  it("admits sparse import commands for SourceProfile import-time support", () => {
    const owner = facts({
      file_path: "src/types/source-profile.ts",
      file_purpose: "Shared SourceProfile field definitions.",
      exported_symbols: [{ name: "SourceProfile", kind: "interface" }],
    });

    expect(
      scoreCodeFacilitySupport({
        query: "package_segment version_segment SourceProfile extension",
        seed: owner,
        candidate: facts({
          file_path: "src/cli/index-cmd.ts",
          exported_symbols: [{ name: "runIndex", kind: "function" }],
        }),
      }),
    ).toMatchObject({
      support_admissible: true,
      facility_tags: expect.arrayContaining(["import_command"]),
      query_intents: expect.arrayContaining(["source_profile_field"]),
    });
  });

  it("boosts collection stores as exact store carriers without import-derived tags", () => {
    const owner = facts({
      file_path: "src/retrieve/code-source-mix.ts",
      file_purpose: "Ranks BM25F structural context candidates.",
      exported_symbols: [{ name: "buildCodeRankedEntries", kind: "function" }],
    });

    const support = scoreCodeFacilitySupport({
      query: "PRD-0025 BM25F field-weight extension structural context",
      seed: owner,
      candidate: facts({
        file_path: "src/store/chunks.ts",
        exported_symbols: [{ name: "upsertChunk", kind: "function" }],
        exported_signatures: [
          "export function upsertChunk(db: Db, c: DocChunk): void",
        ],
      }),
    });

    expect(support).toMatchObject({
      support_admissible: true,
      facility_tags: expect.arrayContaining(["code_source_store"]),
    });
    expect(support.score).toBeGreaterThanOrEqual(0.85);
  });

  it("admits retrieval projection support for explicit flag-wiring owners", () => {
    const owner = facts({
      file_path: "src/retrieve/heading-aliases-flag.ts",
      file_purpose: "Feature flag for heading aliases retrieval.",
      exported_symbols: [{ name: "headingAliasesEnabled", kind: "function" }],
    });

    expect(
      scoreCodeFacilitySupport({
        query: "RETRIEVAL_HEADING_ALIASES flag flip",
        seed: owner,
        candidate: facts({
          file_path: "src/retrieve/fused-source-candidates.ts",
          file_purpose: "Builds fused source candidate projections.",
          exported_symbols: [{ name: "buildFusedSourceCandidates", kind: "function" }],
        }),
      }),
    ).toMatchObject({
      support_admissible: true,
      facility_tags: expect.arrayContaining(["retrieval_candidate_projection"]),
      query_intents: expect.arrayContaining(["flag_wiring"]),
    });
  });
});
