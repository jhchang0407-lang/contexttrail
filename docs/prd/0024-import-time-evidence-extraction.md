# PRD-0024: Import-Time Evidence Extraction

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's twenty-fourth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0007](../adr/0007-hybrid-scoring-additive-text-multiplicative-structure.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md). Related PRDs: [PRD-0014](0014-retrieval-engine-v3-source-selection-and-aboutness.md), [PRD-0016](0016-deterministic-retrieval-precision-and-assembly-ready-top3.md), [PRD-0023](0023-import-time-path-topology-compiler.md). Parked context: [.out-of-scope/source-rerank-tiebreakers-architecture.md](../../.out-of-scope/source-rerank-tiebreakers-architecture.md), [.out-of-scope/prd-0023-slice-23-3-verdict.md](../../.out-of-scope/prd-0023-slice-23-3-verdict.md), [.out-of-scope/source-profile-v2-miss-audit.md](../../.out-of-scope/source-profile-v2-miss-audit.md).
>
> Boundary rule: this PRD shifts the lever from **ranking-time score boosts** (parked after three attempts) to **import-time evidence extraction**. The deliverable is new evidence that source-rerank's existing scoring already knows how to consume — not new score-component coefficients. Deterministic only; no AI; no author-mandatory frontmatter.

## Problem Statement

Three independent ranking-time interventions have now been measured against the real-corpus eval, all delivering net zero or worse:

| Attempt | Architecture | Net top-1 |
|---|---|---:|
| PRD-0022 close-call tiebreakers | Post-sort, surface-signal symmetric | −1 |
| PRD-0023 path-topology unconditional boosts | Always-on additive, principled magnitudes | 0 (rescues 6, breaks 6) |
| PRD-0023 conditional gate (depth ≥ 2) | Conditional additive boost | +3, but agent_answer + chunk_correctness regress |

The pattern is unambiguous: any uniform-shape additive score boost on top of source-rerank, however carefully gated, trades wins and losses on structurally similar cases. The architecture is information-zero or information-marginal at the ranking layer for this corpus. Source-rerank is at its scoring ceiling on the signals it currently has access to.

The miss audit ([`.out-of-scope/source-profile-v2-miss-audit.md`](../../.out-of-scope/source-profile-v2-miss-audit.md)) reframed at the input layer: the importer leaves significant deterministic signal on the table — heading exact-match content, code-fence symbol declarations, nav config, link graph. The 16 displayed top-1 misses are a **signal-extraction problem**, not a ranking-function problem.

PRD-0023 path topology was the smallest piece of that direction; its data validated the framing (signals do find more cases when extracted) but also confirmed that turning extracted signals into uniform additive score boosts is the wrong shape.

PRD-0024 ships the next pieces of the import-time evidence extractor — **new evidence the source-rerank function's existing scoring already knows how to use** (heading-token coverage, alias-hit count, owner-identity score). No new score-component coefficients; the lever is *what evidence is available to score*, not *how the score is computed*.

## Solution

Import-time evidence extraction in two slices, each shipping independently:

### Slice 1 — heading exact-match extraction

Extract normalized heading aliases from each document at import time and surface them through `SourceProfile`. The existing `SourceProfile.heading_outline` carries display-form headings; PRD-0024 slice 1 adds a normalized search-form alias projection (lowercased, stem-aware, surface-form-preserved) keyed by depth + section path.

The extracted aliases participate in two places:
- **Candidate generation** — heading aliases feed the existing alias-based retrieval substrate, so a query whose tokens exactly match an H2 in some document can surface that document even if the document's title doesn't mention the topic.
- **Source-rerank scoring** — heading-token coverage is already a feature in `SourceRerankFeatures` (`heading_token_coverage`), but today it's computed against display-form heading text. Extraction lets the same feature consume normalized heading aliases including suffix and token-normalized matches, broadening match recall without changing the scoring coefficient.

**No new score-component coefficient.** No semantic heading inference. No fuzzy matching. Exact, suffix, and token-normalized matches only.

### Slice 2 — code-fence entity extraction

Extract structured entities from fenced code blocks at import time:
- Filenames and import paths
- Package names
- Config keys and option names
- CLI commands
- Environment variable names
- Routes and endpoint paths
- Exported symbol declarations

Each entity is stored on `SourceProfile` with provenance (`code_fence`, `language`, `section_heading`).

