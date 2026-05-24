# Code-Lane OSS Engine Bake-Off Candidates - 2026-05-20

## Why This Exists

The current ContextTrail code lane is not close enough to the bar. The corrected
causal autopsy showed:

- prompt top-3 misses: `2753 / 7360` (`37.4%`)
- target present by recall@10 but not top-3: `1082` misses (`39.3%`)
- target present by recall@30 but not top-3: `701` misses (`25.5%`)
- absent by recall@100: `680` misses (`24.7%`)
- top-3 filled with non-target decoys: `2330` misses (`84.6%`)

So the next move should not be another small local heuristic. We should run a
bake-off against OSS engines and either fork, borrow, or reject them based on
our corpus, not their marketing.

## What We Need To Beat

Baseline to beat:

- prompt top-3: `4607 / 7360` (`62.6%`)
- recall@10: `5633 / 7810` (`72.1%`)
- recall@30: `6376 / 7810` (`81.6%`)
- recall@100: `6674 / 7810` (`85.5%`)
- file recall@100: `15270 / 28720` (`53.2%`)

Near-term acceptance target for an external engine:

- prompt recall@100: `95%+`
- file recall@100: materially above `53.2%`
- prompt top-3: at least `68%` before we consider migration
- no text-lane regression
- no target-commit leakage

## Evaluation Rules

1. Evaluate candidates against the same local OSS manifest.
2. Index only the repository state available to ContextTrail today. Do not use
   target commit metadata, PR text, or commit history if it leaks target files.
3. Every candidate must return file paths, not just snippets.
4. Evaluate candidate recall@10, recall@30, recall@100, and top-3.
5. If the engine returns snippets/symbols, collapse to file-level hits for
   parity with the current eval.
6. Keep document retrieval separate. A candidate can include doc search, but it
   must not replace the document chunk lane unless it beats the existing text
   metrics.
7. Prefer engines that expose structured evidence we can merge into Context
   Pack entries.

## Bake-Off Harness Status

Implementation started in this repo:

- scorer: `src/eval/oss-code-engine-bakeoff.ts`
- tests: `src/eval/oss-code-engine-bakeoff.test.ts`
- Octocode JSONL wrapper: `scripts/eval/octocode-jsonl.mjs`
- package scripts:
  - `npm run eval:oss-code-engine:bakeoff`
  - `npm run eval:oss-code-engine:octocode-results`

The harness intentionally separates query emission from scoring:

1. Emit a query panel without target labels:

   ```bash
   npm run eval:oss-code-engine:bakeoff -- \
     --manifest=.contexttrail/evals/oss-code-lane-manifest-local.json \
     --target-prompts-per-case=10 \
     --emit-queries=.contexttrail/evals/oss-code-engine-query-panel-local.jsonl
   ```

2. Run a candidate wrapper, such as Octocode:

   ```bash
   npm run eval:oss-code-engine:octocode-results -- \
     --queries=.contexttrail/evals/oss-code-engine-query-panel-local.jsonl \
     --results=.contexttrail/evals/octocode-results.jsonl \
     --max-results=100
   ```

3. Score the candidate output:

   ```bash
   npm run eval:oss-code-engine:bakeoff -- \
     --manifest=.contexttrail/evals/oss-code-lane-manifest-local.json \
     --target-prompts-per-case=10 \
     --results=.contexttrail/evals/octocode-results.jsonl \
     --engine-id=octocode \
     --engine-name=Octocode
   ```

Generated local artifacts:

- smoke query panel: `.contexttrail/evals/oss-code-engine-query-panel-smoke-local.jsonl`
- full query panel: `.contexttrail/evals/oss-code-engine-query-panel-local.jsonl`

The full local query panel has `7810` prompts and does not contain
`targetSourceFiles` or `changedFiles`. This keeps external wrappers from seeing
the answer key.

Current blocker for the first live Octocode run:

- `octocode` is not installed in this environment.
- The Octocode README says indexing requires an embedding provider key or
  configured provider, so the live accuracy run should start only after the
  local binary and provider configuration are available.

Validation completed for the harness:

- `npx vitest run src/eval/oss-code-engine-bakeoff.test.ts`
- `npm run build:all --silent`

## Recommended Eval Order

### 1. Octocode

Source: <https://github.com/Muvon/octocode>

Why first:

- It attacks both major failure classes: candidate generation and first-slate
  disambiguation.
- It combines Tree-sitter AST parsing, symbol extraction, relationships between
  files, a GraphRAG-style knowledge graph, hybrid semantic/BM25 search, and
  reranking.
- It is local-first and Apache-2.0.
- It has a Rust CLI/MCP shape, which makes it plausible to call from our eval
  harness without embedding the whole engine.
- Its README explicitly frames the weakness of standard RAG as flat text chunks
  and claims to model imports/calls/relationships. That matches our autopsy:
  many failures are same-shaped decoys and repo-family confusion.

Fit with ContextTrail:

