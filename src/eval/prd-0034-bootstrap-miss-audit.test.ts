import { describe, expect, it } from "vitest";
import {
  classifyChunkMiss,
  loadMissAuditFixture,
  renderMissAuditTable,
  summarizeMissAudit,
} from "./prd-0034-bootstrap-miss-audit.js";

describe("prd-0034 bootstrap miss audit — classification", () => {
  it("classifies as hit when ground truth and regex agree on a candidate", () => {
    const row = classifyChunkMiss({
      chunk_id: "ch-001",
      chunk_shape: "operational_procedure",
      ground_truth: "candidate",
      regex: { candidates: 1, clarifications: 0 },
    });
    expect(row.classification).toBe("hit");
    expect(row.regex_produced).toBe("candidate");
  });

  it("classifies as hit when ground truth and regex agree on a clarification", () => {
    const row = classifyChunkMiss({
      chunk_id: "ch-002",
      chunk_shape: "decision_rationale",
      ground_truth: "clarification",
      regex: { candidates: 0, clarifications: 1 },
    });
    expect(row.classification).toBe("hit");
  });

  it("classifies as hit when ground truth says nothing and regex produced nothing", () => {
    const row = classifyChunkMiss({
      chunk_id: "ch-003",
      chunk_shape: "parameter_documentation",
      ground_truth: "nothing",
      regex: { candidates: 0, clarifications: 0 },
    });
    expect(row.classification).toBe("hit");
  });

  it("classifies as missed_candidate when ground truth has a candidate but regex produced nothing", () => {
    const row = classifyChunkMiss({
      chunk_id: "ch-004",
      chunk_shape: "operational_procedure",
      ground_truth: "candidate",
      regex: { candidates: 0, clarifications: 0 },
    });
    expect(row.classification).toBe("missed_candidate");
  });

  it("classifies as missed_clarification when ground truth has a clarification but regex produced nothing", () => {
    const row = classifyChunkMiss({
      chunk_id: "ch-005",
      chunk_shape: "architectural_narrative",
      ground_truth: "clarification",
      regex: { candidates: 0, clarifications: 0 },
    });
    expect(row.classification).toBe("missed_clarification");
  });

  it("classifies as spurious when ground truth says nothing but regex produced a candidate", () => {
    const row = classifyChunkMiss({
      chunk_id: "ch-006",
      chunk_shape: "mixed_content",
      ground_truth: "nothing",
      regex: { candidates: 1, clarifications: 0 },
    });
    expect(row.classification).toBe("spurious");
  });

  it("classifies as spurious when ground truth says nothing but regex produced a clarification", () => {
    const row = classifyChunkMiss({
      chunk_id: "ch-007",
      chunk_shape: "mixed_content",
      ground_truth: "nothing",
      regex: { candidates: 0, clarifications: 1 },
    });
    expect(row.classification).toBe("spurious");
  });

  it("classifies as hedged when ground truth has a candidate but regex produced only a clarification", () => {
    const row = classifyChunkMiss({
      chunk_id: "ch-008",
      chunk_shape: "decision_rationale",
      ground_truth: "candidate",
      regex: { candidates: 0, clarifications: 1 },
    });
    expect(row.classification).toBe("hedged");
  });

  it("treats a clarification ground-truth + regex candidate as hit (regex produced stronger output)", () => {
    const row = classifyChunkMiss({
      chunk_id: "ch-009",
      chunk_shape: "operational_procedure",
      ground_truth: "clarification",
      regex: { candidates: 1, clarifications: 0 },
    });
    expect(row.classification).toBe("hit");
  });
});

