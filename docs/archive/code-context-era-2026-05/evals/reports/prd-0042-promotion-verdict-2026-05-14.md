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
  Ranked code-file coverage Old (file-card): 0/66 (0.0%)
                            New (chunk-first): 54/66 (81.8%)
  Code top-1 acceptable     Old (file-card): 0/14 (0.0%)
                            New (chunk-first): 12/14 (85.7%)
  Code ranked useful        Old (file-card): 0/14 (0.0%)
                            New (chunk-first): 14/14 (100.0%)
  Support-cluster useful    Old (file-card): 0/14 (0.0%)
                            New (chunk-first): 14/14 (100.0%)
  Prompt variant top-1     Old (file-card): 0/42 (0.0%)
                            New (chunk-first): 20/42 (47.6%)
  Prompt variant top-3     Old (file-card): 0/42 (0.0%)
                            New (chunk-first): 26/42 (61.9%)
  Prompt variant ranked    Old (file-card): 0/42 (0.0%)
                            New (chunk-first): 41/42 (97.6%)
  Top-3 hit / top-1 miss  Old (file-card): 0/14 (0.0%)
                            New (chunk-first): 2/14 (14.3%)
  Ranked hit below top-3   Old (file-card): 0/14 (0.0%)
                            New (chunk-first): 0/14 (0.0%)
  Ranked miss              Old (file-card): 14/14 (100.0%)
                            New (chunk-first): 0/14 (0.0%)

Code-lane diagnostics:
  Residual miss families:
    persistence_substrate  tickets=THO-213,THO-217,THO-220,THO-224,THO-225,THO-228  files=src/retrieve/structural-chunk-context-flag.ts, src/store/chunks.ts, src/store/db.ts, src/store/schema.ts, src/types/chunk.ts  missing_from_ranked=7  ranked_below_top3=6  support_missing=12  body_only=0
    import_workflow  tickets=THO-213,THO-223,THO-224,THO-227,THO-228,THO-229  files=src/cli/import.ts, src/cli/index-cmd.ts, src/cli/reindex.ts, src/parse/chunk-structural-context.ts, src/parse/chunker.ts, src/parse/nav-parser/mkdocs.ts, src/parse/nav-parser/vitepress.ts, src/store/reindex.ts  missing_from_ranked=3  ranked_below_top3=8  support_missing=8  body_only=0
    source_profile_storage  tickets=THO-213,THO-217,THO-220,THO-223,THO-228  files=src/parse/source-profile.ts, src/store/source-profiles.ts, src/types/source-profile.ts  missing_from_ranked=1  ranked_below_top3=8  support_missing=4  body_only=0
    other  tickets=THO-218,THO-220,THO-221,THO-225,THO-228  files=src/retrieve/code-fence-entities-flag.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/heading-aliases-flag.ts, src/retrieve/retrieve.ts, src/retrieve/source-card.ts  missing_from_ranked=0  ranked_below_top3=5  support_missing=2  body_only=0
    cli_workflow  tickets=THO-224  files=src/cli/main.ts  missing_from_ranked=1  ranked_below_top3=0  support_missing=1  body_only=0
    retrieval_index  tickets=THO-224  files=src/retrieve/bm25.ts  missing_from_ranked=0  ranked_below_top3=1  support_missing=1  body_only=0
  Next target files:
    src/store/schema.ts  tickets=THO-213,THO-217,THO-220,THO-224,THO-228  missing_from_ranked=3  ranked_below_top3=2  support_missing=5  body_only=0
    src/store/db.ts  tickets=THO-213,THO-217,THO-220,THO-224,THO-228  missing_from_ranked=2  ranked_below_top3=2  support_missing=4  body_only=0
    src/store/source-profiles.ts  tickets=THO-213,THO-217,THO-220,THO-228  missing_from_ranked=1  ranked_below_top3=3  support_missing=1  body_only=0
    src/cli/import.ts  tickets=THO-213,THO-224,THO-229  missing_from_ranked=0  ranked_below_top3=3  support_missing=2  body_only=0
    src/types/source-profile.ts  tickets=THO-217,THO-220,THO-223  missing_from_ranked=0  ranked_below_top3=3  support_missing=1  body_only=0
    src/store/chunks.ts  tickets=THO-224,THO-225  missing_from_ranked=1  ranked_below_top3=1  support_missing=1  body_only=0
    src/parse/source-profile.ts  tickets=THO-217,THO-220,THO-228  missing_from_ranked=0  ranked_below_top3=2  support_missing=2  body_only=0
    src/cli/index-cmd.ts  tickets=THO-213,THO-228  missing_from_ranked=0  ranked_below_top3=2  support_missing=2  body_only=0
  Per-ticket missing files:
    THO-228 (493303b)
      missing_from_ranked: src/store/db.ts, src/store/schema.ts
      ranked_below_top3: src/cli/index-cmd.ts, src/retrieve/source-card.ts, src/store/source-profiles.ts
      support_missing: src/cli/index-cmd.ts, src/parse/source-profile.ts, src/store/db.ts, src/store/schema.ts
      body_only: (none)
    THO-227 (2ecd946)
      missing_from_ranked: (none)
      ranked_below_top3: src/parse/nav-parser/mkdocs.ts, src/parse/nav-parser/vitepress.ts
      support_missing: (none)
      body_only: (none)
    THO-229 (c363aba)
      missing_from_ranked: (none)
      ranked_below_top3: src/cli/import.ts
      support_missing: src/cli/import.ts
      body_only: (none)
    THO-225 (44e7735)
      missing_from_ranked: src/retrieve/structural-chunk-context-flag.ts, src/store/chunks.ts
      ranked_below_top3: src/retrieve/retrieve.ts
      support_missing: src/retrieve/structural-chunk-context-flag.ts, src/store/chunks.ts
      body_only: (none)
    THO-224 (d4adc03)
      missing_from_ranked: src/cli/main.ts, src/cli/reindex.ts, src/store/reindex.ts
      ranked_below_top3: src/cli/import.ts, src/parse/chunker.ts, src/retrieve/bm25.ts, src/store/chunks.ts, src/store/schema.ts, src/types/chunk.ts
      support_missing: src/cli/import.ts, src/cli/main.ts, src/cli/reindex.ts, src/parse/chunker.ts, src/retrieve/bm25.ts, src/store/db.ts, src/store/reindex.ts, src/store/schema.ts, src/types/chunk.ts
      body_only: (none)
    THO-223 (5947445)
      missing_from_ranked: src/parse/chunk-structural-context.ts
      ranked_below_top3: src/types/source-profile.ts
      support_missing: src/parse/chunk-structural-context.ts
      body_only: (none)
    THO-221 (99cf920)
      missing_from_ranked: (none)
      ranked_below_top3: (none)
      support_missing: src/retrieve/code-fence-entities-flag.ts
      body_only: (none)
    THO-220 (fbd4300)
      missing_from_ranked: (none)
      ranked_below_top3: src/parse/source-profile.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/source-card.ts, src/store/db.ts, src/store/schema.ts, src/store/source-profiles.ts, src/types/source-profile.ts
      support_missing: src/store/schema.ts
      body_only: (none)
    THO-218 (9b62fd0)
      missing_from_ranked: (none)
      ranked_below_top3: src/retrieve/fused-source-candidates.ts
      support_missing: src/retrieve/heading-aliases-flag.ts
      body_only: (none)
    THO-217 (bfe5abb)
      missing_from_ranked: src/store/schema.ts, src/store/source-profiles.ts
      ranked_below_top3: src/parse/source-profile.ts, src/store/db.ts, src/types/source-profile.ts
      support_missing: src/parse/source-profile.ts, src/store/db.ts, src/store/schema.ts, src/store/source-profiles.ts, src/types/source-profile.ts
      body_only: (none)
    THO-213 (6dac61a)
      missing_from_ranked: src/store/db.ts, src/store/schema.ts
      ranked_below_top3: src/cli/import.ts, src/cli/index-cmd.ts, src/store/source-profiles.ts
      support_missing: src/cli/index-cmd.ts, src/store/db.ts, src/store/schema.ts
      body_only: (none)

