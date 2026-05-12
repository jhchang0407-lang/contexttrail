import { describe, expect, it } from "vitest";
import { matchAnchorValue } from "./anchor-match.js";

describe("matchAnchorValue", () => {
  it("preserves exact anchor confidence", () => {
    expect(
      matchAnchorValue(
        { kind: "symbol", value: "JWTAuthMiddleware" },
        { kind: "symbol", value: "JWTAuthMiddleware", confidence: "high" },
      ),
    ).toEqual({ kind: "exact", confidence: "high" });
  });

  it("matches symbol casing differences with low confidence", () => {
    expect(
      matchAnchorValue(
        { kind: "symbol", value: "jwt" },
        { kind: "symbol", value: "JWT", confidence: "high" },
      ),
    ).toEqual({ kind: "case_insensitive", confidence: "low" });
  });

  it("matches single-token symbol form variants with low confidence", () => {
    expect(
      matchAnchorValue(
        { kind: "symbol", value: "JWT" },
        { kind: "symbol", value: "JWTAuthMiddleware_1_2", confidence: "high" },
      ),
    ).toEqual({ kind: "symbol_form_variant", confidence: "low" });
  });

  it("does not treat appended underscore suffixes as form variants", () => {
    expect(
      matchAnchorValue(
        { kind: "symbol", value: "Scheduler_1_2" },
        { kind: "symbol", value: "Scheduler_1_2_NotPresent", confidence: "high" },
      ),
    ).toBeNull();
  });

  it("does not collapse a method query to a class-level indexed anchor", () => {
    expect(
      matchAnchorValue(
        { kind: "symbol", value: "WebhookDispatcher.archive" },
        { kind: "symbol", value: "WebhookDispatcher", confidence: "high" },
      ),
    ).toBeNull();
  });

  it("keeps non-symbol anchors strict", () => {
    expect(
      matchAnchorValue(
        { kind: "file", value: "SRC/App.ts" },
        { kind: "file", value: "src/app.ts", confidence: "high" },
      ),
    ).toBeNull();
  });
});
