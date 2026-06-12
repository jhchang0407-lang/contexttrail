/**
 * Deterministic source coverage verifier (V2.5.5).
 *
 * Coverage answers "could this source plausibly answer this query?" using
 * deterministic source evidence (title, path, alias, heading, anchor) and
 * intent. It is NOT a reranker; it is a gate consumed by confidence and
 * future assembly readiness. Conservative on unsupported unanchored cases.
 */
import { describe, it, expect } from "vitest";
import {
  verifySourceCoverage,
  COVERAGE_DECISIONS,
  type CoverageVerifierInput,
} from "./coverage-verifier.js";
import type { ProfileEnrichedSourceCandidate } from "./source-candidates.js";
import type { SourceProfile } from "../types/source-profile.js";

const NOW = "2026-05-08T00:00:00Z";

function profile(p: Partial<SourceProfile> & { source_path: string }): SourceProfile {
  return {
    source_path: p.source_path,
    source_content_hash: "h",
    title: p.title ?? p.source_path,
    h1: p.h1 ?? null,
    intro: p.intro ?? null,
    heading_outline: p.heading_outline ?? [],
    doc_role: p.doc_role ?? "canonical",
    role_source: p.role_source ?? "default",
    doc_purpose: p.doc_purpose ?? "unknown",
    purpose_source: p.purpose_source ?? "default",
    aliases: p.aliases ?? [],
    summary: p.summary ?? null,
    summary_source: p.summary_source ?? "empty",
    questions_answered: p.questions_answered ?? [],
    questions_answered_source: p.questions_answered_source ?? "empty",
    chunk_count: p.chunk_count ?? 1,
    token_count: p.token_count ?? 100,
    indexed_at: NOW,
  };
}

function candidate(
  p: SourceProfile,
  best_chunk_score = 0.7,
  fused_rank = 1,
): ProfileEnrichedSourceCandidate {
  return {
    rank: 1,
    source_path: p.source_path,
    best_chunk_rank: 1,
    best_chunk_score,
    contributing_chunks: [{ version_id: "v", rank: 1, final_score: best_chunk_score }],
    profile: p,
    fused_rank,
    fused_path_count: 1,
  };
}

function input(over: Partial<CoverageVerifierInput>): CoverageVerifierInput {
  const c = over.candidate ?? candidate(profile({ source_path: "docs/x.md" }));
  return {
    intent: "broad_domain",
    query_tokens: [],
    candidate: c,
    path_agreement: over.path_agreement ?? 1,
    top_chunk_score: over.top_chunk_score ?? c.best_chunk_score,
    required_anchors: over.required_anchors ?? { files: [], symbols: [], routes: [] },
    ...over,
  };
}