describe("prd-0034 bootstrap miss audit — summary + proceed gate", () => {
  it("counts each classification and reports unique chunk_shapes among the miss set", () => {
    const rows = [
      { chunk_id: "a", chunk_shape: "operational_procedure", ground_truth: "candidate", regex: { candidates: 0, clarifications: 0 }, regex_produced: "nothing", classification: "missed_candidate" },
      { chunk_id: "b", chunk_shape: "architectural_narrative", ground_truth: "candidate", regex: { candidates: 0, clarifications: 0 }, regex_produced: "nothing", classification: "missed_candidate" },
      { chunk_id: "c", chunk_shape: "decision_rationale", ground_truth: "clarification", regex: { candidates: 0, clarifications: 0 }, regex_produced: "nothing", classification: "missed_clarification" },
      { chunk_id: "d", chunk_shape: "decision_rationale", ground_truth: "candidate", regex: { candidates: 0, clarifications: 1 }, regex_produced: "clarification", classification: "hedged" },
      { chunk_id: "e", chunk_shape: "operational_procedure", ground_truth: "candidate", regex: { candidates: 1, clarifications: 0 }, regex_produced: "candidate", classification: "hit" },
      { chunk_id: "f", chunk_shape: "mixed_content", ground_truth: "nothing", regex: { candidates: 1, clarifications: 0 }, regex_produced: "candidate", classification: "spurious" },
    ] as const;
    const summary = summarizeMissAudit([...rows]);
    expect(summary.total).toBe(6);
    expect(summary.counts).toEqual({
      hit: 1,
      missed_candidate: 2,
      missed_clarification: 1,
      hedged: 1,
      spurious: 1,
    });
    expect(summary.miss_set_size).toBe(4); // missed_candidate + missed_clarification + hedged
    expect([...summary.miss_set_shapes].sort()).toEqual([
      "architectural_narrative",
      "decision_rationale",
      "operational_procedure",
    ]);
  });

  it("computes proceed=true when misses >= 8 and shapes >= 3", () => {
    const rows = Array.from({ length: 8 }).map((_, i) => ({
      chunk_id: `m-${i}`,
      chunk_shape: ["operational_procedure", "architectural_narrative", "decision_rationale"][i % 3]!,
      ground_truth: "candidate",
      regex: { candidates: 0, clarifications: 0 },
      regex_produced: "nothing",
      classification: "missed_candidate",
    })) as const;
    const summary = summarizeMissAudit([...rows]);
    expect(summary.proceed_condition_met).toBe(true);
    expect(summary.proceed_reason).toMatch(/proceed/i);
  });

  it("computes proceed=false when misses < 8 even with many shapes", () => {
    const rows = Array.from({ length: 5 }).map((_, i) => ({
      chunk_id: `m-${i}`,
      chunk_shape: ["operational_procedure", "architectural_narrative", "decision_rationale", "parameter_documentation", "mixed_content"][i]!,
      ground_truth: "candidate",
      regex: { candidates: 0, clarifications: 0 },
      regex_produced: "nothing",
      classification: "missed_candidate",
    })) as const;
    const summary = summarizeMissAudit([...rows]);
    expect(summary.proceed_condition_met).toBe(false);
    expect(summary.proceed_reason).toMatch(/falsified|insufficient/i);
  });

  it("computes proceed=false when 8 misses but only 2 chunk shapes", () => {
    const rows = Array.from({ length: 10 }).map((_, i) => ({
      chunk_id: `m-${i}`,
      chunk_shape: ["operational_procedure", "architectural_narrative"][i % 2]!,
      ground_truth: "candidate",
      regex: { candidates: 0, clarifications: 0 },
      regex_produced: "nothing",
      classification: "missed_candidate",
    })) as const;
    const summary = summarizeMissAudit([...rows]);
    expect(summary.proceed_condition_met).toBe(false);
    expect(summary.proceed_reason).toMatch(/falsified|insufficient/i);
  });
});

describe("prd-0034 bootstrap miss audit — fixture loader", () => {
  it("loads the canonical fixture and runs regex on each chunk producing 20 rows", () => {
    const rows = loadMissAuditFixture();
    expect(rows.length).toBe(20);
    // Each row's regex_produced field is one of nothing | candidate | clarification | candidate+clarification
    for (const row of rows) {
      expect(row.regex_produced).toMatch(/^(nothing|candidate|clarification)$/);
      expect(row.classification).toMatch(/^(hit|missed_candidate|missed_clarification|hedged|spurious)$/);
    }
  });

  it("fixture spans at least 5 distinct chunk shapes (per slice-34.1 requirement)", () => {
    const rows = loadMissAuditFixture();
    const shapes = new Set(rows.map((r) => r.chunk_shape));
    expect(shapes.size).toBeGreaterThanOrEqual(5);
  });
});

describe("prd-0034 bootstrap miss audit — rendering", () => {
  it("renders a markdown table with the expected header columns", () => {
    const md = renderMissAuditTable([
      {
        chunk_id: "ch-001",
        chunk_shape: "operational_procedure",
        ground_truth: "candidate",
        regex: { candidates: 1, clarifications: 0 },
        regex_produced: "candidate",
        classification: "hit",
      },
    ]);
    expect(md).toContain("chunk_id");
    expect(md).toContain("chunk_shape");
    expect(md).toContain("ground_truth");
    expect(md).toContain("regex_produced");
    expect(md).toContain("classification");
    expect(md).toContain("ch-001");
  });
});
