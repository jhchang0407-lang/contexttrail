# PRD-0042 Promotion Report

This durable report records the current promotion evidence for the chunk-first code lane.

========== CROSS-REPO CODE-LANE COMPARISON ==========
Same default budget across every repo section.

Repo: ContextTrail
root: /Users/thomaschang/Repos/DriftLedger
task panel: THO-228, THO-227, THO-229, THO-225

========== PAIRED CODE-LANE COMPARISON ==========
Same task panel, default budget, old file-card path vs new chunk-first code lane.

Summary:
  Source-file coverage      Old (file-card): 13/66 (19.7%)
                            New (chunk-first): 66/66 (100.0%)
  Code top-1 acceptable     Old (file-card): 0/14 (0.0%)
                            New (chunk-first): 12/14 (85.7%)
  Code ranked useful        Old (file-card): 0/14 (0.0%)
                            New (chunk-first): 14/14 (100.0%)
  Support-cluster useful    Old (file-card): 0/14 (0.0%)
                            New (chunk-first): 12/14 (85.7%)

Per-ticket detail:

  THO-228 (493303b)
    file coverage        old 0/7  →  new 7/7
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-227 (2ecd946)
    file coverage        old 1/6  →  new 6/6
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-229 (c363aba)
    file coverage        old 2/3  →  new 3/3
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-225 (44e7735)
    file coverage        old 0/5  →  new 5/5
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-224 (d4adc03)
    file coverage        old 3/10  →  new 10/10
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-223 (5947445)
    file coverage        old 0/3  →  new 3/3
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new miss

  THO-221 (99cf920)
    file coverage        old 1/3  →  new 3/3
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-220 (fbd4300)
    file coverage        old 0/8  →  new 8/8
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-219 (b4ca552)
    file coverage        old 1/1  →  new 1/1
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new miss

  THO-218 (9b62fd0)
    file coverage        old 1/4  →  new 4/4
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-217 (bfe5abb)
    file coverage        old 0/6  →  new 6/6
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-216 (84a2ed3)
    file coverage        old 1/1  →  new 1/1
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-214 (32a46e2)
    file coverage        old 1/1  →  new 1/1
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-213 (6dac61a)
    file coverage        old 2/8  →  new 8/8
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

Old (file-card) detail:

========== AGENT-COMPLETION PROBE ==========
14 tickets, comparing pack-mentioned files to actual commit diffs.