describe("verifySourceCoverage", () => {
  it("declares the canonical decision set", () => {
    expect(COVERAGE_DECISIONS).toEqual([
      "covers",
      "partial",
      "unsupported",
      "needs_anchors",
    ]);
  });

  it("signal_empty intent always returns unsupported", () => {
    const out = verifySourceCoverage(
      input({
        intent: "signal_empty",
        query_tokens: ["ignored"],
        candidate: candidate(profile({ source_path: "docs/x.md", title: "X" })),
      }),
    );
    expect(out.decision).toBe("unsupported");
  });

  it("exact_symbol covers when an alias/symbol matches the query token", () => {
    const p = profile({
      source_path: "wiki/optionality.md",
      title: "Optionality",
      aliases: [{ kind: "symbol", value: "ZodOptional", confidence: "high", origin: "intro" }],
    });
    const out = verifySourceCoverage(
      input({
        intent: "exact_symbol",
        query_tokens: ["ZodOptional"],
        candidate: candidate(p),
      }),
    );
    expect(out.decision).toBe("covers");
    expect(out.reasons).toContain("alias_symbol_match");
  });

  it("exact_symbol on a broad README without symbol/title evidence becomes partial or unsupported", () => {
    const p = profile({
      source_path: "README.md",
      title: "Project",
      aliases: [{ kind: "package", value: "project", confidence: "low", origin: "package_name" }],
    });
    const out = verifySourceCoverage(
      input({
        intent: "exact_symbol",
        query_tokens: ["ZodOptional"],
        candidate: candidate(p, /*top_chunk_score=*/ 0.95),
      }),
    );
    expect(["partial", "unsupported"]).toContain(out.decision);
    expect(out.reasons).toContain("weak_aboutness");
  });

  it("decision_lookup covers when source purpose is rationale-like and title matches", () => {
    const p = profile({
      source_path: "docs/adr/0042-database-choice.md",
      title: "Database Choice",
      doc_purpose: "adr",
    });
    const out = verifySourceCoverage(
      input({
        intent: "decision_lookup",
        query_tokens: ["database", "choice"],
        candidate: candidate(p),
      }),
    );
    expect(out.decision).toBe("covers");
  });

  it("decision_lookup on api_reference becomes partial (low specificity for a why query)", () => {
    const p = profile({
      source_path: "docs/api/foo.md",
      title: "Foo",
      doc_purpose: "api_reference",
    });
    const out = verifySourceCoverage(
      input({
        intent: "decision_lookup",
        query_tokens: ["foo"],
        candidate: candidate(p),
      }),
    );
    expect(out.decision).toBe("partial");
    expect(out.reasons).toContain("low_specificity_section");
  });

  it("broad_domain covers when title/path matches with multi-path agreement", () => {
    const p = profile({ source_path: "docs/api/routing.md", title: "Routing" });
    const out = verifySourceCoverage(
      input({
        intent: "broad_domain",
        query_tokens: ["routing"],
        candidate: candidate(p),
        path_agreement: 2,
      }),
    );
    expect(out.decision).toBe("covers");
    expect(out.reasons).toContain("title_path_match");
  });

  it("broad_domain with title/path match but no agreement is partial", () => {
    const p = profile({ source_path: "docs/x.md", title: "X has routing" });
    const out = verifySourceCoverage(
      input({
        intent: "broad_domain",
        query_tokens: ["routing"],
        candidate: candidate(p),
        path_agreement: 1,
      }),
    );
    expect(out.decision).toBe("partial");
  });

  it("file_anchored returns needs_anchors when anchors are present but the source has no aboutness", () => {
    // Anchors bind scope; if the doc has zero title/path/heading/alias
    // signal, the verifier asks for better anchors instead of guessing.
    const p = profile({
      source_path: "docs/legacy/zzz.md",
      title: "Legacy Notes",
      heading_outline: [],
      aliases: [],
    });
    const out = verifySourceCoverage(
      input({
        intent: "file_anchored",
        query_tokens: ["nonmatching"],
        candidate: candidate(p),
        required_anchors: { files: ["src/server/middleware.ts"], symbols: [], routes: [] },
      }),
    );
    expect(out.decision).toBe("needs_anchors");
    expect(out.reasons).toContain("missing_anchor");
  });

  it("file_anchored covers when the source matches the file anchor", () => {
    const p = profile({ source_path: "docs/api/routing.md", title: "Routing" });
    const out = verifySourceCoverage(
      input({
        intent: "file_anchored",
        query_tokens: [],
        candidate: candidate(p),
        required_anchors: { files: ["docs/api/routing.md"], symbols: [], routes: [] },
      }),
    );
    expect(out.decision).toBe("covers");
    expect(out.reasons).toContain("anchor_match");
  });

  it("returns unsupported when source has no aboutness signal even with high lexical score", () => {
    // The Hono gRPC pattern: a long README mentions gRPC in passing, lexical
    // score is high, but the source is not actually about gRPC.
    const p = profile({
      source_path: "README.md",
      title: "Hono",
      heading_outline: [],
      aliases: [],
    });
    const out = verifySourceCoverage(
      input({
        intent: "broad_domain",
        query_tokens: ["grpc"],
        candidate: candidate(p, /*top_chunk_score=*/ 0.99),
        path_agreement: 1,
      }),
    );
    expect(["unsupported", "partial"]).toContain(out.decision);
    expect(out.reasons).toContain("weak_aboutness");
  });

  it("is conservative on off-domain unanchored queries (returns unsupported)", () => {
    const p = profile({ source_path: "docs/runtime/env.md", title: "Environment Variables" });
    const out = verifySourceCoverage(
      input({
        intent: "broad_domain",
        query_tokens: ["mongodb"],
        candidate: candidate(p, 0.9),
      }),
    );
    expect(out.decision).toBe("unsupported");
    expect(out.reasons).toContain("off_domain_match");
  });

  it("returns unsupported when the candidate has no profile (no aboutness signal)", () => {
    const c = {
      ...candidate(profile({ source_path: "docs/legacy.md" })),
      profile: null,
    };
    const out = verifySourceCoverage(
      input({
        intent: "broad_domain",
        query_tokens: ["foo"],
        candidate: c,
      }),
    );
    expect(out.decision).toBe("unsupported");
  });
});
