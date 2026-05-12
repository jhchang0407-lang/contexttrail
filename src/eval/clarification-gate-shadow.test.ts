import { describe, expect, it } from "vitest";
import {
  buildCorpusSupportIndex,
  decideClarificationGate,
  scoreTaskCorpusSupport,
} from "./clarification-gate-shadow.js";
import type { SourceProfile } from "../types/source-profile.js";

function response(overrides: Parameters<typeof decideClarificationGate>[1]) {
  return overrides;
}

function profile(overrides: Partial<SourceProfile>): SourceProfile {
  return {
    source_path: overrides.source_path ?? "docs/runtime/file-io.md",
    source_content_hash: "hash",
    title: overrides.title ?? "File I/O",
    h1: overrides.h1 ?? null,
    intro: overrides.intro ?? null,
    heading_outline: overrides.heading_outline ?? [],
    doc_role: overrides.doc_role ?? "canonical",
    role_source: overrides.role_source ?? "default",
    doc_purpose: overrides.doc_purpose ?? "unknown",
    purpose_source: overrides.purpose_source ?? "default",
    aliases: overrides.aliases ?? [],
    summary: overrides.summary ?? null,
    summary_source: overrides.summary_source ?? "empty",
    questions_answered: overrides.questions_answered ?? [],
    questions_answered_source: overrides.questions_answered_source ?? "empty",
    chunk_count: overrides.chunk_count ?? 1,
    token_count: overrides.token_count ?? 100,
    indexed_at: overrides.indexed_at ?? "2026-05-10T00:00:00Z",
    heading_aliases: overrides.heading_aliases,
    package_segment: overrides.package_segment,
    version_segment: overrides.version_segment,
    nav_label: overrides.nav_label,
  };
}

describe("decideClarificationGate", () => {
  it("clarifies signal-empty query mode in the direct gate", () => {
    const decision = decideClarificationGate(
      "signal_empty_mode",
      response({
        query_mode: "signal_empty",
        coverage_confidence: "uncertain",
        warnings: [],
        ranked: [],
      }),
      {},
    );

    expect(decision.clarify).toBe(true);
    expect(decision.reason).toBe("query_mode_signal_empty");
  });

  it("clarifies unsupported top-source coverage in unsupported_or_signal_empty", () => {
    const decision = decideClarificationGate(
      "unsupported_or_signal_empty",
      response({
        query_mode: "unanchored",
        coverage_confidence: "uncertain",
        warnings: [],
        ranked: [],
      }),
      {
        top_source_coverage: {
          decision: "unsupported",
          reasons: ["off_domain_match"],
        },
      },
    );

    expect(decision.clarify).toBe(true);
    expect(decision.reason).toBe("top_source_unsupported");
  });

  it("does not clarify conservative low-signal when the answer is confident", () => {
    const decision = decideClarificationGate(
      "conservative_low_signal",
      response({
        query_mode: "anchored",
        coverage_confidence: "confident",
        warnings: [],
        ranked: [{ kind: "chunk", id: "v1", contexttrail: "docs/a.md", score: 1 }],
      }),
      {
        top_source_coverage: {
          decision: "covers",
          reasons: ["title_path_match"],
        },
      },
    );

    expect(decision.clarify).toBe(false);
  });

  it("clarifies when task domain tokens have no source-profile support", () => {
    const support = buildCorpusSupportIndex([
      profile({
        source_path: "docs/runtime/file-io.md",
        title: "File I/O",
        heading_outline: [{ level: 2, text: "Writing files", slug: "writing-files" }],
      }),
    ]);

    const decision = decideClarificationGate(
      "foreign_profile_support",
      response({
        query_mode: "unanchored",
        coverage_confidence: "uncertain",
        warnings: [],
        ranked: [{ kind: "chunk", id: "v1", contexttrail: "docs/a.md", score: 1 }],
      }),
      {},
      {
        task: "android deployment",
        corpusSupport: support,
      },
    );

    expect(decision.clarify).toBe(true);
    expect(decision.reason).toBe("no_profile_domain_support");
    expect(decision.support?.unsupported_tokens).toContain("android");
  });

  it("does not clarify when source-profile structure supports the task domain", () => {
    const support = buildCorpusSupportIndex([
      profile({
        source_path: "docs/runtime/redis.md",
        title: "Redis",
        aliases: [
          { kind: "title", value: "Redis", confidence: "high", origin: "title" },
        ],
      }),
    ]);

    const decision = decideClarificationGate(
      "foreign_profile_support",
      response({
        query_mode: "unanchored",
        coverage_confidence: "uncertain",
        warnings: [],
        ranked: [],
      }),
      {},
      {
        task: "redis connection events",
        corpusSupport: support,
      },
    );

    expect(decision.clarify).toBe(false);
    expect(decision.reason).toBe("profile_domain_supported");
    expect(decision.support?.supported_tokens).toContain("redi");
  });

  it("does not use foreign-profile support to clarify caller-anchored tasks", () => {
    const support = buildCorpusSupportIndex([
      profile({
        source_path: "docs/adr/0004-authored-and-lock-config-split.md",
        title: "Authored and lock config split",
      }),
    ]);

    const decision = decideClarificationGate(
      "foreign_profile_support",
      response({
        query_mode: "signal_empty",
        coverage_confidence: "uncertain",
        warnings: [],
        ranked: [],
      }),
      {},
      {
        task: "verify config fingerprint",
        corpusSupport: support,
        hasCallerAnchors: true,
      },
    );

    expect(decision.clarify).toBe(false);
    expect(decision.reason).toBe("caller_anchor_outside_gate_scope");
  });

  it("scores corpus support from structural source-profile text only", () => {
    const support = buildCorpusSupportIndex([
      profile({
        source_path: "docs/server/routers.md",
        title: "Routers",
        heading_outline: [{ level: 2, text: "Create a router", slug: "create-a-router" }],
      }),
    ]);

    expect(scoreTaskCorpusSupport("routers and procedures", support)).toMatchObject({
      supported_tokens: ["router"],
      unsupported_tokens: ["procedur"],
    });
  });

  it("ignores corpus-generic tokens before deciding foreign-domain support", () => {
    const support = buildCorpusSupportIndex([
      profile({ source_path: "docs/a.md", title: "Zod basics" }),
      profile({ source_path: "docs/b.md", title: "Zod parsing" }),
      profile({ source_path: "docs/c.md", title: "Zod errors" }),
      profile({ source_path: "docs/d.md", title: "Zod schemas" }),
    ]);

    const score = scoreTaskCorpusSupport("zod react component", support);

    expect(score.ignored_corpus_generic_tokens).toContain("zod");
    expect(score.considered_tokens).toContain("react");
    expect(score.supported_tokens).not.toContain("zod");
  });
});