Source files (src/**) pointed-at: 13/66  (19.7%)
Doc files (docs/**) pointed-at:   0/1  (0.0%)
Support-cluster useful: 0/14  (0.0%)
Support-cluster file hits: 0/66  (0.0%)

Per-ticket detail:

  THO-228 (493303b)
    src files: 0/7 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/cli/index-cmd.ts
      [❌] src/parse/source-profile.ts
      [❌] src/retrieve/source-card.ts
      [❌] src/store/db.ts
      [❌] src/store/schema.ts
      [❌] src/store/source-profiles.ts
      [❌] src/types/source-profile.ts

  THO-227 (2ecd946)
    src files: 1/6 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/parse/nav-parser.ts
      [❌] src/parse/nav-parser/docusaurus.ts
      [❌] src/parse/nav-parser/frontmatter.ts
      [❌] src/parse/nav-parser/mkdocs.ts
      [❌] src/parse/nav-parser/readme-as-index.ts
      [❌] src/parse/nav-parser/vitepress.ts

  THO-229 (c363aba)
    src files: 2/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [❌] src/retrieve/nav-metadata-flag.ts
      [✅] src/retrieve/source-rerank.ts

  THO-225 (44e7735)
    src files: 0/5 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/retrieve/bm25.ts
      [❌] src/retrieve/retrieve.ts
      [❌] src/retrieve/structural-chunk-context-flag.ts
      [❌] src/store/chunks.ts
      [❌] src/store/db.ts

  THO-224 (d4adc03)
    src files: 3/10 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [❌] src/cli/main.ts
      [❌] src/cli/reindex.ts
      [✅] src/parse/chunker.ts
      [✅] src/retrieve/bm25.ts
      [❌] src/store/chunks.ts
      [❌] src/store/db.ts
      [❌] src/store/reindex.ts
      [❌] src/store/schema.ts
      [❌] src/types/chunk.ts

  THO-223 (5947445)
    src files: 0/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/parse/chunk-structural-context.ts
      [❌] src/parse/source-profile.ts
      [❌] src/types/source-profile.ts

  THO-221 (99cf920)
    src files: 1/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/retrieve/code-fence-entities-flag.ts
      [❌] src/retrieve/multi-path-candidates.ts
      [✅] src/retrieve/source-rerank.ts

  THO-220 (fbd4300)
    src files: 0/8 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/parse/source-profile.ts
      [❌] src/retrieve/fused-source-candidates.ts
      [❌] src/retrieve/multi-path-candidates.ts
      [❌] src/retrieve/source-card.ts
      [❌] src/store/db.ts
      [❌] src/store/schema.ts
      [❌] src/store/source-profiles.ts
      [❌] src/types/source-profile.ts

  THO-219 (b4ca552)
    src files: 1/1 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/code-fence-entities.ts

  THO-218 (9b62fd0)
    src files: 1/4 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/retrieve/fused-source-candidates.ts
      [❌] src/retrieve/heading-aliases-flag.ts
      [❌] src/retrieve/multi-path-candidates.ts
      [✅] src/retrieve/source-rerank.ts

  THO-217 (bfe5abb)
    src files: 0/6 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/parse/source-profile.ts
      [❌] src/retrieve/source-card.ts
      [❌] src/store/db.ts
      [❌] src/store/schema.ts
      [❌] src/store/source-profiles.ts
      [❌] src/types/source-profile.ts

  THO-216 (84a2ed3)
    src files: 1/1 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/heading-aliases.ts

  THO-214 (32a46e2)
    src files: 1/1 mentioned in pack
    doc files: 0/1 mentioned in pack
      [✅] src/retrieve/source-rerank.ts

  THO-213 (6dac61a)
    src files: 2/8 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [✅] src/cli/index-cmd.ts
      [❌] src/parse/source-profile.ts
      [❌] src/retrieve/source-card.ts
      [❌] src/store/db.ts
      [❌] src/store/schema.ts
      [❌] src/store/source-profiles.ts
      [❌] src/types/source-profile.ts

New (chunk-first) detail:

========== AGENT-COMPLETION PROBE ==========
14 tickets, comparing pack-mentioned files to actual commit diffs.

Source files (src/**) pointed-at: 66/66  (100.0%)
Doc files (docs/**) pointed-at:   0/1  (0.0%)
Support-cluster useful: 12/14  (85.7%)
Support-cluster file hits: 28/66  (42.4%)

Per-ticket detail:

  THO-228 (493303b)
    src files: 7/7 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/index-cmd.ts
      [✅] src/parse/source-profile.ts
      [✅] src/retrieve/source-card.ts
      [✅] src/store/db.ts
      [✅] src/store/schema.ts
      [✅] src/store/source-profiles.ts
      [✅] src/types/source-profile.ts
    support cluster: src/store/source-profiles.ts, src/parse/source-profile.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/pack.ts, src/retrieve/bm25.ts, src/retrieve/pairwise-rerank.ts, src/retrieve/coverage-verifier.ts, src/cards/locked-include.ts, src/store/db.ts, src/retrieve/source-rerank-tiebreakers.ts, src/retrieve/path-topology.ts, src/retrieve/query-intent.ts, src/parse/markdown.ts, src/retrieve/code-fence-entities.ts, src/retrieve/source-candidates.ts, src/retrieve/nav-metadata-flag.ts, src/retrieve/query-mode-honesty.ts, src/retrieve/code-source-mix.ts

  THO-227 (2ecd946)
    src files: 6/6 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/parse/nav-parser.ts
      [✅] src/parse/nav-parser/docusaurus.ts
      [✅] src/parse/nav-parser/frontmatter.ts
      [✅] src/parse/nav-parser/mkdocs.ts
      [✅] src/parse/nav-parser/readme-as-index.ts
      [✅] src/parse/nav-parser/vitepress.ts
    support cluster: src/parse/nav-parser/readme-as-index.ts, src/parse/nav-parser/frontmatter.ts, src/parse/nav-parser/docusaurus.ts, src/parse/nav-parser/vitepress.ts, src/cli/import.ts, src/cli/index-cmd.ts, src/parse/source-profile.ts, src/parse/nav-parser/mkdocs.ts, src/cli/main.ts, src/config/load.ts, src/parse/code-source-dispatch.ts, src/parse/markdown.ts, src/parse/chunker.ts, src/store/source-profiles.ts, src/retrieve/code-fence-entities.ts, src/retrieve/heading-aliases.ts, src/retrieve/multi-path-candidates.ts, src/retrieve/clarification-gates.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/pack.ts, src/retrieve/bm25.ts, src/retrieve/pairwise-rerank.ts, src/retrieve/coverage-verifier.ts, src/cards/locked-include.ts, src/retrieve/code-source-mix.ts

  THO-229 (c363aba)
    src files: 3/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [✅] src/retrieve/nav-metadata-flag.ts
      [✅] src/retrieve/source-rerank.ts
    support cluster: src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/pack.ts, src/retrieve/query-scope.ts, src/retrieve/bm25.ts, src/retrieve/pairwise-rerank.ts, src/retrieve/query-mode-honesty.ts, src/retrieve/coverage-verifier.ts, src/retrieve/source-rerank-tiebreakers.ts, src/cards/locked-include.ts, src/retrieve/query-intent.ts, src/readiness/chunk-selector.ts, src/retrieve/aboutness.ts, src/retrieve/assembly.ts, src/retrieve/source-candidates.ts, src/retrieve/tokenize.ts, src/retrieve/nav-metadata-flag.ts, src/mcp/handlers.ts, src/retrieve/retrieve.ts, src/retrieve/code-source-mix.ts, src/retrieve/multi-path-candidates.ts, src/retrieve/source-rerank.ts, src/retrieve/source-adjudicator.ts, src/retrieve/source-evidence.ts, src/retrieve/source-card.ts, src/retrieve/code-fence-entities.ts, src/retrieve/source-evidence-policy.ts

  THO-225 (44e7735)
    src files: 5/5 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/bm25.ts
      [✅] src/retrieve/retrieve.ts
      [✅] src/retrieve/structural-chunk-context-flag.ts
      [✅] src/store/chunks.ts
      [✅] src/store/db.ts
    support cluster: src/store/db.ts, src/retrieve/code-source-flag.ts, src/parse/tokens.ts, src/retrieve/source-rerank.ts, src/store/code-graph.ts, src/retrieve/score.ts, src/retrieve/pairwise-rerank.ts, src/retrieve/contexttrail.ts, src/store/source-profiles.ts, src/config/defaults.ts, src/retrieve/pack.ts, src/retrieve/coverage-verifier.ts, src/readiness/chunk-selector.ts, src/retrieve/aboutness.ts, src/cards/locked-include.ts

  THO-224 (d4adc03)
    src files: 10/10 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [✅] src/cli/main.ts
      [✅] src/cli/reindex.ts
      [✅] src/parse/chunker.ts
      [✅] src/retrieve/bm25.ts
      [✅] src/store/chunks.ts
      [✅] src/store/db.ts
      [✅] src/store/reindex.ts
      [✅] src/store/schema.ts
      [✅] src/types/chunk.ts
    support cluster: src/parse/code-source.ts, src/types/code-source.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/parse/tokens.ts, src/store/code-graph.ts, src/store/schema.ts, src/cards/locked-include.ts, src/retrieve/contexttrail.ts, src/retrieve/score.ts, src/store/code-sources.ts, src/store/db.ts

  THO-223 (5947445)
    src files: 3/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/parse/chunk-structural-context.ts
      [✅] src/parse/source-profile.ts
      [✅] src/types/source-profile.ts
    support cluster: src/store/source-profiles.ts, src/retrieve/code-source-flag.ts, src/parse/tokens.ts, src/retrieve/path-topology.ts, src/parse/code-source-rust.ts, src/parse/code-source.ts, src/retrieve/contexttrail.ts, src/types/code-source.ts, src/parse/code-source-go.ts, src/parse/code-source-python.ts, src/store/db.ts, src/config/load.ts, src/store/code-graph.ts, src/types/card.ts, src/retrieve/pack.ts, src/retrieve/query-scope.ts, src/store/code-sources.ts, src/config/defaults.ts, src/retrieve/bm25.ts, src/retrieve/coverage-verifier.ts, src/cards/locked-include.ts, src/retrieve/code-source-mix.ts

  THO-221 (99cf920)
    src files: 3/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/code-fence-entities-flag.ts
      [✅] src/retrieve/multi-path-candidates.ts
      [✅] src/retrieve/source-rerank.ts
    support cluster: src/retrieve/source-rerank-tiebreakers.ts, src/retrieve/query-intent.ts, src/retrieve/aboutness.ts, src/parse/markdown.ts, src/retrieve/source-candidates.ts, src/retrieve/tokenize.ts, src/retrieve/heading-aliases.ts, src/retrieve/code-fence-entities.ts, src/retrieve/source-rerank.ts, src/retrieve/source-card.ts, src/retrieve/nav-metadata-flag.ts, src/parse/source-profile.ts, src/retrieve/multi-path-candidates.ts, src/store/source-profiles.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/pack.ts, src/retrieve/query-scope.ts, src/retrieve/bm25.ts, src/retrieve/pairwise-rerank.ts, src/retrieve/query-mode-honesty.ts, src/retrieve/coverage-verifier.ts, src/retrieve/source-evidence-policy.ts, src/retrieve/fused-source-candidates.ts

  THO-220 (fbd4300)
    src files: 8/8 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/parse/source-profile.ts
      [✅] src/retrieve/fused-source-candidates.ts
      [✅] src/retrieve/multi-path-candidates.ts
      [✅] src/retrieve/source-card.ts
      [✅] src/store/db.ts
      [✅] src/store/schema.ts
      [✅] src/store/source-profiles.ts
      [✅] src/types/source-profile.ts
    support cluster: src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/code-fence-entities.ts, src/retrieve/pack.ts, src/retrieve/bm25.ts, src/retrieve/coverage-verifier.ts, src/readiness/chunk-selector.ts, src/retrieve/aboutness.ts, src/retrieve/assembly.ts, src/readiness/task-need.ts, src/cards/locked-include.ts, src/parse/source-profile.ts, src/store/source-profiles.ts, src/retrieve/pairwise-rerank.ts, src/store/db.ts

  THO-219 (b4ca552)
    src files: 1/1 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/code-fence-entities.ts
    support cluster: src/store/code-sources.ts, src/parse/code-source.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/pack.ts, src/retrieve/bm25.ts, src/retrieve/pairwise-rerank.ts, src/retrieve/coverage-verifier.ts, src/cards/locked-include.ts, src/retrieve/code-source-mix.ts, src/store/source-profiles.ts, src/parse/source-profile.ts, src/retrieve/path-topology.ts, src/parse/markdown.ts, src/retrieve/tokenize.ts, src/retrieve/heading-aliases.ts, src/parse/nav-parser.ts, src/retrieve/source-card.ts, src/retrieve/clarification-gates.ts, src/retrieve/source-candidates.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/multi-path-candidates.ts, src/retrieve/source-rerank.ts, src/store/db.ts, src/mcp/presenter.ts, src/retrieve/retrieve.ts, src/store/substrate-schema.ts, src/cli/main.ts

  THO-218 (9b62fd0)
    src files: 4/4 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/fused-source-candidates.ts
      [✅] src/retrieve/heading-aliases-flag.ts
      [✅] src/retrieve/multi-path-candidates.ts
      [✅] src/retrieve/source-rerank.ts
    support cluster: src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/pack.ts, src/retrieve/bm25.ts, src/retrieve/coverage-verifier.ts, src/cards/locked-include.ts, src/readiness/chunk-selector.ts, src/retrieve/aboutness.ts, src/retrieve/heading-aliases.ts, src/retrieve/code-fence-entities.ts, src/parse/source-profile.ts, src/retrieve/pairwise-rerank.ts, src/retrieve/query-mode-honesty.ts, src/retrieve/tokenize.ts, src/retrieve/retrieve.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/multi-path-candidates.ts, src/retrieve/code-source-mix.ts, src/retrieve/source-rerank.ts, src/retrieve/code-fence-entities-flag.ts, src/types/source-profile.ts, src/retrieve/nav-metadata-flag.ts

  THO-217 (bfe5abb)
    src files: 6/6 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/parse/source-profile.ts
      [✅] src/retrieve/source-card.ts
      [✅] src/store/db.ts
      [✅] src/store/schema.ts
      [✅] src/store/source-profiles.ts
      [✅] src/types/source-profile.ts
    support cluster: src/parse/source-profile.ts, src/store/source-profiles.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/pack.ts, src/retrieve/bm25.ts, src/retrieve/pairwise-rerank.ts, src/retrieve/coverage-verifier.ts, src/readiness/chunk-selector.ts, src/cards/locked-include.ts, src/retrieve/query-mode-honesty.ts

  THO-216 (84a2ed3)
    src files: 1/1 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/heading-aliases.ts
    support cluster: src/store/code-sources.ts, src/parse/code-source.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/pack.ts, src/retrieve/bm25.ts, src/retrieve/pairwise-rerank.ts, src/retrieve/coverage-verifier.ts, src/cards/locked-include.ts, src/retrieve/code-source-mix.ts, src/store/source-profiles.ts, src/retrieve/path-topology.ts, src/retrieve/query-scope.ts, src/parse/markdown.ts, src/retrieve/tokenize.ts, src/retrieve/heading-aliases.ts, src/parse/nav-parser.ts, src/retrieve/code-fence-entities.ts, src/cli/import.ts, src/retrieve/source-card.ts, src/cli/index-cmd.ts, src/retrieve/multi-path-candidates.ts, src/store/db.ts, src/mcp/presenter.ts, src/retrieve/retrieve.ts, src/store/substrate-schema.ts, src/cli/main.ts, src/parse/source-profile.ts, src/mcp/schemas.ts

  THO-214 (32a46e2)
    src files: 1/1 mentioned in pack
    doc files: 0/1 mentioned in pack
      [✅] src/retrieve/source-rerank.ts
    support cluster: src/retrieve/query-intent.ts, src/retrieve/code-fence-entities.ts, src/retrieve/source-candidates.ts, src/retrieve/tokenize.ts, src/retrieve/source-rerank-tiebreakers.ts, src/retrieve/nav-metadata-flag.ts, src/retrieve/source-adjudicator.ts, src/retrieve/coverage-verifier.ts, src/retrieve/source-evidence.ts, src/retrieve/source-card.ts, src/retrieve/retrieve.ts, src/retrieve/source-rerank-pipeline.ts, src/store/source-profiles.ts, src/parse/source-profile.ts, src/store/db.ts, src/retrieve/source-family.ts, src/retrieve/phrase-proximity.ts, src/retrieve/heading-aliases.ts, src/retrieve/multi-path-candidates.ts, src/retrieve/code-source-mix.ts, src/retrieve/source-rerank.ts, src/retrieve/query-scope.ts, src/retrieve/aboutness.ts, src/retrieve/source-evidence-policy.ts

  THO-213 (6dac61a)
    src files: 8/8 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [✅] src/cli/index-cmd.ts
      [✅] src/parse/source-profile.ts
      [✅] src/retrieve/source-card.ts
      [✅] src/store/db.ts
      [✅] src/store/schema.ts
      [✅] src/store/source-profiles.ts
      [✅] src/types/source-profile.ts
    support cluster: src/store/source-profiles.ts, src/retrieve/nav-metadata-flag.ts, src/retrieve/source-rerank-tiebreakers.ts, src/review/flow.ts, src/retrieve/query-intent.ts, src/parse/markdown.ts, src/retrieve/code-fence-entities.ts, src/retrieve/path-topology.ts, src/retrieve/source-candidates.ts, src/parse/source-profile.ts, src/store/db.ts, src/retrieve/phrase-proximity.ts, src/retrieve/tokenize.ts, src/retrieve/source-family.ts, src/retrieve/source-rerank.ts, src/mcp/presenter.ts, src/retrieve/retrieve.ts

Repo: Ralph
root: /Users/thomaschang/Repos/Ralph
task panel: THO-25, THO-24, THO-23, THO-17

========== PAIRED CODE-LANE COMPARISON ==========
Same task panel, default budget, old file-card path vs new chunk-first code lane.

Summary:
  Source-file coverage      Old (file-card): 0/9 (0.0%)
                            New (chunk-first): 6/9 (66.7%)
  Code top-1 acceptable     Old (file-card): 0/4 (0.0%)
                            New (chunk-first): 0/4 (0.0%)
  Code ranked useful        Old (file-card): 0/4 (0.0%)
                            New (chunk-first): 3/4 (75.0%)
  Support-cluster useful    Old (file-card): 0/4 (0.0%)
                            New (chunk-first): 1/4 (25.0%)

Per-ticket detail:

  THO-25 (13e51ae)
    file coverage        old 0/2  →  new 0/2
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new miss
    support cluster      old miss  →  new miss

  THO-24 (1e56bad)
    file coverage        old 0/2  →  new 2/2
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new miss

  THO-23 (ca325d2)
    file coverage        old 0/2  →  new 2/2
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-17 (b42194d)
    file coverage        old 0/3  →  new 2/3
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new miss

Old (file-card) detail:

========== AGENT-COMPLETION PROBE ==========
4 tickets, comparing pack-mentioned files to actual commit diffs.

Source files (src/**) pointed-at: 0/9  (0.0%)
Doc files (docs/**) pointed-at:   0/0  (0.0%)
Support-cluster useful: 0/4  (0.0%)
Support-cluster file hits: 0/9  (0.0%)

Per-ticket detail:

  THO-25 (13e51ae)
    src files: 0/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/artifacts/index.ts
      [❌] src/artifacts/summaries.ts

  THO-24 (1e56bad)
    src files: 0/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/runner/index.ts
      [❌] src/runner/takeover-run.ts

  THO-23 (ca325d2)
    src files: 0/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/runner/index.ts
      [❌] src/runner/reset-run.ts

  THO-17 (b42194d)
    src files: 0/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/git/git.ts
      [❌] src/validate/index.ts
      [❌] src/validate/validate.ts

New (chunk-first) detail:

========== AGENT-COMPLETION PROBE ==========
4 tickets, comparing pack-mentioned files to actual commit diffs.

Source files (src/**) pointed-at: 6/9  (66.7%)
Doc files (docs/**) pointed-at:   0/0  (0.0%)
Support-cluster useful: 1/4  (25.0%)
Support-cluster file hits: 1/9  (11.1%)

Per-ticket detail:

  THO-25 (13e51ae)
    src files: 0/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/artifacts/index.ts
      [❌] src/artifacts/summaries.ts

  THO-24 (1e56bad)
    src files: 2/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/runner/index.ts
      [✅] src/runner/takeover-run.ts
    support cluster: src/cli/commands/reset.ts, src/cli/commands/dry-run.ts, src/cli/commands/setup.ts, src/cli/commands/resume.ts, src/runner/workflow-signals.ts, src/schemas/index.ts, src/cli/commands/takeover.ts, src/cli/commands/execute.ts, src/artifacts/summaries.ts, src/runner/execute-run.ts, src/runner/handoff.ts, src/runner/execute-one-ticket.ts, src/config/fingerprint.ts

  THO-23 (ca325d2)
    src files: 2/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/runner/index.ts
      [✅] src/runner/reset-run.ts
    support cluster: src/cli/commands/reset.ts, src/runner/run-state.ts, src/cli/commands/dry-run.ts, src/cli/commands/setup.ts, src/cli/commands/resume.ts, src/cli/commands/takeover.ts, src/cli/commands/execute.ts, src/runner/reset-run.ts, src/runner/resume-run.ts, src/runner/execute-run.ts, src/preflight/run-preflight.ts, src/packet/build-packet.ts, src/artifacts/summaries.ts

  THO-17 (b42194d)
    src files: 2/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/git/git.ts
      [✅] src/validate/index.ts
      [✅] src/validate/validate.ts
    support cluster: src/schemas/machine-block.ts, src/schemas/validator-result.ts, src/schemas/worker-result.ts, src/schemas/index.ts, src/schemas/handoff.ts, src/queue/parse-machine-block.ts, src/queue/types.ts, src/config/fingerprint.ts, src/packet/build-packet.ts, src/runner/execute-one-ticket.ts, src/runner/handoff.ts

========== PAIRED WORKFLOW-ASSEMBLY COMPARISON ==========
Same workflow fixture, default budget, old file-card path vs new chunk-first code lane.

Summary:
  Tickets fully served     Old (file-card): 22/23 (95.7%)
                            New (chunk-first): 22/23 (95.7%)
  Required chunks         Old (file-card): 13/22 (59.1%)
                            New (chunk-first): 13/22 (59.1%)

# PRD-0042 Promotion Verdict

Outcome: **PASS**
Recommendation: `eligible_for_human_review`

## Gate Table

| Gate | Baseline | Current | Result | Detail |
| --- | --- | --- | --- | --- |
| primary_file_coverage_floor | 13/66 | 66/66 | PASS | new lane must not regress primary file coverage on the paired validation panel |
| primary_code_chunk_usefulness_non_regression | top1 0/14; ranked 0/14 | top1 12/14; ranked 14/14 | PASS | new lane must not regress chunk usefulness on the primary paired panel |
| cross_repo_validation_present | >=2 repos | 2 repos | PASS | promotion requires a second commit-grounded repo in the paired validation surface |
| workflow_assembly_no_regression | 22/23 | 22/23 | PASS | workflow assembly must remain at least as strong under the new lane |
| downstream_task_success_measured | 3 old verdicts | 3 new verdicts | PASS | promotion cannot proceed without explicit downstream task-success evidence |
| downstream_task_success_non_regression | reachable 2/3; acceptable 0/3 | reachable 3/3; acceptable 3/3 | PASS | new lane must not regress downstream task-success outcomes once they are measured |
| token_accounting_and_pack_honesty | coverage_confidence=yes, pack_readiness=yes, query_mode=yes | coverage_confidence=yes, pack_readiness=yes, query_mode=yes | PASS | promotion requires explicit token/honesty evidence, not only retrieval wins |

## Evidence

### Old (file-card)
- file coverage: 13/66
- code top-1 acceptable: 0/14
- code ranked useful: 0/14

### New (chunk-first)
- file coverage: 66/66
- code top-1 acceptable: 12/14
- code ranked useful: 14/14

### Cross-repo coverage
- repo count: 2

### downstream_task_success
- old: reached 2/3, acceptable 0/3
- new: reached 3/3, acceptable 3/3

### token_accounting_and_pack_honesty
- coverage_confidence: yes
- pack_readiness: yes
- query_mode: yes
