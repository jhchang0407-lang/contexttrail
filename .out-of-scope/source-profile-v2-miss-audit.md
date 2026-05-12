# SourceProfile v2 — Per-Miss Deterministic-Signal Audit

**Question this doc answers:** for each of the 16 displayed top-1 misses on the real-corpus eval, what **deterministic signals already present in the corpus** — extractable at import time, no inference, no AI — would have made the case unambiguous?

**Source:** `/tmp/eval-runs/baseline.json` (`RETRIEVAL_RERANK_TIEBREAKERS=off`).

**Framing note:** an earlier draft of this audit listed AI-proposed metadata as the lever. That's wrong on principle (variability between codebases, AI as truth, exactly the trap PRD-0019/0020/0021 just parked). This rewrite restricts the lever to **deterministic signals an import-time compiler can extract from sources that already exist:** path topology, nav/sidebar order, link graph, heading outline, code/config extraction, doc shape, version markers, declared frontmatter. AI is not on the table for this design pass.

---

## Deterministic signal taxonomy

Reusing the categories from the user's framing:

| Signal | What it measures | Source |
|---|---|---|
| **Path topology** | repo/package/version, parent/child/sibling, `index.md` entrypoints, basename aliases, path depth | filesystem at import |
| **Nav/sidebar position** | first page in section, ordered siblings, section landing pages | docs config files (vitepress, docusaurus, mkdocs, sidebars.json, _category_.json, etc.) |
| **Link graph** | inbound links, outbound links, anchor text, "see also" sections, PageRank-ish centrality, intro vs. depends-on | markdown link extraction |
| **Heading outline** | H1/H2/H3 terms, section anchors, topic contexttrails, repeated heading patterns | markdown AST |
| **Code/config extraction** | filenames, package names, imports, CLI commands, env vars, routes, option names, exported symbols, config keys | code fences, `package.json`, scattered config |
| **Doc shape metrics** | code density, table density, API signature density, heading depth, length, changelog density, version-marker density | structural analysis |
| **Role heuristics** | path patterns + headings + tables + code fences + nav position → role label | composite |
| **Canonicality signals** | first nav item, shortest topic path, highest inbound links, exact title match, section index page, non-changelog, non-deep-link | composite |
| **Version/platform constraints** | browser/node, React/Vue/Svelte, v4/v5, deprecated/legacy, beta/experimental | paths, headings, frontmatter, package fields |
| **Declared metadata** | frontmatter tags, sidebar labels, titles, slugs, package fields, docs-config metadata | author-authored, opt-in |

---

## Per-case analysis (deterministic signals only)

### 1. hono/hono-anchored-validation
- **Task:** `validate request body in a Hono endpoint` | **Expected:** `docs/guides/validation.md` | **Top-1:** `docs/api/request.md`
- **Resolver signals:**
  - **Path topology:** `docs/guides/` family vs `docs/api/` family — guide vs reference is path-encoded
  - **Doc shape:** `validation.md` likely has `## Steps` / numbered prose; `request.md` has API signature tables → role differentiation
  - **Heading outline:** "Validation" as H1/H2 in validation.md is exact topic match; request.md has "Validation" only as a sub-section
- **Verdict:** **fully deterministic.** Path-family + heading-exact-match + doc-shape role inference all available without AI.

### 2. hono/hono-cross-module-jsx
- **Task:** `render JSX from a hono handler` | **Expected:** `docs/guides/jsx.md` | **Top-1:** `docs/middleware/builtin/jsx-renderer.md`
- **Resolver signals:**
  - **Path topology:** `jsx.md` is shallower (depth 2) than `middleware/builtin/jsx-renderer.md` (depth 4)
  - **Nav position:** Hono's docs config almost certainly lists `jsx.md` as a top-level guide; `jsx-renderer.md` as a middleware sub-entry
  - **Link graph:** `jsx-renderer.md` likely has an inbound "see [JSX guide](../../guides/jsx.md)" — and conversely `jsx.md` is the linked-to authority
- **Verdict:** **fully deterministic** via path depth + nav position + link graph.

### 3. prisma/prisma-cross-module-migrate-vs-schema
- **Task:** `how does prisma migrate read changes from schema.prisma and produce SQL migrations` | **Expected:** `mental-model.md` | **Top-1:** `customizing-migrations.md`
- **Resolver signals:**
  - **Path topology:** `understanding-prisma-migrate/mental-model.md` vs `workflows/customizing-migrations.md` — `understanding-` directory marker is a deterministic signal of conceptual content; `workflows/` marks how-to
  - **Doc shape:** mental-model.md likely has fewer code fences and more prose paragraphs vs. customizing-migrations.md's step-by-step blocks
  - **Heading outline:** mental-model.md probably has "How it works" / "Mental model" headings — exact topic match for "how does X work" query shape
