/**
 * THO-159 (PRD-0016 / P16.1): per-case answer-bearing/failure-class
 * classification. The classifier is a pure function of the eval seed +
 * the observed ranked output and warnings, so it can be unit-tested
 * without spinning up the full retrieval pipeline.
 */
import { describe, expect, it } from "vitest";
import {
  classifyRealCorpusOutcome,
  type RealCorpusClassifierInput,
} from "./real-corpus-fixture.js";

function ranked(...sources: string[]) {
  return sources.map((source, idx) => ({
    id: `r${idx}`,
    kind: "chunk" as const,
    contexttrail: `Source: ${source} > Section: x > Part: 1/1`,
    score: 1,
  }));
}

function rankedCode(
  ...entries: Array<{
    source_path: string;
    symbol_path?: string;
    code_role?: "declaration" | "orientation" | "neighbor" | "test";
  }>
) {
  return entries.map((entry, idx) => ({
    id: `c${idx}`,
    kind: "code" as const,
    contexttrail: `Code: ${entry.source_path}`,
    source_path: entry.source_path,
    symbol_path: entry.symbol_path ?? null,
    code_role: entry.code_role ?? "declaration",
  }));
}

function answerBearingInput(overrides: Partial<RealCorpusClassifierInput> = {}): RealCorpusClassifierInput {
  return {
    expectation_kind: "deterministic",
    expected_query_mode: "anchored",
    expected_signal_empty_warning: false,
    expected_top_source: "docs/x.md",
    acceptableTopSources: ["docs/x.md"],
    mustIncludeSources: ["docs/x.md"],
    actual_query_mode: "anchored",
    coverage_confidence: "confident",
    ranked: ranked("docs/x.md"),
    ...overrides,
  };
}

describe("classifyRealCorpusOutcome — answer-bearing detection", () => {
  it("treats deterministic cases with an expected_top_source as answer-bearing", () => {
    const out = classifyRealCorpusOutcome(answerBearingInput());
    expect(out.isAnswerBearing).toBe(true);
  });

  it("treats expectation_kind=signal_empty as not answer-bearing", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        expectation_kind: "signal_empty",
        expected_query_mode: "signal_empty",
        expected_signal_empty_warning: true,
        coverage_confidence: "empty",
        ranked: [],
      }),
    );
    expect(out.isAnswerBearing).toBe(false);
    expect(out.answerTop1Hit).toBeNull();
    expect(out.answerTop3Hit).toBeNull();
    expect(out.answerReciprocalRank).toBeNull();
  });

  it("treats expected_signal_empty_warning=true as not answer-bearing", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        expected_signal_empty_warning: true,
        expected_query_mode: "signal_empty",
        coverage_confidence: "empty",
      }),
    );
    expect(out.isAnswerBearing).toBe(false);
  });
});

describe("classifyRealCorpusOutcome — top-1 / top-3 / MRR", () => {
  it("counts top-1 hit when an acceptable source is the first ranked chunk", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        ranked: ranked("docs/x.md", "docs/y.md", "docs/z.md"),
      }),
    );
    expect(out.answerTop1Hit).toBe(true);
    expect(out.answerTop3Hit).toBe(true);
    expect(out.answerReciprocalRank).toBe(1);
    expect(out.failureClass).toBe("none");
  });

  it("classifies top-3 hit but top-1 miss as answer_ordering_miss with rr=1/k", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        ranked: ranked("docs/y.md", "docs/x.md", "docs/z.md"),
      }),
    );
    expect(out.answerTop1Hit).toBe(false);
    expect(out.answerTop3Hit).toBe(true);
    expect(out.answerReciprocalRank).toBe(1 / 2);
    expect(out.failureClass).toBe("answer_ordering_miss");
  });

  it("classifies expected source absent from top-3 as answer_recall_miss", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        ranked: ranked("docs/y.md", "docs/z.md", "docs/q.md", "docs/x.md"),
      }),
    );
    expect(out.answerTop1Hit).toBe(false);
    expect(out.answerTop3Hit).toBe(false);
    // Reciprocal rank is reported off the full ranked list, but still
    // contributes 1/4 when source is found later in the list.
    expect(out.answerReciprocalRank).toBe(1 / 4);
    expect(out.failureClass).toBe("answer_recall_miss");
  });

  it("reports rr=0 when the source is missing from the ranked list entirely", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        ranked: ranked("docs/y.md", "docs/z.md"),
      }),
    );
    expect(out.answerReciprocalRank).toBe(0);
    expect(out.failureClass).toBe("answer_recall_miss");
  });

  it("matches by drift substring so any acceptable_top_source counts", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        expected_top_source: "docs/x.md",
        acceptableTopSources: ["docs/x.md", "docs/x-alias.md"],
        ranked: ranked("docs/x-alias.md"),
      }),
    );
    expect(out.answerTop1Hit).toBe(true);
  });
});

