# PRD-0027: Relational Source-Level Metadata (Nav + Link Graph)

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's twenty-seventh PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0007](../adr/0007-hybrid-scoring-additive-text-multiplicative-structure.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md). Related PRDs: [PRD-0014](0014-retrieval-engine-v3-source-selection-and-aboutness.md), [PRD-0024](0024-import-time-evidence-extraction.md). Parked context: [.out-of-scope/source-profile-v2-miss-audit.md](../../.out-of-scope/source-profile-v2-miss-audit.md), [.out-of-scope/prd-0025-chunk-layer-verdict.md](../../.out-of-scope/prd-0025-chunk-layer-verdict.md).
>
> Boundary rule: this PRD ships **source-level relational metadata** that source-rerank's existing scoring features consume for sibling discrimination. Slices 4 and 5 of the original audit. **Source-level graph features, not query-time graph traversal.** Neighbor expansion / context-assembly traversal is explicitly out of scope; it's a downstream concern that depends on retrieval being right first. Fully deterministic; no AI; no author-mandatory frontmatter.

## Problem Statement

Five PRDs into source-level / chunk-level signal experimentation, the cumulative net top-1 lift on the 122-case real corpus is **+1**:

| PRD | Lever | Net top-1 | Production state |
|---|---|---:|---|
| PRD-0022 close-call tiebreakers | Post-sort surface symmetric swap | −1 (parked) | flag off |
| PRD-0023 path-topology | Always-on / conditional additive boosts | 0 / +3 with honesty regression (parked) | flag off |
| PRD-0024 slice 1 (heading aliases) | New evidence consumed by existing features | **+1** (clean) | flag on |
| PRD-0024 slice 2 (code-fence entities) | Same shape, broader entities | 0 / wash (parked) | flag off |
| PRD-0025 chunk-layer structural | Chunk-level fields duplicating source-level signal | 0 / regressions (rolled back) | rolled back |

The PRD-0025 verdict triangulated the bottleneck precisely:

- **The accepted source is in top-5 candidates 97.5% of the time** (top-3 = 118/122). Candidate generation is genuinely strong.
- **Top-1 sibling discrimination is the actual gap** — picking the right one of two valid candidates (e.g., `configuration.md` vs `globs.md`, `routers.md` vs `validators.md`).
- **Source-level token-volume features are at their ceiling** for this discrimination. Source-rerank's existing features (`title_token_coverage`, `path_token_coverage`, `heading_token_coverage`, `alias_hit_count`, `owner_identity_score`) all measure surface-form overlap. Two valid sibling candidates often have similar surface-form profiles.

What source-rerank doesn't have access to today: **relational signals** — facts about *how docs relate to each other* in the corpus. Specifically:

- **Nav landing**: which doc is the section's entry point in the docs config (`sidebars.ts`, `_category_.json`, `mkdocs.yml`, frontmatter `sidebar_position`).
- **Inbound link count**: how many other docs in the corpus link TO this doc.
- **Inbound anchor text**: what name those linkers use ("see [Routers](./routers.md)" → `routers.md` is referred to as "Routers" by external links).
- **PageRank-shaped centrality**: which docs are structurally most-pointed-to.
- **"See also" / "next" link patterns**: explicit author-declared navigation between docs.

These are **structural facts about the corpus** that already exist in the markdown sources but the importer doesn't extract. They're deterministic — same input always produces the same output. They live at the source layer, where the bottleneck is. They feed source-rerank's existing scoring features as new evidence (alias substrate, identity-score path), no new score-component coefficients required.

## Solution

Two extractors at import time, one slice each. Each extractor produces additive optional fields on `SourceProfile`. Each set of fields feeds source-rerank's existing scoring through alias substrate / identity-score paths. **No new coefficients. No additive boosts. No query-time graph traversal.**

### Slice 27.1 — nav/sidebar parser