Per-ticket detail:

  THO-228 (493303b)
    ranked code files    old 0/7  →  new 5/7
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-227 (2ecd946)
    ranked code files    old 0/6  →  new 6/6
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-229 (c363aba)
    ranked code files    old 0/3  →  new 3/3
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-225 (44e7735)
    ranked code files    old 0/5  →  new 3/5
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-224 (d4adc03)
    ranked code files    old 0/10  →  new 7/10
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-223 (5947445)
    ranked code files    old 0/3  →  new 2/3
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-221 (99cf920)
    ranked code files    old 0/3  →  new 3/3
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-220 (fbd4300)
    ranked code files    old 0/8  →  new 8/8
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-219 (b4ca552)
    ranked code files    old 0/1  →  new 1/1
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-218 (9b62fd0)
    ranked code files    old 0/4  →  new 4/4
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-217 (bfe5abb)
    ranked code files    old 0/6  →  new 4/6
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-216 (84a2ed3)
    ranked code files    old 0/1  →  new 1/1
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-214 (32a46e2)
    ranked code files    old 0/1  →  new 1/1
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

  THO-213 (6dac61a)
    ranked code files    old 0/8  →  new 6/8
    code top-1           old miss  →  new hit
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new hit

Old (file-card) detail:

========== AGENT-COMPLETION PROBE ==========
14 tickets, comparing pack-mentioned files to actual commit diffs.

