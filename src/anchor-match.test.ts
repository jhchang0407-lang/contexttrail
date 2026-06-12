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

  describe("id anchors — exact with case-fold only", () => {
    it("exact id match preserves indexed confidence", () => {
      expect(
        matchAnchorValue(
          { kind: "id", value: "CLM-2026-0412" },
          { kind: "id", value: "CLM-2026-0412", confidence: "medium" },
        ),
      ).toEqual({ kind: "exact", confidence: "medium" });
    });

    it("case-folded id match keeps indexed confidence (case is presentation, not signal)", () => {
      expect(
        matchAnchorValue(
          { kind: "id", value: "clm-2026-0412" },
          { kind: "id", value: "CLM-2026-0412", confidence: "medium" },
        ),
      ).toEqual({ kind: "case_insensitive", confidence: "medium" });
    });

    it("does NOT normalize separators: dash vs slash vs none stay distinct", () => {
      for (const variant of ["CLM/2026/0412", "CLM20260412", "CLM-2026-412"]) {
        expect(
          matchAnchorValue(
            { kind: "id", value: variant },
            { kind: "id", value: "CLM-2026-0412", confidence: "medium" },
          ),
        ).toBeNull();
      }
    });

    it("does NOT prefix-match ids the way symbols do", () => {
      expect(
        matchAnchorValue(
          { kind: "id", value: "CLM-2026" },
          { kind: "id", value: "CLM-2026-0412", confidence: "medium" },
        ),
      ).toBeNull();
    });

    it("id query never binds to a different anchor kind", () => {
      expect(
        matchAnchorValue(
          { kind: "id", value: "INV-1042" },
          { kind: "symbol", value: "INV-1042", confidence: "high" },
        ),
      ).toBeNull();
    });
  });
});
