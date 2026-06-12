# ContextTrail

**ContextTrail is an alpha local context engine for document-heavy work.**

It helps an AI agent answer real workflow questions from a folder of documents without dumping the whole folder into the model. You point ContextTrail at the files, add any agent rules you care about, and it assembles a small, source-grounded Context Pack with citations, readiness signals, and warnings when the search or document extraction is weak.

The goal is simple:

> Give the agent the right working context, and make it obvious when the context is not good enough to trust.

ContextTrail is useful for work like insurance claims, contract review, HR packets, sales account folders, vendor onboarding, finance notes, and other paperwork-heavy workflows where the truth is scattered across PDFs, DOCX files, Markdown notes, text files, emails, invoices, policies, and internal rules.

It is local-first. Your documents stay on your machine. Core retrieval does not require an embedding service or an LLM call.

## What It Does

ContextTrail turns local documents into task-specific Context Packs.

For a task like:

```text
Can we make a final coverage decision for claim CLM-2026-0412?
```

ContextTrail tries to return:

- the most relevant source excerpts
- citations back to the original files
- accepted agent rules that should constrain the answer
- warnings for weak extraction, scanned PDFs, stale files, or low-confidence retrieval
- readiness signals that tell the agent whether to answer, retry, ask the user, or abstain

This is not a chatbot and not an answer engine. It is the context layer below the agent.

## Current Alpha Shape

What works now:

- Local CLI for importing documents and retrieving Context Packs.
- Localhost setup UI for non-terminal workflows.
- MCP server for Codex, Claude Code, Claude Desktop, Cursor, and opencode.
- Folder sync so a saved document folder can be refreshed without re-uploading files.
- Separate Agent Rules, so durable instructions do not get mixed into the work-document corpus.
- Task Profiles, so a user can switch between saved document folders and rules.
- Document opening layer for Markdown, text, DOCX, and PDF.
- Extraction quality flags: `indexed`, `parsed_with_warnings`, `layout_sensitive`, `needs_ocr`, and `failed`.
- Pack readiness and slot-level confidence signals for agents.

What is still alpha:

- OCR is explicit and local-first, not automatic.
- Organized PDFs (tax forms like K-1s, ruled corporate forms, financial statements) are reconstructed from positioned text, filled form fields, and ruled-grid geometry into key-value pairs and tables. Documents where that reconstruction fails are still flagged `layout_sensitive` rather than trusted; this is not a full visual form parser.
- The UI is functional, not polished product software.
- The eval suite is growing; results are promising, but this is not a claim that ContextTrail is ready for unsupervised production decisions.

## Install

Requires Node.js 20 or newer.

From npm, once published:

```bash
npm install -g contexttrail
```

From this repo:

```bash
git clone https://github.com/jhchang0407-lang/contexttrail.git
cd contexttrail
npm install
npm run build
```

Run the local build directly:

```bash
node dist/cli/main.js --help
```

## Quick Start With The UI

Start in the folder that should own the ContextTrail setup:

```bash
cd /path/to/your/workspace
contexttrail ui --port 9001
```

If you are using the local repo build:

```bash
cd /path/to/your/workspace
node /path/to/contexttrail/dist/cli/main.js ui --port 9001
```

Open:

```text
http://127.0.0.1:9001
```

In the UI:

1. Add or sync a document folder.
2. Add Agent Rules separately from documents.
3. Save the setup as a Task Profile if you want to reuse it.
4. Use the prompt preview to test what ContextTrail would retrieve for a task.
5. Connect MCP so your agent can request Context Packs while it works.

## Quick Start With The CLI

Create the local ContextTrail state:

```bash
cd /path/to/your/workspace
contexttrail init
```

Import documents:

```bash
contexttrail import "docs/**/*.{md,markdown,txt,docx,pdf}"
```

Ask for a Context Pack:

```bash
contexttrail context "What evidence is needed before this claim can be finalized?"
```

Get structured JSON:

```bash
contexttrail context "What evidence is needed before this claim can be finalized?" --json
```

Refresh after files change:

