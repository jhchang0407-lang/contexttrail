import { describe, expect, it } from "vitest";
import {
  codeQueryFacetEvidence,
  summarizeCodeCandidateEvidence,
} from "./code-candidate-evidence.js";

describe("summarizeCodeCandidateEvidence", () => {
  it("counts independent owner evidence by distinct method family per file", () => {
    const summaries = summarizeCodeCandidateEvidence([
      {
        source_path: "src/retrieve/source-rerank.ts",
        family: "chunk_text",
        role: "owner",
        target: "direct_owner",
        reason: "chunk_fts",
      },
      {
        source_path: "src/retrieve/source-rerank.ts",
        family: "source_facts",
        role: "owner",
        target: "direct_owner",
        reason: "exported_symbol",
      },
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      source_path: "src/retrieve/source-rerank.ts",
      independent_owner_evidence_count: 2,
      owner_families: ["chunk_text", "source_facts"],
    });
  });

  it("collapses duplicate owner evidence from the same method family", () => {
    const [summary] = summarizeCodeCandidateEvidence([
      {
        source_path: "src/retrieve/source-rerank.ts",
        family: "chunk_text",
        role: "owner",
        target: "direct_owner",
        reason: "chunk_fts",
      },
      {
        source_path: "src/retrieve/source-rerank.ts",
        family: "chunk_text",
        role: "owner",
        target: "direct_owner",
        reason: "chunk_fts_companion",
      },
    ]);

    expect(summary).toMatchObject({
      independent_owner_evidence_count: 1,
      owner_families: ["chunk_text"],
    });
  });

  it("separates owner and support evidence families for the same file", () => {
    const [summary] = summarizeCodeCandidateEvidence([
      {
        source_path: "src/store/cards.ts",
        family: "source_facts",
        role: "owner",
        target: "direct_owner",
        reason: "file_purpose",
      },
      {
        source_path: "src/store/cards.ts",
        family: "code_family",
        role: "support",
        target: "support_candidate",
        reason: "persistence_companion",
      },
    ]);

    expect(summary).toMatchObject({
      owner_families: ["source_facts"],
      support_families: ["code_family"],
      independent_owner_evidence_count: 1,
      independent_support_evidence_count: 1,
    });
  });

  it("summarizes passive artifact policy evidence", () => {
    const [summary] = summarizeCodeCandidateEvidence([
      {
        source_path: "examples/basic/stream.ts",
        family: "artifact_policy",
        role: "artifact_policy",
        target: "reject",
        reason: "passive_artifact",
      },
    ]);

    expect(summary).toMatchObject({
      passive_artifact: "rejected",
    });
  });

  it("normalizes query facet evidence by facet reason", () => {
    expect(
      codeQueryFacetEvidence({
        source_path: "crates/biome_configuration/src/vcs.rs",
        facet: { query: "vcs root", reason: "dotted_identity" },
      }),
    ).toMatchObject({
      family: "query_facet",
      role: "owner",
      target: "direct_owner",
      reason: "dotted_identity",
    });

    expect(
      codeQueryFacetEvidence({
        source_path: "crates/biome_css_formatter/src/css/any/keyframes_selector.rs",
        facet: { query: "css formatter", reason: "conventional_scope" },
      }),
    ).toMatchObject({
      family: "query_facet",
      role: "shadow",
      target: "shadow_only",
      reason: "conventional_scope",
    });
  });
});
