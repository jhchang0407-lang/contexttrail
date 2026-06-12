# Contributing to ContextTrail

Thanks for your interest! ContextTrail is in public beta, so issues —
especially "I imported my real folder and X happened" reports — are as
valuable as pull requests.

## Development setup

Requires Node.js 20+.

```bash
git clone https://github.com/jhchang0407-lang/contexttrail.git
cd contexttrail
npm install
npm run build
npm test
```

Run the CLI from source without building:

```bash
npm run contexttrail -- --help
```

## Checks

CI runs on every PR:

```bash
npm run build:all   # type-checks everything, including the eval harness
npm test            # full vitest suite
npm run eval:document-format-stress
```

Retrieval changes should also pass the document-workflow evals before
review:

```bash
npm run eval:document-workflow
npm run eval:document-workflow:robust
```

The synthetic suites under `src/eval/synthetic/` certify per-class
ranking accuracy with statistical lower bounds; they run as part of
`npm test`. If your change moves one of those floors, say so in the PR
description rather than adjusting the floor silently.

## Code map

```
src/types       shared data shapes (chunks, cards, source profiles)
src/parse       document opening: markdown, plain text, DOCX, PDF
                (pdf-structure.ts rebuilds form/table geometry), chunking,
                source profiles
src/store       SQLite persistence (better-sqlite3 + FTS5)
src/retrieve    the ranking pipeline: bm25 → score → source rerank →
                source selection → pack → structural assembly →
                presentation/render
src/readiness   task-need extraction, slot readiness, recovery plans
src/cards       Agent Rules / cards: loading, freshness, locked include
src/config      .contexttrail/config.yaml schema and task profiles
src/cli         command-line entry points (main.ts is the bin)
src/mcp         MCP server, tool schemas, wire presenter
src/ui          localhost setup UI
src/sync        folder sync and freshness repair
src/setup       guided setup and quickstart
src/inbox       review queue for proposed cards/questions
src/eval        eval harnesses and fixtures (not shipped in the package)
tests/fixtures  test corpora; real-corpus/ holds OSS doc snapshots
                (see ATTRIBUTION.md there)
```

A request flows roughly: CLI/MCP/UI → `retrieve/retrieve.ts` →
`mcp/presenter.ts` (wire shape) or `retrieve/render.ts` (text/JSON).

## Conventions

- TypeScript, ES modules, `.js` extensions on relative imports.
- Tests live next to the code as `*.test.ts` and run with vitest.
- Imported document text stays local; never add telemetry or network
  calls to the core retrieval path.
