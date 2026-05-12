/**
 * V5.7 — query-mode classification probe.
 *
 * The real-corpus eval surfaced that ~12 of 33 remaining failures are
 * `signal_empty` over-classification: queries with valid anchors that
 * don't exact-match an indexed chunk anchor. Examples from real corpora:
 *
 *   - hono-anchored-jwt: query anchor "JWT" doesn't match chunk anchor
 *     "JWTAuthMiddleware"
 *   - vitest-anchored-cli: query anchor differs from indexed form
 *   - turborepo-anchored-globs, -boundaries
 *
 * The synthetic harness has been measuring downstream of `query_mode`
 * the entire time. This probe sits AT the classifier and measures:
 *
 *   1. exact_match — anchor matches chunk anchor verbatim → `anchored`
 *   2. no_anchors — no anchors provided → `unanchored`
 *   3. anchors_absent — anchor provided but truly absent → `signal_empty`
 *   4. case_mismatch — anchor matches except for casing → SHOULD be
 *      `anchored`, currently `signal_empty` (the leak).
 *   5. form_variant — anchor is a substring/superstring of indexed form
 *      → SHOULD be `anchored`, currently `signal_empty`.
 *   6. path_segment — query passes a file path; one of its segments
 *      matches a chunk anchor → SHOULD be `anchored` via path-component
 *      fallback, currently inconsistent.
 *
 * Pass criterion per case is set by `expected_query_mode`. Cases (4)–(6)
 * are documented as OPEN failures of the current classifier — the test
 * encodes "this is what we want" and currently flags how often we miss.
 */
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../../config/defaults.js";
import {
  compileQueryScopes,
  makeInMemoryAnchorLookup,
  type QueryMode,
} from "../../retrieve/query-scope.js";
import type { CodeAnchor, DocChunk } from "../../types/chunk.js";
import {
  generateQueryModeCases,
  type QueryModeProbeCase,
} from "./generators.js";
import { wilson95 } from "./stats.js";

const probeConfig = ConfigSchema.parse({
  code_scopes: [
    {
      id: "src-tree",
      pattern: "src/**",
      scope: { layer: "module", module_from_path_after: "src" },
    },
  ],
});

function chunk(version_id: string): DocChunk {
  return {
    stable_key: `stable-${version_id}`,
    version_id,
    source_path: `docs/${version_id}.md`,
    doc_id: `doc-${version_id}`,
    heading_path: ["Synthetic"],
    heading_level: 1,
    chunk_index: 1,
    chunk_count: 1,
    title: "Synthetic",
    body: "body",
    token_count: 10,
    chunk_content_hash: `hash-${version_id}`,
    start_line: 1,
    end_line: 1,
    status: "current",
    source_content_hash: `source-${version_id}`,
    indexed_at: "2026-05-08T00:00:00Z",
    scope: { layer: "module", module: "synthetic", source: {} },
  };
}

function lookupFor(c: QueryModeProbeCase) {
  const chunks = c.available_chunk_anchors.map((_, i) => chunk(`chunk-${i}`));
  const anchorsByChunkVersionId = new Map<string, CodeAnchor[]>();
  c.available_chunk_anchors.forEach((indexed, i) => {
    const versionId = chunks[i]!.version_id;
    anchorsByChunkVersionId.set(versionId, [
      {
        chunk_version_id: versionId,
        kind: indexed.kind,
        value: indexed.value,
        confidence: "high",
        source: "frontmatter",
      },
    ]);
  });
  return makeInMemoryAnchorLookup({
    chunks,
    cards: [],
    anchorsByChunkVersionId,
  });
}

function classify(c: QueryModeProbeCase): QueryMode {
  return compileQueryScopes({
    anchors: c.query_anchors,
    config: probeConfig,
    lookup: lookupFor(c),
  }).query_compilation.query_mode;
}

function classRate(
  cases: QueryModeProbeCase[],
): {
  passed: number;
  total: number;
  rate: number;
  lower95: number;
  upper95: number;
} {
  let passed = 0;
  for (const c of cases) {
    if (classify(c) === c.expected_query_mode) passed += 1;
  }
  const ci = wilson95(passed, cases.length);
  return {
    passed,
    total: cases.length,
    rate: cases.length === 0 ? 0 : passed / cases.length,
    lower95: ci.lower,
    upper95: ci.upper,
  };
}