These entities feed:
- The existing alias substrate, so queries mentioning extracted entities by name surface the document that defines/uses them.
- The existing `alias_hit_count` and `owner_identity_score` features in source-rerank.

**No boost unless the query explicitly mentions the extracted entity.** Exact matches only in slice 2; partial / fuzzy / semantic deferred.

### Authority boundary

This PRD stays inside the deterministic-compiler architecture. Author-declared frontmatter remains an **opt-in escape hatch**, not a primary mechanism. Defaults are inferred from sources that already exist in the corpus (markdown ASTs, code fences). AI is explicitly out of scope.

## User Stories

1. As a ContextTrail maintainer, I want heading aliases extracted from each document at import time, so that source-rerank can score heading exact-match against canonical normalized forms instead of raw display text.
2. As a ContextTrail maintainer, I want heading aliases to participate in candidate generation, so that documents with strong heading evidence surface even when their title doesn't mention the query's topic.
3. As a ContextTrail maintainer, I want heading-depth and section-path metadata preserved alongside each alias, so that the importer can later distinguish H1-rooted aliases from deep-nested H3 aliases without re-parsing.
4. As a ContextTrail maintainer, I want heading exact-match to use exact, suffix, and token-normalized matches only, so that the rule remains deterministic and avoids the surface-signal-symmetry trap that bit PRD-0022 / PRD-0023.
5. As a ContextTrail maintainer, I want code-fence entity extraction at import time, so that documents whose code blocks reference specific filenames, imports, packages, or config keys are routable by those entities.
6. As a ContextTrail maintainer, I want extracted entities stored with provenance (code_fence, language, section_heading), so that future eval traces can explain why a particular evidence type fired.
7. As a ContextTrail maintainer, I want code-fence entity matches to require explicit query mention, so that arbitrary code symbols don't accidentally promote unrelated docs.
8. As a ContextTrail maintainer, I want both slices behind feature flags with default off, so that the lift can be validated independently before the flag flips and source-rerank's effective behavior changes.
9. As a ContextTrail maintainer, I want each slice's eval gated by per-case identity verification (predicted addressable cases verified or explained, unpredicted flips reviewed and classified, per-case regression == 0), so that small deltas remain measurable.
10. As a ContextTrail maintainer, I want each slice's acceptance to require at least one addressed miss explained by newly extracted evidence, so that we know the extraction itself is what's delivering the lift, not adjacent score-component shifts.
11. As a ContextTrail maintainer, I want the existing `SourceProfile.heading_outline` to remain unchanged in shape, so that downstream consumers that read display-form headings continue to work.
12. As a ContextTrail maintainer, I want this PRD to make zero changes to source-rerank's score-component coefficients, so that we test the "new evidence, not new weights" hypothesis cleanly.

## Implementation Decisions

### Slice 1 — heading exact-match

- New module `src/retrieve/heading-aliases.ts`, exporting one extractor: `extractHeadingAliases(headings: string[]): HeadingAlias[]`. Pure function; markdown AST already provides the heading list via `SourceProfile.heading_outline`.
- New `SourceProfile` field (additive, optional, no schema_version bump):
  ```ts
  type HeadingAlias = {
    surface: string;       // raw heading text, original casing
    normalized: string;    // lowercased, whitespace-collapsed
    tokens: string[];      // tokenized via existing retrieval tokenizer
    depth: number;         // 1 for H1, 2 for H2, etc.
    section_path: string[]; // ancestor heading hierarchy
  };
  type SourceProfile = {
    // ...existing fields unchanged...
    heading_aliases?: HeadingAlias[];
  };
  ```
- Profile builder calls `extractHeadingAliases` at import time and populates the field.
- `SourceCard` carries `heading_aliases` forward to ranking time.
- Source-rerank's existing `heading_token_coverage` feature is updated to consume `heading_aliases` when present, broadening match recall (exact / suffix / token-normalized) without changing the coefficient or adding new features.
- Candidate generation: extend the existing alias-retrieval substrate to consume `heading_aliases` alongside title and path aliases.
- Behind feature flag `RETRIEVAL_HEADING_ALIASES=on` (default off until promotion gates pass).

### Slice 2 — code-fence entity extraction (locked spec)

