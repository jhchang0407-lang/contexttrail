# Document Workflow Engine Direction

## Thesis

ContextTrail's stronger product wedge is document-heavy operational work, not
perfect code-file recall. The text/context engine is already much closer to
high-utility retrieval, while insurance, finance, HR, legal, sales, compliance,
and banking teams still spend large amounts of human time finding exact policy
sections, procedures, clauses, and form instructions across messy document
sets.

The product should be evaluated as an evidence-backed workflow engine:

1. Find the right source sections.
2. Extract task-relevant facts.
3. Fill or draft the required output.
4. Cite every value back to source text.
5. Report missing evidence and confidence.
6. Ask for clarification only when source evidence is insufficient.

## Immediate Separation

The code-context engine now lives under `src/code-engine/`. Compatibility
exports remain at the old paths for now, but new code should import from the
new folder. This keeps code-lane experimentation from shaping the default
document workflow architecture.

## First Evaluation Target

Build a "real paperwork" eval before UI work. The eval should answer whether
the current text engine can perform useful work on realistic non-developer
document sets.

A good first vertical is insurance because the task shape is concrete:

- Policy documents and endorsements.
- Claim or intake forms.
- Supporting evidence documents.
- A requested workflow such as "determine which form fields can be completed
  and cite the source for each value."

## Metrics

Do not score only retrieval overlap. Score workflow outcomes:

- **Section recall**: did we retrieve the source section that governs the
  answer or form field?
- **Field accuracy**: did the produced value match the gold value?
- **Citation validity**: does each value cite the exact source span that
  supports it?
- **Abstention quality**: when evidence is missing or conflicting, does the
  system ask instead of hallucinating?
- **Human-review load**: how many fields require review, and are they the
  right ones?

## Ingestion Risk

Current ingestion is markdown-first. Real customers will bring PDFs, DOCX,
spreadsheets, scanned forms, emails, exports, and nested folders. Before UI
investment, run an ingestion audit:

- Which formats can be normalized into markdown-like source text today?
- Which formats preserve headings, tables, page references, and form labels?
- Which formats lose layout or evidence anchors?
- Which inputs need OCR or table extraction before chunking?

The goal is not broad file support immediately. The goal is to prove one
vertical workflow end-to-end with enough source fidelity that citations and
field-level evidence are trustworthy.

## Next Slice

Create a small fixture corpus with:

- 5-10 realistic source documents.
- 2-3 workflow tasks.
- Gold answers as structured fields with required citations.
- A runner that imports the corpus, retrieves context, executes the workflow
  prompt, and scores field accuracy plus citation validity.

Only after that should the UI be designed around upload, review, evidence
inspection, and human correction.