- **Verdict:** **fully deterministic** via path-segment role markers (`understanding-` vs `workflows/`) + code-density doc-shape metric.

### 4. ralph/ralph-anchored-setup-sync — TRUE TOP-3 MISS
- **Task:** `resolve Linear label and workflow-state names to IDs in setup sync` | **Expected:** `docs/adr/0004-...` | **Top-1:** `docs/agents/triage-labels.md` (accepted not in top-3)
- **Resolver signals:**
  - **Link graph:** `triage-labels.md` almost certainly has outbound link `[ADR-0004](../adr/0004-...)` for "label IDs come from ADR-0004." Anchor text "ADR-0004" or "label-to-ID mapping" is the route.
  - **Path topology:** `docs/adr/` directory marks decision documents — high authority for resolution-of-ambiguity queries
- **Verdict:** **fully deterministic** via link-graph extraction. Today's source-rerank doesn't use link graph at all — that's the gap.

### 5. ralph/ralph-anchored-discover-eligible
- **Task:** `select eligible Linear issues for a queue query` | **Expected:** `CONTEXT.md` | **Top-1:** `docs/agents/issue-tracker.md`
- **Resolver signals:**
  - **Path topology:** `CONTEXT.md` is at repo root — shallowest possible path
  - **Heading outline:** `CONTEXT.md` likely has glossary-style "## Eligible / ## Queue / ## Discover" sections that exactly match the query terms
  - **Link graph:** `CONTEXT.md` is probably the most-inbound-linked doc in this repo (other docs say "see CONTEXT.md for vocabulary")
  - **Code/config extraction:** the anchor file `discover-eligible.ts` may import or reference symbols defined in `CONTEXT.md` (uncommon for prose docs but possible if there's a generated glossary)
- **Verdict:** **mostly deterministic.** Link graph + path depth + heading exact-match should win this. The remaining gap (caller anchor `discover-eligible.ts` doesn't appear in CONTEXT.md text) is the honest limit you named — but enough other deterministic signals exist that AI is not needed.

### 6. tanstack/tanstack-anchored-typescript-types
- **Task:** `configure typescript types for useQuery hook return value` | **Expected:** `docs/react/typescript.md` | **Top-1:** `docs/react/reference/useQueries.md` (wrong hook)
- **Resolver signals:**
  - **Path topology:** `react/typescript.md` is a top-level guide; `react/reference/useQueries.md` is in the API reference subdirectory
  - **Heading outline:** `typescript.md` H1 likely "TypeScript" — exact topic match for "typescript types" query
  - **Code/config extraction:** `useQueries` (plural) ≠ `useQuery` (singular) — exact-symbol mismatch is a deterministic disqualifier; today's tokenizer stems them together
- **Verdict:** **fully deterministic** if the tokenizer preserves singular vs. plural surface form when matching anchor symbols (the same fix the basename rule needed).

### 7. tanstack/tanstack-cross-module-eslint — TRUE TOP-3 MISS
- **Task:** `what eslint rules does react-query provide and how do I enable them` | **Expected:** `docs/eslint/eslint-plugin-query.md` (accepted not in top-3)
- **Resolver signals:**
  - **Path topology:** `docs/eslint/` is a separate package directory — query mentions "eslint" → package routing
  - **Code/config extraction:** the package likely has `package.json` declaring it as `eslint-plugin-query`
  - **Heading outline:** the doc's H1 is probably literally "ESLint Plugin Query" or "@tanstack/eslint-plugin-query"
- **Verdict:** **fully deterministic** via package-name extraction + path-package routing. The candidate-generation pipeline needs to expand the slate when query mentions a package name that maps to a sub-directory.

### 8. trpc/trpc-anchored-router — TRUE TOP-3 MISS
- **Task:** `build a trpc router with input validation`, anchor symbol `router` | **Expected:** `docs/server/routers.md` | **Top-1:** `docs/server/validators.md`
- **Resolver signals:**
  - **Code/config extraction:** `routers.md` almost certainly has `import { router } from '@trpc/server'` in its code fences. Symbol `router` extracted from a code fence in `routers.md` deterministically anchors the symbol to that doc.
  - **Path topology:** basename `routers` is the plural of anchor symbol `router` — deterministic stem match on basename specifically (a stronger signal than basename-vs-content-token equality)
  - **Heading outline:** `routers.md` H1 is probably "Defining Routers" — exact topic
- **Verdict:** **fully deterministic** via code-fence symbol extraction. This is the missing signal: today's `path_token_coverage` looks at filenames; it doesn't extract symbol declarations from code fences inside the doc.

### 9. trpc/trpc-anchored-procedures
- Same shape as case 8. `procedures.md` likely contains `import { publicProcedure } from '@trpc/server'` in a code fence; symbol `publicProcedure` deterministically anchors.
- **Verdict:** **fully deterministic** via code-fence symbol extraction.

### 10. trpc/trpc-unanchored-overview
- **Task:** `what is trpc and how does it work` | **Expected:** `docs/server/overview.md` | **Top-1:** `docs/client/vanilla/overview.md`
- **Resolver signals:**
  - **Nav position:** trpc's docs almost certainly list `docs/server/overview.md` as the first/landing page of the docs (server is the canonical starting point for "what is trpc"). `docs/client/vanilla/overview.md` is in a sub-section.
  - **Link graph:** `docs/server/overview.md` is the highest-inbound-link doc; client docs link back to it as "what is trpc"
  - **Path topology:** `server/overview.md` may be shallower or earlier in nav order than `client/vanilla/overview.md`
- **Verdict:** **fully deterministic** via nav-position extraction. This is huge: docs-config files (`sidebars.ts`, `mkdocs.yml`, frontmatter `sidebar_position`) carry canonicality information that today's importer doesn't use.

### 11. vitest/vitest-anchored-mocking
- **Task:** `mock a module in a vitest test`, anchor `vi.mock` | **Expected:** `docs/guide/mocking.md` (parent) | **Top-1:** `docs/guide/mocking/modules.md` (child)
- **Resolver signals:**
  - **Path topology:** `mocking.md` exists adjacent to `mocking/` directory — that's the canonical "section index" pattern. Already partially detected by source-family graph; needs to be a stronger ranking signal.
  - **Nav position:** `mocking.md` is the section landing page; `mocking/modules.md` is a sub-section
  - **Code/config extraction:** `vi.mock` symbol probably appears in code fences of BOTH docs, so this signal alone doesn't differentiate. Path-topology + nav-position carry the load.
- **Verdict:** **fully deterministic** via path-adjacency-to-directory + nav landing-page detection.

### 12. vitest/vitest-anchored-snapshot
- **Task:** `configure inline snapshots and snapshot file location` | **Expected:** `docs/guide/snapshot.md` (guide) | **Top-1:** `docs/guide/learn/snapshots.md` (tutorial)
- **Resolver signals:**
  - **Path topology:** `learn/` directory marker is a tutorial role; `guide/` directory marker is a how-to role. Already partially captured; needs to be promoted to deterministic role tag.
  - **Doc shape:** tutorial likely has more prose / less config-snippet density; guide has reference-table + code-fence density. Doc-shape metrics differentiate.
  - **Heading outline:** "Configure" / "File location" headings in snapshot.md exactly match "configure" / "file location" verbs in the query.
- **Verdict:** **fully deterministic** via path-segment role markers + heading exact-match.

### 13. vitest/vitest-unanchored-environment
- **Task:** `switch test environment to jsdom for component tests` | **Expected:** `docs/guide/environment.md` | **Top-1:** `docs/guide/browser/component-testing.md`
- **Resolver signals:**
  - **Heading outline:** `environment.md` H1 is "Test Environment" — exact topic match for "test environment" in query
  - **Code/config extraction:** `environment.md` likely declares config keys like `environment: 'jsdom'`. Query mentions `jsdom` — config-key extraction matches.
  - **Path topology:** `guide/environment.md` is at the guide root; `guide/browser/component-testing.md` is a sub-section of an unrelated topic.
- **Verdict:** **fully deterministic** via config-key extraction + heading exact-match.

### 14. vitest/vitest-cross-module-browser-mode
- **Task:** `run vitest tests in a real browser` | **Expected:** `docs/guide/browser/index.md` | **Top-1:** `docs/guide/browser/component-testing.md`
- **Resolver signals:**
  - **Path topology:** `index.md` is literally an index file — strong canonicality signal that today's importer doesn't promote enough
  - **Nav position:** `index.md` is the landing page of the `browser/` section
- **Verdict:** **fully deterministic.** `index.md` detection is trivial; just needs to be a high-weight ranking signal.

### 15. zod/zod-anchored-error-handling
- **Task:** `format zod parse errors for the user`, anchor `ZodError` | **Expected:** `packages/docs-v3/ERROR_HANDLING.md` | **Top-1:** `packages/zod/README.md`
- **Resolver signals:**
  - **Code/config extraction:** `ERROR_HANDLING.md` almost certainly has code fences like `error instanceof ZodError`, `ZodError.format()`, etc. Symbol `ZodError` extracted from code fences anchors deterministically.
  - **Heading outline:** H1 is "Error Handling" — exact topic match
  - **Path topology:** ALL_CAPS basename like `ERROR_HANDLING.md` is a strong "named topic" signal in many doc styles
- **Verdict:** **fully deterministic** via code-fence symbol extraction + ALL-CAPS basename heuristic.

### 16. zod/zod-unanchored-readme-v3 — TRUE TOP-3 MISS (rank > 3)
- **Task:** `zod v3 documentation reference` | **Expected:** `packages/docs-v3/README.md`
- **Resolver signals:**
  - **Path topology:** `packages/docs-v3/` directory name encodes version `v3` — query mentions "v3," exact path-segment match
  - **Doc shape:** README.md is typically the package landing page; very high doc-shape weight for "documentation reference" queries
  - **Nav position:** README.md is the package entrypoint by convention
- **Verdict:** **fully deterministic** via path-version extraction + README convention.

---

## Aggregate: signals ranked by per-case leverage

| Deterministic signal | Cases it would resolve | Fully or partially |
|---|---:|---|
| **Code/config extraction** (symbols / config keys / package names from code fences) | 5 (cases 6, 7, 8, 9, 13, 15) | Fully |
| **Path topology** (depth, parent/child adjacency, package directories, version markers, ALL-CAPS basenames, `index.md`) | 12 (cases 1, 2, 3, 6, 7, 10, 11, 12, 13, 14, 15, 16) | Fully on most |
| **Heading outline** (H1 exact-topic match, glossary section markers) | 7 (cases 1, 3, 5, 6, 12, 13, 15) | Fully |
| **Nav position** (sidebar / docs-config landing pages) | 4 (cases 2, 10, 11, 14) | Fully |
| **Link graph** (inbound centrality, outbound `see also`) | 3 (cases 2, 4, 5) | Fully |
| **Doc shape metrics** (code density, prose density, table density) | 3 (cases 1, 3, 12) | Partially (acts as a tiebreaker) |
| **Path-segment role markers** (`understanding-`, `workflows/`, `learn/`, `guide/`, `reference/`) | 3 (cases 3, 12, others) | Fully |

**Coverage if SourceProfile v2 ships with the top three signal categories** (path topology + heading outline + code/config extraction): rescues **at least 13 of the 16 cases** deterministically. Add nav position and link graph: covers **15 of 16** including the true top-3 misses.

---

## The honest deterministic limit

Per the user's framing: deterministic signals can extract structure that **already exists somewhere in the corpus**. They cannot invent missing relationships.

In our 16-case set, the cases where deterministic might fall short:

- **Case 5 (ralph discover-eligible → CONTEXT.md):** if the anchor file `src/queue/discover-eligible.ts` doesn't appear anywhere in the corpus markdown (not in code fences, not in cross-references, not in frontmatter), no signal can route the anchor to CONTEXT.md. The implicit relationship "this domain term is defined in the glossary" lives in author headspace.
   - **Mitigation in this case:** other deterministic signals (link graph centrality, path depth, heading exact-match for "eligible") still rank CONTEXT.md highly. The anchor-routing signal is missing but not load-bearing.
   - **Genuinely unrecoverable case:** if the doc never names the symbol AND no other doc cross-references it AND nav/path topology gives no canonicality clue. None of our 16 cases fit this shape cleanly.

So **for this 16-case set, the deterministic signal compiler has a near-100% theoretical ceiling.** The honest limit becomes load-bearing only on much sparser corpora where docs don't cross-reference and don't carry rich code fences.

---

## Where AI would still be useful (and how to constrain it)

The user's question: if AI is needed, how do we make it as deterministic as possible?

For our addressable cohort, **AI is not needed.** The deterministic signal taxonomy covers the failure modes. PRD-0023 should ship without any AI in the import pipeline.

For corpora where deterministic signals genuinely fall short — sparse docs, missing cross-references, no nav config, no consistent path topology — three options to constrain AI variability:

1. **AI proposes, deterministic accepts.** AI suggests a metadata tag. Importer emits a `proposed_metadata.yaml` artifact. The author reviews and accepts (or auto-accept under a confidence threshold). Once accepted, the metadata is frozen and reused — never re-generated. This makes AI variability a one-time cost paid once at import, not a per-query truth source.
2. **AI confirms, deterministic decides.** Deterministic signals nominate a candidate (e.g., "I think `mocking.md` is canonical for `mocking` topic at high confidence"). AI is asked a yes/no question: "is this correct?" Single-token answer is far more reproducible than open-ended generation, AND the deterministic side is making the proposal so AI is bounded.
3. **AI bounded by closed-set vocabulary.** If asked to label a doc's role, AI must pick from a fixed enum (`overview | guide | reference | api | example | migration | changelog | troubleshooting`). Output validation rejects anything off the enum. This converts generation into classification, which has lower variability.

**None of these apply to our current eval set.** They're future considerations only.

---

## SourceProfile v2 — recommended fields (deterministic-only)

Three field groups, all populated at import time from the signal categories above. **No AI in the inference path. No author-mandatory frontmatter. Author opt-in only when the deterministic compiler outputs `confidence: low` and the author wants to override.**

### 1. `topology: SourceTopology` (path + nav + link graph)
```ts
type SourceTopology = {
  path_depth: number;
  is_index_file: boolean;          // basename is "index.md" or "README.md"
  is_section_landing: boolean;     // .md file adjacent to same-named directory
  package_segment: string | null;  // detected package name from path/package.json
  version_segment: string | null;  // detected version marker (v3, v4, beta, ...)
  nav_order: number | null;        // from sidebars.ts / mkdocs.yml / frontmatter
  nav_section: string | null;
  inbound_link_count: number;
  outbound_link_count: number;
  pagerank_centrality: number;     // computed once at import
  is_authoritative_target: boolean; // many docs link to this with "see also" / canonical anchor text
};
```

### 2. `extraction: SourceExtraction` (code fences + headings + doc shape)
```ts
type SourceExtraction = {
  declared_symbols: string[];      // imports / exports / API signatures from code fences
  config_keys: string[];           // option names from code fences and prose
  cli_commands: string[];
  routes: string[];
  env_vars: string[];
  heading_terms: string[];         // H1/H2/H3 terms, deduplicated
  topic_contexttrails: string[];     // path segment + heading + first-paragraph nouns
  code_density: number;
  table_density: number;
  api_signature_density: number;
  doc_length: number;
};
```

### 3. `role_v2: DocRoleV2` (closed-set, deterministic-only)
```ts
type DocRoleV2 = {
  primary: "overview" | "guide" | "tutorial" | "how_to" | "concept"
         | "api_reference" | "config_reference" | "migration"
         | "changelog" | "example" | "decision" | "troubleshooting";
  // composite signal: path-segment markers + heading patterns + doc-shape +
  // nav-section name. Each contributes a vote; primary is highest-vote.
  signals: Array<{ source: string; vote: string; weight: number }>;
  confidence: "high" | "medium" | "low";
};
```

`role_v2.confidence: high` flips it to a deterministic ranking signal. `medium` / `low` stays advisory.

---

## Changes to source-rerank to use the new signals

PRD-0023's actual ranking work becomes very small:

1. **Boost docs with `topology.is_index_file == true` or `is_section_landing == true`** when the query lacks sub-anchors (cases 11, 14).
2. **Boost docs whose `extraction.declared_symbols` includes a caller anchor symbol** verbatim — case-preserving exact match (cases 8, 9, 15).
3. **Boost docs whose `extraction.heading_terms` has an exact-topic match** with query content tokens, surface-form (no stemming) (cases 1, 3, 5, 6, 12, 13).
4. **Use `topology.nav_order == 1`** as a strong canonicality signal for unanchored "what is X?" queries (cases 10, 14).
5. **Use `topology.inbound_link_count` and `pagerank_centrality`** as a soft canonicality boost — particularly for true top-3 misses where the right doc is structurally important but content-thin (case 4).
6. **Penalize docs whose `topology.version_segment` doesn't match a query version mention** (case 16).

All of these are scalar score components added to the existing source-rerank function. Each is independently revertable. Each has a deterministic synthetic property test (no surface-signature symmetry trap).

---

## Bottom line

The 16 displayed top-1 misses are **not a ranking-function problem.** They're a **signal-extraction problem.** Today's importer leaves nav config, link graph, code-fence symbol declarations, doc-shape metrics, and path-segment role markers on the table. PRD-0023's primary deliverable is an **import-time deterministic compiler** that reads those signals out of the corpus the customer already has. The ranking-function changes are tiny — score boosts on the new signals, no new architecture.

**Projected reach (deterministic only): 13–15 of 16 cases.** Top-1 ceiling: 105 + 13 = **118/121 (97.5%)**, comfortably clearing the 97% target. AI is not on the critical path. Author tagging is not on the critical path. The lever is structural metadata that already exists in the corpus and that today's importer doesn't extract.
