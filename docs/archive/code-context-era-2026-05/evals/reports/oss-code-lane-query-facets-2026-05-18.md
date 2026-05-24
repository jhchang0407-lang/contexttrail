# OSS code-lane query facets - 2026-05-18

## Scope

This report covers the first Stage 2 TDD slice from
`docs/prd/0051-oss-code-lane-corpus-accuracy-improvement-plan.md`.

The implemented runtime slice is intentionally narrow:

- build deterministic query facets for dotted/path/code-shaped identities,
  conventional commit scopes, and code identifiers
- activate only dotted-identity facets in retrieval for now
- run bounded facet FTS over both `code_chunks_fts` and `code_sources_fts`
- disable facet channels when explicit file/symbol anchors are already present

The broader conventional-scope and code-identifier facets remain tested at the
facet-builder layer, but are not active in runtime ranking yet.

## Why dotted-only

An initial broad runtime attempt activated all facet families. It improved the
smoke corpus, but failed the full-corpus promotion test:

- prompt top-3: `4475 / 7360` (`60.8%`)
- ticket robust: `250 / 736` (`34.0%`)
- support file hits: `127 / 2872` (`4.4%`)

That regressed the prior post-chunker full-corpus baseline, so the broad facet
runtime was rejected.

## Accepted result

After narrowing runtime participation to dotted identities, the full local OSS
corpus result was:

- outcome: fail certification gates, but product lift over the previous stage
- prompt top-3: `4607 / 7360` (`62.6%`, lower99 `61.1%`)
- ticket top-3 robust: `257 / 736` (`34.9%`, lower99 `30.5%`)
- ranked useful: `4607 / 7360` (`62.6%`, lower99 `61.1%`)
- support file hits: `133 / 2872` (`4.6%`, lower99 `3.7%`)
- recall@10: `5633 / 7810` (`72.1%`)
- recall@30: `6376 / 7810` (`81.6%`)
- recall@100: `6674 / 7810` (`85.5%`)

Compared with the prior Stage 3 chunker run (`4577 / 7360`, `62.2%`), this is a
small but corpus-proven owner-discovery lift.

## PRD-0052 admission tightening checkpoint

The first PRD-0052 tightening slice extracted facet promotion into
`src/retrieve/code-method-admission.ts`.

Runtime behavior remains intentionally equivalent to the accepted dotted-only
integration:

- dotted-identity facets can admit as `direct_owner`
- conventional-scope facets remain `shadow_only` without independent evidence
- code-identifier facets remain `shadow_only` without independent evidence
- explicit file/symbol anchors reject facet promotion
- `exact_symbol` intent alone is not treated as an explicit owner anchor

The exact-symbol-intent distinction matters. An intermediate variant rejected
facet promotion whenever `query_intent === "exact_symbol"` even without concrete
file/symbol anchors. The full corpus caught that as a regression:

- prompt top-3: `4588 / 7360` (`62.3%`)
- ticket robust: `252 / 736` (`34.2%`)
- support file hits: `133 / 2872` (`4.6%`)

That variant was rejected.

After narrowing rejection to concrete file/symbol anchors, the full local OSS
corpus returned to the accepted dotted-only baseline:

- prompt top-3: `4607 / 7360` (`62.6%`, lower99 `61.1%`)
- ticket top-3 robust: `257 / 736` (`34.9%`, lower99 `30.5%`)
- ranked useful: `4607 / 7360` (`62.6%`, lower99 `61.1%`)
- support file hits: `133 / 2872` (`4.6%`, lower99 `3.7%`)
- recall@10: `5633 / 7810` (`72.1%`)
- recall@30: `6376 / 7810` (`81.6%`)
- recall@100: `6674 / 7810` (`85.5%`)

## PRD-0053 evidence normalization checkpoint

The first PRD-0053 slice added a normalized candidate-evidence substrate in
`src/retrieve/code-candidate-evidence.ts`.

Implemented evidence behavior:

- file-level summaries count independent owner evidence by method family
- duplicate hits from one method family collapse to one independent signal
- owner and support evidence remain separate on the same file
- passive artifact policy is summarized explicitly
- query facet evidence preserves facet reason and keeps non-dotted facets
  shadow-only
- method admission can consume normalized candidate evidence while preserving
  the previous numeric independent-evidence input
- code-source mixer hits now carry shadow evidence summaries internally without
  changing ranking or first-slate arbitration

The full local OSS corpus remained behavior-preserving:

- prompt top-3: `4607 / 7360` (`62.6%`, lower99 `61.1%`)
- ticket top-3 robust: `257 / 736` (`34.9%`, lower99 `30.5%`)
- ranked useful: `4607 / 7360` (`62.6%`, lower99 `61.1%`)
- support file hits: `133 / 2872` (`4.6%`, lower99 `3.7%`)
- recall@10: `5633 / 7810` (`72.1%`)
- recall@30: `6376 / 7810` (`81.6%`)
- recall@100: `6674 / 7810` (`85.5%`)

This slice is intentionally scaffolding. It does not promote conventional-scope
or code-identifier facets by default. The next acceptance step is to extend eval
diagnostics so useful shadow evidence can be counted by method family before any
new runtime promotion.

## Notable smoke behavior

The smoke corpus recovered the representative Biome `vcs.root` case:

- `biome:Revert "docs: clarify vcs.root description"` improved to `10 / 10`
  top-3 prompt variants.
- Smoke prompt top-3 was `121 / 160` (`75.6%`).

Smoke remains a plumbing signal only; the full local OSS corpus is the promotion
benchmark.

## Next work

The next Stage 2 slice should make non-dotted facets promotable without the
full-corpus regression observed above. Likely direction:

- keep conventional-scope/code-identifier facets shadowed
- add per-facet trace/reporting so wins and losses can be sliced
- require multiple independent signals before non-dotted facets can promote a
  file over strong baseline owner evidence
- prefer recall@30 movement first, then first-slate reranking only after the
  candidate pool is healthier