Parse the most common docs-config conventions and capture per-doc:
- `nav_section_id`: the section/group the doc belongs to in nav (e.g., `"server"`, `"reference"`)
- `nav_position`: order within the nav section (1 = first, the section's landing entry)
- `nav_label`: the label the nav uses for this doc (often more canonical than the doc's title — e.g., title `"Defining Routers in tRPC"` but nav label `"Routers"`)
- `is_nav_landing`: true iff this doc is the first entry in its nav section AND the section has multiple entries

Supported config formats (initial coverage):
- VitePress `.vitepress/config.ts` and sidebar configs
- Docusaurus `_category_.json`, `sidebars.js/ts`
- MkDocs `mkdocs.yml`
- Frontmatter `sidebar_position` / `sidebar_label`
- README-as-section-index (when `README.md` exists alongside other docs in a directory)

Parsers are tolerant: if no config is present, the fields stay null. If a config is malformed, the parse fails gracefully and the import continues without nav data.

### Slice 27.2 — link-graph extractor

Walk every markdown file's links once at import. Capture per-doc:
- `inbound_link_count`: how many other docs link to this doc (after dedup-by-source)
- `inbound_anchor_texts`: list of the anchor texts used by linkers (deduplicated, capped at 32 per doc)
- `outbound_link_count`: how many other docs this doc links to
- `pagerank_centrality`: PageRank-shaped centrality computed over the doc-graph (one-time per import; standard 0.85 damping factor; converges in ≤30 iterations on typical corpora)
- `is_authoritative_target`: true iff `inbound_link_count >= median + 2*MAD` AND multiple linkers use a topic-shaped anchor text (heuristic: docs that many others point to with a consistent name are structural authorities for that name)

Link-graph extraction is deterministic: same corpus, same links, same PageRank result.

### Provenance is load-bearing — gating on confidence, not just presence

Nav information arrives from sources of materially different reliability. The PRD must distinguish them or it repeats the "weak inferred signal becomes ranking authority" pattern that bit PRD-0023 (`is_index_file` boosting every README uniformly).

| Source | Reliability | What it tells you |
|---|---|---|
| Explicit project nav config (`sidebars.ts`, `mkdocs.yml`, `_category_.json`) | high — author explicitly declared the project-wide structure | "this doc is the section landing for X, in this order, with this label" |
| Frontmatter `sidebar_label` / `sidebar_position` on individual docs | medium — explicit but per-doc; can be inconsistent | "I, the author of this one doc, want it labeled this way" |
| README/index-as-section-index fallback | low — convention-based heuristic | "this looks like the section's landing page" |

Captured as `nav_provenance` on `SourceProfile`:

```ts
type NavProvenance =
  | "explicit_config"   // sidebars.ts, _category_.json, mkdocs.yml
  | "frontmatter"       // sidebar_label / sidebar_position on the doc itself
  | "structural"        // README/index-as-section-landing inference
  | "none";             // no nav data extracted

type SourceProfile = {
  // ...existing + nav_section_id / nav_position / nav_label / is_nav_landing...
  nav_provenance?: NavProvenance;
};
```

### How source-rerank consumes the new fields (gated on provenance, no new coefficients)

| New field | Existing feature it feeds | Provenance gate |
|---|---|---|
| `nav_label` | `alias_hit_count`, `owner_identity_score` | `explicit_config` and `frontmatter` → full alias contribution. `structural` → advisory only (surfaced in explain, not consumed by ranking math). |
| `is_nav_landing` | `overview_owner_score` | `explicit_config` only → full contribution. `frontmatter` → reduced or advisory (single-doc declaration may not match project intent). `structural` → advisory only. |
| `inbound_anchor_texts` | `alias_hit_count`, `owner_identity_score` | always full contribution — anchor text is a literal extraction from another doc's link, no inference involved. (Slice 27.2 field; same provenance discipline applies but the source is always "explicit_link".) |
| `pagerank_centrality` | `overview_owner_score` | scaled fixed value; centrality is computed deterministically from the link graph so no provenance gate is needed. |
| `is_authoritative_target` | `owner_identity_score` | always full contribution when true (the threshold itself is the gate). |

The principled split: **alias-substrate consumption tolerates frontmatter** (the author wrote the label explicitly, even if just for one doc); **overview-owner-score requires explicit project config** (a section-landing claim affects ranking authority across the section, so the project-wide source is the only trusted one).

Every consumption path is additive on existing features. **No new feature in `SourceRerankFeatures`. No new coefficient. No new boost.** The lift mechanism is "existing scoring sees new evidence," same shape as PRD-0024 slice 24.1 (which delivered a clean +1) — and the provenance gate is what prevents this PRD from regressing the same way PRD-0023 did when weak inferred signals were treated as authority.

### What this is NOT

**This PRD does not deliver query-time graph traversal.** Neighbor expansion ("walk the graph from seeds to add related stuff to the pack") is a context-assembly concern, depends on retrieval being right first, and would need its own architecture decisions. PRD-0027 ships *graph features* — scalar values on each `SourceProfile` derived from the graph at import time — not graph traversal at query time.

The PRD-0025 verdict explicitly localized: **don't add layers that require good seeds before the seed selection is solid.** Source-level graph features don't have that problem; they're new evidence on the existing candidates, not expansion from seeds.

## User Stories

1. As a ContextTrail maintainer, I want the importer to parse common docs-config formats (VitePress, Docusaurus, MkDocs, frontmatter `sidebar_position`) so that author-declared nav structure becomes available to source-rerank.
2. As a ContextTrail maintainer, I want each doc's nav label captured separately from its title, so that queries can match the canonical name authors use even when the title is more elaborate.
3. As a ContextTrail maintainer, I want section-landing detection from nav config so that "is this the section entry point" is structurally determined, not heuristically inferred from path.
4. As a ContextTrail maintainer, I want every markdown file's outbound links extracted at import time so that the corpus's link graph is materialized once and queried cheaply.
5. As a ContextTrail maintainer, I want inbound-link counts and anchor texts captured per doc so that source-rerank knows what name other docs use to refer to this one.
6. As a ContextTrail maintainer, I want PageRank-shaped centrality computed once at import so that high-centrality docs (often the project's true canonical entries) get appropriate weight in source-rerank.
7. As a ContextTrail maintainer, I want all new fields fed through source-rerank's existing alias substrate and identity-score features, so that no new score-component coefficients enter the scoring math.
8. As a ContextTrail maintainer, I want both slices behind feature flags with default off, so that lift can be validated independently before becoming default.
9. As a ContextTrail maintainer, I want the link-graph extractor to handle malformed / dead links gracefully (skip them; never block import).
10. As a ContextTrail maintainer, I want the nav parser to handle missing / malformed config gracefully (degrade to null; never block import).
11. As a ContextTrail maintainer, I want acceptance to require at least one addressed miss explained by a specific new field (commit message names case + field) so that the lever is shown to be doing real work.
12. As a future implementer, I want graph traversal at query time to remain explicitly out of scope, so that the architecture stays at "graph features, not graph walks."

## Implementation Decisions

### Slice 27.1 — nav parser

- New module `src/parse/nav-parser.ts`. Per-format sub-parsers; one entry function `parseNavConfig(corpus_root): NavGraph`.
- `NavGraph` is a single-pass artifact: array of `{ source_path, nav_section_id, nav_position, nav_label, is_nav_landing }`.
- Source-profile builder consumes the `NavGraph` at import time and populates the new fields on each `SourceProfile`.
- Initial format coverage: VitePress, Docusaurus, MkDocs, frontmatter `sidebar_position`. Each in a separate file under `src/parse/nav-parser/<format>.ts` so adding new formats later doesn't churn the entry function.
- README-as-section-index detection: when a directory contains `README.md` (or `index.md`) plus other docs, the README is treated as the section landing if no explicit nav config disagrees.

Additive `SourceProfile` fields (no schema_version bump):
```ts
type SourceProfile = {
  // ...existing fields unchanged...
  nav_section_id?: string | null;
  nav_position?: number | null;
  nav_label?: string | null;
  is_nav_landing?: boolean;
};
```

### Slice 27.2 — link-graph extractor

- New module `src/parse/link-graph.ts`. One pass over the corpus; produces `LinkGraph`.
- `LinkGraph` is computed at corpus level (needs all docs first), then projected to per-doc fields.
- PageRank computation: standard iterative algorithm, 0.85 damping, max 30 iterations or until convergence (delta < 1e-6).
- Anchor text capture: dedup at the (linker, target) pair level so a single doc that links to the same target multiple times only contributes one anchor text.
- Threshold for `is_authoritative_target`: corpus median inbound count plus 2 × MAD, AND ≥ 2 distinct linkers use a topic-shaped anchor text (anchor text matches the target's `nav_label` or `title` after normalization).

Additive `SourceProfile` fields:
```ts
type SourceProfile = {
  // ...existing fields unchanged + 27.1 fields...
  inbound_link_count?: number;
  inbound_anchor_texts?: string[];     // capped at 32, deduplicated
  outbound_link_count?: number;
  pagerank_centrality?: number;        // 0..1
  is_authoritative_target?: boolean;
};
```

### Source-rerank consumption (slice 27.3)

Wire the new fields into source-rerank's existing features through the alias substrate and identity-score path. **No new feature. No new coefficient.** Behind feature flag `RETRIEVAL_RELATIONAL_SOURCE_METADATA=on` (default off until promotion gates pass).

Specifically:
- `nav_label` and `inbound_anchor_texts` are added to the per-doc alias set consumed by `alias_hit_count` and `owner_identity_score`.
- `is_nav_landing` and `pagerank_centrality` feed `overview_owner_score`'s existing weighted sum (scaled appropriately so they don't dominate; principled fixed scaling, not tuned).
- `is_authoritative_target` boosts the identity-score path within bounded multiplier.

### What's explicitly excluded from PRD-0027

- Query-time graph traversal / neighbor expansion (context-assembly concern; future PRD if/when needed)
- Chunk-level link graph (per-section cross-references) — out of scope; project to source-level only in v1
- Author-declared frontmatter overrides for nav/canonicality (could ship later as opt-in escape hatch)
- Cross-corpus / external link graph (only intra-corpus links for v1)
- New score-component coefficients in source-rerank
- AI-proposed relational metadata
- Production MCP response-shape changes

## Testing Decisions

### Synthetic property tests

- **Nav parser**: 200 random VitePress / Docusaurus / MkDocs config shapes; assert each format produces correct `nav_section_id`, `nav_position`, `nav_label`, `is_nav_landing` on representative inputs. Lower-95 ≥ 95%.
- **Link-graph extractor**: 200 random doc-graph topologies; assert PageRank converges and produces stable ranks; assert inbound anchor texts deduplicate correctly.
- **`is_authoritative_target` thresholding**: corner cases at the median+2*MAD boundary and the anchor-text-distinctness threshold.

### Adversarial coverage

- Nav: malformed configs, missing files, configs that disagree with each other (multiple format files present), unicode in nav labels, deeply nested categories.
- Link graph: cyclic links (A → B → A), self-links, broken links (target file doesn't exist), links with anchor fragments (`./foo.md#bar`), very long anchor text strings.

### Real-corpus discipline

Predicted addressable cohort (from the audit, prioritized by which depend on relational signals):

- **Nav-driven** (slice 27.1):
  - `trpc-unanchored-overview` (`docs/server/overview.md` is nav landing for "server" section)
  - `vitest-cross-module-browser-mode` (`browser/index.md` confirmed nav landing)
  - `vitest-anchored-mocking` (`mocking.md` parent vs `mocking/modules.md` child differentiated by nav landing flag)
- **Link-graph-driven** (slice 27.2):
  - `ralph-anchored-setup-sync` (true top-3 miss; ADR-0004 is referenced by `triage-labels.md` with anchor text matching the query)
  - `ralph-anchored-discover-eligible` (CONTEXT.md is high-centrality doc with many inbound links)
  - `tanstack-cross-module-eslint` (true top-3 miss; eslint-plugin-query.md likely has inbound links from main tanstack docs)

Conservative target per slice: **at least 1 clean win, zero per-case regression**. Same bar as PRD-0024 slice 24.1 (which delivered the only clean lift across 5 PRDs of experimentation).

## Promotion Gates (per slice)

Conjunctive — every gate must pass before the slice's feature flag flips to `on`:

- `npm test` passes
- `npx tsc --noEmit` passes
- All synthetic property tests pass at lower-95 ≥ 95%
- Adversarial suites pass
- Real-corpus eval (flag on):
  - top-1 ≥ baseline (no regression vs current displayed)
  - top-3 ≥ 118/122 (no regression)
  - coverage_honest stays 148/148
  - agent_answer ≥ 147/148
  - chunk_correctness ≥ 3/3
  - per-case `regressions == 0`
  - **At least one addressed miss explained by a specific new field** (commit message names case + field — `nav_label` / `is_nav_landing` / `inbound_anchor_texts` / `pagerank_centrality` / `is_authoritative_target`)
- All predicted addressable cases verified or explained
- All unpredicted flips reviewed and classified before acceptance

## Out of Scope

- Query-time graph traversal / neighbor expansion (future context-assembly PRD)
- Chunk-level link graph
- New score-component coefficients in source-rerank
- AI in any inference path
- Production MCP response-shape changes
- Author opt-in frontmatter overrides (future, if needed)
- Re-litigating parked PRD-0022 / PRD-0023 / PRD-0025 ranking-time and chunk-layer experiments

## Further Notes

This PRD is the audit's slices 4 and 5, finally. Five PRDs of experimentation triangulated to the conclusion the audit reached on day one: source-level relational metadata is what's missing. Three independent failure-mode lines all point here:

1. **Path-topology** (PRD-0023) showed the symmetric-additive-boost trap. Relational fields don't have that shape — `inbound_anchor_texts` is candidate-specific, not corpus-symmetric.
2. **Heading aliases** (PRD-0024 slice 1) delivered the only clean +1 because the signal was *new evidence* fed through *existing features*. PRD-0027 takes the same shape.
3. **Chunk-layer structural** (PRD-0025) showed that adding signals duplicated at a different layer doesn't help. PRD-0027 adds signals that aren't anywhere today.

The architectural thread the project has been pulling on for several months — "right enough at the source level, broken at sibling discrimination" — finally has its actual lever named and shipped. If PRD-0027 closes the sibling-discrimination gap, the retrieval architecture is at a real plateau and context-assembly becomes the next frontier (where graph traversal genuinely belongs). If PRD-0027 doesn't close the gap, the diagnosis shifts to "source-rerank's coefficients themselves are wrong," and that's a deeper architecture question.

Either outcome is informative. This is the PRD that finishes the audit's deterministic-extraction direction. Whatever comes after is an architectural decision based on what PRD-0027's data shows.

## Future-PRD reference: deterministic query shaping with clarification fallback

Captured here because the architecture is parallel to PRD-0027 and the design constraint is unusual enough to be worth recording before the idea evaporates.

The unanchored failure cohort (~7 cases of the 16 displayed top-1 misses) suggests query-side processing as a complementary lever — synthesizing anchor-equivalent signals from natural-language query text (topic noun phrases, question shape, version mentions, package mentions) so source-rerank's existing alias-substrate / purpose-compat features have more to work with on queries that arrive without caller anchors.

The architectural concern (carried from PRD-0019/0020/0021): parser-extracted facets at query time produced 13 regressions in PRD-0020 because the parser became authority — noisy `topic:across`, `topic:set` shards were treated as required gates.

The user's locked design constraint for any future query-shaping work:

> **Deterministic extraction or ask the user.** If a deterministic regex/pattern rule cannot honestly determine what the query is asking, the engine asks the user a targeted clarifying question rather than guessing. No LLM at query time. No silent inference of intent.

This is materially different from the parked facet engine. The parked design tried to extract structured intent from any query; the new design extracts only when the deterministic signal is strong, and falls back to user clarification (matching the existing setup-wizard pattern, applied at query time) when it isn't.

Specifically the high-confidence extraction patterns:
- **Question-shape detection** (already partly in `classifyQueryIntent`): `"how does X work"` → concept-shaped → biases toward `doc_purpose: concept`. `"what is X"` → overview-shaped → biases toward `is_nav_landing` docs.
- **Version mention extraction**: `"v3"`, `"v4"`, `"3.x"` in query → matches `version_segment` field (still on `SourceProfile` from the parked PRD-0023 path topology).
- **Package mention extraction**: explicit package-shaped tokens → matches `package_segment` field.
- **Topic-noun-phrase extraction**: dominant nouns in the query → matches `nav_label` / `inbound_anchor_texts` (PRD-0027) and `heading_aliases` (PRD-0024 shipped).

When extraction confidence is low (ambiguous query, no strong anchors, multiple plausible intents):
- Engine returns a `needs_clarification` readiness state with 2–4 candidate disambiguations
- Caller surfaces these to the user as a prompt: "Did you mean A or B?"
- User's selection is captured as an explicit anchor and re-runs retrieval

This composes with PRD-0027 — nav and link-graph fields populate the source side; query shaping is what makes source-rerank notice when query text references those fields. Sequencing: PRD-0027 ships first (most of the unanchored failures are addressed there), then this query-shaping PRD picks up the residual cases that need query-side signal extraction or user clarification. Captured here as PRD-0028 candidate work; not filed.