describe("generateQueryModeCases", () => {
  it("emits cases tagged with expected_query_mode and a failure_class", () => {
    const cases = generateQueryModeCases({ count: 10, seed: 1 });
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(["anchored", "unanchored", "signal_empty"]).toContain(c.expected_query_mode);
      expect([
        "exact_match",
        "no_anchors",
        "anchors_absent",
        "case_mismatch",
        "form_variant",
        "path_segment",
      ]).toContain(c.failure_class);
    }
  });

  it("covers every failure_class at least once for a small generation", () => {
    const cases = generateQueryModeCases({ count: 30, seed: 2 });
    const classes = new Set(cases.map((c) => c.failure_class));
    expect(classes.has("exact_match")).toBe(true);
    expect(classes.has("no_anchors")).toBe(true);
    expect(classes.has("anchors_absent")).toBe(true);
    expect(classes.has("case_mismatch")).toBe(true);
    expect(classes.has("form_variant")).toBe(true);
  });

  it("is deterministic given the same seed", () => {
    const a = generateQueryModeCases({ count: 6, seed: 17 });
    const b = generateQueryModeCases({ count: 6, seed: 17 });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.failure_class)).toEqual(b.map((c) => c.failure_class));
  });
});

describe("compileQueryScopes — classifier behavior on the cleanly-classified cases", () => {
  it("exact_match cases → all classified as `anchored`", () => {
    const cases = generateQueryModeCases({ count: 600, seed: 31 }).filter(
      (c) => c.failure_class === "exact_match",
    );
    expect(cases.length).toBeGreaterThanOrEqual(73);
    const result = classRate(cases);
    // eslint-disable-next-line no-console
    console.log("[query-mode exact_match]", result);
    expect(result.lower95).toBeGreaterThanOrEqual(0.95);
  });

  it("no_anchors cases → all classified as `unanchored`", () => {
    const cases = generateQueryModeCases({ count: 600, seed: 33 }).filter(
      (c) => c.failure_class === "no_anchors",
    );
    expect(cases.length).toBeGreaterThanOrEqual(73);
    const result = classRate(cases);
    // eslint-disable-next-line no-console
    console.log("[query-mode no_anchors]", result);
    expect(result.lower95).toBeGreaterThanOrEqual(0.95);
  });

  it("anchors_absent cases → all classified as `signal_empty`", () => {
    const cases = generateQueryModeCases({ count: 600, seed: 35 }).filter(
      (c) => c.failure_class === "anchors_absent",
    );
    expect(cases.length).toBeGreaterThanOrEqual(73);
    const result = classRate(cases);
    // eslint-disable-next-line no-console
    console.log("[query-mode anchors_absent]", result);
    expect(result.lower95).toBeGreaterThanOrEqual(0.95);
  });
});

describe("compileQueryScopes — fuzzy anchor-recognition cases", () => {
  it("case_mismatch cases → all classified as `anchored`", () => {
    const cases = generateQueryModeCases({ count: 600, seed: 41 }).filter(
      (c) => c.failure_class === "case_mismatch",
    );
    expect(cases.length).toBeGreaterThanOrEqual(73);
    const result = classRate(cases);
    // eslint-disable-next-line no-console
    console.log("[query-mode case_mismatch]", result);
    expect(result.lower95).toBeGreaterThanOrEqual(0.95);
  });

  it("form_variant cases → all classified as `anchored`", () => {
    const cases = generateQueryModeCases({ count: 600, seed: 43 }).filter(
      (c) => c.failure_class === "form_variant",
    );
    expect(cases.length).toBeGreaterThanOrEqual(73);
    const result = classRate(cases);
    // eslint-disable-next-line no-console
    console.log("[query-mode form_variant]", result);
    expect(result.lower95).toBeGreaterThanOrEqual(0.95);
  });

  it("path_segment cases — pass via the existing path-component fallback", () => {
    const cases = generateQueryModeCases({ count: 600, seed: 45 }).filter(
      (c) => c.failure_class === "path_segment",
    );
    expect(cases.length).toBeGreaterThanOrEqual(73);
    const result = classRate(cases);
    // eslint-disable-next-line no-console
    console.log("[query-mode path_segment]", result);
    expect(result.lower95).toBeGreaterThanOrEqual(0.95);
  });
});

describe("V5.7 statistical certification of query-mode classifier", () => {
  it("overall classification accuracy on a balanced 600-case corpus", () => {
    const cases = generateQueryModeCases({ count: 600, seed: 51 });
    const result = classRate(cases);
    // eslint-disable-next-line no-console
    console.log("[query-mode N=600 overall]", result);
    // The balanced probe is now a classifier gate rather than a leak witness.
    expect(result.total).toBe(600);
    expect(result.lower95).toBeGreaterThanOrEqual(0.95);
  });
});
