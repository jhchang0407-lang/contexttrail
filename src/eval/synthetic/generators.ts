/**
 * Synthetic case generators for V3+ source-selection mechanism testing.
 *
 * Each generator answers a corpus-wide question about how a doc/query class
 * should be ranked. Cases are pure data: a synthetic corpus, a query, an
 * intent label, an expected top-1 source, an expected must-include set.
 *
 * The generators are deterministic given a seed (mulberry32 PRNG) so cases
 * are reproducible across runs and machines. The corpus shapes are
 * intentionally generic — no tokens drawn from real fixture corpora — so
 * any primitive that wins here wins for general structural reasons.
 */
import type { QueryIntent } from "../../retrieve/source-rerank.js";
import type { SourceSelectionLossCategory } from "./loss-category.js";
import type { DocPurpose } from "../../types/source-profile.js";
import type { DocRole } from "../../types/chunk.js";

export type SyntheticDoc = {
  source_path: string;
  title: string;
  h1: string;
  intro: string;
  headings: string[];
  body_tokens: string[];
  doc_purpose: DocPurpose;
  doc_role: DocRole;
  /** Inbound link texts collected from other corpus docs (for anchor-text learning). */
  inbound_link_texts?: string[];
  /** Outbound markdown links to other corpus source_paths. */
  outbound_links?: string[];
  /** Declared questions the doc answers (mirrors SourceProfile.questions_answered). */
  questions_answered?: string[];
};

export type SyntheticCase = {
  id: string;
  loss_class: SourceSelectionLossCategory;
  intent: QueryIntent;
  query: string;
  query_tokens: string[];
  corpus: SyntheticDoc[];
  expected_top1: string;
  expected_must_include_top3: string[];
  /** Optional unsupported sentinel for fail-closed sanity cases. */
  expected_unsupported?: boolean;
  /** Human-readable explanation of what this case probes. */
  rationale: string;
  /**
   * V4.3 — substitution slots used by the paraphrase fanout wrapper to emit
   * the same case under multiple query phrasings. Generators populate the
   * keys their templates need (`topic`, `alt`, `phrase`, `filename`, `pkg`,
   * `parent`). Optional so non-fanned generators stay valid.
   */
  paraphrase_args?: Record<string, string>;
};

// Mulberry32 — small, fast, deterministic PRNG. We only need uniform 0..1
// for ordering and id seeding; cryptographic quality is irrelevant.
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

// Generic topic vocabularies. Deliberately abstract — no overlap with the
// real OSS fixture corpora — so primitives that work here aren't fitted to
// fixture-specific tokens.
const PARENT_TOPICS = [
  "scheduler",
  "transport",
  "renderer",
  "compiler",
  "runtime",
  "loader",
  "router",
  "binder",
  "resolver",
  "planner",
] as const;

const LEAF_TOPIC_SUFFIXES = [
  "lifecycle",
  "options",
  "errors",
  "events",
  "internals",
  "dispatch",
  "fallback",
  "warmup",
  "teardown",
  "telemetry",
] as const;

const REFERENCE_NOUNS = [
  "configuration",
  "package",
  "manifest",
  "command",
  "registry",
  "schema",
  "field",
  "table",
] as const;

const COMPOSITIONAL_MODES = [
  "batch",
  "streaming",
  "preview",
  "strict",
  "incremental",
  "embedded",
] as const;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

export type GeneratorOptions = {
  count: number;
  seed: number;
};

export function generateParentVsLeafCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    const parentPath = `docs/concepts/${topic}.md`;
    const leafCount = 2 + Math.floor(r() * 3); // 2..4 leaves
    const leaves: SyntheticDoc[] = [];
    for (let k = 0; k < leafCount; k++) {
      const leafSuffix = `${pick(r, LEAF_TOPIC_SUFFIXES)}_${k}`;
      const leafPath = `docs/concepts/${topic}/${leafSuffix}.md`;
      leaves.push({
        source_path: leafPath,
        title: `${capitalize(topic)} ${leafSuffix}`,
        h1: `${capitalize(topic)} ${leafSuffix}`,
        intro: `This page documents the ${leafSuffix} aspect of the ${topic}.`,
        headings: [`${leafSuffix} basics`, `${leafSuffix} examples`],
        body_tokens: tokenize(
          `${topic} ${leafSuffix} ${topic} ${leafSuffix} examples reference`,
        ),
        doc_purpose: "guide",
        doc_role: "canonical",
      });
    }
    const parent: SyntheticDoc = {
      source_path: parentPath,
      title: capitalize(topic),
      h1: capitalize(topic),
      intro: `The ${topic} is the central concept that ties together ${leaves
        .map((l) => l.source_path.split("/").pop())
        .join(", ")}.`,
      headings: ["Overview", "How it composes", "When to extend"],
      body_tokens: tokenize(
        `${topic} overview concept design ${topic} ${topic} composition`,
      ),
      doc_purpose: "concept",
      doc_role: "canonical",
      outbound_links: leaves.map((l) => l.source_path),
    };
    // Each leaf links back to the parent — simulates a real doc graph where
    // the parent is the canonical/back-linked source.
    for (const leaf of leaves) {
      leaf.outbound_links = [parentPath];
      leaf.inbound_link_texts = [];
    }
    parent.inbound_link_texts = leaves.map(() => `the ${topic} concept`);

    const intent: QueryIntent = r() < 0.5 ? "broad_domain" : "decision_lookup";
    const query =
      intent === "decision_lookup"
        ? `why use ${topic}`
        : `${topic} overview`;

    cases.push({
      id: `parent_vs_leaf-${opts.seed}-${i}`,
      loss_class: "parent_vs_leaf",
      intent,
      query,
      query_tokens: tokenize(query),
      corpus: [parent, ...leaves],
      expected_top1: parentPath,
      expected_must_include_top3: [parentPath],
      rationale: `Query "${query}" targets the parent concept; ${leafCount} leaves under ${parentPath} should not crowd the parent out of top-1.`,
      paraphrase_args: { topic },
    });
  }
  return cases;
}

export function generateAnchoredExactVsBroadCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, LEAF_TOPIC_SUFFIXES)}_${i}_${opts.seed}`;
    const exactPath = `docs/reference/${topic}.md`;
    const exactDoc: SyntheticDoc = {
      source_path: exactPath,
      title: capitalize(topic),
      h1: capitalize(topic),
      intro: `Exact reference for ${topic}.`,
      headings: [`${topic} usage`, `${topic} rules`, `${topic} examples`],
      body_tokens: tokenize(
        `${topic} ${topic} ${topic} usage rules examples reference`,
      ),
      doc_purpose: "guide",
      doc_role: "canonical",
    };
    const distractors: SyntheticDoc[] = [];
    const distractorCount = 2 + Math.floor(r() * 3); // 2..4 distractors
    for (let k = 0; k < distractorCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      const distractorPath = `docs/reference/${noun}_${k}.md`;
      distractors.push({
        source_path: distractorPath,
        title: capitalize(noun),
        h1: capitalize(noun),
        intro: `Broad reference for ${noun}; mentions ${topic} in passing.`,
        headings: [`${noun} fields`, `${noun} options`, `${noun} caveats`],
        // Distractors mention the topic in body but not in title/headings.
        body_tokens: tokenize(
          `${noun} ${noun} ${noun} fields options ${topic} caveats`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }
    const query = topic;
    cases.push({
      id: `anchored_exact_vs_broad-${opts.seed}-${i}`,
      loss_class: "anchored_exact_vs_broad",
      intent: "file_anchored",
      query,
      query_tokens: tokenize(query),
      corpus: [exactDoc, ...distractors],
      expected_top1: exactPath,
      expected_must_include_top3: [exactPath],
      rationale: `Query is the exact title of ${exactPath}; ${distractorCount} api_reference distractors mention the topic in body only.`,
      paraphrase_args: { phrase: topic },
    });
  }
  return cases;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * decision_vs_procedural — query has decision shape ("why X over Y",
 * "tradeoffs of X"), corpus has one ADR/concept doc plus 2-3 procedural
 * guides that mention X but don't explain the rationale.
 */
export function generateDecisionVsProceduralCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    const alt = `${pick(r, PARENT_TOPICS)}_alt_${opts.seed}`;
    const decisionPath = `docs/decisions/${topic}_vs_${alt}.md`;
    const decisionDoc: SyntheticDoc = {
      source_path: decisionPath,
      title: `${capitalize(topic)} vs ${capitalize(alt)}`,
      h1: `${capitalize(topic)} vs ${capitalize(alt)}`,
      intro: `Why we chose ${topic} over ${alt}, and when to revisit.`,
      headings: ["Tradeoffs", "When to choose " + topic, "When to choose " + alt],
      body_tokens: tokenize(
        `${topic} ${alt} tradeoff rationale why decision ${topic} ${alt}`,
      ),
      doc_purpose: "concept",
      doc_role: "canonical",
    };
    const procedurals: SyntheticDoc[] = [];
    const procCount = 2 + Math.floor(r() * 2);
    for (let k = 0; k < procCount; k++) {
      const verb = pick(r, ["configuring", "running", "debugging", "deploying"] as const);
      procedurals.push({
        source_path: `docs/guides/${verb}_${topic}_${k}.md`,
        title: `${capitalize(verb)} ${topic}`,
        h1: `${capitalize(verb)} ${topic}`,
        intro: `Step-by-step guide for ${verb} ${topic}.`,
        headings: [`${topic} setup`, `${topic} options`, `${topic} examples`],
        body_tokens: tokenize(
          `${topic} ${topic} ${topic} ${verb} steps options examples ${topic}`,
        ),
        doc_purpose: "guide",
        doc_role: "canonical",
      });
    }
    const noise = noiseDocs(r, 2, opts.seed * 17 + i);
    const query = `why use ${topic} over ${alt}`;
    cases.push({
      id: `decision_vs_procedural-${opts.seed}-${i}`,
      loss_class: "decision_vs_procedural",
      intent: "decision_lookup",
      query,
      query_tokens: tokenize(query),
      corpus: [decisionDoc, ...procedurals, ...noise],
      expected_top1: decisionPath,
      expected_must_include_top3: [decisionPath],
      rationale: `Decision query "${query}" has the canonical rationale doc. Procedural guides mention "${topic}" densely but don't carry the rationale. Mirrors trpc-decision-rpc-vs-rest real-fixture loss.`,
      paraphrase_args: { topic, alt },
    });
  }
  return cases;
}

