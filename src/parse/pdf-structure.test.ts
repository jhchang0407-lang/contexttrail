import { describe, expect, it } from "vitest";
import {
  assemblePdfLines,
  buildPdfBlocks,
  pdfPlainTextLines,
  type PdfTextItem,
} from "./pdf-structure.js";

function item(
  str: string,
  x: number,
  y: number,
  overrides: Partial<PdfTextItem> = {},
): PdfTextItem {
  return {
    str,
    x,
    y,
    width: overrides.width ?? str.length * 5,
    height: overrides.height ?? 10,
    ...overrides,
  };
}

describe("assemblePdfLines", () => {
  it("clusters items into lines by y and orders cells by x", () => {
    const lines = assemblePdfLines([
      item("12,345", 300, 700),
      item("1 Ordinary business income", 72, 700),
      item("Heading", 72, 680),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.cells).toEqual(["Heading"]);
    expect(lines[1]!.cells).toEqual(["1 Ordinary business income", "12,345"]);
  });

  it("treats wide whitespace items as cell separators, not text", () => {
    // pdf.js emits the gutter between a form label and its value as a
    // standalone whitespace item whose width covers the gap.
    const lines = assemblePdfLines([
      item("Ending capital", 72, 700, { width: 70 }),
      item(" ", 142, 700, { width: 158 }),
      item("62,345", 300, 700),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.cells).toEqual(["Ending capital", "62,345"]);
  });

  it("joins small gaps with a space and kerning-sized gaps without one", () => {
    const lines = assemblePdfLines([
      item("Net", 72, 700, { width: 15 }),
      item("income", 90, 700, { width: 30 }), // 3pt gap → word space
      item("(lo", 122.8, 700, { width: 12 }), // 2.8pt gap → word space
      item("ss)", 135.2, 700, { width: 12 }), // 0.4pt gap → kerning, no space
    ]);
    expect(lines[0]!.cells).toEqual(["Net income (loss)"]);
  });

  it("keeps slightly offset baselines (superscripts) on one line and splits real lines", () => {
    const lines = assemblePdfLines([
      item("Total", 72, 700),
      item("(1)", 100, 697, { height: 6 }),
      item("Next line", 72, 714),
    ]);
    expect(lines.map((line) => line.cells.join(" "))).toEqual(["Total (1)", "Next line"]);
  });

  it("drops whitespace-only lines", () => {
    expect(assemblePdfLines([item("   ", 72, 700, { width: 40 })])).toEqual([]);
  });
});

describe("pdfPlainTextLines", () => {
  it("joins cells with spaces for layout-risk scoring", () => {
    const pages = [
      { num: 1, lines: assemblePdfLines([
        item("Label", 72, 700),
        item("Value", 300, 700),
      ]) },
    ];
    expect(pdfPlainTextLines(pages)).toBe("Label Value");
  });
});

describe("buildPdfBlocks", () => {
  it("turns two-cell lines into key_value blocks with page numbers", () => {
    const result = buildPdfBlocks({
      pages: [{
        num: 2,
        lines: assemblePdfLines([
          item("1 Ordinary business income (loss)", 72, 700),
          item("12,345", 300, 700),
          item("2 Net rental real estate income (loss)", 72, 714),
          item("-1,200", 300, 714),
        ]),
      }],
      fields: [],
      tables: [],
    });
    expect(result.blocks).toEqual([
      { type: "key_value", label: "1 Ordinary business income (loss)", value: "12,345", page: 2 },
      { type: "key_value", label: "2 Net rental real estate income (loss)", value: "-1,200", page: 2 },
    ]);
    expect(result.summary.key_value_count).toBe(2);
  });

  it("detects schedule/part headings", () => {
    const result = buildPdfBlocks({
      pages: [{
        num: 1,
        lines: assemblePdfLines([
          item("Schedule K-1", 72, 80),
          item("Part III Partner's Share of Current Year Income", 72, 100),
          item("Sections of this paragraph are plain prose, not headings.", 72, 114),
        ]),
      }],
      fields: [],
      tables: [],
    });
    expect(result.blocks[0]).toEqual({ type: "heading", level: 1, text: "Schedule K-1", page: 1 });
    expect(result.blocks[1]).toMatchObject({ type: "heading", level: 2 });
    expect(result.blocks[2]).toMatchObject({ type: "paragraph" });
    expect(result.summary.heading_count).toBe(2);
  });

  it("does not treat 'Schedule of' or trailing-period lines as headings", () => {
    const result = buildPdfBlocks({
      pages: [{
        num: 1,
        lines: assemblePdfLines([
          item("Schedule of fees", 72, 80),
          item("Part II applies to renewals.", 72, 94),
        ]),
      }],
      fields: [],
      tables: [],
    });
    expect(result.blocks.every((block) => block.type === "paragraph")).toBe(true);
  });

  it("splits dotted leader lines into key_value blocks", () => {
    const result = buildPdfBlocks({
      pages: [{
        num: 1,
        lines: assemblePdfLines([
          item("Total distributions . . . . . 9,876", 72, 700),
        ]),
      }],
      fields: [],
      tables: [],
    });
    expect(result.blocks).toEqual([
      { type: "key_value", label: "Total distributions", value: "9,876", page: 1 },
    ]);
  });

  it("keeps two-column prose as paragraphs instead of fake key-values", () => {
    const result = buildPdfBlocks({
      pages: [{
        num: 1,
        lines: assemblePdfLines([
          item("the left column continues its sentence", 72, 700),
          item("while the right column narrates separately", 320, 700),
        ]),
      }],
      fields: [],
      tables: [],
    });
    expect(result.blocks).toEqual([
      {
        type: "paragraph",
        text: "the left column continues its sentence while the right column narrates separately",
        page: 1,
      },
    ]);
    expect(result.summary.key_value_count).toBe(0);
  });

  it("groups consecutive multi-cell lines into a table and leaves a lone row as text", () => {
    const result = buildPdfBlocks({
      pages: [{
        num: 1,
        lines: assemblePdfLines([
          item("Quarter", 72, 700), item("Revenue", 220, 700), item("Margin", 380, 700),
          item("Q1", 72, 714), item("4,000", 220, 714), item("31%", 380, 714),
          item("Prose resumes here after the table region ends entirely.", 72, 760),
          item("Lone", 72, 774), item("row", 220, 774), item("cells", 380, 774),
        ]),
      }],
      fields: [],
      tables: [],
    });
    expect(result.blocks[0]).toEqual({
      type: "table",
      rows: [["Quarter", "Revenue", "Margin"], ["Q1", "4,000", "31%"]],
      page: 1,
    });
    expect(result.blocks[1]).toMatchObject({ type: "paragraph" });
    expect((result.blocks[1] as { text: string }).text).toContain("Prose resumes");
    expect(result.blocks[2]).toEqual({ type: "paragraph", text: "Lone row cells", page: 1 });
    expect(result.summary.table_count).toBe(1);
    expect(result.summary.table_row_count).toBe(2);
  });

  it("splits paragraphs on large vertical gaps", () => {
    const result = buildPdfBlocks({
      pages: [{
        num: 1,
        lines: assemblePdfLines([
          item("First paragraph line one.", 72, 700),
          item("First paragraph line two.", 72, 713),
          item("Second paragraph after a visual break.", 72, 760),
        ]),
      }],
      fields: [],
      tables: [],
    });
    expect(result.blocks).toHaveLength(2);
    expect((result.blocks[0] as { text: string }).text).toBe(
      "First paragraph line one.\nFirst paragraph line two.",
    );
  });

  it("drops noise lines such as Docusign banners and rule artifacts", () => {
    const result = buildPdfBlocks({
      pages: [{
        num: 1,
        lines: assemblePdfLines([
          item("Docusign Envelope ID: ABCD-1234", 72, 60),
          item("----------------", 72, 80),
          item("Real content survives.", 72, 100),
        ]),
      }],
      fields: [],
      tables: [],
    });
    expect(result.blocks).toEqual([
      { type: "paragraph", text: "Real content survives.", page: 1 },
    ]);
  });

  it("emits ruled tables and suppresses the text lines they already cover", () => {
    const result = buildPdfBlocks({
      pages: [{
        num: 1,
        lines: assemblePdfLines([
          item("Beginning capital", 80, 680), item("50,000", 230, 680),
          item("Ending capital", 80, 630), item("62,345", 230, 630),
          item("Narrative outside the grid.", 72, 760),
        ]),
      }],
      fields: [],
      tables: [{
        page: 1,
        rows: [["Beginning capital", "50,000"], ["Ending capital", "62,345"]],
      }],
    });
    const types = result.blocks.map((block) => block.type);
    expect(types).toEqual(["paragraph", "table"]);
    expect((result.blocks[0] as { text: string }).text).toBe("Narrative outside the grid.");
    expect(result.summary.table_count).toBe(1);
  });

  it("rejects degenerate ruled tables", () => {
    const result = buildPdfBlocks({
      pages: [{ num: 1, lines: assemblePdfLines([item("Prose.", 72, 700)]) }],
      fields: [],
      tables: [
        { page: 1, rows: [["only one row", "x"]] },
        { page: 1, rows: [["a"], ["b"]] },
        { page: 1, rows: [["", ""], ["", ""]] },
      ],
    });
    expect(result.blocks.map((block) => block.type)).toEqual(["paragraph"]);
    expect(result.summary.table_count).toBe(0);
  });

  it("appends deduplicated form fields per page, including pages without text", () => {
    const result = buildPdfBlocks({
      pages: [{ num: 1, lines: assemblePdfLines([item("Cover page", 72, 700)]) }],
      fields: [
        { page: 1, label: "Final K-1", value: "checked" },
        { page: 1, label: "Final K-1", value: "checked" },
        { page: 2, label: "", value: "45.5%" },
      ],
      tables: [],
    });
    expect(result.blocks).toEqual([
      { type: "paragraph", text: "Cover page", page: 1 },
      { type: "key_value", label: "Final K-1", value: "checked", page: 1 },
      { type: "key_value", label: "Form field", value: "45.5%", page: 2 },
    ]);
    expect(result.summary.form_field_count).toBe(2);
  });
});