- Strong code-lane fit.
- Medium text-lane fit. It can coexist with our text chunking; we should not
  adopt its doc handling until measured.
- Good evidence fit: symbol, file, relationship, and search score can map into
  our candidate evidence model.

Risks:

- Embedding stack and LanceDB may add operational weight.
- Language support must be checked against our corpus: TypeScript, JavaScript,
  Python, Go, Rust.
- It may optimize snippet retrieval rather than commit-title-to-edited-file
  retrieval, so our eval is still decisive.

Eval first because:

If Octocode cannot beat our top-100/file-recall numbers, that is a strong signal
that off-the-shelf semantic+graph search is not enough and we need a custom
edit-intent architecture.

### 2. Aider Repo Map

Sources:

- <https://github.com/Aider-AI/aider>
- <https://aider.chat/2023/10/22/repomap.html>

Why second:

- Aider's repo map is not just search. It builds a token-budgeted map of files,
  definitions, references, and important symbols using Tree-sitter.
- It is closer to an "edit context prior" than a retrieval engine.
- Our autopsy says top-3 is crowded with decoys even when targets are nearby.
  A repo map / symbol-reference prior may be exactly what our first-slate
  arbitration is missing.
- It is mature, widely used, and Apache-2.0.

Fit with ContextTrail:

- Very strong fit with text chunking because it produces compact structured
  context rather than trying to replace docs.
- Very strong fit with a future bundle selector: repo-map output can become a
  code-orientation pack entry or candidate prior.
- Good implementation fit: Python module, inspectable algorithm, simple enough
  to port or fork selectively.

Risks:

- It may improve agent editing behavior more than our standalone top-3 file
  metric.
- It is not a drop-in candidate generator. We need to adapt it into file scoring
  or run it as a prior over current candidates.
- It may not saturate recall@100 by itself.

Eval second because:

It tests the hypothesis that our failure is not "search harder" but "give the
ranker a better repository map and ownership prior."

### 3. Claude Context / Zilliz Code Context

Source: <https://github.com/zilliztech/claude-context>

Why third:

- It is purpose-built as a code search MCP for coding agents.
- The core package provides code indexing and semantic search.
- It uses hybrid dense/BM25 retrieval and AST/syntax-boundary chunking.
- It is MIT-licensed.
- It may fit our combined code+text context goal better than graph-heavy tools,
  because it already treats code search as a retrieval product for agents.

Fit with ContextTrail:

- Strong text-lane compatibility if its chunk abstractions can be mapped into
  our document/code pack entries.
- Medium-to-strong code-lane fit for candidate generation.
- Good candidate for a "semantic retrieval baseline" against our deterministic
  code lane.

Risks:

- Vector database / Milvus or Zilliz assumptions may be too heavy for a local
  deterministic engine.
- Semantic similarity can worsen same-shaped decoy problems unless paired with
  strong repo-family disambiguation.
- Need to verify local-only operation and language support under our eval.

Eval third because:

It gives us a clean answer on whether modern hybrid semantic retrieval moves the
needle on weak prompts without a custom repo map.

### 4. Zoekt

Source: <https://github.com/sourcegraph/zoekt>

Why fourth:

- Mature code search engine built for source code.
- Fast trigram/regex/substring search with code-aware ranking signals such as
  symbol matching.
- Maintained by Sourcegraph.
- Easy to evaluate as a candidate-universe saturation baseline.

Fit with ContextTrail:

- Strong as a replacement or companion for our FTS candidate generator.
- Weak-to-medium for text chunking; it is code search, not context assembly.
- Good operational profile: Go binaries, local indexes, fast queries.

Risks:

- It is lexical search, not semantic/edit-intent understanding.
- It may improve exact/path/symbol recall but not weak prompt identity.
- It probably will not solve first-slate bundle arbitration by itself.

Eval fourth because:

If Zoekt dramatically improves recall@100, our current SQLite FTS path is the
bottleneck. If it does not, the issue is above lexical candidate generation.

### 5. codebase-context

Source: <https://github.com/PatrickSys/codebase-context>

Why fifth:

- It explicitly frames search as insufficient and adds architecture maps,
  patterns, golden files, relationship hints, quality indicators, and an
  edit-intent preflight card.
- This aligns with our autopsy better than generic semantic search: weak prompts
  need architecture/pattern context, not just nearest code chunks.
- It exposes CLI/MCP flows and seems easy to trial with `npx`.

Fit with ContextTrail:

- Very strong conceptual fit with Context Pack quality.
- Strong text-lane fit if its summaries/patterns can become supporting context
  rather than replacing document chunks.
- Strong product fit for "ready/partial/exploratory" context states.

Risks:

- Need to verify license and forkability before depending on it.
- It may be optimized for conventions/examples, not exact edited-file recall.
- It may rely on generated summaries or heuristics that are hard to make
  deterministic enough for our eval.

Eval fifth because:

It tests the architecture-context hypothesis, but only after we benchmark the
more direct search/graph candidates.

### 6. semcode

Source: <https://mcpservers.org/servers/goodbyeplanet/semcode>

Why sixth:

- MIT-licensed MCP server with hybrid semantic/BM25 search.
- Uses Tree-sitter for symbols.
- Indexes code and git commit history.
- The commit-history angle is relevant because our prompts are often
  commit-title-shaped.

Fit with ContextTrail:

- Medium code-lane fit.
- Potentially interesting for issue/commit wording, but dangerous.

Risks:

- Commit history can leak the answer in our eval if target commits or nearby
  history are indexed. We must disable commit-history features or build a
  leakage-safe protocol.
- Language support and output shape need verification.

Eval only after leakage rules are clear.

### 7. Sourcebot

Sources:

- <https://github.com/sourcebot-dev/sourcebot>
- <https://www.sourcebot.dev/>

Why not first:

- It is more of a full code understanding platform than a forkable retrieval
  engine.
- It uses Zoekt under the hood for search and adds code navigation plus
  agentic/Ask workflows.
- The current site says it is released under Fair Source, which is a poor fit if
  we want to fork into an OSS ContextTrail code lane.

Fit with ContextTrail:

- Useful as a product reference.
- Possibly useful for evaluating agentic search behavior.
- Poor fit as a direct fork unless licensing is acceptable.

Eval later or use only as inspiration.

### 8. Bloop

Source: <https://github.com/BloopAI/bloop>

Why not first:

- It is a Rust code search engine with natural-language ambitions, but the repo
  is archived as of January 2025.
- Archived status makes it risky as a fork base.

Eval only if we need historical implementation ideas.

## Not Recommended As Immediate Fork Bases

- Full Sourcegraph: the core product is not a clean OSS fork target now; use
  Zoekt instead.
- Sourcebot: valuable reference, but Fair Source licensing complicates forking.
- New MCP projects with tiny adoption and unclear license: maybe later, not for
  the first bake-off.
- Pure vector semantic search tools without repo structure: our autopsy says
  semantic similarity alone is likely to pick same-shaped decoys.

## Bake-Off Harness Shape

For each candidate, build an adapter that returns:

```ts
type ExternalCodeSearchHit = {
  file_path: string;
  score?: number;
  symbol?: string;
  snippet?: string;
  reason?: string;
  source: "octocode" | "aider_repomap" | "claude_context" | "zoekt" | string;
};
```

Then compute:

- prompt top-3
- prompt recall@10
- prompt recall@30
- prompt recall@100
- file recall@100
- weak-prompt subset
- large-target subset
- same-shaped-family subset
- runtime/configuration/api/parser/build-tooling slices
- index time
- query time
- operational dependencies
- license/forkability score

The adapter should be read-only and eval-only first. Do not wire any candidate
into Context Pack production ranking until it beats the current baseline.

## My Recommended First Three Evals

1. **Octocode**
   - Best chance to improve both candidate universe and same-shaped decoy
     disambiguation.
   - If it wins, fork/borrow graph+hybrid search architecture.

2. **Aider repo map**
   - Best chance to improve first-slate arbitration and fit naturally with our
     document chunk lane.
   - If it wins, port repo-map ownership priors rather than fork an external
     server.

3. **Claude Context**
   - Best semantic retrieval/text-chunking fit.
   - If it wins, borrow AST chunking + hybrid retrieval; be careful with vector
     infra.

Zoekt should be the fourth eval as a lexical high-recall baseline. It is
unlikely to solve weak prompts by itself, but it will tell us whether our FTS
candidate-generation layer is simply underpowered.

## Decision Rule

Pick a fork/borrow target only if it clears one of these:

- `+5pp` or better prompt top-3 over current baseline, or
- `95%+` prompt recall@100 with materially better file recall@100, or
- strong weak-prompt lift without damaging exact/path/symbol prompts, or
- clear first-slate decoy reduction on the buried-top10 bucket.

If no external engine clears those bars, do not fork. Build a ContextTrail V2
code lane around the lessons:

- repo-family ownership maps
- first-slate bundle arbitration over top 30
- candidate universe saturation
- weak-prompt exploratory mode
- exact source/support role separation

## Sources Reviewed

- Octocode: <https://github.com/Muvon/octocode>
- Aider repo map: <https://aider.chat/2023/10/22/repomap.html>
- Aider GitHub: <https://github.com/Aider-AI/aider>
- Claude Context: <https://github.com/zilliztech/claude-context>
- Zoekt: <https://github.com/sourcegraph/zoekt>
- Sourcebot: <https://github.com/sourcebot-dev/sourcebot>
- Sourcebot site: <https://www.sourcebot.dev/>
- semcode listing: <https://mcpservers.org/servers/goodbyeplanet/semcode>
- codebase-context: <https://github.com/PatrickSys/codebase-context>
- Bloop: <https://github.com/BloopAI/bloop>