/**
 * V5.5 — ambiguous multi-answer probe. Three concept docs are equally
 * canonical for the query (different mechanisms / approaches that all
 * answer the question). Top-3 should contain ALL three. Probes whether
 * V3 picks one and fills with distractors instead of surfacing the set.
 *
 * Distinct from V4.6 set-cover (concept + example) — there the two
 * docs differed in purpose. Here all three share `doc_purpose: "concept"`.
 */
const AMBIGUOUS_VARIANTS = [
  "imperative",
  "declarative",
  "functional",
  "reactive",
  "hybrid",
] as const;

/**
 * V5.7 — query-mode classification probe. Sits AT compileQueryScopes
 * rather than downstream. Real-corpus eval shows ~12 of 33 failures
 * are `signal_empty` over-classification: anchors provided but not
 * matched verbatim against indexed chunk anchors.
 */
export type QueryModeProbeFailureClass =
  | "exact_match"
  | "no_anchors"
  | "anchors_absent"
  | "case_mismatch"
  | "form_variant"
  | "path_segment";

type CodeAnchorKindLite = "file" | "symbol" | "route";

export type QueryModeProbeCase = {
  id: string;
  failure_class: QueryModeProbeFailureClass;
  expected_query_mode: "anchored" | "unanchored" | "signal_empty";
  query_anchors: { files?: string[]; symbols?: string[]; routes?: string[] };
  available_chunk_anchors: Array<{ kind: CodeAnchorKindLite; value: string }>;
};

const QUERY_MODE_SYMBOL_BASES = [
  "Scheduler",
  "TransportClient",
  "RendererCore",
  "RuntimeContext",
  "RouterAdapter",
  "BinderRegistry",
  "ResolverHost",
] as const;

export function generateQueryModeCases(
  opts: GeneratorOptions,
): QueryModeProbeCase[] {
  const r = rng(opts.seed);
  const cases: QueryModeProbeCase[] = [];
  const classes: QueryModeProbeFailureClass[] = [
    "exact_match",
    "no_anchors",
    "anchors_absent",
    "case_mismatch",
    "form_variant",
    "path_segment",
  ];
  for (let i = 0; i < opts.count; i++) {
    const cls = classes[i % classes.length] as QueryModeProbeFailureClass;
    const symbol = `${pick(r, QUERY_MODE_SYMBOL_BASES)}_${i}_${opts.seed}`;
    const file = `src/synthetic_${i}_${opts.seed}/${pick(r, ["main", "core", "adapter", "host"] as const)}.ts`;
    cases.push(buildQueryModeCase(cls, i, opts.seed, symbol, file));
  }
  return cases;
}

function buildQueryModeCase(
  cls: QueryModeProbeFailureClass,
  i: number,
  seed: number,
  symbol: string,
  file: string,
): QueryModeProbeCase {
  const id = `query_mode-${cls}-${seed}-${i}`;
  switch (cls) {
    case "exact_match":
      return {
        id,
        failure_class: cls,
        expected_query_mode: "anchored",
        query_anchors: { symbols: [symbol] },
        available_chunk_anchors: [{ kind: "symbol", value: symbol }],
      };
    case "no_anchors":
      return {
        id,
        failure_class: cls,
        expected_query_mode: "unanchored",
        query_anchors: {},
        available_chunk_anchors: [{ kind: "symbol", value: symbol }],
      };
    case "anchors_absent":
      return {
        id,
        failure_class: cls,
        expected_query_mode: "signal_empty",
        query_anchors: { symbols: [symbol] },
        available_chunk_anchors: [
          { kind: "symbol", value: `${symbol}_NotPresent` },
          { kind: "file", value: "src/elsewhere/other.ts" },
        ],
      };
    case "case_mismatch":
      return {
        id,
        failure_class: cls,
        expected_query_mode: "anchored",
        query_anchors: { symbols: [symbol.toLowerCase()] },
        available_chunk_anchors: [{ kind: "symbol", value: symbol }],
      };
    case "form_variant":
      return {
        id,
        failure_class: cls,
        expected_query_mode: "anchored",
        query_anchors: { symbols: ["JWT"] },
        available_chunk_anchors: [
          { kind: "symbol", value: `JWTAuthMiddleware_${i}_${seed}` },
        ],
      };
    case "path_segment":
      return {
        id,
        failure_class: cls,
        expected_query_mode: "anchored",
        query_anchors: { files: [file] },
        available_chunk_anchors: [
          { kind: "symbol", value: file.split("/")[1] ?? "synthetic" },
        ],
      };
  }
}

export function generateAmbiguousMultiAnswerCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    const distinctVariants: string[] = [];
    while (distinctVariants.length < 3) {
      const next = pick(r, AMBIGUOUS_VARIANTS);
      if (!distinctVariants.includes(next)) distinctVariants.push(next);
    }
    const canonicalDocs: SyntheticDoc[] = distinctVariants.map(
      (variant) => ({
        source_path: `docs/concepts/${topic}-${variant}.md`,
        title: `${capitalize(topic)} (${variant})`,
        h1: `${capitalize(topic)} ${variant}`,
        intro: `Documents the ${variant} approach to ${topic}.`,
        headings: [`${variant} setup`, `${variant} caveats`],
        body_tokens: tokenize(
          `${topic} ${topic} ${variant} setup caveats examples ${topic}`,
        ),
        doc_purpose: "concept",
        doc_role: "canonical",
      }),
    );
    const distractors: SyntheticDoc[] = [];
    const distractorCount = 2 + Math.floor(r() * 2);
    for (let k = 0; k < distractorCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      distractors.push({
        source_path: `docs/reference/${topic}-${noun}-${k}.md`,
        title: `${capitalize(topic)} ${capitalize(noun)}`,
        h1: `${capitalize(topic)} ${capitalize(noun)}`,
        intro: `${capitalize(noun)} reference for ${topic}.`,
        headings: [`${noun} fields`, `${noun} options`, `${topic} ${noun}`],
        body_tokens: tokenize(
          `${topic} ${topic} ${topic} ${noun} ${noun} fields options examples`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }
    const noise = noiseDocs(r, 2, opts.seed * 83 + i);
    const query = `how does ${topic} work`;
    cases.push({
      id: `ambiguous_multi_answer-${opts.seed}-${i}`,
      // Reuse overview_vs_reference label for runner grouping.
      loss_class: "overview_vs_reference",
      intent: "broad_domain",
      query,
      query_tokens: tokenize(query),
      corpus: [...canonicalDocs, ...distractors, ...noise],
      expected_top1: canonicalDocs[0]!.source_path,
      expected_must_include_top3: canonicalDocs.map((d) => d.source_path),
      rationale: `Ambiguous query "${query}": THREE equally-canonical concept docs (${distinctVariants.join(", ")}) must all surface in top-3.`,
      paraphrase_args: { topic },
    });
  }
  return cases;
}

/**
 * V4.12b — compositional SET-COVER queries. Distinct from
 * `generateCompositionalModeCases` (single combined target): here the
 * canonical answer is a SET of two docs that must BOTH surface in top-3.
 *   - A-main: docs/concepts/{feature}.md
 *   - B-A bridge: docs/adapters/{platform}/{feature}.md
 *
 * Real-world shape: "tRPC with Next.js" → both the tRPC concept doc AND
 * the Next.js adapter must reach top-3 for the agent to compose correctly.
 * Top-1 is not sufficient.
 */
const COMPOSITIONAL_PLATFORMS = [
  "nextjs",
  "bun",
  "deno",
  "workers",
  "vercel",
  "node",
  "edge",
] as const;

const COMPOSITIONAL_CONNECTORS = ["with", "in", "for", "on"] as const;

export function generateCompositionalSetCoverCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const feature = `${pick(r, PARENT_TOPICS)}_f${i}_${opts.seed}`;
    const platform = `${pick(r, COMPOSITIONAL_PLATFORMS)}_p${i}_${opts.seed}`;
    const aPath = `docs/concepts/${feature}.md`;
    const bridgePath = `docs/adapters/${platform}/${feature}.md`;

    const aDoc: SyntheticDoc = {
      source_path: aPath,
      title: capitalize(feature),
      h1: capitalize(feature),
      intro: `Overview of ${feature}.`,
      headings: [`What ${feature} is`, `When to use ${feature}`],
      body_tokens: tokenize(
        `${feature} ${feature} concept overview composition design`,
      ),
      doc_purpose: "concept",
      doc_role: "canonical",
    };
    const bridgeDoc: SyntheticDoc = {
      source_path: bridgePath,
      title: `${capitalize(feature)} on ${capitalize(platform)}`,
      h1: `${capitalize(feature)} on ${capitalize(platform)}`,
      intro: `How to use ${feature} when running on ${platform}.`,
      headings: [`Setup`, `${platform}-specific notes`, `Caveats`],
      body_tokens: tokenize(
        `${feature} ${platform} setup integration ${platform} caveats ${feature}`,
      ),
      doc_purpose: "guide",
      doc_role: "canonical",
    };

    const aDistractors: SyntheticDoc[] = [];
    const aDistractorCount = 2 + Math.floor(r() * 2);
    for (let k = 0; k < aDistractorCount; k++) {
      const leafSuffix = `${pick(r, LEAF_TOPIC_SUFFIXES)}_${k}`;
      aDistractors.push({
        source_path: `docs/concepts/${feature}/${leafSuffix}.md`,
        title: `${capitalize(feature)} ${leafSuffix}`,
        h1: `${capitalize(feature)} ${leafSuffix}`,
        intro: `${capitalize(feature)} ${leafSuffix} guide.`,
        headings: [`${leafSuffix} basics`, `${leafSuffix} examples`],
        body_tokens: tokenize(
          `${feature} ${feature} ${feature} ${leafSuffix} examples reference`,
        ),
        doc_purpose: "guide",
        doc_role: "canonical",
      });
    }

    const bDistractors: SyntheticDoc[] = [];
    const bDistractorCount = 2 + Math.floor(r() * 2);
    for (let k = 0; k < bDistractorCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      bDistractors.push({
        source_path: `docs/adapters/${platform}/${noun}_${k}.md`,
        title: `${capitalize(platform)} ${capitalize(noun)}`,
        h1: `${capitalize(platform)} ${capitalize(noun)}`,
        intro: `${capitalize(platform)} ${noun} reference.`,
        headings: [`${noun} fields`, `${noun} options`],
        body_tokens: tokenize(
          `${platform} ${platform} ${platform} ${noun} ${noun} fields options`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }

    const noise = noiseDocs(r, 2, opts.seed * 71 + i);
    const connector = pick(r, COMPOSITIONAL_CONNECTORS);
    const query = `${feature} ${connector} ${platform}`;
    cases.push({
      id: `compositional_set_cover-${opts.seed}-${i}`,
      loss_class: "overview_vs_reference",
      intent: "broad_domain",
      query,
      query_tokens: tokenize(query),
      corpus: [aDoc, bridgeDoc, ...aDistractors, ...bDistractors, ...noise],
      expected_top1: aPath,
      expected_must_include_top3: [aPath, bridgePath],
      rationale: `Compositional set-cover: query "${query}" requires BOTH ${aPath} and ${bridgePath} in top-3. Same-feature and same-platform distractors compete for slots.`,
      paraphrase_args: { feature, platform },
    });
  }
  return cases;
}

/**
 * V4.12c — HARD compositional set-cover. The basic version is too easy
 * (lexical alone covers both anchors). The hard version adds adversarial
 * pressure:
 *   - bridge title is bare (e.g., "Feature") — same as A-main, ambiguous
 *   - 5+ A-only distractors whose titles include the feature
 *   - 5+ B-only distractors whose titles include the platform
 *   - 2 "wrong-bridge" distractors: feature on a DIFFERENT platform
 *     (e.g., feature on WrongPlatform.md) — looks like the answer, isn't
 *
 * Pass criterion: top-3 still contains BOTH the right A-main and the
 * right B-A bridge.
 */
export function generateHardCompositionalSetCoverCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const feature = `${pick(r, PARENT_TOPICS)}_f${i}_${opts.seed}`;
    const platform = `${pick(r, COMPOSITIONAL_PLATFORMS)}_p${i}_${opts.seed}`;
    const wrongPlatformBase = pickExcluding(r, COMPOSITIONAL_PLATFORMS, platformBase(platform));
    const wrongPlatform = `${wrongPlatformBase}_w${i}_${opts.seed}`;
    const aPath = `docs/concepts/${feature}.md`;
    const bridgePath = `docs/adapters/${platform}/${feature}.md`;

    const aDoc: SyntheticDoc = {
      source_path: aPath,
      title: capitalize(feature),
      h1: capitalize(feature),
      intro: `Overview of ${feature}.`,
      headings: [`Concept`, `Composition`],
      // Stripped headings — no longer help A-main lexically beat distractors.
      body_tokens: tokenize(`${feature} concept overview design`),
      doc_purpose: "concept",
      doc_role: "canonical",
    };
    const bridgeDoc: SyntheticDoc = {
      source_path: bridgePath,
      title: capitalize(feature), // bare, ambiguous with aDoc
      h1: capitalize(feature),
      intro: `Using ${feature} on ${platform}.`,
      headings: [`Setup`, `${platform} notes`, `Caveats`],
      body_tokens: tokenize(
        `${feature} ${platform} setup integration ${feature}`,
      ),
      doc_purpose: "guide",
      doc_role: "canonical",
    };

    // 5 A-only distractors with feature in title — competes with aDoc.
    const aDistractors: SyntheticDoc[] = [];
    for (let k = 0; k < 5; k++) {
      const leafSuffix = `${pick(r, LEAF_TOPIC_SUFFIXES)}_${k}`;
      aDistractors.push({
        source_path: `docs/concepts/${feature}/${leafSuffix}.md`,
        title: `${capitalize(feature)} ${leafSuffix}`,
        h1: `${capitalize(feature)} ${leafSuffix}`,
        intro: `${capitalize(feature)} ${leafSuffix} guide.`,
        headings: [`${feature} basics`, `${feature} examples`],
        body_tokens: tokenize(
          `${feature} ${feature} ${feature} ${feature} ${leafSuffix} examples reference`,
        ),
        doc_purpose: "guide",
        doc_role: "canonical",
      });
    }

    // 5 B-only distractors with platform in title — competes with bridge.
    const bDistractors: SyntheticDoc[] = [];
    for (let k = 0; k < 5; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      bDistractors.push({
        source_path: `docs/adapters/${platform}/${noun}_${k}.md`,
        title: `${capitalize(platform)} ${capitalize(noun)}`,
        h1: `${capitalize(platform)} ${capitalize(noun)}`,
        intro: `${capitalize(platform)} ${noun} reference.`,
        headings: [`${platform} ${noun} fields`, `${platform} ${noun} options`],
        body_tokens: tokenize(
          `${platform} ${platform} ${platform} ${platform} ${noun} ${noun} fields options`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }

    // 2 wrong-bridge distractors: feature on a DIFFERENT platform.
    const wrongBridges: SyntheticDoc[] = [];
    for (let k = 0; k < 2; k++) {
      wrongBridges.push({
        source_path: `docs/adapters/${wrongPlatform}/${feature}-${k}.md`,
        title: `${capitalize(feature)} on ${capitalize(wrongPlatform)}`,
        h1: `${capitalize(feature)} on ${capitalize(wrongPlatform)}`,
        intro: `Using ${feature} on ${wrongPlatform}.`,
        headings: [`Setup`, `${wrongPlatform} notes`, `Variant ${k}`],
        body_tokens: tokenize(
          `${feature} ${wrongPlatform} setup ${feature} ${wrongPlatform} variant ${k}`,
        ),
        doc_purpose: "guide",
        doc_role: "canonical",
      });
    }

    const noise = noiseDocs(r, 2, opts.seed * 79 + i);
    const connector = pick(r, COMPOSITIONAL_CONNECTORS);
    const query = `${feature} ${connector} ${platform}`;
    cases.push({
      id: `compositional_set_cover_hard-${opts.seed}-${i}`,
      loss_class: "overview_vs_reference",
      intent: "broad_domain",
      query,
      query_tokens: tokenize(query),
      corpus: [
        aDoc,
        bridgeDoc,
        ...aDistractors,
        ...bDistractors,
        ...wrongBridges,
        ...noise,
      ],
      expected_top1: aPath,
      expected_must_include_top3: [aPath, bridgePath],
      rationale: `Hard compositional set-cover: query "${query}" must surface BOTH ${aPath} (A-main, bare title — ambiguous with bridge) and ${bridgePath} (the RIGHT platform's bridge), beating 5 feature-titled A-distractors, 5 platform-titled B-distractors, and 2 wrong-platform bridges.`,
      paraphrase_args: { feature, platform },
    });
  }
  return cases;
}

function platformBase(platform: string): string {
  const cut = platform.indexOf("_");
  return cut === -1 ? platform : platform.slice(0, cut);
}

function pickExcluding<T extends string>(
  rand: () => number,
  items: readonly T[],
  excluded: string,
): T {
  const filtered = items.filter((item) => item !== excluded);
  return (filtered[Math.floor(rand() * filtered.length)] ?? items[0]) as T;
}

/**
 * compositional_mode — multi-anchor query where BOTH the domain topic and a
 * mode token are required to find the canonical answer. Mirrors real queries
 * like "X with Y", "X in Z mode", where single-anchor retrieval can surface
 * the topic overview or the mode reference but miss the combined doc.
 */
export function generateCompositionalModeCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    const mode = pick(r, COMPOSITIONAL_MODES);
    const targetPath = `docs/guides/${topic}-${mode}.md`;
    const topicOverviewPath = `docs/concepts/${topic}.md`;
    const modeReferencePath = `docs/reference/${mode}.md`;

    const targetDoc: SyntheticDoc = {
      source_path: targetPath,
      title: `${capitalize(topic)} in ${mode} mode`,
      h1: `${capitalize(topic)} in ${mode} mode`,
      intro: `How ${topic} behaves in ${mode} mode.`,
      headings: [`${mode} setup`, `${topic} with ${mode}`, `${mode} caveats`],
      body_tokens: tokenize(
        `${topic} ${topic} ${mode} mode setup caveats examples ${topic} ${mode}`,
      ),
      doc_purpose: "guide",
      doc_role: "canonical",
    };
    const topicOverview: SyntheticDoc = {
      source_path: topicOverviewPath,
      title: capitalize(topic),
      h1: capitalize(topic),
      intro: `Overview of ${topic}.`,
      headings: [`What ${topic} is`, `Why use ${topic}`],
      body_tokens: tokenize(`${topic} ${topic} overview concept design`),
      doc_purpose: "concept",
      doc_role: "canonical",
    };
    const modeReference: SyntheticDoc = {
      source_path: modeReferencePath,
      title: `${capitalize(mode)} mode`,
      h1: `${capitalize(mode)} mode`,
      intro: `Reference for ${mode} mode.`,
      headings: [`${mode} options`, `${mode} examples`],
      body_tokens: tokenize(`${mode} ${mode} mode options examples reference`),
      doc_purpose: "api_reference",
      doc_role: "canonical",
    };
    const distractors: SyntheticDoc[] = [];
    const distractorCount = 3 + Math.floor(r() * 2);
    for (let k = 0; k < distractorCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      distractors.push({
        source_path: `docs/reference/${topic}-${mode}-${noun}-${k}.md`,
        title: `${capitalize(topic)} ${capitalize(noun)}`,
        h1: `${capitalize(topic)} ${capitalize(noun)}`,
        intro: `${capitalize(noun)} reference for ${topic} that mentions ${mode}.`,
        headings: [`${noun} fields`, `${mode} ${noun}`, `${topic} ${noun}`],
        body_tokens: tokenize(
          `${topic} ${topic} ${mode} ${noun} ${noun} fields options examples`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }

    const query =
      r() < 0.5 ? `${topic} with ${mode}` : `${topic} in ${mode} mode`;
    cases.push({
      id: `compositional_mode-${opts.seed}-${i}`,
      loss_class: "adjacent_sibling",
      intent: "broad_domain",
      query,
      query_tokens: tokenize(query),
      corpus: [targetDoc, topicOverview, modeReference, ...distractors],
      expected_top1: targetPath,
      expected_must_include_top3: [targetPath],
      rationale: `Compositional query "${query}" should prefer the combined ${topic}+${mode} guide over the topic overview or mode reference alone.`,
      paraphrase_args: { topic, mode },
    });
  }
  return cases;
}

/**
 * adjacent_sibling — required source has a sibling with the same FILENAME
 * but in a different parent path (e.g., server/adapters/nextjs.md vs
 * client/nextjs.md). Both will surface; the engine must pick the correct
 * parent context. Structurally this is the hardest deterministic case.
 */
export function generateAdjacentSiblingCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const filename = `${pick(r, LEAF_TOPIC_SUFFIXES)}_${i}_${opts.seed}`;
    const correctParent = "server";
    const wrongParent = "client";
    const correctPath = `docs/${correctParent}/${filename}.md`;
    const wrongPath = `docs/${wrongParent}/${filename}.md`;
    const correctDoc: SyntheticDoc = {
      source_path: correctPath,
      title: `${capitalize(filename)} (server)`,
      h1: capitalize(filename),
      intro: `${capitalize(filename)} on the server side.`,
      headings: [`${filename} setup on server`, `server-side ${filename}`],
      body_tokens: tokenize(
        `server ${filename} server ${filename} server adapter ${filename}`,
      ),
      doc_purpose: "guide",
      doc_role: "canonical",
    };
    const wrongDoc: SyntheticDoc = {
      source_path: wrongPath,
      title: `${capitalize(filename)} (client)`,
      h1: capitalize(filename),
      intro: `${capitalize(filename)} on the client side.`,
      headings: [`${filename} setup on client`, `client-side ${filename}`],
      body_tokens: tokenize(
        `client ${filename} client ${filename} client setup ${filename}`,
      ),
      doc_purpose: "guide",
      doc_role: "canonical",
    };
    const noise = noiseDocs(r, 2, opts.seed * 19 + i);
    // Query mentions "server" — this is the disambiguating token.
    const query = `${filename} on the server`;
    cases.push({
      id: `adjacent_sibling-${opts.seed}-${i}`,
      loss_class: "adjacent_sibling",
      intent: "broad_domain",
      query,
      query_tokens: tokenize(query),
      corpus: [correctDoc, wrongDoc, ...noise],
      expected_top1: correctPath,
      expected_must_include_top3: [correctPath],
      rationale: `Two docs share filename "${filename}" but live under different parents (server/, client/). Query disambiguates with "server". Mirrors trpc-cross-module-nextjs real-fixture loss.`,
      paraphrase_args: { filename, parent: correctParent },
    });
  }
  return cases;
}

/**
 * changelog_release_intent — query asks "what's new in X" / "X migration"
 * but the canonical changelog can be outranked by README and feature docs
 * that mention the version verbatim.
 */
export function generateChangelogReleaseIntentCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const pkg = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    const changelogPath = `packages/${pkg}/CHANGELOG.md`;
    const changelog: SyntheticDoc = {
      source_path: changelogPath,
      title: `${capitalize(pkg)} changelog`,
      h1: "Changelog",
      intro: `Release history for ${pkg}.`,
      headings: ["v3.0.0", "v2.0.0", "v1.0.0"],
      body_tokens: tokenize(`${pkg} version release breaking changed added`),
      doc_purpose: "changelog",
      doc_role: "canonical",
    };
    const distractors: SyntheticDoc[] = [];
    const distractorCount = 2 + Math.floor(r() * 2);
    for (let k = 0; k < distractorCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      distractors.push({
        source_path: `packages/${pkg}/${noun}_${k}.md`,
        title: `${capitalize(pkg)} ${noun}`,
        h1: `${pkg} ${noun}`,
        intro: `${pkg} ${noun} reference.`,
        headings: [`${noun} basics`, `${pkg} v3 ${noun}`],
        body_tokens: tokenize(
          `${pkg} ${pkg} ${noun} ${noun} v3 v3 reference examples`,
        ),
        doc_purpose: "package_readme",
        doc_role: "canonical",
      });
    }
    const noise = noiseDocs(r, 2, opts.seed * 23 + i);
    const query = `what changed in ${pkg} v3`;
    cases.push({
      id: `changelog_release_intent-${opts.seed}-${i}`,
      loss_class: "changelog_release_intent",
      intent: "broad_domain",
      query,
      query_tokens: tokenize(query),
      corpus: [changelog, ...distractors, ...noise],
      expected_top1: changelogPath,
      expected_must_include_top3: [changelogPath],
      rationale: `Release-intent query "${query}". Canonical CHANGELOG.md should beat README/feature docs that mention v3 in passing. Mirrors zod-unanchored-changelog real-fixture loss.`,
      paraphrase_args: { pkg },
    });
  }
  return cases;
}

