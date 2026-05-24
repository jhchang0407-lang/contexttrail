import { describe, expect, it } from "vitest";
import { summarizeCodeCandidateEvidence } from "./code-candidate-evidence.js";
import { admitCodeQueryFacet } from "./code-method-admission.js";

describe("admitCodeQueryFacet", () => {
  it("admits dotted identity facets as direct owner evidence for unanchored owner discovery", () => {
    expect(
      admitCodeQueryFacet({
        facet: { query: "vcs root", reason: "dotted_identity" },
      }),
    ).toMatchObject({
      decision: "direct_owner",
      reason: "dotted_identity",
    });
  });

  it("keeps conventional-scope facets shadowed without independent evidence", () => {
    expect(
      admitCodeQueryFacet({
        facet: { query: "css formatter", reason: "conventional_scope" },
      }),
    ).toMatchObject({
      decision: "shadow_only",
      reason: "needs_independent_evidence",
    });
  });

  it("keeps code-identifier facets shadowed without independent evidence", () => {
    expect(
      admitCodeQueryFacet({
        facet: {
          query: "no unused function parameters",
          reason: "code_identifier",
        },
      }),
    ).toMatchObject({
      decision: "shadow_only",
      reason: "needs_independent_evidence",
    });
  });

  it("admits non-dotted facets only after independent method agreement", () => {
    expect(
      admitCodeQueryFacet({
        facet: { query: "css formatter", reason: "conventional_scope" },
        independent_evidence_count: 2,
      }),
    ).toMatchObject({
      decision: "direct_owner",
      reason: "independent_evidence",
    });
  });

  it("uses normalized candidate evidence for non-dotted facet admission", () => {
    const [candidateEvidence] = summarizeCodeCandidateEvidence([
      {
        source_path: "crates/biome_css_formatter/src/css/any/keyframes_selector.rs",
        family: "path_identity",
        role: "owner",
        target: "direct_owner",
        reason: "path_alignment",
      },
      {
        source_path: "crates/biome_css_formatter/src/css/any/keyframes_selector.rs",
        family: "source_facts",
        role: "owner",
        target: "direct_owner",
        reason: "file_purpose",
      },
    ]);

    expect(
      admitCodeQueryFacet({
        facet: { query: "css formatter", reason: "conventional_scope" },
        candidate_evidence: candidateEvidence,
      }),
    ).toMatchObject({
      decision: "direct_owner",
      reason: "independent_evidence",
    });
  });

  it("rejects facet promotion when explicit anchors already define the owner", () => {
    expect(
      admitCodeQueryFacet({
        facet: { query: "vcs root", reason: "dotted_identity" },
        query_anchors: { files: ["crates/biome_configuration/src/vcs.rs"] },
      }),
    ).toMatchObject({
      decision: "reject",
      reason: "explicit_anchor",
    });
  });

  it("does not treat exact-symbol intent alone as an explicit owner anchor", () => {
    expect(
      admitCodeQueryFacet({
        facet: { query: "vcs root", reason: "dotted_identity" },
        query_intent: "exact_symbol",
      }),
    ).toMatchObject({
      decision: "direct_owner",
      reason: "dotted_identity",
    });
  });
});
