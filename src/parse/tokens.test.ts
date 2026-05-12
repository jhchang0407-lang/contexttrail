import { describe, it, expect } from "vitest";
import { count, makeTokenCounter } from "./tokens.js";

describe("tokenizer (cl100k_base smoke)", () => {
  it("counts non-zero tokens for non-empty text", () => {
    expect(count("hello world")).toBeGreaterThan(0);
  });

  it("returns 0 for empty string", () => {
    expect(count("")).toBe(0);
  });

  it("longer text has more tokens than shorter", () => {
    const a = count("hello");
    const b = count("hello world this is a longer sentence");
    expect(b).toBeGreaterThan(a);
  });

  it("makeTokenCounter('cl100k_base') matches default count()", () => {
    const c = makeTokenCounter("cl100k_base");
    expect(c("the quick brown fox")).toBe(count("the quick brown fox"));
  });
});
