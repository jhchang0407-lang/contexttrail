# Roadmap

## Phase 1: Focus The Product Surface

- Archive old code-context docs.
- Keep a small active docs surface.
- Treat the document-workflow eval as the primary product feedback loop.

## Phase 2: Make The Eval Useful

- Expand the insurance fixture set.
- Add observation output for every miss.
- Add workflow-output scoring against saved outputs.
- Add a first automated workflow-output runner.

## Phase 3: Improve The Text Engine

- Diagnose evidence misses from the insurance fixtures.
- Improve adjacent-section and sibling-section retrieval for paperwork.
- Strengthen citation validity and evidence span matching.
- Add abstention behavior to workflow execution.

## Phase 4: Add File Support Deliberately

Add formats in this order unless eval evidence says otherwise:

1. DOCX.
2. PDF with embedded text.
3. XLSX and CSV.
4. Email exports.
5. Scanned PDFs and OCR.

Each format must preserve enough source identity, heading/table structure, and
evidence anchors for citations to remain trustworthy.

## Phase 5: Build The UI Around Review

Only after the eval is meaningful, build a non-terminal workflow surface:

- Corpus upload.
- Workflow selection.
- Field review.
- Evidence inspection.
- Missing/conflicting evidence prompts.
- Human correction capture.

The UI should make review fast and trustworthy, not hide the evidence behind a
chat transcript.