describe("classifyRealCorpusOutcome — non-answer failure classes", () => {
  it("flags query_mode_miss when answer-bearing query mode is wrong but ranking is fine", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        actual_query_mode: "unanchored",
      }),
    );
    expect(out.failureClass).toBe("query_mode_miss");
  });

  it("flags signal_empty_dishonest when a signal-empty case reports confident", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        expectation_kind: "signal_empty",
        expected_query_mode: "signal_empty",
        expected_signal_empty_warning: true,
        coverage_confidence: "confident",
      }),
    );
    expect(out.failureClass).toBe("signal_empty_dishonest");
  });

  it("flags pack_shape_miss when must_include sources are missing despite a top-1 win", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        mustIncludeSources: ["docs/x.md", "docs/extra.md"],
        ranked: ranked("docs/x.md"),
      }),
    );
    expect(out.failureClass).toBe("pack_shape_miss");
  });

  it("ranking failure takes precedence over pack-shape: top-3 miss is reported as recall", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        ranked: ranked("docs/y.md", "docs/z.md"),
        mustIncludeSources: ["docs/x.md", "docs/extra.md"],
      }),
    );
    expect(out.failureClass).toBe("answer_recall_miss");
  });

  it("classifies code-file top-1 misses separately on code-only cases", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        eval_surface: "code",
        expected_top_source: "",
        acceptableTopSources: [],
        mustIncludeSources: [],
        acceptableTopCodeFiles: ["src/linear/setup-sync.ts"],
        mustIncludeCodeFiles: ["src/linear/setup-sync.ts"],
        ranked: rankedCode(
          { source_path: "src/linear/normalize-ticket.ts", symbol_path: "normalizeTicket" },
          { source_path: "src/linear/setup-sync.ts", symbol_path: "setupSync" },
        ),
      }),
    );
    expect(out.answerTop1Hit).toBeNull();
    expect(out.codeTop1Acceptable).toBe(false);
    expect(out.codeTop3Hit).toBe(true);
    expect(out.codeFileReciprocalRank).toBe(1 / 2);
    expect(out.failureClass).toBe("code_file_ordering_miss");
  });

  it("classifies missing code files as code recall misses", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        eval_surface: "code",
        expected_top_source: "",
        acceptableTopSources: [],
        mustIncludeSources: [],
        acceptableTopCodeFiles: ["src/linear/setup-sync.ts"],
        mustIncludeCodeFiles: ["src/linear/setup-sync.ts"],
        ranked: rankedCode(
          { source_path: "src/linear/normalize-ticket.ts", symbol_path: "normalizeTicket" },
          { source_path: "src/linear/discover-eligible.ts", symbol_path: "discoverEligible" },
        ),
      }),
    );
    expect(out.codeTop3Hit).toBe(false);
    expect(out.codeFileReciprocalRank).toBe(0);
    expect(out.failureClass).toBe("code_file_recall_miss");
  });

  it("classifies missing acceptable code chunks as code_chunk_miss", () => {
    const out = classifyRealCorpusOutcome(
      answerBearingInput({
        eval_surface: "code",
        expected_top_source: "",
        acceptableTopSources: [],
        mustIncludeSources: [],
        acceptableTopCodeFiles: ["src/linear/setup-sync.ts"],
        mustIncludeCodeFiles: ["src/linear/setup-sync.ts"],
        acceptableTopCodeChunks: [
          {
            source_path: "src/linear/setup-sync.ts",
            symbol_path: "setupSync",
            code_role: "declaration",
          },
        ],
        mustIncludeCodeChunks: [
          {
            source_path: "src/linear/setup-sync.ts",
            symbol_path: "setupSync",
            code_role: "declaration",
          },
        ],
        ranked: rankedCode(
          { source_path: "src/linear/setup-sync.ts", symbol_path: "setupSync", code_role: "orientation" },
        ),
      }),
    );
    expect(out.codeTop1Acceptable).toBe(true);
    expect(out.codeChunkTop1Acceptable).toBe(false);
    expect(out.failureClass).toBe("code_chunk_miss");
  });
});
