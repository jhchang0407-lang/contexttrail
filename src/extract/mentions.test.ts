import { describe, it, expect } from "vitest";
import { extractIdTokens, extractMentions } from "./mentions.js";

const find = (
  results: ReturnType<typeof extractMentions>,
  pred: (r: ReturnType<typeof extractMentions>[number]) => boolean,
) => results.find(pred);

describe("D32 mention extraction — file anchors", () => {
  it("backticked path with extension+slash → high", () => {
    const out = extractMentions(
      "see `src/payments/refund.ts` for the impl",
    );
    const m = find(out, (a) => a.kind === "file" && a.value === "src/payments/refund.ts");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("high");
  });

  it("unbacked path with extension+slash → medium", () => {
    const out = extractMentions("look at src/payments/refund.ts in your editor");
    const m = find(out, (a) => a.kind === "file" && a.value === "src/payments/refund.ts");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("medium");
  });

  it("negative: prose without slash or extension is NOT a file", () => {
    const out = extractMentions("the refund service handles refunds.");
    expect(out.find((a) => a.kind === "file")).toBeUndefined();
  });
});

describe("D32 mention extraction — symbol anchors", () => {
  it("backticked PascalCase.member chain → high symbol", () => {
    const out = extractMentions("`RefundService.processRefund` is idempotent");
    const m = find(out, (a) => a.kind === "symbol" && a.value === "RefundService.processRefund");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("high");
  });

  it("backticked single PascalCase → medium symbol", () => {
    const out = extractMentions("the `RefundService` class");
    const m = find(out, (a) => a.kind === "symbol" && a.value === "RefundService");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("medium");
  });

  it("unbacked PascalCase.member chain → low symbol", () => {
    const out = extractMentions("call OrderService.cancel here");
    const m = find(out, (a) => a.kind === "symbol" && a.value === "OrderService.cancel");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("low");
  });

  it("negative: unbacked bare PascalCase is SKIPPED (collides with English)", () => {
    const out = extractMentions(
      "Refund and Order are common English words here.",
    );
    expect(out.find((a) => a.kind === "symbol" && a.value === "Refund")).toBeUndefined();
    expect(out.find((a) => a.kind === "symbol" && a.value === "Order")).toBeUndefined();
  });
});

describe("D32 mention extraction — route anchors", () => {
  it("backticked route with `:` → high route", () => {
    const out = extractMentions("call `/orders/:id/cancel` to cancel");
    const m = find(out, (a) => a.kind === "route" && a.value === "/orders/:id/cancel");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("high");
  });

  it("backticked `METHOD /path` → high route", () => {
    const out = extractMentions("hit `POST /orders/cancel` to cancel");
    const m = find(out, (a) => a.kind === "route" && /POST \/orders\/cancel/.test(a.value));
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("high");
  });

  it("negative: unbacked route is ambiguous and skipped", () => {
    const out = extractMentions("the path /a/b should not match unbacked");
    expect(out.find((a) => a.kind === "route" && a.value === "/a/b")).toBeUndefined();
  });
});

describe("D32 mention extraction — env_var anchors", () => {
  it("uppercase ≥4 chars with underscore → medium env_var", () => {
    const out = extractMentions("set STRIPE_API_KEY in env");
    const m = find(out, (a) => a.kind === "env_var" && a.value === "STRIPE_API_KEY");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("medium");
  });

  it("negative: short acronyms (API, HTTP, JSON) are NOT env_vars", () => {
    const out = extractMentions("the API uses HTTP and JSON.");
    for (const v of ["API", "HTTP", "JSON"]) {
      expect(out.find((a) => a.kind === "env_var" && a.value === v)).toBeUndefined();
    }
  });

  it("negative: uppercase-with-no-underscore is NOT env_var", () => {
    const out = extractMentions("the AUTHORIZATION header");
    expect(out.find((a) => a.kind === "env_var" && a.value === "AUTHORIZATION")).toBeUndefined();
  });
});

describe("D32 mention extraction — test anchors", () => {
  it("*.test.ts → high test", () => {
    const out = extractMentions("see refund.test.ts");
    const m = find(out, (a) => a.kind === "test" && a.value === "refund.test.ts");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("high");
  });

  it("*.spec.ts → high test", () => {
    const out = extractMentions("see `cart.spec.ts`");
    const m = find(out, (a) => a.kind === "test" && a.value === "cart.spec.ts");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("high");
  });

  it("*_test.py → high test", () => {
    const out = extractMentions("see refund_test.py for python tests");
    const m = find(out, (a) => a.kind === "test" && a.value === "refund_test.py");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("high");
  });

  it("negative: regular .ts file is NOT a test", () => {
    const out = extractMentions("see refund.ts");
    expect(out.find((a) => a.kind === "test")).toBeUndefined();
  });
});