/**
 * V4.3 — query-paraphrase fanout. For each input case, emit N paraphrased
 * variants that share corpus and expected_top1 but vary the query shape.
 * The variants probe whether V4 primitives are real (intent-shaped, robust)
 * or just fitted to one phrasing.
 *
 * Templates per loss class are intentionally written to feel like natural
 * user phrasing, including aliases the original generator did not use. A
 * primitive that depends on a single trigger word will visibly leak; one
 * that responds to query intent shape will hold.
 */
type ParaphraseTemplateFn = (args: Record<string, string>) => string[];

function slot(args: Record<string, string>, key: string): string {
  return args[key] ?? "";
}

const PARAPHRASE_TEMPLATES: Partial<
  Record<SourceSelectionLossCategory, ParaphraseTemplateFn>
> = {
  parent_vs_leaf: (a) => {
    const t = slot(a, "topic");
    return [
      `${t} overview`,
      `what is ${t}`,
      `intro to ${t}`,
      `explain ${t}`,
      `${t} concept`,
      `${t} basics`,
      `guide to ${t}`,
      `why use ${t}`,
      `help me get oriented on ${t}`,
      `i need the big picture on ${t}`,
    ];
  },
  anchored_exact_vs_broad: (a) => {
    const p = slot(a, "phrase");
    return [
      p,
      `${p} reference`,
      `${p} documentation`,
      `${p} docs`,
      `how does ${p} work`,
      `${p} examples`,
      `where is the canonical writeup for ${p}`,
      `i need the main doc for ${p}`,
    ];
  },
  decision_vs_procedural: (a) => {
    const t = slot(a, "topic");
    const alt = slot(a, "alt");
    return [
      `why use ${t} over ${alt}`,
      `${t} vs ${alt}`,
      `tradeoffs of ${t}`,
      `when to choose ${t}`,
      `${t} or ${alt}`,
      `rationale for ${t}`,
    ];
  },
  adjacent_sibling: (a) => {
    const f = slot(a, "filename");
    const p = slot(a, "parent");
    return [
      `${f} on the ${p}`,
      `${p} ${f}`,
      `${p}-side ${f}`,
      `${f} ${p} adapter`,
    ];
  },
  changelog_release_intent: (a) => {
    const p = slot(a, "pkg");
    return [
      // The four phrasings the user explicitly named.
      `what changed in ${p}`,
      `whats new in ${p}`,
      `${p} v3 changes`,
      `migration to ${p} v3`,
      // Plus a few more natural shapes.
      `${p} release notes`,
      `${p} upgrade guide`,
      `breaking changes in ${p}`,
      `${p} changelog`,
      `before i adopt ${p} v3 what do i need to know`,
      `i am moving an app onto ${p} v3`,
    ];
  },
  overview_vs_reference: (a) => {
    const t = slot(a, "topic");
    return [
      `guide to ${t}`,
      `${t} guide`,
      `intro to ${t}`,
      `what is ${t}`,
      `explain ${t}`,
      `help me understand ${t}`,
      `i need an orientation to ${t}`,
    ];
  },
};

