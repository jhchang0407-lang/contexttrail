/**
 * End-to-end coverage for entity-shaped id anchors (business identifiers
 * like CLM-2026-0412) — PRD: id anchors are inferred from the task text
 * alone, with NO files/symbols/routes params and no new wire inputs.
 *
 * Index side: `contexttrail import` → persistChunkWithAnchors →
 * extractMentions → code_anchors rows with kind "id".
 * Query side: compileQueryScopes mines the task text with the same pattern
 * and resolves through the standard anchor lookup, so a recognized id
 * produces query_mode=anchored exactly like a supplied file anchor.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { createHandlers } from "./handlers.js";
import { schemas } from "./schemas.js";
import { openDb, closeDb } from "../store/db.js";
import { migrateFlatToSubstrate } from "../store/migrate.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

const CLAIM_DOC = `---
scope:
  layer: module
  project: claims
  module: intake
---

# Claim intake file

Claim CLM-2026-0412 was filed by the policyholder after the warehouse
incident. The adjuster review for CLM-2026-0412 is complete and the
remaining step is the close-out checklist.

## Close-out checklist

Before we close out a claim the reserve must be released, the payment
reconciled, and the final letter sent to the policyholder.
`;

const DISTRACTOR_BILLING = `---
scope:
  layer: module
  project: billing
  module: invoices
---

# Billing overview

Invoices are generated at the end of each cycle and reconciled against the
ledger. The current pipeline was last revised on 2026-06-12 when version
1.2.3 of the billing service shipped.

## Closing the books

To close out the quarter, finance reconciles every open invoice and posts
the summary entries to the general ledger.
`;

const DISTRACTOR_ONBOARDING = `---
scope:
  layer: module
  project: support
  module: onboarding
---

# Onboarding guide

New adjusters shadow a senior reviewer for their first week. The checklist
covers claim handling basics, the escalation matrix, and the close-out
workflow used across the team.

## Escalations

Escalate anything involving litigation or amounts above the authority limit
to the regional lead.
`;

function setupCorpus(prefix: string): TestCorpus {
  const corpus = createTestCorpus({ prefix });
  corpus.writeDoc("docs/claims/claim-file.md", CLAIM_DOC);
  corpus.writeDoc("docs/billing/billing-overview.md", DISTRACTOR_BILLING);
  corpus.writeDoc("docs/support/onboarding-guide.md", DISTRACTOR_ONBOARDING);
  corpus.importDocs();
  return corpus;
}

describe("id anchors end-to-end (flat read model)", () => {
  let corpus: TestCorpus;
  let cwd: string;

  beforeAll(() => {
    corpus = setupCorpus("contexttrail-id-anchors-flat-");
    cwd = corpus.cwd;
  });
  afterAll(() => corpus.cleanup());

  it("indexes the claim id (and only the claim id) as kind=id at import time", () => {
    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    try {
      const rows = db
        .prepare("SELECT DISTINCT value FROM code_anchors WHERE kind='id'")
        .all() as { value: string }[];
      // Dates (2026-06-12) and semver (1.2.3) in the distractors must NOT
      // have been indexed as ids.
      expect(rows.map((r) => r.value)).toEqual(["CLM-2026-0412"]);
    } finally {
      closeDb(db);
    }
  });

  it("task containing the id, with NO files/symbols/routes → anchored, claim doc is top source", async () => {
    const r = await createHandlers({ cwd }).retrieve_context_pack({
      task: "can we close out CLM-2026-0412",
      explain: true,
    });
    const v = schemas.retrieve_context_pack.output.safeParse(r);
    expect(v.success).toBe(true);

    expect(r.query_mode).toBe("anchored");
    expect(r.ranked.length).toBeGreaterThan(0);
    expect(r.ranked[0]!.source_path).toContain("claim-file.md");

    const compiled = r.explain!.query_compilation;
    expect(compiled.query_mode).toBe("anchored");
    const idAnchor = compiled.anchors.find((a) => a.anchor.kind === "id");
    expect(idAnchor).toBeDefined();
    expect(idAnchor!.anchor.value).toBe("CLM-2026-0412");
    expect(idAnchor!.recognition).not.toBe("none");
  });

  it("case-folded task id (clm-2026-0412) still anchors", async () => {
    const r = await createHandlers({ cwd }).retrieve_context_pack({
      task: "can we close out clm-2026-0412",
    });
    expect(r.query_mode).toBe("anchored");
    expect(r.ranked[0]!.source_path).toContain("claim-file.md");
  });

  it("negative: a date in the task does NOT become an id anchor", async () => {
    const r = await createHandlers({ cwd }).retrieve_context_pack({
      task: "summarize what changed on 2026-06-12",
      explain: true,
    });
    expect(r.query_mode).toBe("unanchored");
    expect(
      r.explain!.query_compilation.anchors.filter((a) => a.anchor.kind === "id"),
    ).toEqual([]);
  });

  it("negative: an id-shaped token the corpus has never seen stays unanchored, not signal_empty", async () => {
    const r = await createHandlers({ cwd }).retrieve_context_pack({
      task: "can we close out CLM-9999-0001",
      explain: true,
    });
    expect(r.query_mode).toBe("unanchored");
    expect(r.warnings.map((w) => w.kind)).not.toContain("anchors_unrecognized");
    expect(r.explain!.query_compilation.anchors).toEqual([]);
  });
});

describe("id anchors end-to-end (substrate read model)", () => {
  let corpus: TestCorpus;
  let cwd: string;

  beforeAll(() => {
    corpus = setupCorpus("contexttrail-id-anchors-substrate-");
    cwd = corpus.cwd;
    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    migrateFlatToSubstrate(db, { force: true });
    closeDb(db);
  });
  afterAll(() => corpus.cleanup());

  it("task containing the id → anchored with the claim doc on top via code_anchors_v2", async () => {
    const r = await createHandlers({ cwd }).retrieve_context_pack({
      task: "can we close out CLM-2026-0412",
      explain: true,
    });
    const v = schemas.retrieve_context_pack.output.safeParse(r);
    expect(v.success).toBe(true);
    expect(r.query_mode).toBe("anchored");
    expect(r.ranked[0]!.source_path).toContain("claim-file.md");
    const idAnchor = r.explain!.query_compilation.anchors.find(
      (a) => a.anchor.kind === "id",
    );
    expect(idAnchor).toBeDefined();
    expect(idAnchor!.recognition).not.toBe("none");
  });

  it("negative: date-only task stays unanchored on substrate too", async () => {
    const r = await createHandlers({ cwd }).retrieve_context_pack({
      task: "summarize what changed on 2026-06-12",
    });
    expect(r.query_mode).toBe("unanchored");
  });
});

describe("id anchors — discrimination gate end-to-end", () => {
  let corpus: TestCorpus;
  let cwd: string;

  beforeAll(() => {
    corpus = createTestCorpus({ prefix: "contexttrail-id-anchors-boilerplate-" });
    cwd = corpus.cwd;
    // The same case number stamped on every document in the packet — like a
    // claim file where each doc carries the claim number. Even though every
    // doc is scoped, that id spans the whole corpus, carries no routing
    // signal, and must NOT flip queries into anchored mode.
    for (const [name, topic] of [
      ["intake", "Intake summary for the case"],
      ["estimate", "Repair estimate details"],
      ["ledger", "Payment ledger entries"],
      ["notes", "Field notes from inspection"],
    ] as const) {
      corpus.writeDoc(
        `docs/${name}.md`,
        `---
scope:
  layer: module
  project: casework
  module: ${name}
---

# ${topic}

Case REF-2026-7741 ${topic.toLowerCase()} recorded for the file.
`,
      );
    }
    corpus.importDocs();
  });
  afterAll(() => corpus.cleanup());

  it("an id present in every source is boilerplate — query stays unanchored", async () => {
    const r = await createHandlers({ cwd }).retrieve_context_pack({
      task: "summarize payments for REF-2026-7741",
      explain: true,
    });
    expect(r.query_mode).toBe("unanchored");
    expect(r.explain!.query_compilation.anchors).toEqual([]);
  });
});

describe("id anchors — scope-less corpora stay conservative end-to-end", () => {
  let corpus: TestCorpus;
  let cwd: string;

  beforeAll(() => {
    corpus = createTestCorpus({ prefix: "contexttrail-id-anchors-scopeless-" });
    cwd = corpus.cwd;
    // No frontmatter scopes anywhere. An inferred id binding here cannot
    // produce a scope, so anchored-mode scoring would have nothing to
    // preserve — the inference is dropped and retrieval behaves exactly as
    // it did before id anchors existed.
    corpus.writeDoc(
      "docs/ticket-log.md",
      "# Ticket log\n\nTicket TCK-2026-991 covers the export regression reported by the pilot customer.\n",
    );
    corpus.writeDoc(
      "docs/runbook.md",
      "# Export runbook\n\nThe export pipeline retries three times before paging the on-call engineer.\n",
    );
    corpus.importDocs();
  });
  afterAll(() => corpus.cleanup());

  it("a discriminating id on a scope-less corpus does not flip anchored", async () => {
    const r = await createHandlers({ cwd }).retrieve_context_pack({
      task: "status of TCK-2026-991",
      explain: true,
    });
    expect(r.query_mode).toBe("unanchored");
    expect(r.explain!.query_compilation.anchors).toEqual([]);
  });
});