describe("entity id extraction — extractIdTokens matrix", () => {
  const matches = (text: string) => extractIdTokens(text);

  describe("positive matrix", () => {
    it.each([
      ["claim number", "can we close out CLM-2026-0412", "CLM-2026-0412"],
      ["invoice number", "invoice INV-1042 is overdue", "INV-1042"],
      ["purchase order", "PO-88231 was approved", "PO-88231"],
      ["slash-suffixed id", "see amendment AB-12345/X for details", "AB-12345/X"],
      ["hash separator", "ticket PO#88231 in the queue", "PO#88231"],
      ["unseparated 3+ uppercase prefix", "policy INV1042 renewed", "INV1042"],
      ["longer unseparated uppercase prefix", "ref ABC12345 attached", "ABC12345"],
      ["sentence-final punctuation", "close out CLM-2026-0412.", "CLM-2026-0412"],
      ["parenthesized", "the claim (CLM-2026-0412) is open", "CLM-2026-0412"],
    ])("%s: %s → %s", (_name, text, expected) => {
      expect(matches(text)).toContain(expected);
    });
  });

  describe("negative matrix", () => {
    it.each([
      // Documented rejection: at <5 chars a letter-digit pair collides with
      // tax-form shorthand (K-1, W-2), aircraft names (B-52), chess notation;
      // it also carries only one digit, so the ≥2-digits rule rejects it
      // independently of the length rule.
      ["too short / ambiguous (K-1)", "attach the K-1 form"],
      ["too short / ambiguous (W-2)", "upload your W-2 today"],
      ["pure dashed date", "what changed on 2026-06-12"],
      ["pure slashed date", "due 06/12/2026 at noon"],
      ["semver", "upgrade to 1.2.3 first"],
      ["v-prefixed semver", "released v1.2.3 yesterday"],
      ["bare number", "order 88231 shipped"],
      ["single digit acronym (UTF-8)", "encode as UTF-8 always"],
      ["env var (underscore)", "set STRIPE_API_KEY before running"],
      ["filename", "see report-2026.pdf for numbers"],
      ["month-name date", "filed on 12-JUN-2026"],
      ["month-year", "the JUN-2026 close"],
      ["iso timestamp", "failed at 2026-06-12T10:30 UTC"],
      ["prose word + year", "targets mid-2026 delivery"],
      ["quantity compound (12-month)", "within a 12-month period"],
      ["quantity compound (30-day)", "after the 30-day notice window"],
      ["quantity compound, multi-word", "the 12-month-period rule applies"],
      ["two-letter unseparated prefix", "code PO88231 is unparsed"],
      ["leading-slash route", "GET /orders/123 returns the order"],
      ["hashtag number", "see #88231 upstream"],
      ["all letters", "the ACME-CORP entity"],
    ])("%s: %s → no ids", (_name, text) => {
      expect(matches(text)).toEqual([]);
    });

    it("rejects tokens longer than 40 chars", () => {
      const long = `AB-${"1234567890".repeat(4)}`; // 43 chars
      expect(matches(`ref ${long} here`)).toEqual([]);
    });
  });

  it("dedupes case-insensitively, first spelling wins", () => {
    expect(
      matches("CLM-2026-0412 then later clm-2026-0412 again"),
    ).toEqual(["CLM-2026-0412"]);
  });

  it("extracts multiple distinct ids in order of appearance", () => {
    expect(matches("link INV-1042 to PO-88231")).toEqual(["INV-1042", "PO-88231"]);
  });
});

describe("entity id extraction — id mentions in extractMentions", () => {
  it("prose id → medium-confidence id mention", () => {
    const out = extractMentions("Claim CLM-2026-0412 was approved last week.");
    const m = find(out, (a) => a.kind === "id" && a.value === "CLM-2026-0412");
    expect(m).toBeDefined();
    expect(m!.confidence).toBe("medium");
    expect(m!.source).toBe("bare_identifier");
  });

  it("backticked id is still extracted (raw-body scan)", () => {
    const out = extractMentions("close out `INV-1042` this sprint");
    expect(find(out, (a) => a.kind === "id" && a.value === "INV-1042")).toBeDefined();
  });

  it("negative: dates, semver, and bare numbers do not become id mentions", () => {
    const out = extractMentions(
      "released on 2026-06-12 as version 1.2.3, build 88231",
    );
    expect(out.find((a) => a.kind === "id")).toBeUndefined();
  });

  it("id extraction does not disturb existing anchor kinds", () => {
    const out = extractMentions(
      "see `src/payments/refund.ts` and claim CLM-2026-0412",
    );
    expect(
      find(out, (a) => a.kind === "file" && a.value === "src/payments/refund.ts"),
    ).toBeDefined();
    expect(find(out, (a) => a.kind === "id" && a.value === "CLM-2026-0412")).toBeDefined();
  });
});

describe("D32 mention extraction — dedupe", () => {
  it("identical mention repeated across the body is reported once at highest confidence", () => {
    const out = extractMentions(
      "first mention `RefundService` then later RefundService.processRefund and `RefundService.processRefund`",
    );
    const sym = out.filter(
      (a) => a.kind === "symbol" && a.value === "RefundService.processRefund",
    );
    expect(sym).toHaveLength(1);
    expect(sym[0]!.confidence).toBe("high");
  });
});