export function withParaphraseFanout(cases: SyntheticCase[]): SyntheticCase[] {
  const out: SyntheticCase[] = [];
  for (const c of cases) {
    const template = PARAPHRASE_TEMPLATES[c.loss_class];
    const args = c.paraphrase_args;
    if (!template || !args) {
      // No template registered — emit the case unchanged so we never silently
      // drop a class.
      out.push(c);
      continue;
    }
    const variants = template(args);
    if (variants.length === 0) {
      out.push(c);
      continue;
    }
    variants.forEach((query, idx) => {
      out.push({
        ...c,
        id: `${c.id}-p${idx}`,
        query,
        query_tokens: tokenize(query),
        rationale: `${c.rationale} (paraphrase #${idx}: "${query}")`,
      });
    });
  }
  return out;
}

/**
 * Perturbation wrapper: flip `doc_purpose` on a fraction of docs to simulate
 * the real-corpus failure mode where source-profile classification is noisy.
 * If V3 leaks under noisy profiles, the deterministic fix has to depend less
 * on profile labels and more on structural / lexical / graph signals.
 *
 * Per-case PRNG keyed on case id so the perturbation is deterministic for a
 * given (cases, seed) pair. The expected_top1 doc keeps its purpose — we are
 * probing whether V3 still picks it correctly when DISTRACTORS are
 * mislabeled, not whether V3 can recover from a wrong target label.
 */
export function withNoisyProfiles(
  cases: SyntheticCase[],
  opts: { probability: number; seed: number },
): SyntheticCase[] {
  const fallbackPurposes: DocPurpose[] = [
    "concept",
    "guide",
    "api_reference",
    "package_readme",
    "runbook",
    "unknown",
  ];
  return cases.map((c) => {
    const r = rng(opts.seed ^ stringHash(c.id));
    return {
      ...c,
      id: `${c.id}-noisy`,
      corpus: c.corpus.map((doc) => {
        if (doc.source_path === c.expected_top1) return doc;
        if (r() >= opts.probability) return doc;
        // Pick a wrong purpose. Excludes the doc's actual purpose so the
        // perturbation is observable.
        const candidates = fallbackPurposes.filter((p) => p !== doc.doc_purpose);
        const newPurpose = candidates[Math.floor(r() * candidates.length)] ?? doc.doc_purpose;
        return { ...doc, doc_purpose: newPurpose };
      }),
    };
  });
}

/**
 * V4.8 — cross-corpus vocabulary swap. Replaces every occurrence of the
 * canonical PARENT_TOPICS / LEAF_TOPIC_SUFFIXES / REFERENCE_NOUNS tokens
 * with caller-supplied substitutes (e.g., pseudo-nonsense words). Probes
 * whether V3 wins are vocabulary-fitted: if rates collapse on swap, V3 was
 * relying on token identity rather than structural properties.
 *
 * The swap traverses paths, titles, h1, intros, headings, bodies, link
 * texts, and paraphrase_args. expected_top1 + expected_must_include_top3
 * are rewritten so they reference the swapped paths.
 */
type CustomVocabularyOptions = {
  parent_topics: readonly string[];
  leaf_suffixes: readonly string[];
  reference_nouns: readonly string[];
  seed: number;
};

type FreshCaseVocabularyOptions = {
  seed: number;
};

export function withCustomVocabulary(
  cases: SyntheticCase[],
  opts: CustomVocabularyOptions,
): SyntheticCase[] {
  return cases.map((c, idx) => {
    const r = rng(opts.seed ^ stringHash(c.id) ^ idx);
    const replacements = buildVocabularyReplacementMap(
      [...PARENT_TOPICS] as readonly string[],
      [...LEAF_TOPIC_SUFFIXES] as readonly string[],
      [...REFERENCE_NOUNS] as readonly string[],
      opts.parent_topics,
      opts.leaf_suffixes,
      opts.reference_nouns,
      r,
    );
    const swap = (s: string): string => substituteAll(s, replacements);
    const swapTokens = (toks: string[]): string[] =>
      toks.map((t) => replacements.get(t) ?? t);

    const newCorpus: SyntheticDoc[] = c.corpus.map((doc) => ({
      ...doc,
      source_path: swap(doc.source_path),
      title: swap(doc.title),
      h1: swap(doc.h1),
      intro: swap(doc.intro),
      headings: doc.headings.map(swap),
      body_tokens: swapTokens(doc.body_tokens),
      outbound_links: doc.outbound_links?.map(swap),
      inbound_link_texts: doc.inbound_link_texts?.map(swap),
      questions_answered: doc.questions_answered?.map(swap),
    }));

    const newQuery = swap(c.query);
    const newArgs = c.paraphrase_args
      ? Object.fromEntries(
          Object.entries(c.paraphrase_args).map(([k, v]) => [k, swap(v)]),
        )
      : undefined;

    return {
      ...c,
      id: `${c.id}-vocab`,
      query: newQuery,
      query_tokens: swapTokens(c.query_tokens),
      corpus: newCorpus,
      expected_top1: swap(c.expected_top1),
      expected_must_include_top3: c.expected_must_include_top3.map(swap),
      paraphrase_args: newArgs,
    };
  });
}

/**
 * V4.8 hardening — generate a FRESH synthetic vocabulary per case rather
 * than swapping through one shared nonsense inventory. This avoids the
 * latent repeated-token schema of the original PARENT_TOPICS / LEAF /
 * REFERENCE arrays and gives each case its own made-up lexicon.
 */
export function withFreshCaseVocabulary(
  cases: SyntheticCase[],
  opts: FreshCaseVocabularyOptions,
): SyntheticCase[] {
  return cases.map((c, idx) => {
    const r = rng(opts.seed ^ stringHash(c.id) ^ idx);
    const replacements = buildVocabularyReplacementMap(
      [...PARENT_TOPICS] as readonly string[],
      [...LEAF_TOPIC_SUFFIXES] as readonly string[],
      [...REFERENCE_NOUNS] as readonly string[],
      buildFreshVocabulary(PARENT_TOPICS.length, r),
      buildFreshVocabulary(LEAF_TOPIC_SUFFIXES.length, r),
      buildFreshVocabulary(REFERENCE_NOUNS.length, r),
      r,
    );
    const swap = (s: string): string => substituteAll(s, replacements);
    const swapTokens = (toks: string[]): string[] =>
      toks.map((t) => replacements.get(t) ?? t);

    const newCorpus: SyntheticDoc[] = c.corpus.map((doc) => ({
      ...doc,
      source_path: swap(doc.source_path),
      title: swap(doc.title),
      h1: swap(doc.h1),
      intro: swap(doc.intro),
      headings: doc.headings.map(swap),
      body_tokens: swapTokens(doc.body_tokens),
      outbound_links: doc.outbound_links?.map(swap),
      inbound_link_texts: doc.inbound_link_texts?.map(swap),
      questions_answered: doc.questions_answered?.map(swap),
    }));

    const newQuery = swap(c.query);
    const newArgs = c.paraphrase_args
      ? Object.fromEntries(
          Object.entries(c.paraphrase_args).map(([k, v]) => [k, swap(v)]),
        )
      : undefined;

    return {
      ...c,
      id: `${c.id}-freshvocab`,
      query: newQuery,
      query_tokens: swapTokens(c.query_tokens),
      corpus: newCorpus,
      expected_top1: swap(c.expected_top1),
      expected_must_include_top3: c.expected_must_include_top3.map(swap),
      paraphrase_args: newArgs,
    };
  });
}

function buildVocabularyReplacementMap(
  origParents: readonly string[],
  origLeaves: readonly string[],
  origNouns: readonly string[],
  newParents: readonly string[],
  newLeaves: readonly string[],
  newNouns: readonly string[],
  r: () => number,
): Map<string, string> {
  const map = new Map<string, string>();
  const assign = (orig: readonly string[], replacements: readonly string[]) => {
    if (replacements.length === 0) return;
    for (const o of orig) {
      const pick = replacements[Math.floor(r() * replacements.length)];
      if (pick) map.set(o, pick);
    }
  };
  assign(origParents, newParents);
  assign(origLeaves, newLeaves);
  assign(origNouns, newNouns);
  return map;
}

function substituteAll(input: string, replacements: Map<string, string>): string {
  if (replacements.size === 0) return input;
  // Sort by length desc so multi-char tokens are matched before any
  // token that is a substring of another token.
  const ordered = [...replacements.entries()].sort(
    ([a], [b]) => b.length - a.length,
  );
  let out = input;
  for (const [orig, repl] of ordered) {
    if (!orig) continue;
    // Match orig as a whole token (bounded by non-alphanumeric chars or
    // string ends). Case-sensitive — vocabularies are lowercase tokens.
    const re = new RegExp(`(^|[^a-z0-9])(${escapeRegExp(orig)})(?![a-z0-9])`, "g");
    out = out.replace(re, (_full, pre) => `${pre}${repl}`);
    // Capitalized variant.
    const capOrig = orig.charAt(0).toUpperCase() + orig.slice(1);
    const capRepl = repl.charAt(0).toUpperCase() + repl.slice(1);
    const reCap = new RegExp(`(^|[^a-zA-Z0-9])(${escapeRegExp(capOrig)})(?![a-z0-9])`, "g");
    out = out.replace(reCap, (_full, pre) => `${pre}${capRepl}`);
  }
  return out;
}