Source files (src/**) pointed-at: 13/66  (19.7%)
Doc files (docs/**) pointed-at:   0/1  (0.0%)
Ranked-code file hits: 0/66  (0.0%)
Support-cluster useful: 0/14  (0.0%)
Support-cluster file hits: 0/66  (0.0%)
Body-mention-only file hits: 13/66  (19.7%)

Miss taxonomy:
  top1_hit: 0
  top3_hit_top1_miss: 0
  ranked_hit_top3_miss: 0
  ranked_miss_body_only: 9
  ranked_miss: 5
  ranked_file_hits: 0/66
  top3_file_hits: 0/66
  missing_from_ranked: 66/66
  body_only_file_hits: 13/66
  support_can_promote_top1_misses: 0
  support_missing_when_top1_missed: 14

Prompt variants:
  prompt top-1 acceptable: 0/42  (0.0%)
  prompt top-3 useful: 0/42  (0.0%)
  prompt ranked useful: 0/42  (0.0%)
  prompt support useful: 0/42  (0.0%)
  prompt ranked-file hits: 0/198  (0.0%)
  tickets top-1 robust: 0/14
  tickets top-3 robust: 0/14
  tickets ranked robust: 0/14

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
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/7 :: PRD-0027 SourceProfile nav-field extension import-time wiring
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/7 :: SourceProfile nav fields buildSourceProfile
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/7 :: NavGraph import wiring source-profile builder

  THO-227 (2ecd946)
    src files: 1/6 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/parse/nav-parser.ts
      [❌] src/parse/nav-parser/docusaurus.ts
      [❌] src/parse/nav-parser/frontmatter.ts
      [❌] src/parse/nav-parser/mkdocs.ts
      [❌] src/parse/nav-parser/readme-as-index.ts
      [❌] src/parse/nav-parser/vitepress.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/6 :: PRD-0027 nav sidebar parser sub-parsers
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/6 :: vitepress mkdocs docusaurus frontmatter nav parser
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/6 :: parseNavConfig per-format extraction property tests

  THO-229 (c363aba)
    src files: 2/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [❌] src/retrieve/nav-metadata-flag.ts
      [✅] src/retrieve/source-rerank.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: PRD-0027 source-rerank wiring nav metadata flag
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: nav-landing source-rerank scoring
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: RETRIEVAL_NAV_METADATA flag overview-owner-score

  THO-225 (44e7735)
    src files: 0/5 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/retrieve/bm25.ts
      [❌] src/retrieve/retrieve.ts
      [❌] src/retrieve/structural-chunk-context-flag.ts
      [❌] src/store/chunks.ts
      [❌] src/store/db.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/5 :: PRD-0025 BM25F field-weight extension structural context
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/5 :: BM25F doc_title doc_purpose section_intro field weights
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/5 :: structural chunk context flag candidate recall eval

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
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/10 :: PRD-0025 chunk table column extension FTS5
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/10 :: chunk-table virtual table recreation reindex
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/10 :: FTS5 schema migration chunk reindex

  THO-223 (5947445)
    src files: 0/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/parse/chunk-structural-context.ts
      [❌] src/parse/source-profile.ts
      [❌] src/types/source-profile.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: PRD-0025 chunk-structural-context extractor doc_purpose
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: structural context extractor provenance trace
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: chunk-level doc_purpose extractor synthetic property

  THO-221 (99cf920)
    src files: 1/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/retrieve/code-fence-entities-flag.ts
      [❌] src/retrieve/multi-path-candidates.ts
      [✅] src/retrieve/source-rerank.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: PRD-0024 code-fence entity consumption alias substrate
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: code_fence_entities source-rerank wiring
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: code-fence entity flag shadow eval

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
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/8 :: PRD-0024 SourceProfile code_fence_entities field import wiring
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/8 :: code_fence_entities import-time wiring
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/8 :: code_fence_entities SourceProfile schema field

  THO-219 (b4ca552)
    src files: 1/1 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/code-fence-entities.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/1 :: PRD-0024 extractCodeFenceEntities extractor property tests
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/1 :: code-fence entities markdown extractor
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/1 :: extractCodeFenceEntities synthetic property gate

  THO-218 (9b62fd0)
    src files: 1/4 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/retrieve/fused-source-candidates.ts
      [❌] src/retrieve/heading-aliases-flag.ts
      [❌] src/retrieve/multi-path-candidates.ts
      [✅] src/retrieve/source-rerank.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/4 :: PRD-0024 heading aliases source-rerank wiring
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/4 :: heading_aliases SourceProfile field source-rerank evidence
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/4 :: RETRIEVAL_HEADING_ALIASES flag flip

  THO-217 (bfe5abb)
    src files: 0/6 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/parse/source-profile.ts
      [❌] src/retrieve/source-card.ts
      [❌] src/store/db.ts
      [❌] src/store/schema.ts
      [❌] src/store/source-profiles.ts
      [❌] src/types/source-profile.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/6 :: PRD-0024 SourceProfile heading_aliases field import wiring
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/6 :: heading_aliases SourceProfile schema field
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/6 :: import-time wiring heading aliases extractor

  THO-216 (84a2ed3)
    src files: 1/1 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/heading-aliases.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/1 :: PRD-0024 extractHeadingAliases extractor property tests
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/1 :: heading aliases markdown H1 H2 H3 extractor
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/1 :: extractHeadingAliases synthetic property gate

  THO-214 (32a46e2)
    src files: 1/1 mentioned in pack
    doc files: 0/1 mentioned in pack
      [✅] src/retrieve/source-rerank.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/1 :: PRD-0023 path-topology source-rerank boosts flag
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/1 :: landing index package version boost source-rerank
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/1 :: RETRIEVAL_PATH_TOPOLOGY_BOOSTS flag

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
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/8 :: PRD-0023 SourceProfile path-topology fields import wiring
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/8 :: is_index_file is_section_landing path_depth SourceProfile
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/8 :: package_segment version_segment SourceProfile extension

New (chunk-first) detail:

========== AGENT-COMPLETION PROBE ==========
14 tickets, comparing pack-mentioned files to actual commit diffs.

Source files (src/**) pointed-at: 54/66  (81.8%)
Doc files (docs/**) pointed-at:   0/1  (0.0%)
Ranked-code file hits: 54/66  (81.8%)
Support-cluster useful: 14/14  (100.0%)
Support-cluster file hits: 38/66  (57.6%)
Body-mention-only file hits: 0/66  (0.0%)

Miss taxonomy:
  top1_hit: 12
  top3_hit_top1_miss: 2
  ranked_hit_top3_miss: 0
  ranked_miss_body_only: 0
  ranked_miss: 0
  ranked_file_hits: 54/66
  top3_file_hits: 26/66
  missing_from_ranked: 12/66
  body_only_file_hits: 0/66
  support_can_promote_top1_misses: 2
  support_missing_when_top1_missed: 0

Prompt variants:
  prompt top-1 acceptable: 20/42  (47.6%)
  prompt top-3 useful: 26/42  (61.9%)
  prompt ranked useful: 41/42  (97.6%)
  prompt support useful: 31/42  (73.8%)
  prompt ranked-file hits: 127/198  (64.1%)
  tickets top-1 robust: 1/14
  tickets top-3 robust: 5/14
  tickets ranked robust: 13/14

Per-ticket detail:

  THO-228 (493303b)
    src files: 5/7 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/index-cmd.ts
      [✅] src/parse/source-profile.ts
      [✅] src/retrieve/source-card.ts
      [❌] src/store/db.ts
      [❌] src/store/schema.ts
      [✅] src/store/source-profiles.ts
      [✅] src/types/source-profile.ts
    support cluster: src/readiness/task-need.ts, src/retrieve/source-rerank.ts, src/parse/nav-parser.ts, src/parse/nav-parser/docusaurus.ts, src/retrieve/path-topology.ts, src/types/code-source.ts, src/parse/nav-parser/readme-as-index.ts, src/parse/nav-parser/frontmatter.ts, src/parse/nav-parser/mkdocs.ts, src/parse/nav-parser/vitepress.ts, src/retrieve/code-import-traversal.ts, src/retrieve/multi-path-candidates.ts, src/retrieve/source-card.ts, src/cards/locked-include.ts, src/types/source-profile.ts, src/store/source-profiles.ts, src/retrieve/heading-aliases.ts, src/parse/markdown.ts, src/retrieve/code-fence-entities.ts, src/cli/import.ts, src/retrieve/fused-source-candidates.ts, src/parse/code-source-python.ts
    prompt variants:
      top1=miss top3=miss ranked=hit support=hit ranked_files=3/7 :: PRD-0027 SourceProfile nav-field extension import-time wiring
      top1=hit top3=hit ranked=hit support=hit ranked_files=4/7 :: SourceProfile nav fields buildSourceProfile
      top1=hit top3=hit ranked=hit support=hit ranked_files=5/7 :: NavGraph import wiring source-profile builder

  THO-227 (2ecd946)
    src files: 6/6 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/parse/nav-parser.ts
      [✅] src/parse/nav-parser/docusaurus.ts
      [✅] src/parse/nav-parser/frontmatter.ts
      [✅] src/parse/nav-parser/mkdocs.ts
      [✅] src/parse/nav-parser/readme-as-index.ts
      [✅] src/parse/nav-parser/vitepress.ts
    support cluster: src/parse/nav-parser/readme-as-index.ts, src/parse/nav-parser/frontmatter.ts, src/parse/nav-parser/mkdocs.ts, src/parse/nav-parser/docusaurus.ts, src/parse/nav-parser/vitepress.ts, src/retrieve/code-import-traversal.ts, src/parse/code-source-go.ts, src/parse/source-profile.ts, src/parse/code-source-python.ts, src/retrieve/retrieve.ts, src/cli/index-cmd.ts, src/cli/import.ts, src/parse/code-source-dispatch.ts, src/retrieve/heading-aliases.ts, src/setup/next-step.ts, src/retrieve/link-traversal.ts, src/cards/loader.ts, src/parse/nav-parser.ts, src/types/code-source.ts, src/retrieve/code-source-flag.ts, src/retrieve/query-scope.ts, src/retrieve/aboutness.ts
    prompt variants:
      top1=hit top3=hit ranked=hit support=hit ranked_files=6/6 :: PRD-0027 nav sidebar parser sub-parsers
      top1=hit top3=hit ranked=hit support=hit ranked_files=6/6 :: vitepress mkdocs docusaurus frontmatter nav parser
      top1=miss top3=hit ranked=hit support=hit ranked_files=3/6 :: parseNavConfig per-format extraction property tests

  THO-229 (c363aba)
    src files: 3/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [✅] src/retrieve/nav-metadata-flag.ts
      [✅] src/retrieve/source-rerank.ts
    support cluster: src/retrieve/source-rerank.ts, src/types/source-profile.ts, src/retrieve/source-card.ts, src/retrieve/source-evidence.ts, src/retrieve/source-rerank-flags.ts, src/retrieve/source-rerank-tiebreakers.ts, src/retrieve/source-selection-decision.ts, src/retrieve/source-adjudicator.ts, src/retrieve/source-rerank-pipeline.ts, src/retrieve/coverage-verifier.ts, src/retrieve/query-intent.ts, src/retrieve/source-candidates.ts, src/retrieve/code-fence-entities.ts, src/retrieve/nav-metadata-flag.ts, src/parse/nav-parser/readme-as-index.ts, src/parse/source-profile.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/heading-aliases.ts, src/retrieve/retrieve.ts, src/retrieve/tokenize.ts
    prompt variants:
      top1=hit top3=hit ranked=hit support=hit ranked_files=2/3 :: PRD-0027 source-rerank wiring nav metadata flag
      top1=hit top3=hit ranked=hit support=hit ranked_files=2/3 :: nav-landing source-rerank scoring
      top1=hit top3=hit ranked=hit support=hit ranked_files=3/3 :: RETRIEVAL_NAV_METADATA flag overview-owner-score

  THO-225 (44e7735)
    src files: 3/5 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/bm25.ts
      [✅] src/retrieve/retrieve.ts
      [❌] src/retrieve/structural-chunk-context-flag.ts
      [❌] src/store/chunks.ts
      [✅] src/store/db.ts
    support cluster: src/retrieve/phrase-proximity.ts, src/retrieve/source-card.ts, src/retrieve/source-rerank-pipeline.ts, src/retrieve/pairwise-rerank.ts, src/types/source-profile.ts, src/retrieve/bm25.ts, src/store/db.ts, src/parse/source-profile.ts, src/retrieve/tokenize.ts, src/retrieve/retrieve.ts, src/store/code-sources.ts, src/retrieve/source-selection-decision.ts, src/cards/locked-include.ts, src/retrieve/multi-path-candidates.ts, src/retrieve/source-rerank.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/nav-metadata-flag.ts
    prompt variants:
      top1=miss top3=miss ranked=hit support=hit ranked_files=2/5 :: PRD-0025 BM25F field-weight extension structural context
      top1=hit top3=hit ranked=hit support=hit ranked_files=3/5 :: BM25F doc_title doc_purpose section_intro field weights
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/5 :: structural chunk context flag candidate recall eval

  THO-224 (d4adc03)
    src files: 7/10 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [❌] src/cli/main.ts
      [❌] src/cli/reindex.ts
      [✅] src/parse/chunker.ts
      [✅] src/retrieve/bm25.ts
      [✅] src/store/chunks.ts
      [✅] src/store/db.ts
      [❌] src/store/reindex.ts
      [✅] src/store/schema.ts
      [✅] src/types/chunk.ts
    support cluster: src/store/read-model.ts, src/store/code-sources.ts, src/store/substrate-read.ts, src/store/substrate-support.ts, src/store/code-chunks.ts, src/store/substrate-sync.ts, src/retrieve/path-topology.ts, src/store/sources.ts, src/retrieve/freshness-check.ts, src/store/persist-chunk.ts, src/store/anchors.ts, src/store/chunks.ts, src/cards/lifecycle.ts, src/setup/next-step.ts, src/retrieve/runtime.ts, src/retrieve/source-card.ts, src/retrieve/score.ts, src/readiness/task-need.ts, src/store/substrate-schema.ts, src/types/code-source.ts, src/retrieve/code-source-mix.ts, src/cards/locked-include.ts, src/readiness/chunk-selector.ts, src/retrieve/aboutness.ts, src/config/defaults.ts, src/retrieve/code-import-traversal.ts
    prompt variants:
      top1=hit top3=hit ranked=hit support=hit ranked_files=3/10 :: PRD-0025 chunk table column extension FTS5
      top1=miss top3=miss ranked=hit support=miss ranked_files=7/10 :: chunk-table virtual table recreation reindex
      top1=miss top3=miss ranked=hit support=miss ranked_files=2/10 :: FTS5 schema migration chunk reindex

  THO-223 (5947445)
    src files: 2/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/parse/chunk-structural-context.ts
      [✅] src/parse/source-profile.ts
      [✅] src/types/source-profile.ts
    support cluster: src/retrieve/path-topology.ts, src/readiness/task-need.ts, src/types/source-profile.ts, src/parse/code-source.ts, src/retrieve/code-import-traversal.ts, src/store/source-profiles.ts, src/parse/markdown.ts, src/cli/import.ts, src/retrieve/source-card.ts, src/parse/code-source-dispatch.ts, src/store/db.ts, src/retrieve/retrieve.ts, src/mcp/presenter.ts, src/retrieve/link-traversal.ts, src/types/code-source.ts, src/store/code-sources.ts, src/parse/source-profile.ts, src/retrieve/score.ts, src/store/schema.ts, src/retrieve/code-source-mix.ts, src/retrieve/source-rerank.ts, src/retrieve/aboutness.ts
    prompt variants:
      top1=hit top3=hit ranked=hit support=hit ranked_files=2/3 :: PRD-0025 chunk-structural-context extractor doc_purpose
      top1=miss top3=miss ranked=hit support=miss ranked_files=1/3 :: structural context extractor provenance trace
      top1=miss top3=miss ranked=hit support=hit ranked_files=2/3 :: chunk-level doc_purpose extractor synthetic property

  THO-221 (99cf920)
    src files: 3/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/code-fence-entities-flag.ts
      [✅] src/retrieve/multi-path-candidates.ts
      [✅] src/retrieve/source-rerank.ts
    support cluster: src/retrieve/multi-path-candidates.ts, src/retrieve/source-rerank.ts, src/retrieve/code-fence-entities.ts, src/retrieve/source-adjudicator.ts, src/retrieve/query-intent.ts, src/retrieve/source-evidence.ts, src/retrieve/nav-metadata-flag.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/heading-aliases.ts, src/store/db.ts, src/retrieve/code-source-flag.ts, src/retrieve/source-rerank-pipeline.ts, src/config/defaults.ts, src/retrieve/query-scope.ts, src/retrieve/query-mode-honesty.ts, src/retrieve/assembly.ts, src/retrieve/pack.ts, src/store/source-profiles.ts, src/retrieve/coverage-verifier.ts, src/retrieve/retrieve.ts, src/retrieve/source-card.ts
    prompt variants:
      top1=hit top3=hit ranked=hit support=hit ranked_files=3/3 :: PRD-0024 code-fence entity consumption alias substrate
      top1=miss top3=miss ranked=hit support=miss ranked_files=3/3 :: code_fence_entities source-rerank wiring
      top1=hit top3=hit ranked=hit support=hit ranked_files=3/3 :: code-fence entity flag shadow eval

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
    support cluster: src/retrieve/code-fence-entities.ts, src/parse/code-source-python.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/path-topology.ts, src/types/code-source.ts, src/types/source-profile.ts, src/retrieve/heading-aliases.ts, src/retrieve/retrieve.ts, src/cli/index-cmd.ts, src/parse/chunker.ts, src/inbox/items.ts, src/retrieve/source-rerank.ts, src/parse/source-profile.ts, src/retrieve/source-card.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/types/card.ts, src/retrieve/pack.ts, src/retrieve/query-scope.ts, src/retrieve/query-mode-honesty.ts, src/store/source-profiles.ts, src/retrieve/tokenize.ts, src/store/db.ts, src/store/code-sources.ts, src/retrieve/multi-path-candidates.ts
    prompt variants:
      top1=hit top3=hit ranked=hit support=hit ranked_files=5/8 :: PRD-0024 SourceProfile code_fence_entities field import wiring
      top1=miss top3=miss ranked=hit support=hit ranked_files=8/8 :: code_fence_entities import-time wiring
      top1=miss top3=miss ranked=hit support=hit ranked_files=6/8 :: code_fence_entities SourceProfile schema field

  THO-219 (b4ca552)
    src files: 1/1 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/code-fence-entities.ts
    support cluster: src/readiness/task-need.ts, src/retrieve/code-import-traversal.ts, src/types/code-source.ts, src/retrieve/path-topology.ts, src/setup/next-step.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/retrieve/multi-path-candidates.ts, src/store/source-profiles.ts, src/retrieve/source-card.ts, src/retrieve/source-rerank.ts, src/parse/markdown.ts, src/parse/source-profile.ts, src/retrieve/coverage-verifier.ts, src/retrieve/ambiguity-planner.ts, src/parse/chunker.ts, src/parse/nav-parser.ts, src/parse/code-source.ts, src/retrieve/retrieve.ts, src/retrieve/clarification-gates.ts, src/mcp/wild-log.ts, src/retrieve/code-source-mix.ts, src/retrieve/heading-aliases.ts, src/retrieve/code-fence-entities.ts, src/types/source-profile.ts, src/cli/index-cmd.ts
    prompt variants:
      top1=miss top3=miss ranked=hit support=miss ranked_files=1/1 :: PRD-0024 extractCodeFenceEntities extractor property tests
      top1=hit top3=hit ranked=hit support=miss ranked_files=1/1 :: code-fence entities markdown extractor
      top1=miss top3=miss ranked=hit support=hit ranked_files=1/1 :: extractCodeFenceEntities synthetic property gate

  THO-218 (9b62fd0)
    src files: 4/4 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/fused-source-candidates.ts
      [✅] src/retrieve/heading-aliases-flag.ts
      [✅] src/retrieve/multi-path-candidates.ts
      [✅] src/retrieve/source-rerank.ts
    support cluster: src/retrieve/multi-path-candidates.ts, src/retrieve/source-rerank.ts, src/retrieve/heading-aliases.ts, src/types/source-profile.ts, src/retrieve/source-card.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/source-rerank-tiebreakers.ts, src/retrieve/source-selection-decision.ts, src/retrieve/nav-metadata-flag.ts, src/retrieve/source-rerank-pipeline.ts, src/retrieve/source-evidence.ts, src/types/code-source.ts, src/parse/source-profile.ts, src/retrieve/source-evidence-policy.ts, src/retrieve/source-family.ts, src/retrieve/code-source-mix.ts, src/cards/freshness-policy.ts, src/store/code-sources.ts, src/retrieve/source-adjudicator.ts, src/retrieve/query-intent.ts, src/retrieve/aboutness.ts, src/retrieve/code-fence-entities.ts, src/retrieve/source-candidates.ts, src/retrieve/retrieve.ts, src/retrieve/source-rerank-flags.ts
    prompt variants:
      top1=hit top3=hit ranked=hit support=hit ranked_files=4/4 :: PRD-0024 heading aliases source-rerank wiring
      top1=miss top3=hit ranked=hit support=hit ranked_files=4/4 :: heading_aliases SourceProfile field source-rerank evidence
      top1=hit top3=hit ranked=hit support=hit ranked_files=3/4 :: RETRIEVAL_HEADING_ALIASES flag flip

  THO-217 (bfe5abb)
    src files: 4/6 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/parse/source-profile.ts
      [✅] src/retrieve/source-card.ts
      [✅] src/store/db.ts
      [❌] src/store/schema.ts
      [❌] src/store/source-profiles.ts
      [✅] src/types/source-profile.ts
    support cluster: src/retrieve/code-import-traversal.ts, src/readiness/task-need.ts, src/retrieve/source-rerank.ts, src/types/code-source.ts, src/retrieve/path-topology.ts, src/retrieve/multi-path-candidates.ts, src/retrieve/source-card.ts, src/retrieve/code-source-flag.ts, src/retrieve/score.ts, src/cards/locked-include.ts
    prompt variants:
      top1=miss top3=miss ranked=hit support=hit ranked_files=3/6 :: PRD-0024 SourceProfile heading_aliases field import wiring
      top1=miss top3=hit ranked=hit support=hit ranked_files=4/6 :: heading_aliases SourceProfile schema field
      top1=miss top3=miss ranked=hit support=miss ranked_files=2/6 :: import-time wiring heading aliases extractor

  THO-216 (84a2ed3)
    src files: 1/1 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/retrieve/heading-aliases.ts
    support cluster: src/readiness/task-need.ts, src/retrieve/code-import-traversal.ts, src/types/code-source.ts, src/retrieve/path-topology.ts, src/setup/next-step.ts, src/retrieve/code-source-flag.ts, src/config/defaults.ts, src/store/source-profiles.ts, src/retrieve/heading-aliases.ts, src/parse/nav-parser.ts, src/types/source-profile.ts, src/cli/import.ts, src/cli/index-cmd.ts, src/parse/markdown.ts, src/retrieve/code-fence-entities.ts, src/store/code-sources.ts, src/parse/code-source.ts, src/parse/source-profile.ts, src/retrieve/source-card.ts, src/retrieve/retrieve.ts, src/retrieve/source-rerank.ts, src/retrieve/clarification-gates.ts, src/retrieve/score.ts, src/mcp/wild-log.ts, src/retrieve/coverage-verifier.ts, src/retrieve/code-source-mix.ts
    prompt variants:
      top1=miss top3=miss ranked=hit support=miss ranked_files=1/1 :: PRD-0024 extractHeadingAliases extractor property tests
      top1=miss top3=hit ranked=hit support=hit ranked_files=1/1 :: heading aliases markdown H1 H2 H3 extractor
      top1=miss top3=miss ranked=hit support=hit ranked_files=1/1 :: extractHeadingAliases synthetic property gate

  THO-214 (32a46e2)
    src files: 1/1 mentioned in pack
    doc files: 0/1 mentioned in pack
      [✅] src/retrieve/source-rerank.ts
    support cluster: src/retrieve/source-rerank-flags.ts, src/retrieve/path-topology.ts, src/types/source-profile.ts, src/retrieve/source-card.ts, src/retrieve/query-intent.ts, src/retrieve/code-fence-entities.ts, src/retrieve/source-candidates.ts, src/retrieve/nav-metadata-flag.ts, src/retrieve/source-rerank-tiebreakers.ts, src/retrieve/source-rerank-pipeline.ts, src/retrieve/fused-source-candidates.ts, src/parse/source-profile.ts, src/retrieve/source-rerank.ts, src/mcp/wild-log.ts, src/retrieve/code-source-mix.ts, src/retrieve/multi-path-candidates.ts, src/retrieve/source-adjudicator.ts, src/retrieve/query-scope.ts, src/retrieve/aboutness.ts
    prompt variants:
      top1=hit top3=hit ranked=hit support=miss ranked_files=1/1 :: PRD-0023 path-topology source-rerank boosts flag
      top1=hit top3=hit ranked=hit support=miss ranked_files=1/1 :: landing index package version boost source-rerank
      top1=miss top3=hit ranked=hit support=hit ranked_files=1/1 :: RETRIEVAL_PATH_TOPOLOGY_BOOSTS flag

  THO-213 (6dac61a)
    src files: 6/8 mentioned in pack
    doc files: 0/0 mentioned in pack
      [✅] src/cli/import.ts
      [✅] src/cli/index-cmd.ts
      [✅] src/parse/source-profile.ts
      [✅] src/retrieve/source-card.ts
      [❌] src/store/db.ts
      [❌] src/store/schema.ts
      [✅] src/store/source-profiles.ts
      [✅] src/types/source-profile.ts
    support cluster: src/retrieve/code-import-traversal.ts, src/parse/code-source-python.ts, src/retrieve/code-fence-entities.ts, src/retrieve/path-topology.ts, src/types/code-source.ts, src/types/source-profile.ts, src/retrieve/heading-aliases.ts, src/store/source-profiles.ts, src/parse/code-source-go.ts, src/bootstrap/llm-client.ts, src/parse/nav-parser.ts, src/cli/import.ts, src/retrieve/source-rerank.ts, src/retrieve/phrase-proximity.ts, src/retrieve/source-candidates.ts, src/retrieve/source-family.ts, src/retrieve/fused-source-candidates.ts, src/retrieve/multi-path-candidates.ts, src/parse/source-profile.ts, src/mcp/presenter.ts, src/retrieve/retrieve.ts, src/retrieve/source-card.ts
    prompt variants:
      top1=hit top3=hit ranked=hit support=hit ranked_files=6/8 :: PRD-0023 SourceProfile path-topology fields import wiring
      top1=hit top3=hit ranked=hit support=hit ranked_files=4/8 :: is_index_file is_section_landing path_depth SourceProfile
      top1=miss top3=hit ranked=hit support=hit ranked_files=4/8 :: package_segment version_segment SourceProfile extension

Repo: Ralph
root: /Users/thomaschang/Repos/Ralph
task panel: THO-25, THO-24, THO-23, THO-17

========== PAIRED CODE-LANE COMPARISON ==========
Same task panel, default budget, old file-card path vs new chunk-first code lane.

Summary:
  Ranked code-file coverage Old (file-card): 0/9 (0.0%)
                            New (chunk-first): 3/9 (33.3%)
  Code top-1 acceptable     Old (file-card): 0/4 (0.0%)
                            New (chunk-first): 0/4 (0.0%)
  Code ranked useful        Old (file-card): 0/4 (0.0%)
                            New (chunk-first): 3/4 (75.0%)
  Support-cluster useful    Old (file-card): 0/4 (0.0%)
                            New (chunk-first): 0/4 (0.0%)
  Prompt variant top-1     Old (file-card): 0/12 (0.0%)
                            New (chunk-first): 0/12 (0.0%)
  Prompt variant top-3     Old (file-card): 0/12 (0.0%)
                            New (chunk-first): 0/12 (0.0%)
  Prompt variant ranked    Old (file-card): 0/12 (0.0%)
                            New (chunk-first): 3/12 (25.0%)
  Top-3 hit / top-1 miss  Old (file-card): 0/4 (0.0%)
                            New (chunk-first): 0/4 (0.0%)
  Ranked hit below top-3   Old (file-card): 0/4 (0.0%)
                            New (chunk-first): 3/4 (75.0%)
  Ranked miss              Old (file-card): 4/4 (100.0%)
                            New (chunk-first): 1/4 (25.0%)

Code-lane diagnostics:
  Residual miss families:
    retrieval_index  tickets=THO-17,THO-23,THO-24,THO-25  files=src/artifacts/index.ts, src/runner/index.ts, src/validate/index.ts  missing_from_ranked=4  ranked_below_top3=0  support_missing=4  body_only=0
    other  tickets=THO-17,THO-25  files=src/artifacts/summaries.ts, src/git/git.ts  missing_from_ranked=2  ranked_below_top3=0  support_missing=2  body_only=0
    cli_workflow  tickets=THO-17,THO-23,THO-24  files=src/runner/reset-run.ts, src/runner/takeover-run.ts, src/validate/validate.ts  missing_from_ranked=0  ranked_below_top3=3  support_missing=3  body_only=0
  Next target files:
    src/runner/index.ts  tickets=THO-23,THO-24  missing_from_ranked=2  ranked_below_top3=0  support_missing=2  body_only=0
    src/artifacts/index.ts  tickets=THO-25  missing_from_ranked=1  ranked_below_top3=0  support_missing=1  body_only=0
    src/artifacts/summaries.ts  tickets=THO-25  missing_from_ranked=1  ranked_below_top3=0  support_missing=1  body_only=0
    src/git/git.ts  tickets=THO-17  missing_from_ranked=1  ranked_below_top3=0  support_missing=1  body_only=0
    src/validate/index.ts  tickets=THO-17  missing_from_ranked=1  ranked_below_top3=0  support_missing=1  body_only=0
    src/runner/reset-run.ts  tickets=THO-23  missing_from_ranked=0  ranked_below_top3=1  support_missing=1  body_only=0
    src/runner/takeover-run.ts  tickets=THO-24  missing_from_ranked=0  ranked_below_top3=1  support_missing=1  body_only=0
    src/validate/validate.ts  tickets=THO-17  missing_from_ranked=0  ranked_below_top3=1  support_missing=1  body_only=0
  Per-ticket missing files:
    THO-25 (13e51ae)
      missing_from_ranked: src/artifacts/index.ts, src/artifacts/summaries.ts
      ranked_below_top3: (none)
      support_missing: src/artifacts/index.ts, src/artifacts/summaries.ts
      body_only: (none)
    THO-24 (1e56bad)
      missing_from_ranked: src/runner/index.ts
      ranked_below_top3: src/runner/takeover-run.ts
      support_missing: src/runner/index.ts, src/runner/takeover-run.ts
      body_only: (none)
    THO-23 (ca325d2)
      missing_from_ranked: src/runner/index.ts
      ranked_below_top3: src/runner/reset-run.ts
      support_missing: src/runner/index.ts, src/runner/reset-run.ts
      body_only: (none)
    THO-17 (b42194d)
      missing_from_ranked: src/git/git.ts, src/validate/index.ts
      ranked_below_top3: src/validate/validate.ts
      support_missing: src/git/git.ts, src/validate/index.ts, src/validate/validate.ts
      body_only: (none)

Per-ticket detail:

  THO-25 (13e51ae)
    ranked code files    old 0/2  →  new 0/2
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new miss
    support cluster      old miss  →  new miss

  THO-24 (1e56bad)
    ranked code files    old 0/2  →  new 1/2
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new miss

  THO-23 (ca325d2)
    ranked code files    old 0/2  →  new 1/2
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new miss

  THO-17 (b42194d)
    ranked code files    old 0/3  →  new 1/3
    code top-1           old miss  →  new miss
    code ranked useful   old miss  →  new hit
    support cluster      old miss  →  new miss

Old (file-card) detail:

========== AGENT-COMPLETION PROBE ==========
4 tickets, comparing pack-mentioned files to actual commit diffs.

Source files (src/**) pointed-at: 0/9  (0.0%)
Doc files (docs/**) pointed-at:   0/0  (0.0%)
Ranked-code file hits: 0/9  (0.0%)
Support-cluster useful: 0/4  (0.0%)
Support-cluster file hits: 0/9  (0.0%)
Body-mention-only file hits: 0/9  (0.0%)

Miss taxonomy:
  top1_hit: 0
  top3_hit_top1_miss: 0
  ranked_hit_top3_miss: 0
  ranked_miss_body_only: 0
  ranked_miss: 4
  ranked_file_hits: 0/9
  top3_file_hits: 0/9
  missing_from_ranked: 9/9
  body_only_file_hits: 0/9
  support_can_promote_top1_misses: 0
  support_missing_when_top1_missed: 4

Prompt variants:
  prompt top-1 acceptable: 0/12  (0.0%)
  prompt top-3 useful: 0/12  (0.0%)
  prompt ranked useful: 0/12  (0.0%)
  prompt support useful: 0/12  (0.0%)
  prompt ranked-file hits: 0/27  (0.0%)
  tickets top-1 robust: 0/4
  tickets top-3 robust: 0/4
  tickets ranked robust: 0/4

Per-ticket detail:

  THO-25 (13e51ae)
    src files: 0/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/artifacts/index.ts
      [❌] src/artifacts/summaries.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: THO-25 markdown summary rendering of JSON artifacts
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: render markdown summaries for run manifest worker validator artifacts
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: ticket summary run summary iteration summary markdown

  THO-24 (1e56bad)
    src files: 0/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/runner/index.ts
      [❌] src/runner/takeover-run.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: THO-24 takeover command adopts blocked or in-progress tickets
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: takeoverTicket autonomous human_steered blocked in-progress
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: reuse retry budget from prior handoff takeover branch strategy

  THO-23 (ca325d2)
    src files: 0/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/runner/index.ts
      [❌] src/runner/reset-run.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: THO-23 reset command clears stale lock and run state
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: resetRunState clear repo lock active run preserve manifests
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: stale lock reset active-run confirm

  THO-17 (b42194d)
    src files: 0/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/git/git.ts
      [❌] src/validate/index.ts
      [❌] src/validate/validate.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: THO-17 validator command runner with failure classification
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: validateWorkerOutput policy_failure command_failure scope_failure
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: worker result validator commands forbidden path scan

New (chunk-first) detail:

========== AGENT-COMPLETION PROBE ==========
4 tickets, comparing pack-mentioned files to actual commit diffs.

Source files (src/**) pointed-at: 3/9  (33.3%)
Doc files (docs/**) pointed-at:   0/0  (0.0%)
Ranked-code file hits: 3/9  (33.3%)
Support-cluster useful: 0/4  (0.0%)
Support-cluster file hits: 0/9  (0.0%)
Body-mention-only file hits: 0/9  (0.0%)

Miss taxonomy:
  top1_hit: 0
  top3_hit_top1_miss: 0
  ranked_hit_top3_miss: 3
  ranked_miss_body_only: 0
  ranked_miss: 1
  ranked_file_hits: 3/9
  top3_file_hits: 0/9
  missing_from_ranked: 6/9
  body_only_file_hits: 0/9
  support_can_promote_top1_misses: 0
  support_missing_when_top1_missed: 4

Prompt variants:
  prompt top-1 acceptable: 0/12  (0.0%)
  prompt top-3 useful: 0/12  (0.0%)
  prompt ranked useful: 3/12  (25.0%)
  prompt support useful: 0/12  (0.0%)
  prompt ranked-file hits: 3/27  (11.1%)
  tickets top-1 robust: 0/4
  tickets top-3 robust: 0/4
  tickets ranked robust: 0/4

Per-ticket detail:

  THO-25 (13e51ae)
    src files: 0/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/artifacts/index.ts
      [❌] src/artifacts/summaries.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: THO-25 markdown summary rendering of JSON artifacts
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: render markdown summaries for run manifest worker validator artifacts
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: ticket summary run summary iteration summary markdown

  THO-24 (1e56bad)
    src files: 1/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/runner/index.ts
      [✅] src/runner/takeover-run.ts
    support cluster: src/cli/commands/reset.ts, src/cli/commands/dry-run.ts, src/cli/commands/setup.ts, src/cli/commands/resume.ts, src/cli/commands/execute.ts, src/cli/commands/takeover.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: THO-24 takeover command adopts blocked or in-progress tickets
      top1=miss top3=miss ranked=hit support=miss ranked_files=1/2 :: takeoverTicket autonomous human_steered blocked in-progress
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: reuse retry budget from prior handoff takeover branch strategy

  THO-23 (ca325d2)
    src files: 1/2 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/runner/index.ts
      [✅] src/runner/reset-run.ts
    support cluster: src/cli/commands/setup.ts, src/cli/commands/resume.ts, src/cli/commands/takeover.ts, src/cli/commands/execute.ts, src/cli/commands/reset.ts, src/cli/commands/dry-run.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: THO-23 reset command clears stale lock and run state
      top1=miss top3=miss ranked=hit support=miss ranked_files=1/2 :: resetRunState clear repo lock active run preserve manifests
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/2 :: stale lock reset active-run confirm

  THO-17 (b42194d)
    src files: 1/3 mentioned in pack
    doc files: 0/0 mentioned in pack
      [❌] src/git/git.ts
      [❌] src/validate/index.ts
      [✅] src/validate/validate.ts
    support cluster: src/schemas/machine-block.ts
    prompt variants:
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: THO-17 validator command runner with failure classification
      top1=miss top3=miss ranked=hit support=miss ranked_files=1/3 :: validateWorkerOutput policy_failure command_failure scope_failure
      top1=miss top3=miss ranked=miss support=miss ranked_files=0/3 :: worker result validator commands forbidden path scan

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
| primary_file_coverage_floor | 0/66 | 54/66 | PASS | new lane must not regress primary file coverage on the paired validation panel |
| primary_code_chunk_usefulness_non_regression | top1 0/14; ranked 0/14 | top1 12/14; ranked 14/14 | PASS | new lane must not regress chunk usefulness on the primary paired panel |
| cross_repo_validation_present | >=2 repos | 2 repos | PASS | promotion requires a second commit-grounded repo in the paired validation surface |
| workflow_assembly_no_regression | 22/23 | 22/23 | PASS | workflow assembly must remain at least as strong under the new lane |
| downstream_task_success_measured | 3 old verdicts | 3 new verdicts | PASS | promotion cannot proceed without explicit downstream task-success evidence |
| downstream_task_success_non_regression | reachable 2/3; acceptable 0/3 | reachable 3/3; acceptable 3/3 | PASS | new lane must not regress downstream task-success outcomes once they are measured |
| token_accounting_and_pack_honesty | coverage_confidence=yes, pack_readiness=yes, query_mode=yes | coverage_confidence=yes, pack_readiness=yes, query_mode=yes | PASS | promotion requires explicit token/honesty evidence, not only retrieval wins |

## Evidence

### Old (file-card)
- file coverage: 0/66
- code top-1 acceptable: 0/14
- code ranked useful: 0/14

### New (chunk-first)
- file coverage: 54/66
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
