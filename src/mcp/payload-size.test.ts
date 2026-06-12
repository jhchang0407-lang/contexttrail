/**
 * MCP wire payload-size harness (PRD-0004 / S1).
 *
 * Measures the on-the-wire size of `retrieve_context_pack` responses across
 * representative queries, broken down by field.
 *
 * Scenarios run against a **static fixture corpus** (`tests/fixtures/docs/`).
 * Snapshotted. Proves `rendered_text` duplication and locks per-field shape.
 * Diffs here indicate a real change in retrieval output for these tiny inputs.
 * Set `CONTEXTTRAIL_PAYLOAD_REPORT=1` to print per-field byte tables.
 *
 * Bytes are bucketed to the nearest 100 to absorb scoring/float jitter while
 * preserving the order-of-magnitude that S2/S3 will move. Approx tokens use
 * a fixed bytes/4 heuristic — accurate enough for "is this big or small" but
 * not a substitute for a real tokenizer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandlers } from "./handlers.js";
import { openDb, closeDb } from "../store/db.js";
import { migrateFlatToSubstrate } from "../store/migrate.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tests",
  "fixtures",
  "docs",
);

const APPROX_TOKEN_DIVISOR = 4;
const BYTES_BUCKET = 100;

function writeBigConstraint(cwd: string, id: string) {
  const dir = join(cwd, ".contexttrail/cards");
  mkdirSync(dir, { recursive: true });
  const padding =
    "\n" + Array(2000).fill("Lorem ipsum dolor sit amet consectetur adipiscing elit.").join(" ");
  const md = `---
id: ${id}
type: constraint
title: "Test constraint ${id}"
authority: accepted
scope:
  layer: company
  company: acme
symbol_anchors: []
file_anchors: []
---

Critical invariant.${padding}
`;
  writeFileSync(join(dir, `${id}.md`), md);
}

function bucket(n: number): number {
  return Math.round(n / BYTES_BUCKET) * BYTES_BUCKET;
}

function bytesOf(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v ?? null), "utf8");
}

type FieldStat = {
  bytes: number;
  approx_tokens: number;
  count?: number;
  /** Set on `omitted` after PRD-0004 / S2: the underlying total before the
   *  top-N cap. `count` reflects what was actually shipped on the wire. */
  underlying_total?: number;
};

function fieldStat(v: unknown): FieldStat {
  const bytes = bytesOf(v);
  const stat: FieldStat = {
    bytes: bucket(bytes),
    approx_tokens: bucket(bytes / APPROX_TOKEN_DIVISOR),
  };
  if (Array.isArray(v)) stat.count = v.length;
  // omitted is now a summary object {total, by_reason, top, truncated}.
  if (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "total" in v &&
    "top" in v &&
    Array.isArray((v as { top: unknown[] }).top)
  ) {
    const o = v as { total: number; top: unknown[] };
    stat.count = o.top.length;
    stat.underlying_total = o.total;
  }
  return stat;
}

function breakdown(r: Record<string, unknown>) {
  const fields: Record<string, FieldStat> = {
    rendered_text: fieldStat(r.rendered_text),
    locked: fieldStat(r.locked),
    ranked: fieldStat(r.ranked),
    omitted: fieldStat(r.omitted),
    warnings: fieldStat(r.warnings),
    budget: fieldStat(r.budget),
  };
  if (r.explain !== undefined) fields.explain = fieldStat(r.explain);
  const warnings_kinds = Array.isArray(r.warnings)
    ? (r.warnings as Array<{ kind: string }>).map((w) => w.kind).sort()
    : [];
  return {
    total_bytes: bucket(bytesOf(r)),
    fields,
    warnings_kinds,
  };
}

function printTable(name: string, b: ReturnType<typeof breakdown>, opts: { force?: boolean } = {}): void {
  if (!opts.force && process.env.CONTEXTTRAIL_PAYLOAD_REPORT !== "1") return;
  const rows: string[] = [];
  rows.push(`\n=== ${name} ===`);
  rows.push(`total_bytes=${b.total_bytes}  warnings=${b.warnings_kinds.join(",") || "-"}`);
  rows.push(`field            bytes      approx_tokens   count   underlying_total`);
  for (const [k, v] of Object.entries(b.fields)) {
    rows.push(
      `${k.padEnd(16)} ${String(v.bytes).padStart(10)} ${String(v.approx_tokens).padStart(15)} ${
        v.count !== undefined ? String(v.count).padStart(7) : "      -"
      } ${v.underlying_total !== undefined ? String(v.underlying_total).padStart(17) : "                -"}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(rows.join("\n"));
}

describe("MCP payload-size harness (PRD-0004 / S1)", () => {
  describe("standard corpus", () => {
    let corpus: TestCorpus;
    let cwd: string;

    beforeAll(() => {
      corpus = createTestCorpus({ prefix: "contexttrail-payload-size-" });
      cwd = corpus.cwd;
      corpus.copyDocsFrom(FIXTURE_ROOT);
      corpus.importDocs();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      migrateFlatToSubstrate(db, { force: true });
      closeDb(db);
    });

    afterAll(() => corpus.cleanup());

    const SCENARIOS = [
      {
        name: "01-focused-refund-default",
        input: {
          task: "change RefundService.processRefund idempotency behavior",
          files: ["src/payments/refund.ts"],
          symbols: ["RefundService.processRefund"],
        },
      },
      {
        name: "02-focused-refund-small",
        input: {
          task: "change RefundService.processRefund idempotency behavior",
          files: ["src/payments/refund.ts"],
          symbols: ["RefundService.processRefund"],
          budget: "small" as const,
        },
      },
      {
        name: "03-broad-task-only",
        input: {
          task: "change RefundService.processRefund idempotency behavior",
        },
      },
      {
        name: "04-no-matches",
        input: {
          task: "xyz123 unrelated nonsense quantum chromodynamics",
        },
      },
    ];

    for (const s of SCENARIOS) {
      it(`baseline: ${s.name}`, async () => {
        const r = (await createHandlers({ cwd }).retrieve_context_pack(
          s.input,
        )) as unknown as Record<string, unknown>;
        const b = breakdown(r);
        printTable(s.name, b);
        expect(b).toMatchSnapshot();
      });
    }
  });

  describe("locked-overflow corpus", () => {
    let corpus: TestCorpus;
    let cwd: string;

    beforeAll(() => {
      corpus = createTestCorpus({ prefix: "contexttrail-payload-size-overflow-" });
      cwd = corpus.cwd;
      corpus.copyDocsFrom(FIXTURE_ROOT);
      corpus.importDocs();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      migrateFlatToSubstrate(db, { force: true });
      closeDb(db);
      writeBigConstraint(cwd, "C902");
      corpus.importCards();
    });

    afterAll(() => corpus.cleanup());

    it("baseline: 05-locked-overflow", async () => {
      const r = (await createHandlers({ cwd }).retrieve_context_pack({
        task: "make refunds idempotent",
        budget: "small",
      })) as unknown as Record<string, unknown>;
      const b = breakdown(r);
      printTable("05-locked-overflow", b);
      expect(b).toMatchSnapshot();
    });
  });

});
