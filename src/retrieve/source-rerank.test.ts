import { describe, it, expect } from "vitest";
import {
  anchorIntentFallbackEnabledFromEnv,
  applyHierarchyInheritance,
  classifyQueryIntent,
  scoreSourceRerank,
  rerankSourceCandidates,
  tokenizeForRerank,
  type QueryIntent,
} from "./source-rerank.js";
import type { ProfileEnrichedSourceCandidate } from "./source-candidates.js";
import type { SourceProfile } from "../types/source-profile.js";

const NOW = "2026-05-08T00:00:00Z";

function makeProfile(p: Partial<SourceProfile> & { source_path: string }): SourceProfile {
  return {
    source_path: p.source_path,
    source_content_hash: "h0",
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

function makeCandidate(args: {
  source_path: string;
  best_chunk_rank?: number;
  best_chunk_score?: number;
  profile?: SourceProfile | null;
}): ProfileEnrichedSourceCandidate {
  return {
    rank: 1,
    source_path: args.source_path,
    best_chunk_rank: args.best_chunk_rank ?? 1,
    best_chunk_score: args.best_chunk_score ?? 0.5,
    contributing_chunks: [
      {
        version_id: "v",
        rank: args.best_chunk_rank ?? 1,
        final_score: args.best_chunk_score ?? 0.5,
      },
    ],
    profile: args.profile ?? null,
  };
}

describe("classifyQueryIntent", () => {
  it("returns signal_empty when query_mode says so", () => {
    expect(classifyQueryIntent({ task: "anything", query_mode: "signal_empty" })).toBe(
      "signal_empty",
    );
  });

  it("keeps unrecognized provided anchors in signal_empty intent", () => {
    expect(
      classifyQueryIntent({
        task: "how do I configure turbo.json outputs?",
        query_mode: "signal_empty",
        has_anchors: true,
      }),
    ).toBe("signal_empty");
  });

  it("can shadow-treat signal_empty with provided anchors as anchored intent", () => {
    expect(
      classifyQueryIntent({
        task: "how do I configure turbo.json outputs?",
        query_mode: "signal_empty",
        has_anchors: true,
        enable_anchor_intent_fallback: true,
      }),
    ).toBe("file_anchored");
  });

  it("reads the anchor-intent fallback env flag without changing the default", () => {
    const previous = process.env.RETRIEVAL_ANCHOR_INTENT_FALLBACK;
    try {
      delete process.env.RETRIEVAL_ANCHOR_INTENT_FALLBACK;
      expect(anchorIntentFallbackEnabledFromEnv()).toBe(false);

      process.env.RETRIEVAL_ANCHOR_INTENT_FALLBACK = "on";
      expect(anchorIntentFallbackEnabledFromEnv()).toBe(true);
      expect(
        classifyQueryIntent({
          task: "how do I configure turbo.json outputs?",
          query_mode: "signal_empty",
          has_anchors: true,
        }),
      ).toBe("file_anchored");

      process.env.RETRIEVAL_ANCHOR_INTENT_FALLBACK = "off";
      expect(anchorIntentFallbackEnabledFromEnv()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.RETRIEVAL_ANCHOR_INTENT_FALLBACK;
      } else {
        process.env.RETRIEVAL_ANCHOR_INTENT_FALLBACK = previous;
      }
    }
  });

  it("returns file_anchored when anchors are provided", () => {
    expect(
      classifyQueryIntent({
        task: "fix bug",
        query_mode: "anchored",
        has_anchors: true,
      }),
    ).toBe("file_anchored");
  });

  it("returns decision_lookup for why/tradeoff queries", () => {
    expect(classifyQueryIntent({ task: "why did we pick X over Y?", query_mode: "unanchored" })).toBe(
      "decision_lookup",
    );
    expect(
      classifyQueryIntent({ task: "tradeoff between A and B", query_mode: "unanchored" }),
    ).toBe("decision_lookup");
    expect(
      classifyQueryIntent({
        task: "what decisions govern refund idempotency",
        query_mode: "unanchored",
      }),
    ).toBe("decision_lookup");
  });

  it("returns exact_symbol when query contains identifier-like tokens", () => {
    expect(
      classifyQueryIntent({ task: "useQuery devtools setup", query_mode: "unanchored" }),
    ).toBe("exact_symbol");
    expect(
      classifyQueryIntent({ task: "Bun.serve() docs", query_mode: "unanchored" }),
    ).toBe("exact_symbol");
  });

  it("returns broad_domain otherwise", () => {
    expect(
      classifyQueryIntent({ task: "how to build a web app", query_mode: "unanchored" }),
    ).toBe("broad_domain");
  });
});

describe("scoreSourceRerank — feature explanation", () => {
  it("returns deterministic score and feature vector for every candidate", () => {
    const candidate = makeCandidate({
      source_path: "docs/concepts/foo.md",
      profile: makeProfile({
        source_path: "docs/concepts/foo.md",
        title: "Foo concept",
        doc_purpose: "concept",
        aliases: [
          { kind: "title", value: "Foo concept", confidence: "high", origin: "title" },
          { kind: "filename", value: "foo", confidence: "high", origin: "filename" },
        ],
      }),
    });
    const scored = scoreSourceRerank({
      candidate,
      query_tokens: ["foo", "concept"],
      intent: "broad_domain",
    });
    expect(scored.score).toBeTypeOf("number");
    expect(scored.features).toMatchObject({
      lexical_chunk_score: expect.any(Number),
      source_rank_prior: expect.any(Number),
      title_token_coverage: expect.any(Number),
      path_token_coverage: expect.any(Number),
      title_path_agreement: expect.any(Number),
      alias_hit_count: expect.any(Number),
      purpose_compat_bonus: expect.any(Number),
      distractor_penalty: expect.any(Number),
    });
  });
});

describe("scoreSourceRerank — purpose intent compatibility", () => {
  it("decision_lookup prefers ADR/concept/runbook over reference", () => {
    const adr = makeCandidate({
      source_path: "docs/adr/0007-tradeoff.md",
      profile: makeProfile({ source_path: "docs/adr/0007-tradeoff.md", doc_purpose: "adr" }),
      best_chunk_score: 0.5,
    });
    const ref = makeCandidate({
      source_path: "docs/api/everything.md",
      profile: makeProfile({ source_path: "docs/api/everything.md", doc_purpose: "api_reference" }),
      best_chunk_score: 0.5,
    });
    const adrScore = scoreSourceRerank({
      candidate: adr,
      query_tokens: ["why", "tradeoff"],
      intent: "decision_lookup",
    });
    const refScore = scoreSourceRerank({
      candidate: ref,
      query_tokens: ["why", "tradeoff"],
      intent: "decision_lookup",
    });
    expect(adrScore.score).toBeGreaterThan(refScore.score);
  });

  it("exact_symbol prefers api_reference + alias hits over migration", () => {
    const api = makeCandidate({
      source_path: "docs/api/use-query.md",
      profile: makeProfile({
        source_path: "docs/api/use-query.md",
        doc_purpose: "api_reference",
        aliases: [
          { kind: "symbol", value: "useQuery", confidence: "high", origin: "frontmatter" },
          { kind: "filename", value: "use-query", confidence: "high", origin: "filename" },
        ],
      }),
      best_chunk_score: 0.4,
    });
    const migration = makeCandidate({
      source_path: "docs/migration-v5.md",
      profile: makeProfile({
        source_path: "docs/migration-v5.md",
        doc_purpose: "migration",
      }),
      best_chunk_score: 0.6,
    });
    const apiScore = scoreSourceRerank({
      candidate: api,
      query_tokens: ["usequery"],
      intent: "exact_symbol",
    });
    const migScore = scoreSourceRerank({
      candidate: migration,
      query_tokens: ["usequery"],
      intent: "exact_symbol",
    });
    expect(apiScore.score).toBeGreaterThan(migScore.score);
  });

  it("broad_domain prefers concept/quick_start over reference", () => {
    const concept = makeCandidate({
      source_path: "docs/concepts/web-app.md",
      profile: makeProfile({ source_path: "docs/concepts/web-app.md", doc_purpose: "concept" }),
    });
    const ref = makeCandidate({
      source_path: "docs/api/all.md",
      profile: makeProfile({ source_path: "docs/api/all.md", doc_purpose: "api_reference" }),
    });
    const cs = scoreSourceRerank({
      candidate: concept,
      query_tokens: ["web", "app"],
      intent: "broad_domain",
    });
    const rs = scoreSourceRerank({
      candidate: ref,
      query_tokens: ["web", "app"],
      intent: "broad_domain",
    });
    expect(cs.score).toBeGreaterThan(rs.score);
  });

  it("migration is NOT demoted when the query asks for migration/upgrade/breaking", () => {
    const candidate = makeCandidate({
      source_path: "docs/migration-v5.md",
      profile: makeProfile({ source_path: "docs/migration-v5.md", doc_purpose: "migration" }),
    });
    const distract = scoreSourceRerank({
      candidate,
      query_tokens: ["fetch", "data"],
      intent: "broad_domain",
    });
    const onTopic = scoreSourceRerank({
      candidate,
      query_tokens: ["migrate", "to", "v5"],
      intent: "broad_domain",
    });
    expect(distract.features.distractor_penalty).toBeLessThan(0);
    expect(onTopic.features.distractor_penalty).toBe(0);
  });
});

describe("scoreSourceRerank — alias evidence", () => {
  it("counts query-token hits against source aliases", () => {
    const candidate = makeCandidate({
      source_path: "docs/api/use-query.md",
      profile: makeProfile({
        source_path: "docs/api/use-query.md",
        aliases: [
          { kind: "symbol", value: "useQuery", confidence: "high", origin: "frontmatter" },
          { kind: "filename", value: "use-query", confidence: "high", origin: "filename" },
        ],
      }),
    });
    const scored = scoreSourceRerank({
      candidate,
      query_tokens: tokenizeForRerank("useQuery"),
      intent: "exact_symbol",
    });
    expect(scored.features.alias_hit_count).toBeGreaterThanOrEqual(1);
  });
});

describe("rerankSourceCandidates", () => {
  it("promotes an exact filename owner over a dense broad configuration sink", () => {
    const owner = makeCandidate({
      source_path: "docs/reference/globs.md",
      best_chunk_rank: 9,
      best_chunk_score: 0.5,
      profile: makeProfile({
        source_path: "docs/reference/globs.md",
        title: "File glob specification",
        heading_outline: [{ level: 2, text: "Glob patterns", slug: "glob-patterns" }],
        aliases: [
          { kind: "filename", value: "globs", confidence: "high", origin: "filename" },
        ],
      }),
    });
    const broad = makeCandidate({
      source_path: "docs/reference/configuration.md",
      best_chunk_rank: 1,
      best_chunk_score: 0.8,
      profile: makeProfile({
        source_path: "docs/reference/configuration.md",
        title: "Configuring turbo.json",
        heading_outline: [
          { level: 2, text: "Task options", slug: "task-options" },
          { level: 3, text: "inputs", slug: "inputs" },
          { level: 3, text: "outputs", slug: "outputs" },
        ],
        token_count: 12000,
        chunk_count: 80,
      }),
    });

    const reranked = rerankSourceCandidates({
      candidates: [broad, owner],
      query_tokens: tokenizeForRerank("configure glob inputs and outputs in turbo.json"),
      intent: "file_anchored",
    });

    expect(reranked[0]!.candidate.source_path).toBe("docs/reference/globs.md");
    expect(reranked.find((r) => r.candidate.source_path === "docs/reference/configuration.md")!.features.broad_container_penalty).toBeLessThan(0);
  });

  it("does not treat CamelCase fragments as source-owner identity", () => {
    const owner = makeCandidate({
      source_path: "docs/core-concepts/package-types.md",
      best_chunk_rank: 7,
      best_chunk_score: 0.45,
      profile: makeProfile({
        source_path: "docs/core-concepts/package-types.md",
        title: "Package types",
        aliases: [
          { kind: "filename", value: "package-types", confidence: "high", origin: "filename" },
        ],
      }),
    });
    const distractor = makeCandidate({
      source_path: "docs/guides/tools/typescript.md",
      best_chunk_rank: 1,
      best_chunk_score: 0.8,
      profile: makeProfile({
        source_path: "docs/guides/tools/typescript.md",
        title: "TypeScript",
        heading_outline: [
          { level: 2, text: "Package manager setup", slug: "package-manager-setup" },
        ],
      }),
    });

    const reranked = rerankSourceCandidates({
      candidates: [distractor, owner],
      query_tokens: tokenizeForRerank("what are package types in turborepo and which to use"),
      intent: "decision_lookup",
    });

    expect(reranked[0]!.candidate.source_path).toBe("docs/core-concepts/package-types.md");
  });

  it("uses overview-shape and intro topic support without promoting product-token leaves", () => {
    const overview = makeCandidate({
      source_path: "docs/server/overview.md",
      best_chunk_rank: 19,
      best_chunk_score: 0.25,
      profile: makeProfile({
        source_path: "docs/server/overview.md",
        title: "Backend Usage",
        intro: "This section covers everything you need to set up and configure your tRPC backend.",
        aliases: [
          { kind: "filename", value: "overview", confidence: "high", origin: "filename" },
        ],
      }),
    });
    const leaf = makeCandidate({
      source_path: "docs/client/react/createTRPCQueryUtils.md",
      best_chunk_rank: 2,
      best_chunk_score: 0.85,
      profile: makeProfile({
        source_path: "docs/client/react/createTRPCQueryUtils.md",
        title: "createTRPCQueryUtils",
        heading_outline: [
          { level: 2, text: "How to use createTRPCQueryUtils", slug: "how-to-use-createtrpcqueryutils" },
        ],
      }),
    });

    const reranked = rerankSourceCandidates({
      candidates: [leaf, overview],
      query_tokens: tokenizeForRerank("what is trpc and how does it work"),
      intent: "broad_domain",
    });

    expect(reranked[0]!.candidate.source_path).toBe("docs/server/overview.md");
  });

  it("does not let generic purpose compatibility swamp canonical path/title evidence", () => {
    const canonical = makeCandidate({
      source_path: "docs/runtime/environment-variables.md",
      best_chunk_rank: 1,
      best_chunk_score: 0.13,
      profile: makeProfile({
        source_path: "docs/runtime/environment-variables.md",
        title: "Environment variables",
        heading_outline: [{ level: 2, text: "Reading environment variables", slug: "reading-environment-variables" }],
        aliases: [
          { kind: "filename", value: "environment variables", confidence: "high", origin: "filename" },
        ],
      }),
    });
    const generic = makeCandidate({
      source_path: "docs/bundler/fullstack.md",
      best_chunk_rank: 4,
      best_chunk_score: 0.05,
      profile: makeProfile({
        source_path: "docs/bundler/fullstack.md",
        title: "Fullstack bundling",
        doc_purpose: "api_reference",
        heading_outline: [{ level: 2, text: "Deployment environment variables", slug: "deployment-environment-variables" }],
        aliases: [
          { kind: "heading", value: "environment variables", confidence: "medium", origin: "heading" },
        ],
      }),
    });

    const reranked = rerankSourceCandidates({
      candidates: [generic, canonical],
      query_tokens: tokenizeForRerank("read environment variables from .env files in Bun"),
      intent: "file_anchored",
    });

    expect(reranked[0]!.candidate.source_path).toBe("docs/runtime/environment-variables.md");
  });

  it("uses stemmed stopword-filtered tokens for source aboutness", () => {
    const canonical = makeCandidate({
      source_path: "docs/runtime/glob.md",
      best_chunk_rank: 2,
      best_chunk_score: 0.11,
      profile: makeProfile({
        source_path: "docs/runtime/glob.md",
        title: "Glob patterns",
        heading_outline: [{ level: 2, text: "Supported glob patterns", slug: "supported-glob-patterns" }],
        aliases: [
          { kind: "filename", value: "glob", confidence: "high", origin: "filename" },
        ],
      }),
    });
    const incidental = makeCandidate({
      source_path: "docs/bundler/minifier.md",
      best_chunk_rank: 24,
      best_chunk_score: 0.01,
      profile: makeProfile({
        source_path: "docs/bundler/minifier.md",
        title: "Minifier",
        doc_purpose: "api_reference",
        heading_outline: [{ level: 2, text: "Matching file patterns", slug: "matching-file-patterns" }],
        aliases: [
          { kind: "heading", value: "file patterns", confidence: "medium", origin: "heading" },
        ],
      }),
    });

    const reranked = rerankSourceCandidates({
      candidates: [incidental, canonical],
      query_tokens: tokenizeForRerank("use Bun.Glob to walk files matching a pattern"),
      intent: "file_anchored",
    });

    expect(reranked[0]!.candidate.source_path).toBe("docs/runtime/glob.md");
  });

  it("returns candidates ordered by source-rerank score desc with explainable features", () => {
    const a = makeCandidate({
      source_path: "docs/migration-v5.md",
      best_chunk_score: 0.9,
      profile: makeProfile({ source_path: "docs/migration-v5.md", doc_purpose: "migration" }),
    });
    const b = makeCandidate({
      source_path: "docs/concepts/web-app.md",
      best_chunk_score: 0.6,
      profile: makeProfile({ source_path: "docs/concepts/web-app.md", doc_purpose: "concept" }),
    });
    const reranked = rerankSourceCandidates({
      candidates: [a, b],
      query_tokens: ["web", "app"],
      intent: "broad_domain",
    });
    expect(reranked.map((r) => r.candidate.source_path)).toEqual([
      "docs/concepts/web-app.md",
      "docs/migration-v5.md",
    ]);
    expect(reranked[0]!.features).toBeDefined();
  });

  it("preserves original order when no profiles and tied features (deterministic fallback)", () => {
    const a = makeCandidate({ source_path: "docs/a.md", best_chunk_rank: 1, best_chunk_score: 0.5 });
    const b = makeCandidate({ source_path: "docs/b.md", best_chunk_rank: 2, best_chunk_score: 0.4 });
    const reranked = rerankSourceCandidates({
      candidates: [a, b],
      query_tokens: ["x"],
      intent: "broad_domain" as QueryIntent,
    });
    expect(reranked.map((r) => r.candidate.source_path)).toEqual(["docs/a.md", "docs/b.md"]);
  });
});

describe("applyHierarchyInheritance", () => {
  it("lifts a credible parent landing past its strongest descendant when scores are close", () => {
    const scored = [
      { candidate: { source_path: "docs/guide/mocking/modules.md", best_chunk_rank: 1 }, score: 1.0 },
      { candidate: { source_path: "docs/guide/mocking.md", best_chunk_rank: 2 }, score: 0.9 },
    ];
    applyHierarchyInheritance(scored, "broad_domain" as QueryIntent);
    expect(scored[1]!.score).toBeGreaterThan(scored[0]!.score);
  });

  it("does not lift an ill-fitting parent (parent inherits proportional to its own score)", () => {
    const scored = [
      { candidate: { source_path: "docs/guide/mocking/modules.md", best_chunk_rank: 1 }, score: 1.0 },
      { candidate: { source_path: "docs/guide/mocking.md", best_chunk_rank: 2 }, score: 0.1 },
    ];
    applyHierarchyInheritance(scored, "broad_domain" as QueryIntent);
    expect(scored[1]!.score).toBeLessThan(scored[0]!.score);
  });

  it("recognises the index.md form for landing detection", () => {
    const scored = [
      { candidate: { source_path: "docs/guide/mocking/sub.md", best_chunk_rank: 1 }, score: 1.0 },
      { candidate: { source_path: "docs/guide/mocking/index.md", best_chunk_rank: 2 }, score: 0.95 },
    ];
    applyHierarchyInheritance(scored, "broad_domain" as QueryIntent);
    expect(scored[1]!.score).toBeGreaterThan(scored[0]!.score);
  });

  it("never inherits when the candidate has no descendants in the candidate set", () => {
    const scored = [
      { candidate: { source_path: "docs/a.md", best_chunk_rank: 1 }, score: 0.5 },
      { candidate: { source_path: "docs/b.md", best_chunk_rank: 2 }, score: 0.4 },
    ];
    const beforeA = scored[0]!.score;
    const beforeB = scored[1]!.score;
    applyHierarchyInheritance(scored, "broad_domain" as QueryIntent);
    expect(scored[0]!.score).toBe(beforeA);
    expect(scored[1]!.score).toBe(beforeB);
  });

  it("does not fire for signal_empty intent", () => {
    const scored = [
      { candidate: { source_path: "docs/guide/mocking/modules.md", best_chunk_rank: 1 }, score: 1.0 },
      { candidate: { source_path: "docs/guide/mocking.md", best_chunk_rank: 2 }, score: 0.9 },
    ];
    const before = scored[1]!.score;
    applyHierarchyInheritance(scored, "signal_empty" as QueryIntent);
    expect(scored[1]!.score).toBe(before);
  });
});

describe("applyHierarchyInheritance — README convention", () => {
  it("recognises nested README.md as section landing for its directory", () => {
    const scored = [
      { candidate: { source_path: "packages/docs-v3/ERROR_HANDLING.md", best_chunk_rank: 1 }, score: 1.0 },
      { candidate: { source_path: "packages/docs-v3/README.md", best_chunk_rank: 2 }, score: 0.95 },
    ];
    applyHierarchyInheritance(scored, "broad_domain" as QueryIntent);
    expect(scored[1]!.score).toBeGreaterThan(scored[0]!.score);
  });

  it("does not treat root-level README.md as section landing (would unboundedly inherit)", () => {
    const scored = [
      { candidate: { source_path: "docs/feature/usage.md", best_chunk_rank: 1 }, score: 1.0 },
      { candidate: { source_path: "README.md", best_chunk_rank: 2 }, score: 0.5 },
    ];
    const before = scored[1]!.score;
    applyHierarchyInheritance(scored, "broad_domain" as QueryIntent);
    expect(scored[1]!.score).toBe(before);
  });
});