```bash
contexttrail sync
```

Check what sync would do without writing:

```bash
contexttrail sync --check
```

## Connect To Codex MCP

Install the MCP server once:

```bash
contexttrail mcp install --client codex
contexttrail mcp doctor --client codex
```

If you are testing from a local repo build, install with an absolute command:

```bash
cd /path/to/contexttrail
npm run build

node dist/cli/main.js mcp install \
  --client codex \
  --command /path/to/contexttrail/dist/cli/main.js

node dist/cli/main.js mcp doctor --client codex
```

Then restart Codex or open a new Codex session. MCP servers are normally loaded when the session starts.

You do not usually start the MCP server manually. Codex starts it from its MCP config.

## Connect To Other MCP Clients

Supported installer targets:

```bash
contexttrail mcp install --client claude-code
contexttrail mcp install --client claude-desktop
contexttrail mcp install --client cursor
contexttrail mcp install --client opencode
```

Verify:

```bash
contexttrail mcp doctor --client claude-code
```

## Agent Rules

Agent Rules are durable instructions that should guide the agent while it uses retrieved documents.

Examples:

```text
Draft memos must not be cited as final authority.
Final coverage recommendations must cite policy language and claim facts separately.
If causation is unresolved, recommend retry, escalation, or abstention.
```

Rules are stored separately from the document corpus. That matters because business users often want to change "how the agent should behave" without changing the evidence folder itself.

## Document Import

Supported inputs today:

- Markdown: `.md`, `.markdown`
- Plain text: `.txt`
- Word documents: `.docx`
- PDFs with text layers: `.pdf`

PDF extraction is structure-aware. ContextTrail rebuilds lines and cells from positioned text geometry, so label/value pairs on form documents (Schedule K-1 boxes, invoice fields, statement rows) stay associated instead of flattening into prose. It also reads filled AcroForm field values (fillable tax and corporate forms keep their answers in form fields, invisible to plain text extraction) and detects ruled-grid tables from the page's drawn lines.

Every imported file gets extraction metadata. ContextTrail tries to distinguish:

- clean indexed text
- usable text with warnings
- layout-sensitive forms or tables
- scanned/image-only PDFs that need OCR
- failed extraction

Scanned PDFs are not treated as empty evidence. They are marked as `needs_ocr` so the agent knows the source exists but was not opened well enough to trust.

## Confidence And Readiness

ContextTrail exposes readiness so agents know when to proceed and when to retry.

At runtime, the system tracks:

- retrieval confidence: did the search look grounded?
- adequate search: did it search the places where evidence should reasonably exist?
- slot readiness: is this workflow ingredient satisfied?
- pack readiness: is the whole Context Pack safe enough to use?

The important rule:

> A Context Pack is only ready if its required task-critical evidence is ready.

Missing context can be a valid finding when the search was adequate. Weak search is different: the agent should retry, ask the user for better anchors, or abstain.

## Example Tasks

For an insurance claim folder:

```text
Can we make a final coverage determination for this claim?
What required documents or facts are still missing?
Is the mitigation invoice ready for payment release?
Draft a follow-up asking only for the missing claim items.
Do not cite drafts or non-authoritative memos as final authority.
```

For a contract folder:

```text
Find the termination rights and notice requirements.
What payment obligations survive termination?
Which clauses create approval or compliance risk?
```

For an HR packet:

```text
Is this employee eligible for the requested benefit?
Which signed forms are missing?
What policy rule controls the decision?
```

For a sales account folder:

```text
Draft a follow-up after the latest customer call.
What objections, commitments, and next steps are supported by the notes?
Which stakeholder cares about price, security, or timeline?
```

## Development

```bash
npm install
npm run build
npm test
```

Useful checks:

```bash
npm run build:all
npm run eval:document-workflow:robust
npm run eval:document-format-stress
```

## Privacy

ContextTrail is designed to run locally. Imported document text is stored in the workspace under `.contexttrail/`. Do not commit that directory. The repo `.gitignore` excludes local ContextTrail state.

## License

MIT