function buildFreshVocabulary(count: number, r: () => number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  while (out.length < count) {
    const token = makeFreshToken(r);
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function makeFreshToken(r: () => number): string {
  const syllables = [
    "zor",
    "bliv",
    "tarn",
    "mep",
    "quor",
    "snik",
    "dra",
    "vel",
    "prax",
    "lume",
    "frin",
    "grol",
  ] as const;
  const count = 2 + Math.floor(r() * 2);
  let out = "";
  for (let i = 0; i < count; i++) {
    out += syllables[Math.floor(r() * syllables.length)] ?? "zor";
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * V4.7 — adversarial near-miss generator. Corpus contains:
 *   - target:    docs/concepts/{topic}.md, title "{Topic}"
 *   - near-miss: docs/concepts/{topic}-internals.md, title "{Topic} Internals"
 *   - distractors: same-topic api_reference docs
 * Query is the bare topic phrase. Both target and near-miss could
 * plausibly be top-1; only the bare-titled target is correct.
 *
 * Probes whether V4.2's title-exact-match is greedy enough to fire on
 * close-but-wrong neighbours. Title token sets:
 *   - target {topic}     — equals query token set
 *   - near-miss {topic, internal} — superset
 * If V4.2 is correctly STRICT (set equality, not subset), the near-miss
 * never fires title_exact_match; selection should pick the target.
 */
const NEAR_MISS_QUALIFIERS = [
  "internals",
  "api",
  "advanced",
  "reference",
  "examples",
] as const;

export function generateConceptNearMissCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    const targetPath = `docs/concepts/${topic}.md`;
    const qualifier = pick(r, NEAR_MISS_QUALIFIERS);
    const nearMissPath = `docs/concepts/${topic}-${qualifier}.md`;

    const targetDoc: SyntheticDoc = {
      source_path: targetPath,
      title: capitalize(topic),
      h1: capitalize(topic),
      intro: `Overview of ${topic}.`,
      headings: [`What ${topic} is`, `How it composes`],
      body_tokens: tokenize(`${topic} ${topic} overview composition design`),
      doc_purpose: "concept",
      doc_role: "canonical",
    };
    const nearMissDoc: SyntheticDoc = {
      source_path: nearMissPath,
      title: `${capitalize(topic)} ${capitalize(qualifier)}`,
      h1: `${capitalize(topic)} ${capitalize(qualifier)}`,
      intro: `Deep dive into the ${qualifier} of ${topic}.`,
      headings: [
        `${qualifier} basics`,
        `${qualifier} of ${topic}`,
        `${qualifier} examples`,
      ],
      // Higher density than the target so naive lexical loses.
      body_tokens: tokenize(
        `${topic} ${topic} ${topic} ${qualifier} ${qualifier} ${qualifier} ${topic} examples`,
      ),
      doc_purpose: "guide",
      doc_role: "canonical",
    };

    const distractors: SyntheticDoc[] = [];
    const distractorCount = 2 + Math.floor(r() * 2);
    for (let k = 0; k < distractorCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      distractors.push({
        source_path: `docs/reference/${topic}-${noun}-${k}.md`,
        title: `${capitalize(topic)} ${capitalize(noun)}`,
        h1: `${capitalize(topic)} ${capitalize(noun)}`,
        intro: `${capitalize(noun)} reference for ${topic}.`,
        headings: [`${noun} fields`, `${noun} options`],
        body_tokens: tokenize(
          `${topic} ${topic} ${noun} ${noun} fields options ${topic}`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }

    const query = topic;
    cases.push({
      id: `concept_near_miss-${opts.seed}-${i}`,
      // Reuse anchored_exact_vs_broad — same family of failure (bare-title
      // target competing with longer-titled neighbours). The class label is
      // for grouping in the runner only.
      loss_class: "anchored_exact_vs_broad",
      intent: "broad_domain",
      query,
      query_tokens: tokenize(query),
      corpus: [targetDoc, nearMissDoc, ...distractors],
      expected_top1: targetPath,
      expected_must_include_top3: [targetPath],
      rationale: `Adversarial near-miss: query "${query}" must pick bare-titled "${capitalize(topic)}" over its near-miss sibling "${capitalize(topic)} ${capitalize(qualifier)}".`,
      paraphrase_args: { topic },
    });
  }
  return cases;
}

/**
 * V4.6 — concept+example set-cover generator. Real-corpus how-to questions
 * are best answered by the canonical concept doc PLUS a canonical example
 * doc that demonstrates it. Top-3 metrics that count "any acceptable
 * source" can hide a system that picks three near-duplicate concept docs.
 *
 * The generator emits a corpus where:
 *   - concept doc at docs/concepts/{topic}.md
 *   - canonical example at docs/examples/{topic}-{kind}.md
 *   - 3-4 distractor docs that mention the topic in body but are neither
 *   - 2 noise docs unrelated to the topic
 * Pass criterion (enforced by callers): both expected_must_include_top3
 * entries are in displayed top-3.
 */
const EXAMPLE_KINDS = [
  "starter",
  "walkthrough",
  "demo",
  "minimal",
  "end-to-end",
] as const;

const CONCEPT_REDUNDANCY_KINDS = [
  "architecture",
  "patterns",
  "internals",
  "composition",
  "overview",
] as const;

export function generateConceptPlusExampleCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    const conceptPath = `docs/concepts/${topic}.md`;
    const exampleKind = pick(r, EXAMPLE_KINDS);
    const examplePath = `docs/examples/${topic}-${exampleKind}.md`;

    const conceptDoc: SyntheticDoc = {
      source_path: conceptPath,
      title: `${capitalize(topic)} concept`,
      h1: `${capitalize(topic)} concept`,
      intro: `What ${topic} is and how it composes.`,
      headings: [`What ${topic} is`, `How it composes`, `When to use`],
      body_tokens: tokenize(
        `${topic} ${topic} concept overview composition when to use`,
      ),
      doc_purpose: "concept",
      doc_role: "canonical",
    };
    const exampleDoc: SyntheticDoc = {
      source_path: examplePath,
      title: `${capitalize(topic)} ${exampleKind} example`,
      h1: `${capitalize(topic)} ${exampleKind} example`,
      intro: `A ${exampleKind} example that demonstrates ${topic} end to end.`,
      headings: [`Setup`, `Walkthrough`, `Result`],
      body_tokens: tokenize(
        `${topic} example ${exampleKind} setup walkthrough result demonstrate ${topic}`,
      ),
      doc_purpose: "example",
      doc_role: "canonical",
    };

    const distractors: SyntheticDoc[] = [];
    const conceptSiblingCount = 2 + Math.floor(r() * 2);
    for (let k = 0; k < conceptSiblingCount; k++) {
      const kind = pick(r, CONCEPT_REDUNDANCY_KINDS);
      distractors.push({
        source_path: `docs/concepts/${topic}-${kind}-${k}.md`,
        title: `${capitalize(topic)} ${capitalize(kind)}`,
        h1: `${capitalize(topic)} ${capitalize(kind)}`,
        intro: `${capitalize(kind)} notes for ${topic}.`,
        headings: [`${kind} of ${topic}`, `${topic} ${kind} examples`],
        body_tokens: tokenize(
          `${topic} ${topic} ${topic} ${topic} ${kind} ${kind} composition architecture examples`,
        ),
        doc_purpose: "concept",
        doc_role: "canonical",
      });
    }
    const referenceDistractorCount = 2 + Math.floor(r() * 2);
    for (let k = 0; k < referenceDistractorCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      distractors.push({
        source_path: `docs/reference/${topic}-${noun}-${k}.md`,
        title: `${capitalize(topic)} ${capitalize(noun)}`,
        h1: `${capitalize(topic)} ${capitalize(noun)}`,
        intro: `${capitalize(noun)} reference for ${topic}.`,
        headings: [`${noun} fields`, `${noun} options`, `${topic} ${noun}`],
        body_tokens: tokenize(
          `${topic} ${topic} ${topic} ${noun} ${noun} fields options examples ${topic}`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }
    const noise = noiseDocs(r, 2, opts.seed * 53 + i);

    const query = `how does ${topic} work`;
    cases.push({
      id: `concept_plus_example-${opts.seed}-${i}`,
      // No formal SourceSelectionLossCategory for set-cover yet — reuse
      // overview_vs_reference because the failure mode is structurally
      // similar (overview-vs-reference). Reporting groups by this label.
      loss_class: "overview_vs_reference",
      intent: "broad_domain",
      query,
      query_tokens: tokenize(query),
      corpus: [conceptDoc, exampleDoc, ...distractors, ...noise],
      expected_top1: conceptPath,
      expected_must_include_top3: [conceptPath, examplePath],
      rationale: `Set-cover: how-to query "${query}" should surface BOTH the concept doc and a canonical example. ${conceptSiblingCount} concept-side near-duplicates and ${referenceDistractorCount} api_reference distractors compete for top-3 slots.`,
      paraphrase_args: { topic },
    });
  }
  return cases;
}

/**
 * V4.5 — path-structure noise. Real-corpus parent and leaf docs sometimes
 * do not share a clean path prefix (parent at `docs/concepts/X.md`, leaves
 * at `docs/X/sub/Y.md` where `docs/X/` is a sibling of `docs/concepts/`).
 * V3's `parent_vs_leaf` aboutness reason and `parent_over_leaf` selection
 * rule both depend on `isStrictAncestorPath(parent, leaf)`. When path
 * nesting is broken, the rule cannot fire.
 *
 * Mode `leaves_to_sibling_dir` moves leaves of a parent_vs_leaf case out of
 * the parent's directory tree into `docs/leaves/{topic}/...`, preserving
 * filenames and content. Other loss classes are passed through unchanged.
 */
type PathStructureOptions = {
  mode: "leaves_to_sibling_dir";
};

export function withPathStructureNoise(
  cases: SyntheticCase[],
  opts: PathStructureOptions,
): SyntheticCase[] {
  if (opts.mode !== "leaves_to_sibling_dir") return cases;
  return cases.map((c) => {
    if (c.loss_class !== "parent_vs_leaf") return c;
    const parentPath = c.expected_top1;
    const parentDirPrefix = parentPath.replace(/\.md$/, "") + "/";
    const topic = c.paraphrase_args?.topic ?? "topic";
    const rewrittenPaths = new Map<string, string>();
    let moved = false;
    const movedDocs = c.corpus.map((doc) => {
      if (doc.source_path === parentPath) return doc;
      if (doc.source_path.startsWith("docs/elsewhere/")) return doc;
      if (!doc.source_path.startsWith(parentDirPrefix)) return doc;
      const filename = doc.source_path.split("/").pop() ?? "leaf.md";
      const rewrittenPath = `docs/leaves/${topic}/${filename}`;
      rewrittenPaths.set(doc.source_path, rewrittenPath);
      moved = true;
      return {
        ...doc,
        source_path: rewrittenPath,
      };
    });
    if (!moved) return c;
    const newCorpus = movedDocs.map((doc) => ({
      ...doc,
      outbound_links: doc.outbound_links?.map(
        (path) => rewrittenPaths.get(path) ?? path,
      ),
    }));
    return {
      ...c,
      id: `${c.id}-pathnoise`,
      corpus: newCorpus,
    };
  });
}

/**
 * V4.4 — title-verbosity perturbation. Rewrites the target doc's title so it
 * contains extra context words around the original. Probes whether V4.2's
 * exact-token-set title-match primitive is too brittle to verbose canonical
 * titles ("Hono middleware concepts and patterns" instead of "Middleware").
 *
 * Modes:
 *   - "prefix_suffix": one common prefix word + one common suffix phrase.
 *
 * The perturbation only mutates the target's title. Paths, intros,
 * headings, and bodies stay generic so failures isolate the title primitive.
 */
type TitleVerbosityOptions = {
  mode: "prefix_suffix";
  /**
   * Optional harness hardening for anchored/title-match classes: rewrite the
   * target filename too so V4.2 cannot keep winning via unchanged
   * filename-exact-match after the title has been made verbose.
   */
  perturb_filename?: boolean;
};

// V4.9 anti-pattern fix: prefixes/suffixes must NOT overlap with any query
// template vocabulary used by the loss-class generators. Leaky words like
// "Guide to", "Internal(s)", "Reference", "deep dive" inject query tokens
// into titles and create spurious V3 wins under verbosity (a perturbation
// that should be neutral or harmful, never helpful).
const TITLE_NOISE_PREFIXES = [
  "Notes on",
  "Operational",
  "Module:",
  "Field manual:",
  "Practical",
] as const;

const TITLE_NOISE_SUFFIXES = [
  "concepts and patterns",
  "(preview)",
  "in production",
  "explained",
  "and how to use it",
] as const;

export function withTitleVerbosity(
  cases: SyntheticCase[],
  opts: TitleVerbosityOptions,
): SyntheticCase[] {
  return cases.map((c) => {
    const r = rng(stringHash(c.id));
    const prefix = pick(r, TITLE_NOISE_PREFIXES);
    const suffix = pick(r, TITLE_NOISE_SUFFIXES);
    const nextTargetPath = opts.perturb_filename
      ? rewriteFilename(c.expected_top1, "canonical")
      : c.expected_top1;
    return {
      ...c,
      id: `${c.id}-titleverbose`,
      expected_top1: nextTargetPath,
      expected_must_include_top3: c.expected_must_include_top3.map((path) =>
        path === c.expected_top1 ? nextTargetPath : path,
      ),
      corpus: c.corpus.map((doc) => {
        const rewrittenPath =
          doc.source_path === c.expected_top1 ? nextTargetPath : doc.source_path;
        return {
          ...doc,
          source_path: rewrittenPath,
          title:
            doc.source_path === c.expected_top1
              ? `${prefix} ${doc.title} ${suffix}`.trim()
              : doc.title,
          outbound_links: doc.outbound_links?.map((path) =>
            path === c.expected_top1 ? nextTargetPath : path,
          ),
        };
      }),
    };
  });
}

function rewriteFilename(path: string, suffix: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  if (slash === -1 || dot <= slash) return `${path}-${suffix}`;
  return `${path.slice(0, dot)}-${suffix}${path.slice(dot)}`;
}

/**
 * Perturbation wrapper: drop the expected target's `doc_purpose` to "unknown"
 * — simulates the most pessimistic real-fixture case where the canonical doc
 * itself was misclassified. Tests whether V3 can still recover.
 */
export function withTargetPurposeDropped(cases: SyntheticCase[]): SyntheticCase[] {
  return cases.map((c) => ({
    ...c,
    id: `${c.id}-target-unknown`,
    corpus: c.corpus.map((doc) =>
      doc.source_path === c.expected_top1
        ? { ...doc, doc_purpose: "unknown" as DocPurpose }
        : doc,
    ),
  }));
}

type LargeCorpusNoiseOptions = {
  same_topic_count: number;
  unrelated_count: number;
  seed: number;
};

/**
 * Large-corpus scale wrapper: increase each synthetic corpus to production-
 * like sizes by adding many same-topic and unrelated distractors. Useful for
 * testing rank dynamics at 100-1000 docs per case rather than just many
 * cases with small corpora.
 */
export function withLargeCorpusNoise(
  cases: SyntheticCase[],
  opts: LargeCorpusNoiseOptions,
): SyntheticCase[] {
  return cases.map((c, idx) => {
    const r = rng(opts.seed ^ stringHash(c.id) ^ idx);
    const topic =
      c.paraphrase_args?.topic ??
      c.paraphrase_args?.phrase ??
      c.paraphrase_args?.feature ??
      c.paraphrase_args?.filename ??
      c.paraphrase_args?.pkg ??
      `topic_${idx}`;
    const mode = c.paraphrase_args?.mode ?? pick(r, COMPOSITIONAL_MODES);
    const extras: SyntheticDoc[] = [];
    for (let k = 0; k < opts.same_topic_count; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      extras.push({
        source_path: `docs/large/${topic}-${noun}-${idx}-${k}.md`,
        title: `${capitalize(topic)} ${capitalize(noun)} ${k}`,
        h1: `${capitalize(topic)} ${capitalize(noun)} ${k}`,
        intro: `${capitalize(noun)} notes for ${topic}.`,
        headings: [`${topic} ${noun}`, `${mode} ${noun}`],
        body_tokens: tokenize(
          `${topic} ${topic} ${topic} ${mode} ${noun} ${noun} fields options examples`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }
    for (let k = 0; k < opts.unrelated_count; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      extras.push({
        source_path: `docs/large/unrelated_${idx}_${k}.md`,
        title: `Unrelated ${capitalize(noun)} ${k}`,
        h1: `Unrelated ${capitalize(noun)} ${k}`,
        intro: `Unrelated material about ${noun}.`,
        headings: [`${noun} basics`, `${noun} examples`],
        body_tokens: tokenize(`${noun} ${noun} basics examples reference`),
        doc_purpose: "guide",
        doc_role: "canonical",
      });
    }
    return {
      ...c,
      id: `${c.id}-large`,
      corpus: [...c.corpus, ...extras],
    };
  });
}

function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * overview_vs_reference — broad-domain query (e.g., "guide to X projects")
 * where the canonical answer is a guide/concept page, but several
 * api_reference siblings on related-but-not-target topics are denser and
 * tend to outrank by lexical signal. Mirrors vitest-unanchored-projects.
 *
 * The hard ingredient: the api_reference distractors share the parent
 * directory with the expected guide AND mention the topic in their bodies
 * with high density. The expected doc has stronger title alignment but
 * weaker body density.
 */
export function generateOverviewVsReferenceCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    const guidePath = `docs/guide/${topic}.md`;
    // V4.4 hardening: bare topic title (no trigger word "guide"), shorter
    // body. Lexical scoring should NOT trivially favor the guide. The
    // engine has to recognise broad-domain intent + concept doc_purpose to
    // select the guide. Mirrors vitest-unanchored-projects more honestly.
    const guideDoc: SyntheticDoc = {
      source_path: guidePath,
      title: capitalize(topic),
      h1: capitalize(topic),
      intro: `Overview of ${topic}.`,
      headings: [`Why ${topic}`, `Composition`],
      body_tokens: tokenize(`${topic} overview composition design`),
      doc_purpose: "concept",
      doc_role: "canonical",
    };
    const apiRefs: SyntheticDoc[] = [];
    const apiRefCount = 3 + Math.floor(r() * 2);
    for (let k = 0; k < apiRefCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      apiRefs.push({
        // Distractor sits in the same /guide/ dir so path-shape doesn't
        // discriminate, AND its title carries the topic — naive lexical
        // ranking is genuinely confused.
        source_path: `docs/guide/${topic}_${noun}_${k}.md`,
        title: `${capitalize(topic)} ${capitalize(noun)}`,
        h1: `${capitalize(topic)} ${capitalize(noun)}`,
        intro: `Comprehensive reference for ${topic} ${noun}.`,
        headings: [
          `${topic} ${noun} fields`,
          `${topic} ${noun} options`,
          `${topic} ${noun} examples`,
        ],
        body_tokens: tokenize(
          // Higher density on topic than the guide doc itself.
          `${topic} ${topic} ${topic} ${topic} ${noun} ${noun} fields options examples caveats`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }
    const noise = noiseDocs(r, 2, opts.seed * 29 + i);
    const query = `guide to ${topic}`;
    cases.push({
      id: `overview_vs_reference-${opts.seed}-${i}`,
      loss_class: "overview_vs_reference",
      intent: "broad_domain",
      query,
      query_tokens: tokenize(query),
      corpus: [guideDoc, ...apiRefs, ...noise],
      expected_top1: guidePath,
      expected_must_include_top3: [guidePath],
      rationale: `Broad query "${query}" must land on the bare-titled overview doc despite ${apiRefCount} same-dir api_reference siblings whose titles ALSO contain "${topic}" and whose bodies are denser. Mirrors vitest-unanchored-projects honestly.`,
      paraphrase_args: { topic },
    });
  }
  return cases;
}

/**
 * Unsupported sanity — corpus contains NO doc that actually answers the
 * query. The engine should remain uncertain (fail-closed selection) and
 * not confidently rank one of the irrelevant docs at top-1. The expected
 * top1 is intentionally absent from the corpus.
 */
export function generateUnsupportedSanityCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const queryTopic = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    // The corpus is composed entirely of unrelated docs. None of them
    // mentions the query topic.
    const corpus: SyntheticDoc[] = [];
    const docCount = 4 + Math.floor(r() * 3);
    for (let k = 0; k < docCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      corpus.push({
        source_path: `docs/${noun}_${k}.md`,
        title: capitalize(noun),
        h1: capitalize(noun),
        intro: `Unrelated content about ${noun}.`,
        headings: [`${noun} basics`, `${noun} options`],
        body_tokens: tokenize(`${noun} ${noun} ${noun} basics options`),
        doc_purpose: "guide",
        doc_role: "canonical",
      });
    }
    cases.push({
      id: `unsupported_sanity-${opts.seed}-${i}`,
      loss_class: "none", // not a true loss class — sanity probe
      intent: "broad_domain",
      query: `${queryTopic} reference`,
      query_tokens: tokenize(`${queryTopic} reference`),
      corpus,
      expected_top1: "<<NONE — must fail closed>>",
      expected_must_include_top3: [],
      expected_unsupported: true,
      rationale: `No doc in the corpus mentions "${queryTopic}". V3 should fail closed and return empty selection rather than confidently rank an unrelated doc at top-1.`,
    });
  }
  return cases;
}

/**
 * Build N "noise" docs unrelated to the case topic — simulates the rest of
 * a real corpus that always shows up in top-N alongside the target. Causes
 * the V3 `every other card is a strict descendant` checks to fail, which is
 * exactly the structural pattern that defeats V3 on real fixtures.
 */
function noiseDocs(r: () => number, count: number, seed: number): SyntheticDoc[] {
  const out: SyntheticDoc[] = [];
  for (let i = 0; i < count; i++) {
    const noun = pick(r, REFERENCE_NOUNS);
    const path = `docs/elsewhere/${noun}_${seed}_${i}.md`;
    out.push({
      source_path: path,
      title: capitalize(noun),
      h1: capitalize(noun),
      intro: `Unrelated content about ${noun}.`,
      headings: [`${noun} basics`],
      body_tokens: tokenize(`${noun} ${noun} ${noun} basics`),
      doc_purpose: "guide",
      doc_role: "canonical",
    });
  }
  return out;
}

/**
 * "Hard" parent_vs_leaf — leaves' TITLES include the parent topic so token
 * coverage on title and path is high for leaves too. Mirrors the real
 * hono-middleware / vitest-browser-mode pattern where every leaf is named
 * "X middleware" / "X browser" and the parent overview has just "Middleware"
 * / "Browser Mode" as a title that is technically a substring match.
 */
export function generateHardParentVsLeafCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, PARENT_TOPICS)}_${i}_${opts.seed}`;
    const parentPath = `docs/concepts/${topic}.md`;
    const leafCount = 3 + Math.floor(r() * 2); // 3..4 leaves, more crowding
    const leaves: SyntheticDoc[] = [];
    for (let k = 0; k < leafCount; k++) {
      const leafQualifier = `${pick(r, LEAF_TOPIC_SUFFIXES)}_${k}`;
      const leafPath = `docs/concepts/${topic}/${leafQualifier}.md`;
      leaves.push({
        source_path: leafPath,
        // Leaf title contains the parent topic verbatim — this is the
        // structural noise that defeats simple title-match.
        title: `${capitalize(leafQualifier)} ${topic}`,
        h1: `${capitalize(leafQualifier)} ${topic}`,
        intro: `Configures the ${topic} for the ${leafQualifier} use case.`,
        headings: [`${topic} basics`, `${topic} options`, `${topic} examples`],
        body_tokens: tokenize(
          // High lexical density on the parent topic.
          `${topic} ${topic} ${topic} ${topic} ${leafQualifier} options examples reference`,
        ),
        doc_purpose: "guide",
        doc_role: "canonical",
      });
    }
    const parent: SyntheticDoc = {
      source_path: parentPath,
      title: capitalize(topic),
      h1: capitalize(topic),
      intro: `The ${topic} overview describes how ${leaves.length} subtopics compose.`,
      headings: ["Overview", "Composition", "When to extend"],
      // Parent has lower lexical density than the leaves combined.
      body_tokens: tokenize(`${topic} overview concept design composition`),
      doc_purpose: "concept",
      doc_role: "canonical",
      outbound_links: leaves.map((l) => l.source_path),
    };
    for (const leaf of leaves) {
      leaf.outbound_links = [parentPath];
      leaf.inbound_link_texts = [];
    }
    parent.inbound_link_texts = leaves.map(() => `the ${topic} concept`);

    const intent: QueryIntent = r() < 0.5 ? "broad_domain" : "decision_lookup";
    const query =
      intent === "decision_lookup"
        ? `why use ${topic}`
        : `${topic} overview`;

    // Add 2 noise docs to mirror real-corpus top-N composition. These are
    // the structural elements that defeat V3's "every other card is a leaf"
    // check on real fixtures.
    const noise = noiseDocs(r, 2, opts.seed * 7 + i);
    cases.push({
      id: `parent_vs_leaf-hard-${opts.seed}-${i}`,
      loss_class: "parent_vs_leaf",
      intent,
      query,
      query_tokens: tokenize(query),
      corpus: [parent, ...leaves, ...noise],
      expected_top1: parentPath,
      expected_must_include_top3: [parentPath],
      rationale: `Hard parent_vs_leaf with corpus noise: leaves' titles contain the parent topic verbatim and have higher body density; 2 unrelated docs in top-N defeat V3's "every other card is a leaf" check. Mirrors hono-middleware / vitest-browser-mode real-fixture losses.`,
      paraphrase_args: { topic },
    });
  }
  return cases;
}

/**
 * "Hard" anchored_exact_vs_broad — broad reference docs are themselves
 * canonical (their titles match a different reference noun) AND they
 * carry the query topic in their HEADINGS, not just body. Mirrors
 * turborepo-anchored-globs / vitest-anchored-cli where configuration.md
 * has a globs section.
 */
export function generateHardAnchoredExactVsBroadCases(
  opts: GeneratorOptions,
): SyntheticCase[] {
  const r = rng(opts.seed);
  const cases: SyntheticCase[] = [];
  for (let i = 0; i < opts.count; i++) {
    const topic = `${pick(r, LEAF_TOPIC_SUFFIXES)}_${i}_${opts.seed}`;
    const phrase = `${topic}_profile`;
    const exactPath = `docs/reference/${phrase}.md`;
    const exactDoc: SyntheticDoc = {
      source_path: exactPath,
      title: capitalize(phrase),
      h1: capitalize(phrase),
      intro: `Reference for ${phrase}.`,
      headings: [`${phrase} usage`, `${phrase} rules`],
      // Exact doc is intentionally sparse: this is the doc that *owns* the
      // phrase, but it does not win by density alone.
      body_tokens: tokenize(`${topic} profile usage rules`),
      doc_purpose: "guide",
      doc_role: "canonical",
    };
    const distractors: SyntheticDoc[] = [];
    const distractorCount = 3 + Math.floor(r() * 2);
    for (let k = 0; k < distractorCount; k++) {
      const noun = pick(r, REFERENCE_NOUNS);
      distractors.push({
        source_path: `docs/reference/${phrase}_${noun}_${k}.md`,
        // Broad docs now carry the full phrase in title/path too, so a
        // lexical scorer can be pulled toward them by density and section
        // matches rather than by query-token absence.
        title: `${capitalize(phrase)} ${capitalize(noun)}`,
        h1: `${capitalize(phrase)} ${capitalize(noun)}`,
        intro: `Comprehensive reference for ${noun}, including ${phrase} configuration.`,
        headings: [
          `${noun} fields`,
          `${phrase} configuration`,
          `${noun} examples`,
        ],
        // Broad references are denser and should attract naive lexical
        // retrieval even though they are not the canonical owner doc.
        body_tokens: tokenize(
          `${topic} profile ${topic} profile ${topic} profile ${noun} ${noun} fields options caveats examples`,
        ),
        doc_purpose: "api_reference",
        doc_role: "canonical",
      });
    }
    const noise = noiseDocs(r, 2, opts.seed * 13 + i);
    cases.push({
      id: `anchored_exact_vs_broad-hard-${opts.seed}-${i}`,
      loss_class: "anchored_exact_vs_broad",
      intent: "file_anchored",
      query: phrase,
      query_tokens: tokenize(phrase),
      corpus: [exactDoc, ...distractors, ...noise],
      expected_top1: exactPath,
      expected_must_include_top3: [exactPath],
      rationale: `Hard anchored with corpus noise: broad api_reference docs carry the full phrase "${phrase}" in title, path, and headings and have higher body density, but the exact owner doc should still win. Mirrors exact-topic-vs-broad-reference failures without relying on fixture naming conventions.`,
      paraphrase_args: { phrase },
    });
  }
  return cases;
}
