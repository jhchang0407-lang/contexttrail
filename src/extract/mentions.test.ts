import { describe, it, expect } from "vitest";
import { extractMentions } from "./mentions.js";

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
