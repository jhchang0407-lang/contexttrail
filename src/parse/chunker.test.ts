import { describe, it, expect } from "vitest";
import { chunk } from "./chunker.js";
import { count as countTokens } from "./tokens.js";

const SOURCE_PATH = "docs/example.md";
const SOURCE_HASH = "src-hash-1";
const INDEXED_AT = "2026-05-06T00:00:00Z";

const opts = {
  source_path: SOURCE_PATH,
  source_content_hash: SOURCE_HASH,
  indexed_at: INDEXED_AT,
  target_tokens: 500,
  max_tokens: 900,
};

describe("chunker — D30 case A: small adjacent sections do not merge", () => {
  it("uses frontmatter title as a synthetic heading for headingless docs", () => {
    const md = `---\ntitle: Quick Start\n---\n\nStart with queries, mutations, and query invalidation.\n`;
    const chunks = chunk(md, {
      ...opts,
      source_path: "docs/react/quick-start.md",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.title).toBe("Quick Start");
    expect(chunks[0]!.heading_path).toEqual(["Quick Start"]);
    expect(chunks[0]!.body).toContain("queries, mutations");
  });

  it("keeps preamble under frontmatter title before later markdown headings", () => {
    const md = `---\ntitle: Installation\n---\n\nInstall React Query first.\n\n### NPM\n\nnpm i @tanstack/react-query\n`;
    const chunks = chunk(md, {
      ...opts,
      source_path: "docs/react/installation.md",
    });
    expect(chunks.map((c) => c.title)).toEqual(["Installation", "NPM"]);
    expect(chunks[0]!.heading_path).toEqual(["Installation"]);
    expect(chunks[1]!.heading_path).toEqual(["NPM"]);
    expect(chunks[0]!.body).toContain("Install React Query first");
  });

  it("falls back to filename as synthetic heading when no markdown heading exists", () => {
    const md = `A package README without a markdown heading.\n`;
    const chunks = chunk(md, {
      ...opts,
      source_path: "packages/drizzle-zod.md",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.title).toBe("drizzle-zod");
    expect(chunks[0]!.heading_path).toEqual(["drizzle-zod"]);
  });

  it("two small sections produce two chunks (one per heading)", () => {
    const md = `# Alpha\n\nshort para.\n\n# Beta\n\nanother short para.\n`;
    const chunks = chunk(md, opts);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.title).toBe("Alpha");
    expect(chunks[1]!.title).toBe("Beta");
    expect(chunks[0]!.heading_path).toEqual(["Alpha"]);
    expect(chunks[1]!.heading_path).toEqual(["Beta"]);
    expect(chunks[0]!.chunk_index).toBe(1);
    expect(chunks[0]!.chunk_count).toBe(1);
    expect(chunks[1]!.chunk_count).toBe(1);
  });

  it("D30 case B: section over max_tokens greedy-fills to target", () => {
    // Build a section with several paragraphs that together exceed max_tokens
    // when target=20 / max=30. Each paragraph ~10 tokens.
    const para = "the quick brown fox jumps over the lazy dog every morning";
    const md =
      `# Big\n\n` + Array.from({ length: 8 }, () => para).join("\n\n") + "\n";
    const chunks = chunk(md, {
      ...opts,
      target_tokens: 20,
      max_tokens: 30,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.token_count).toBeLessThanOrEqual(30);
      expect(c.chunk_count).toBe(chunks.length);
    }
    expect(chunks[0]!.chunk_index).toBe(1);
    expect(chunks[chunks.length - 1]!.chunk_index).toBe(chunks.length);
  });

  it("D30 case C: oversized atomic code block preserves and warns (under 2× max_tokens)", () => {
    // Sized so the code stays under 2× max_tokens (the forced-split threshold
    // from PRD-0036/36.2). Should preserve-and-warn as before.
    const bigCode = "const x = 1;\n".repeat(30);
    const md = `# Code\n\n\`\`\`ts\n${bigCode}\`\`\`\n`;
    const chunks = chunk(md, { ...opts, target_tokens: 50, max_tokens: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.token_count).toBeGreaterThan(100);
    expect(chunks[0]!.token_count).toBeLessThanOrEqual(200);
    expect(chunks[0]!.warnings).toBeDefined();
    expect(chunks[0]!.warnings![0]).toMatch(/kept as single chunk/);
    expect(chunks[0]!.split_part).toBeUndefined();
  });

  // PRD-0036 / 36.2 (B3): blocks past 2× max_tokens get force-split at the
  // block's natural boundary. The fastapi pilot had a 7344-token block that
  // ate ~45% of a 16k retrieval budget — this test guards that case.
  it("PRD-0036/36.2: code block past 2× max_tokens splits across ≥4 parts", () => {
    // Build a code block with ~80 lines * ~50 tokens each ≈ 4000 tokens, with
    // blank-line separators every ~5 lines so the splitter has natural boundaries.
    const codeSegment = Array.from({ length: 5 }, () =>
      "const some_meaningful_variable_name = compute_a_long_value(argument_one, argument_two);",
    ).join("\n");
    const fullCode = Array.from({ length: 16 }, () => codeSegment).join("\n\n");
    const md = `# Code\n\n\`\`\`ts\n${fullCode}\n\`\`\`\n`;
    const chunks = chunk(md, { ...opts, target_tokens: 100, max_tokens: 200 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    // All parts share the same heading_path / source_path / split_part.total.
    const total = chunks[0]!.split_part!.total;
    expect(total).toBe(chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      expect(c.heading_path).toEqual(["Code"]);
      expect(c.source_path).toBe(SOURCE_PATH);
      expect(c.split_part).toEqual({ index: i + 1, total });
      expect(c.warnings).toBeDefined();
      expect(c.warnings![0]).toMatch(/split across \d+ parts/);
    }
  });

  it("PRD-0036/36.2: list past 2× max_tokens splits at list-item boundaries", () => {
    const item = "- this is a moderately long list item that adds enough tokens to push the list past the cap.";
    const md = `# List\n\n` + Array.from({ length: 30 }, () => item).join("\n") + "\n";
    const chunks = chunk(md, { ...opts, target_tokens: 100, max_tokens: 150 });
    // List should be split — at least 2 parts, all carrying split_part.
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.split_part).toEqual({
        index: i + 1,
        total: chunks.length,
      });
      // Each part should start at a list-item boundary.
      expect(chunks[i]!.body.trimStart().startsWith("-")).toBe(true);
    }
  });

  it("PRD-0036/36.2: table past 2× max_tokens splits at row boundaries", () => {
    // Build a table with many short rows.
    const rows = Array.from(
      { length: 60 },
      (_, i) => `| name_${i} | description for row ${i} with some content |`,
    );
    const md =
      `# Tbl\n\n| col_a | col_b |\n| --- | --- |\n` + rows.join("\n") + "\n";
    const chunks = chunk(md, { ...opts, target_tokens: 100, max_tokens: 150 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.split_part).toEqual({
        index: i + 1,
        total: chunks.length,
      });
      // Every part contains at least one table row.
      expect(chunks[i]!.body).toMatch(/\|/);
    }
  });

  it("PRD-0036/36.2: between max_tokens and 2× max_tokens, block stays whole", () => {
    // Code block ~150 tokens with max_tokens=100 (1.5× max — under the 2× floor).
    const bigCode = "const x = 1;\n".repeat(40); // ~160 tokens
    const md = `# Code\n\n\`\`\`ts\n${bigCode}\`\`\`\n`;
    const chunks = chunk(md, { ...opts, target_tokens: 50, max_tokens: 100 });
    // Should NOT be split — between max and 2× max we preserve atomic-block invariant.
    const splitChunks = chunks.filter((c) => c.split_part !== undefined);
    expect(splitChunks.length).toBe(0);
    // Should have the old "kept as single chunk" warning.
    expect(chunks[0]!.warnings![0]).toMatch(/kept as single chunk/);
  });

  it("D30 case D: overlap_tokens=0; sum of chunk tokens ≈ section tokens (no duplication)", () => {
    // Distinct paragraphs; sum of chunk token_counts should equal the body's
    // tokens within tokenizer rounding (overlap would inflate sum).
    const paras = [
      "alpha alpha alpha alpha alpha alpha",
      "beta beta beta beta beta beta beta",
      "gamma gamma gamma gamma gamma gamma",
      "delta delta delta delta delta delta",
      "epsilon epsilon epsilon epsilon epsilon",
      "zeta zeta zeta zeta zeta zeta zeta zeta",
    ];
    const md = `# X\n\n` + paras.join("\n\n") + "\n";
    const chunks = chunk(md, { ...opts, target_tokens: 10, max_tokens: 14 });
    expect(chunks.length).toBeGreaterThan(1);
    const totalChunkTokens = chunks.reduce((s, c) => s + c.token_count, 0);
    // Tokens of the joined paragraphs (no headings, no overlap).
    const sectionText = paras.join("\n\n");
    const sectionTokens = countTokens(sectionText);
    // Allow small +/- a few token rounding from chunk-boundary whitespace.
    expect(Math.abs(totalChunkTokens - sectionTokens)).toBeLessThan(8);
  });

  it("identity: stable_key persists when content under heading is rewritten", () => {
    const a = chunk(`# Sec\n\nfirst body.\n`, opts);
    const b = chunk(`# Sec\n\ntotally different prose here.\n`, opts);
    expect(a[0]!.stable_key).toBe(b[0]!.stable_key);
    expect(a[0]!.version_id).not.toBe(b[0]!.version_id);
  });

  it("identity: heading rename invalidates stable_key (acceptable v1 cost)", () => {
    const a = chunk(`# Original\n\nbody.\n`, opts);
    const b = chunk(`# Renamed\n\nbody.\n`, opts);
    expect(a[0]!.stable_key).not.toBe(b[0]!.stable_key);
  });

  it("identity: inserting a heading above does not change sibling stable_keys (intra-section index)", () => {
    const before = chunk(`# A\n\na body.\n\n# B\n\nb body.\n`, opts);
    const after = chunk(
      `# Inserted\n\nnew.\n\n# A\n\na body.\n\n# B\n\nb body.\n`,
      opts,
    );
    const aBefore = before.find((c) => c.title === "A")!;
    const aAfter = after.find((c) => c.title === "A")!;
    const bBefore = before.find((c) => c.title === "B")!;
    const bAfter = after.find((c) => c.title === "B")!;
    expect(aAfter.stable_key).toBe(aBefore.stable_key);
    expect(bAfter.stable_key).toBe(bBefore.stable_key);
  });

  it("identity: reordering siblings keeps stable_keys intact", () => {
    const original = chunk(`# A\n\na.\n\n# B\n\nb.\n`, opts);
    const reordered = chunk(`# B\n\nb.\n\n# A\n\na.\n`, opts);
    const aOrig = original.find((c) => c.title === "A")!;
    const aReord = reordered.find((c) => c.title === "A")!;
    expect(aReord.stable_key).toBe(aOrig.stable_key);
  });

  it("nested headings flow into heading_path", () => {
    const md = `# A\n\nintro.\n\n## B\n\nb body.\n\n### C\n\nc body.\n`;
    const chunks = chunk(md, opts);
    // Three sections: A (with intro), A>B, A>B>C
    const titles = chunks.map((c) => c.title);
    expect(titles).toEqual(["A", "B", "C"]);
    expect(chunks[2]!.heading_path).toEqual(["A", "B", "C"]);
    expect(chunks[2]!.heading_level).toBe(3);
  });
});
