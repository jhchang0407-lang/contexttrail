import { describe, expect, it } from "vitest";
import { buildCodeQueryFacets } from "./code-query-facets.js";

describe("buildCodeQueryFacets", () => {
  it("turns dotted code identities into precise query facets", () => {
    expect(buildCodeQueryFacets("Revert docs: clarify vcs.root description")).toContainEqual({
      query: "vcs root",
      reason: "dotted_identity",
    });
  });

  it("extracts conventional commit scopes as file-identity facets", () => {
    expect(
      buildCodeQueryFacets("feat(css_formatter): format SCSS keyframes selectors"),
    ).toContainEqual({
      query: "css formatter",
      reason: "conventional_scope",
    });
  });

  it("splits code-shaped identifiers into symbol facets", () => {
    expect(
      buildCodeQueryFacets("fix noUnusedFunctionParameters diagnostic wording"),
    ).toContainEqual({
      query: "no unused function parameters",
      reason: "code_identifier",
    });
  });
});
