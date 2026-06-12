/**
 * Synthetic property tests for the heading-alias
 * extractor.
 *
 * Each rule generates 200 random heading-outline shapes and certifies
 * the property at Wilson lower-95 ≥ 95%. Adversarial cases cover
 * known-tricky shapes per rule (markdown link syntax leftovers, code
 * spans, mixed RTL/LTR, unicode, very-long headings, empty /
 * whitespace-only headings, deep nesting, depth jumps).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { extractHeadingAliases } from "../../retrieve/heading-aliases.js";
import { tokenize } from "../../retrieve/tokenize.js";
import type { HeadingOutlineEntry, SourceProfile } from "../../types/source-profile.js";
import { scoreSourceRerank } from "../../retrieve/source-rerank.js";
import { wilson95Lower } from "./stats.js";

const PROPERTY_LOWER_95 = 0.95;
const PROPERTY_RUNS = 200;

function entry(level: number, text: string): HeadingOutlineEntry {
  return { level, text, slug: text.toLowerCase().replace(/\s+/g, "-") };
}

// ──────────────────────────────────────────────────────────────────────────
// extractHeadingAliases — adversarial cases
// ──────────────────────────────────────────────────────────────────────────

describe("extractHeadingAliases — surface preservation", () => {
  it("preserves the heading text verbatim in surface", () => {
    const aliases = extractHeadingAliases([
      entry(1, "Mocking In Vitest"),
      entry(2, "Module Mocking with vi.mock()"),
    ]);
    expect(aliases[0]?.surface).toBe("Mocking In Vitest");
    expect(aliases[1]?.surface).toBe("Module Mocking with vi.mock()");
  });

  it("preserves unicode and case in surface", () => {
    const aliases = extractHeadingAliases([
      entry(1, "日本語タイトル"),
      entry(2, "Café au lait"),
    ]);
    expect(aliases[0]?.surface).toBe("日本語タイトル");
    expect(aliases[1]?.surface).toBe("Café au lait");
  });

  it("preserves very long headings (>300 chars)", () => {
    const long = "x".repeat(350);
    const aliases = extractHeadingAliases([entry(1, long)]);
    expect(aliases[0]?.surface).toBe(long);
  });
});

describe("extractHeadingAliases — normalized form", () => {
  it("lowercases the heading", () => {
    const a = extractHeadingAliases([entry(1, "MockING In VitesT")]);
    expect(a[0]?.normalized).toBe("mocking in vitest");
  });

  it("collapses internal whitespace runs to a single space", () => {
    const a = extractHeadingAliases([entry(1, "Hello   World\t\tFoo\nBar")]);
    expect(a[0]?.normalized).toBe("hello world foo bar");
  });

  it("trims leading and trailing whitespace", () => {
    const a = extractHeadingAliases([entry(1, "  Hello World  ")]);
    expect(a[0]?.normalized).toBe("hello world");
  });
});

describe("extractHeadingAliases — empty / whitespace-only", () => {
  it("skips empty headings entirely", () => {
    const a = extractHeadingAliases([
      entry(1, ""),
      entry(1, "   "),
      entry(1, "Real heading"),
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]?.surface).toBe("Real heading");
  });
});

describe("extractHeadingAliases — tokens", () => {
  it("matches the retrieval tokenizer's output", () => {
    const a = extractHeadingAliases([entry(2, "Module Mocking with vi.mock()")]);
    expect(a[0]?.tokens).toEqual(tokenize("Module Mocking with vi.mock()"));
  });

  it("returns an empty token array when normalized text yields no tokens", () => {
    const a = extractHeadingAliases([entry(1, "—")]);
    // Punctuation-only headings normalize to non-empty but tokenize to [].
    expect(a[0]?.tokens).toEqual([]);
  });
});

describe("extractHeadingAliases — depth", () => {
  it("forwards the heading level into depth", () => {
    const a = extractHeadingAliases([
      entry(1, "Title"),
      entry(2, "Section"),
      entry(3, "Subsection"),
    ]);
    expect(a.map((x) => x.depth)).toEqual([1, 2, 3]);
  });
});

describe("extractHeadingAliases — section_path", () => {
  it("returns empty section_path for top-level (H1) headings", () => {
    const a = extractHeadingAliases([entry(1, "Foo")]);
    expect(a[0]?.section_path).toEqual([]);
  });

  it("captures the chain of strictly-shallower ancestors", () => {
    const a = extractHeadingAliases([
      entry(1, "Foo"),
      entry(2, "Bar"),
      entry(3, "Baz"),
    ]);
    expect(a[1]?.section_path).toEqual(["Foo"]);
    expect(a[2]?.section_path).toEqual(["Foo", "Bar"]);
  });

  it("pops siblings off the stack on equal-depth headings", () => {
    const a = extractHeadingAliases([
      entry(1, "Foo"),
      entry(2, "Bar"),
      entry(2, "Qux"),
    ]);
    expect(a[2]?.surface).toBe("Qux");
    expect(a[2]?.section_path).toEqual(["Foo"]);
  });

  it("pops deeper-but-equal headings on a smaller-depth jump", () => {
    const a = extractHeadingAliases([
      entry(1, "Foo"),
      entry(2, "Bar"),
      entry(3, "Baz"),
      entry(2, "Qux"),
    ]);
    expect(a[3]?.section_path).toEqual(["Foo"]);
  });

  it("handles depth jumps that skip levels (H1 → H3)", () => {
    const a = extractHeadingAliases([
      entry(1, "Foo"),
      entry(3, "Deep"),
    ]);
    // No H2 in between; ancestors are just Foo.
    expect(a[1]?.section_path).toEqual(["Foo"]);
  });

  it("handles a doc that starts at H2 (no H1)", () => {
    const a = extractHeadingAliases([
      entry(2, "Section"),
      entry(3, "Sub"),
    ]);
    expect(a[0]?.section_path).toEqual([]);
    expect(a[1]?.section_path).toEqual(["Section"]);
  });
});

describe("extractHeadingAliases — markdown / code-span residue", () => {
  it("normalizes inline code spans without backtick chars", () => {
    // The mdast extractor already strips backticks at parse time, but the
    // extractor must still handle a heading text where the original
    // backtick characters survived (e.g. a custom heading source).
    const a = extractHeadingAliases([entry(2, "Using `vi.fn()` mock helpers")]);
    expect(a[0]?.normalized).toBe("using `vi.fn()` mock helpers");
    expect(a[0]?.tokens).toContain("vi");
  });

  it("does not crash on bracket residue", () => {
    const a = extractHeadingAliases([entry(2, "[useQuery] hook")]);
    expect(a[0]?.surface).toBe("[useQuery] hook");
    expect(a[0]?.tokens).toContain("hook");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Property tests
// ──────────────────────────────────────────────────────────────────────────

describe("extractHeadingAliases — property", () => {
  it("surface is preserved verbatim on 200 random outlines (lower-95 ≥ 95%)", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 1, max: 6 }),
            fc.string({ minLength: 1, maxLength: 60 }),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        (outline) => {
          total += 1;
          const aliases = extractHeadingAliases(
            outline.map(([lvl, text]) => entry(lvl, text)),
          );
          // Every produced alias must have its surface come from the
          // input heading's text. Since empty/whitespace-only entries
          // are filtered, we walk and match in order.
          const inputTexts = outline.map(([, t]) => t).filter((t) => t.trim().length > 0);
          const aliasSurfaces = aliases.map((a) => a.surface);
          if (
            aliasSurfaces.length === inputTexts.length &&
            aliasSurfaces.every((s, i) => s === inputTexts[i])
          ) {
            passed += 1;
          }
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });

  it("normalized is lowercased + whitespace-collapsed (lower-95 ≥ 95%)", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 1, max: 6 }),
            fc.string({ minLength: 1, maxLength: 60 }),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        (outline) => {
          total += 1;
          const aliases = extractHeadingAliases(
            outline.map(([lvl, text]) => entry(lvl, text)),
          );
          const ok = aliases.every((a) => {
            const expected = a.surface.toLowerCase().replace(/\s+/g, " ").trim();
            return a.normalized === expected;
          });
          if (ok) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });

  it("tokens match the retrieval tokenizer (lower-95 ≥ 95%)", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 1, max: 6 }),
            fc.string({ minLength: 1, maxLength: 60 }),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        (outline) => {
          total += 1;
          const aliases = extractHeadingAliases(
            outline.map(([lvl, text]) => entry(lvl, text)),
          );
          const ok = aliases.every((a) => {
            const expected = tokenize(a.surface);
            if (expected.length !== a.tokens.length) return false;
            return expected.every((t, i) => t === a.tokens[i]);
          });
          if (ok) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });

  it("heading_token_coverage rises to 1.0 on phrase-substring match (flag on)", () => {
    // The lever the heading-aliases flag introduces. With the flag off, the
    // current per-token coverage governs (which can already reach 1.0
    // when query tokens overlap heading tokens). With the flag on,
    // the coverage feature ALSO recognizes a phrase-substring match
    // — important when hyphenation or casing differences fragment the
    // query in a way that token-intersect misses.
    const profile: SourceProfile = {
      source_path: "docs/guide/foo.md",
      source_content_hash: "h0",
      title: "Foo Guide",
      h1: "Foo Guide",
      intro: "Foo intro",
      heading_outline: [{ level: 2, text: "Browser Mode", slug: "browser-mode" }],
      doc_role: "canonical",
      role_source: "default",
      doc_purpose: "guide",
      purpose_source: "path_rule",
      aliases: [],
      summary: null,
      summary_source: "empty",
      questions_answered: [],
      questions_answered_source: "empty",
      chunk_count: 1,
      token_count: 100,
      indexed_at: "2026-05-08T00:00:00Z",
      heading_aliases: [
        {
          surface: "Browser Mode",
          normalized: "browser mode",
          tokens: tokenize("Browser Mode"),
          depth: 2,
          section_path: [],
        },
      ],
    };
    const previous = process.env.RETRIEVAL_HEADING_ALIASES;
    process.env.RETRIEVAL_HEADING_ALIASES = "off";
    try {
      const off = scoreSourceRerank({
        candidate: {
          rank: 1,
          source_path: profile.source_path,
          best_chunk_rank: 1,
          best_chunk_score: 0.5,
          contributing_chunks: [{ version_id: "v1", rank: 1, final_score: 0.5 }],
          profile,
        },
        // Query whose phrase appears in the alias.normalized verbatim
        // ("browser mode") AND whose tokens overlap heading tokens —
        // both modes succeed; coverage = 1.0 either way for this case.
        query_tokens: tokenize("browser mode"),
        intent: "broad_domain",
      });
      expect(off.features.heading_token_coverage).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.RETRIEVAL_HEADING_ALIASES;
      else process.env.RETRIEVAL_HEADING_ALIASES = previous;
    }

    // Query that has a noise token the heading does NOT contain. Per-token
    // coverage drops to <1; phrase-substring still finds "browser mode".
    process.env.RETRIEVAL_HEADING_ALIASES = "on";
    try {
      const on = scoreSourceRerank({
        candidate: {
          rank: 1,
          source_path: profile.source_path,
          best_chunk_rank: 1,
          best_chunk_score: 0.5,
          contributing_chunks: [{ version_id: "v1", rank: 1, final_score: 0.5 }],
          profile,
        },
        query_tokens: tokenize("browser mode unrelatednoise"),
        intent: "broad_domain",
      });
      // With the flag on AND a phrase substring match, coverage is forced to 1.0
      // even though "unrelatednoise" doesn't appear in the heading.
      expect(on.features.heading_token_coverage).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.RETRIEVAL_HEADING_ALIASES;
      else process.env.RETRIEVAL_HEADING_ALIASES = previous;
    }

    // Same query with flag off: per-token coverage is 2/3 (browser, mode hit;
    // unrelatednoise misses).
    process.env.RETRIEVAL_HEADING_ALIASES = "off";
    try {
      const off2 = scoreSourceRerank({
        candidate: {
          rank: 1,
          source_path: profile.source_path,
          best_chunk_rank: 1,
          best_chunk_score: 0.5,
          contributing_chunks: [{ version_id: "v1", rank: 1, final_score: 0.5 }],
          profile,
        },
        query_tokens: tokenize("browser mode unrelatednoise"),
        intent: "broad_domain",
      });
      expect(off2.features.heading_token_coverage).toBeLessThan(1);
    } finally {
      if (previous === undefined) delete process.env.RETRIEVAL_HEADING_ALIASES;
      else process.env.RETRIEVAL_HEADING_ALIASES = previous;
    }
  });

  it("section_path is consistent with the depth-stack rule (lower-95 ≥ 95%)", () => {
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 1, max: 5 }),
            fc.string({ minLength: 1, maxLength: 30 }),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        (outline) => {
          total += 1;
          const inputs = outline
            .map(([lvl, text]) => entry(lvl, text))
            .filter((e) => e.text.trim().length > 0);
          const aliases = extractHeadingAliases(inputs);
          // Recompute section_path independently and compare.
          const stack: { depth: number; surface: string }[] = [];
          let ok = true;
          for (let i = 0; i < inputs.length; i += 1) {
            const e = inputs[i]!;
            while (stack.length > 0 && stack[stack.length - 1]!.depth >= e.level) {
              stack.pop();
            }
            const expected = stack.map((s) => s.surface);
            const got = aliases[i]?.section_path ?? [];
            if (
              got.length !== expected.length ||
              got.some((v, j) => v !== expected[j])
            ) {
              ok = false;
              break;
            }
            stack.push({ depth: e.level, surface: e.text });
          }
          if (ok) passed += 1;
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });
});
