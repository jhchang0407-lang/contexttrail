import { describe, it, expect } from "vitest";
import { decodeChunkScope, encodeChunkScope } from "./scope-codec.js";

describe("scope codec", () => {
  it("round-trips a scope object", () => {
    const scope = {
      layer: "module" as const,
      project: "payments",
      module: "payments/refunds",
      source: { frontmatter: true },
    };
    expect(decodeChunkScope(encodeChunkScope(scope))).toEqual(scope);
  });

  it("falls back to unknown scope when the stored value is empty", () => {
    expect(decodeChunkScope(null)).toEqual({ layer: "unknown", source: {} });
  });
});