**Architectural constraint (carried from slice 1's confirmed result):** new evidence, not new weights. Slice 2 must not introduce broad additive boosts. Extracted entities are consumed through the existing exact-evidence paths (the alias substrate, `alias_hit_count`, `owner_identity_score`). Match semantics are exact-only in v1.

- New module `src/retrieve/code-fence-entities.ts`, exporting one extractor: `extractCodeFenceEntities(markdown: string): CodeFenceEntity[]`. Pure function; consumes the markdown source, identifies fenced code blocks, extracts entities by language-aware lightweight parsing.
- New `SourceProfile` field (additive, optional, no schema_version bump):
  ```ts
  type CodeFenceEntityKind =
    | "import"        // import ... from "x", require("x")
    | "package_name"  // package literals from imports / install commands
    | "config_file"   // vitest.config.ts, tsconfig.json, etc.
    | "config_key"    // object keys in config-looking snippets
    | "cli_command"   // vitest --browser, pnpm test, etc.
    | "symbol"        // exported functions/classes/types + obvious API calls
                      // (router, procedure, z.object, useQuery, etc.)
    | "route";        // string literals that look like /api/foo
  type CodeFenceEntity = {
    kind: CodeFenceEntityKind;
    value: string;            // raw entity surface (preserves case / punctuation)
    normalized: string;       // lowercased, language-appropriate normalization
    language: string;         // code-fence language tag (ts, js, sh, json, ...)
    section_heading: string | null; // nearest enclosing section heading
  };
  type SourceProfile = {
    // ...existing fields unchanged...
    code_fence_entities?: CodeFenceEntity[];
  };
  ```
- Extraction patterns (deterministic; no learned model; no fuzzy):
  - `import`: capture the module string from `import ... from "x"` and `require("x")` in TS/JS fences
  - `package_name`: the same string when it's not a relative path; also the package operands of `npm/pnpm/yarn install <pkg>` in shell fences
  - `config_file`: filename literals matching well-known config file patterns (`*.config.{ts,js,mjs,cjs,json,yaml,yml}`, `tsconfig*.json`, `package.json`, `vitest.config.ts`, etc.) — match by literal filename, not by extension alone
  - `config_key`: object keys in fences whose language is TS/JS/JSON/YAML AND whose surrounding shape looks like a config block (top-level object literal, `defineConfig({...})`, `export default {...}`, etc.)
  - `cli_command`: command-shaped lines in shell fences — first whitespace-separated token is a known CLI binary or matches a project-local script name
  - `symbol`: exported declarations (`export function X`, `export class Y`, `export type Z`, `export const W`) plus obviously-API-shaped identifiers from import bindings (`z.object`, `router`, `procedure`, etc.)
  - `route`: string literals that match a route shape (leading slash, no whitespace, not a filesystem-looking path), within fences whose surrounding text mentions HTTP / API / endpoint
- Consumption (no new features in source-rerank):
  - Extracted entities feed the existing alias substrate alongside title / path / heading aliases.
  - `alias_hit_count` increments when a query token matches an entity's `normalized` (exact only).
  - `owner_identity_score` consumes entities the same way it consumes other aliases — token-rarity-weighted overlap with query tokens.
  - **No new score-component coefficient.** No new feature in `SourceRerankFeatures`.
  - **No additive boost.** A candidate gets credit only when the query explicitly mentions an extracted entity by name.
- Initial language coverage: TypeScript / JavaScript (imports + symbols), shell (CLI commands + package names from install commands), JSON / YAML (config keys + config files), HTTP-route-shaped string literals. Other languages skipped in v1; future PRDs can extend.
- Behind feature flag `RETRIEVAL_CODE_FENCE_ENTITIES=on` (default off until promotion gates pass).
- **Promotion gate (sharper than slice 1's):** `≥1 clean win AND zero per-case regression`. Conservative expected lift: 2–4 top-1 wins from the symbol-anchor cohort (`trpc-anchored-router`, `trpc-anchored-procedures`, `zod-anchored-error-handling`, `zod-anchored-package-readme`). Accept the slice if at least one clean win lands and no regression occurs; do not chase the predicted maximum if it costs even a single regression.

### What's explicitly excluded from PRD-0024

- New score-component coefficients in source-rerank (the whole point: new evidence, not new weights).
- Boost magnitudes (slice 1 / 2 do not add weighted boosts; they enrich existing features).
- Nav/sidebar parsing (slice 4 of the audit's direction; future PRD).
- Link graph + PageRank-ish centrality (slice 5; future PRD).
- Author-mandatory frontmatter; opt-in escape hatch only.
- Performance optimization beyond the import-time pass.
- AI in any extraction or scoring path.
- Production MCP response-shape changes.

## Testing Decisions

### Synthetic property tests

Each extractor gets a synthetic suite at lower-95 ≥ 95%:

- `extractHeadingAliases`: 200 random heading-outline shapes (depths, casings, special chars). Property: surface preserved verbatim; normalized lowercased + whitespace-collapsed; tokens consistent with retrieval tokenizer; depth and section_path correct.
- `extractCodeFenceEntities`: 200 random code-fence corpora across supported languages. Property: extracted entities match expected shapes per language; provenance fields populated; no false positives in unsupported languages.

### Adversarial coverage

- Heading aliases: heading text containing markdown link syntax, code spans, mixed RTL/LTR, unicode, very long headings (>300 chars), nested code-block headings.
- Code-fence entities: nested fences, partial fences (unclosed), language-tag variants (`typescript` vs `ts`), code blocks with non-source content (e.g. ASCII tables in `text` fences), shell heredocs, JSON with comments.

### Real-corpus discipline

Per-slice predicted addressable cohort + per-case identity verification. Acceptance for each slice requires:

- `npm test` passes
- `npx tsc --noEmit` passes
- Synthetic property tests at lower-95 ≥ 95%
- Adversarial suites pass
- Real-corpus eval flag-on:
  - top-1 ≥ baseline (no regression)
  - top-3 ≥ baseline
  - coverage honesty 148/148
  - agent answer ≥ 147/148
  - chunk_correctness ≥ 3/3
  - per-case `regressions == 0` against displayed baseline
  - **at least one addressed miss explained by newly extracted evidence** (proves the extraction itself is delivering the lift, not adjacent shifts)
  - All predicted addressable cases verified or explained
  - All unpredicted flips reviewed and classified before acceptance

## Promotion Gates (per slice)

Conjunctive — every gate must pass before the slice's feature flag flips to `on`:

- `npm test` passes
- `npx tsc -p tsconfig.json --noEmit` passes
- All synthetic property tests pass at lower-95 ≥ 95%
- Adversarial suites pass for each extractor
- Real-corpus top-1 ≥ baseline (no regression vs displayed)
- Real-corpus top-3 ≥ baseline
- Coverage honesty stays 148/148
- Agent answer correct ≥ 147/148
- Chunk correctness ≥ 3/3
- Per-case `regressions == 0`
- At least one addressed miss explained by newly extracted evidence
- All predicted addressable cases verified or explained
- All unpredicted flips reviewed and classified

## Out of Scope

- New score-component coefficients in source-rerank (the explicit hypothesis being tested: new evidence, not new weights)
- Path-segment role markers (slice 2 of the audit; future PRD if heading aliases don't already address the role-discrimination cohort)
- Nav/sidebar parsing (slice 4)
- Link graph + PageRank-ish centrality (slice 5)
- Doc-shape metrics for role classification
- Author opt-in frontmatter overrides
- AI in any inference path
- Production MCP response-shape changes
- Tuning / promoting any of the parked PRD-0022 / PRD-0023 ranking-time boost lanes

## Further Notes

This PRD is the natural continuation of the audit's framing. Three ranking-time experiments have now produced enough data to localize the ceiling: source-rerank's scoring is at the limit of the *signals* it has, not the limit of *how* it weighs them. PRD-0024 tests whether enriching the input changes the outcome.

The hypothesis is sharper than PRD-0023's: instead of "extract path topology and add score boosts," PRD-0024 says "extract heading + code-fence evidence and let source-rerank's existing features consume it." If lift comes from this lever, it confirms the audit's framing and unlocks slices 4–5 (nav, link graph) as further evidence streams along the same architectural shape. If lift doesn't come, the deterministic-compiler direction is also exhausted and the project pivots to candidate-generation breadth (a different lever entirely).

Per the lessons banked from PRD-0022 and PRD-0023:

- Synthetic property tests at lower-95 ≥ 95% carry the generalization weight.
- Per-case identity verification is a hard gate, not a summary.
- Magnitudes (where applicable) are principled, not tuned.
- Each slice ships independently; the multi-slice aggregate accumulates as the architectural premise stays valid.
- "At least one addressed miss explained by newly extracted evidence" is the signal that the lever did real work, not that adjacent shifts cancelled into a vague net positive.
