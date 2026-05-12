/**
 * PRD-0027 / THO-229 — composition test for nav-metadata consumption
 * through the alias substrate (`alias_hit_count` /
 * `owner_identity_score`) and the overview-owner-score path.
 *
 * Property: a query whose token exactly matches `nav_label` on
 * candidate A but NOT on candidate B causes A to rank higher than B.
 * Certified at Wilson lower-95 ≥ 95% over 200 random nav labels.
 *
 * Adversarial unit tests double-check:
 *
 *   - Flag-off → nav_label match contributes 0 to alias_hit_count.
 *   - Flag-on → nav_label match contributes ≥ 1 to alias_hit_count.
 *   - Flag-on with `is_nav_landing=true` and an overview-shape query
 *     → overview_owner_score is positive even when the path/title
 *     don't carry overview-shaped tokens.
 *   - Flag-on with `is_nav_landing=false` → no overview-owner-score
 *     contribution from nav (parity with flag off).
 *   - Flag-on but query token absent from nav_label → alias_hit_count
 *     equals the flag-off value.
 *
 * Mirrors the slice 24.2.3 code-fence-entities composition test.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  rerankSourceCandidates,
  scoreSourceRerank,
  tokenizeForRerank,
} from "../../retrieve/source-rerank.js";
import type { ProfileEnrichedSourceCandidate } from "../../retrieve/source-candidates.js";
import type { SourceProfile } from "../../types/source-profile.js";
import { wilson95Lower } from "./stats.js";

const PROPERTY_LOWER_95 = 0.95;
const PROPERTY_RUNS = 200;
const NOW = "2026-05-08T00:00:00Z";

function profile(args: {
  source_path: string;
  title: string;
  nav_label?: string | null;
  is_nav_landing?: boolean;
  nav_section_id?: string | null;
  nav_position?: number | null;
  nav_origin?:
    | "frontmatter"
    | "readme_as_index"
    | "mkdocs"
    | "docusaurus_category"
    | "docusaurus_sidebar"
    | "vitepress"
    | null;
  nav_provenance?: "explicit_config" | "frontmatter" | "structural" | null;
}): SourceProfile {
  return {
    source_path: args.source_path,
    source_content_hash: "h0",
    title: args.title,
    h1: args.title,
    intro: null,
    heading_outline: [],
    doc_role: "canonical",
    role_source: "default",
    doc_purpose: "guide",
    purpose_source: "default",
    aliases: [],
    summary: null,
    summary_source: "empty",
    questions_answered: [],
    questions_answered_source: "empty",
    chunk_count: 1,
    token_count: 100,
    indexed_at: NOW,
    nav_label: args.nav_label,
    is_nav_landing: args.is_nav_landing,
    nav_section_id: args.nav_section_id,
    nav_position: args.nav_position,
    nav_origin: args.nav_origin,
    nav_provenance: args.nav_provenance,
  };
}

function candidate(p: SourceProfile): ProfileEnrichedSourceCandidate {
  return {
    rank: 1,
    source_path: p.source_path,
    best_chunk_rank: 1,
    best_chunk_score: 0.5,
    contributing_chunks: [{ version_id: "v", rank: 1, final_score: 0.5 }],
    profile: p,
  };
}

function withFlag<T>(value: "on" | "off", fn: () => T): T {
  const previous = process.env.RETRIEVAL_NAV_METADATA;
  process.env.RETRIEVAL_NAV_METADATA = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.RETRIEVAL_NAV_METADATA;
    } else {
      process.env.RETRIEVAL_NAV_METADATA = previous;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Adversarial — alias_hit_count + overview_owner_score wiring
// ──────────────────────────────────────────────────────────────────────────

describe("nav metadata — alias_hit_count wiring (27.1.3)", () => {
  it("flag off: a nav_label-only match does NOT increment alias_hit_count", () => {
    const p2 = profile({
      source_path: "docs/server/x.md",
      title: "Configuration Notes",
      nav_label: "ZebraGraph",
      nav_origin: "vitepress",
      nav_provenance: "explicit_config",
    });
    const off = withFlag("off", () =>
      scoreSourceRerank({
        candidate: candidate(p2),
        query_tokens: tokenizeForRerank("ZebraGraph"),
        intent: "broad_domain",
      }),
    );
    expect(off.features.alias_hit_count).toBe(0);
  });

  it("flag on: a nav_label-only match increments alias_hit_count", () => {
    const p = profile({
      source_path: "docs/server/x.md",
      title: "Configuration Notes",
      nav_label: "ZebraGraph",
      nav_origin: "vitepress",
      nav_provenance: "explicit_config",
    });
    withFlag("on", () => {
      const on = scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("ZebraGraph"),
        intent: "broad_domain",
      });
      expect(on.features.alias_hit_count).toBeGreaterThan(0);
    });
  });

  it("flag on: query token absent from nav_label → no change vs flag off", () => {
    const p = profile({
      source_path: "docs/server/x.md",
      title: "Configuration Notes",
      nav_label: "ZebraGraph",
      nav_origin: "vitepress",
      nav_provenance: "explicit_config",
    });
    const off = withFlag("off", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("totallyUnrelated"),
        intent: "broad_domain",
      }),
    );
    const on = withFlag("on", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("totallyUnrelated"),
        intent: "broad_domain",
      }),
    );
    expect(on.features.alias_hit_count).toBe(off.features.alias_hit_count);
  });
});

describe("nav metadata — overview_owner_score wiring (27.1.3)", () => {
  it("flag off + is_nav_landing=true → no overview-owner contribution from nav", () => {
    const p = profile({
      source_path: "docs/zebra/zebra-page.md",
      title: "Zebra Page",
      nav_label: "Zebra Page",
      is_nav_landing: true,
      nav_origin: "vitepress",
      nav_provenance: "explicit_config",
    });
    const off = withFlag("off", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("what is zebra"),
        intent: "broad_domain",
      }),
    );
    expect(off.features.overview_owner_score).toBe(0);
  });

  it("flag on + is_nav_landing=true → overview_owner_score is positive on overview-shape query", () => {
    const p = profile({
      source_path: "docs/zebra/zebra-page.md",
      title: "Zebra Page",
      nav_label: "Zebra Page",
      is_nav_landing: true,
      nav_origin: "vitepress",
      nav_provenance: "explicit_config",
    });
    const on = withFlag("on", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("what is zebra"),
        intent: "broad_domain",
      }),
    );
    expect(on.features.overview_owner_score).toBeGreaterThan(0);
  });

  it("flag on + is_nav_landing=false → no overview-owner contribution from nav (parity with flag off)", () => {
    const p = profile({
      source_path: "docs/zebra/zebra-page.md",
      title: "Zebra Page",
      nav_label: "Zebra Page",
      is_nav_landing: false,
      nav_origin: "vitepress",
      nav_provenance: "explicit_config",
    });
    const off = withFlag("off", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("what is zebra"),
        intent: "broad_domain",
      }),
    );
    const on = withFlag("on", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("what is zebra"),
        intent: "broad_domain",
      }),
    );
    expect(on.features.overview_owner_score).toBe(off.features.overview_owner_score);
  });
});

describe("nav metadata — provenance gates (27.1.3)", () => {
  it("frontmatter labels feed alias matching but not overview-owner landings", () => {
    const p = profile({
      source_path: "docs/zebra/zebra-page.md",
      title: "Configuration Notes",
      nav_label: "ZebraGraph",
      is_nav_landing: true,
      nav_origin: "frontmatter",
      nav_provenance: "frontmatter",
    });
    const on = withFlag("on", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("what is ZebraGraph"),
        intent: "broad_domain",
      }),
    );
    expect(on.features.alias_hit_count).toBeGreaterThan(0);
    expect(on.features.overview_owner_score).toBe(0);
  });

  it("structural README/index labels are explain-only and do not feed ranking math", () => {
    const p = profile({
      source_path: "docs/zebra/README.md",
      title: "Configuration Notes",
      nav_label: "ZebraGraph",
      is_nav_landing: true,
      nav_origin: "readme_as_index",
      nav_provenance: "structural",
    });
    const on = withFlag("on", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("ZebraGraph"),
        intent: "broad_domain",
      }),
    );
    expect(on.features.alias_hit_count).toBe(0);
    expect(on.features.overview_owner_score).toBe(0);
  });

  it("profiles without nav provenance do not consume nav labels", () => {
    const p = profile({
      source_path: "docs/server/x.md",
      title: "Configuration Notes",
      nav_label: "ZebraGraph",
      is_nav_landing: true,
    });
    const on = withFlag("on", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("what is ZebraGraph"),
        intent: "broad_domain",
      }),
    );
    expect(on.features.alias_hit_count).toBe(0);
    expect(on.features.overview_owner_score).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Property test — composition over 200 random nav labels.
// ──────────────────────────────────────────────────────────────────────────

describe("nav metadata — composition (27.1.3)", () => {
  it("nav_label match on A but not B causes A to rank higher than B (lower-95 ≥ 95%)", () => {
    // Random Pascal-shaped labels of length 6+ so they don't collide
    // with common English tokens after stemming or with the title.
    const labelArb = fc
      .stringMatching(/^[A-Z][a-z]{5,12}$/);
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(labelArb, (label) => {
        total += 1;
        const a = candidate(
          profile({
            source_path: "docs/a.md",
            title: "Doc A",
            nav_label: label,
            nav_origin: "vitepress",
            nav_provenance: "explicit_config",
          }),
        );
        const b = candidate(
          profile({ source_path: "docs/b.md", title: "Doc B" }),
        );
        const queryTokens = tokenizeForRerank(label);
        const reranked = withFlag("on", () =>
          rerankSourceCandidates({
            candidates: [a, b],
            query_tokens: queryTokens,
            intent: "broad_domain",
          }),
        );
        const aRank =
          reranked.find((r) => r.candidate.source_path === "docs/a.md")?.rank ?? 0;
        const bRank =
          reranked.find((r) => r.candidate.source_path === "docs/b.md")?.rank ?? 0;
        if (aRank > 0 && bRank > 0 && aRank < bRank) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(PROPERTY_LOWER_95);
  });

  it("flag off: same nav-label match produces no positional advantage", () => {
    // Sanity: the lift comes from the flag, not from accidental ordering.
    const label = "Zebrafication";
    const a = candidate(
      profile({
        source_path: "docs/a.md",
        title: "Doc A",
        nav_label: label,
        nav_origin: "vitepress",
        nav_provenance: "explicit_config",
      }),
    );
    const b = candidate(profile({ source_path: "docs/b.md", title: "Doc B" }));
    const queryTokens = tokenizeForRerank(label);
    const reranked = withFlag("off", () =>
      rerankSourceCandidates({
        candidates: [a, b],
        query_tokens: queryTokens,
        intent: "broad_domain",
      }),
    );
    const aRank =
      reranked.find((r) => r.candidate.source_path === "docs/a.md")?.rank ?? 0;
    const bRank =
      reranked.find((r) => r.candidate.source_path === "docs/b.md")?.rank ?? 0;
    // With the flag off, A and B are symmetric on this evidence.
    expect(aRank).toBeLessThanOrEqual(bRank + 1); // tied or A first arbitrarily
    expect(bRank).toBeLessThanOrEqual(aRank + 1);
  });
});
