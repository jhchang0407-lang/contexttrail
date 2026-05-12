/**
 * THO-134 / PRD-0013 V2.5.1 — failure-layer classification.
 *
 * `classifyCriticalSourceMiss` answers a single question: "for an expected
 * critical source that did not appear in the displayed top-3, which layer of
 * the retrieval stack lost it?". The answer must distinguish corpus-import
 * failures from candidate-generation failures from threshold/budget/display
 * failures, because each one points at a different remediation.
 */
import { describe, it, expect } from "vitest";
import {
  classifyCriticalSourceMiss,
  classifyCaseFailureLayer,
  caseFailureLayer,
  type CaseFailureLayerObservation,
} from "./failure-layer.js";

const baseSignals = {
  imported: true as boolean | null,
  candidate_rank: 1 as number | null,
  has_above_threshold_chunk: true,
  has_packed_chunk: true,
  in_displayed_top3: true,
};

describe("classifyCriticalSourceMiss", () => {
  it("returns 'none' when the source is packed and displayed in top-3", () => {
    expect(classifyCriticalSourceMiss(baseSignals)).toBe("none");
  });

  it("classifies 'not_imported' before any retrieval-stage layer", () => {
    expect(
      classifyCriticalSourceMiss({
        ...baseSignals,
        imported: false,
        candidate_rank: null,
        has_above_threshold_chunk: false,
        has_packed_chunk: false,
        in_displayed_top3: false,
      }),
    ).toBe("not_imported");
  });

  it("classifies 'absent_from_candidates' when imported but no chunks reached candidate set", () => {
    expect(
      classifyCriticalSourceMiss({
        ...baseSignals,
        imported: true,
        candidate_rank: null,
        has_above_threshold_chunk: false,
        has_packed_chunk: false,
        in_displayed_top3: false,
      }),
    ).toBe("absent_from_candidates");
  });

  it("classifies 'outside_top50' when candidate rank > 50", () => {
    expect(
      classifyCriticalSourceMiss({
        ...baseSignals,
        candidate_rank: 51,
        has_above_threshold_chunk: false,
        has_packed_chunk: false,
        in_displayed_top3: false,
      }),
    ).toBe("outside_top50");
  });

  it("classifies 'below_threshold' when in top-50 but no chunk survived threshold", () => {
    expect(
      classifyCriticalSourceMiss({
        ...baseSignals,
        candidate_rank: 7,
        has_above_threshold_chunk: false,
        has_packed_chunk: false,
        in_displayed_top3: false,
      }),
    ).toBe("below_threshold");
  });

  it("classifies 'pack_loss' when above threshold but no packed chunk", () => {
    expect(
      classifyCriticalSourceMiss({
        ...baseSignals,
        candidate_rank: 3,
        has_above_threshold_chunk: true,
        has_packed_chunk: false,
        in_displayed_top3: false,
      }),
    ).toBe("pack_loss");
  });

  it("classifies 'display_loss' when packed but not in displayed top-3", () => {
    expect(
      classifyCriticalSourceMiss({
        ...baseSignals,
        in_displayed_top3: false,
      }),
    ).toBe("display_loss");
  });

  it("classifies a case as 'none' when every critical source is in displayed top-3", () => {
    const obs: CaseFailureLayerObservation = classifyCaseFailureLayer({
      sources: [
        {
          source_path: "docs/a.md",
          signals: { ...baseSignals },
        },
        {
          source_path: "docs/b.md",
          signals: { ...baseSignals, candidate_rank: 2 },
        },
      ],
    });
    expect(obs.layer).toBe("none");
    expect(obs.per_source.every((p) => p.layer === "none")).toBe(true);
  });

  it("picks the worst (highest-precedence) miss as the dominant case layer", () => {
    // Precedence order is the FAILURE_LAYERS array (excluding 'none'):
    // not_imported > absent > outside_top50 > below_threshold > pack > display.
    const obs = classifyCaseFailureLayer({
      sources: [
        {
          source_path: "docs/imported.md",
          signals: {
            ...baseSignals,
            in_displayed_top3: false, // display_loss
          },
        },
        {
          source_path: "docs/missing.md",
          signals: {
            ...baseSignals,
            imported: false,
            candidate_rank: null,
            has_above_threshold_chunk: false,
            has_packed_chunk: false,
            in_displayed_top3: false,
          },
        },
      ],
    });
    expect(obs.layer).toBe("not_imported");
    expect(obs.per_source.find((p) => p.source_path === "docs/missing.md")?.layer).toBe(
      "not_imported",
    );
    expect(obs.per_source.find((p) => p.source_path === "docs/imported.md")?.layer).toBe(
      "display_loss",
    );
  });

  it("derives per-source signals from raw retrieval state via caseFailureLayer", () => {
    // happy path: the only critical source is in displayed top-3.
    const obs = caseFailureLayer({
      must_include_sources: ["docs/a.md"],
      candidate_rank_by_source: new Map([["docs/a.md", 1]]),
      above_threshold_sources: new Set(["docs/a.md"]),
      packed_sources: new Set(["docs/a.md"]),
      displayed_top3_sources: new Set(["docs/a.md"]),
      imported_sources: null,
    });
    expect(obs.layer).toBe("none");
  });

  it("caseFailureLayer surfaces 'not_imported' when import inventory is provided and excludes the source", () => {
    const obs = caseFailureLayer({
      must_include_sources: ["wiki/optionality.md"],
      candidate_rank_by_source: new Map(),
      above_threshold_sources: new Set(),
      packed_sources: new Set(),
      displayed_top3_sources: new Set(),
      imported_sources: new Set(["docs/index.md"]),
    });
    expect(obs.layer).toBe("not_imported");
  });

  it("caseFailureLayer surfaces 'pack_loss' when above threshold but not packed", () => {
    const obs = caseFailureLayer({
      must_include_sources: ["docs/c.md"],
      candidate_rank_by_source: new Map([["docs/c.md", 4]]),
      above_threshold_sources: new Set(["docs/c.md"]),
      packed_sources: new Set(),
      displayed_top3_sources: new Set(),
      imported_sources: null,
    });
    expect(obs.layer).toBe("pack_loss");
  });

  it("caseFailureLayer treats null imported_sources as inventory-unavailable (no not_imported)", () => {
    const obs = caseFailureLayer({
      must_include_sources: ["docs/d.md"],
      candidate_rank_by_source: new Map(),
      above_threshold_sources: new Set(),
      packed_sources: new Set(),
      displayed_top3_sources: new Set(),
      imported_sources: null,
    });
    expect(obs.layer).toBe("absent_from_candidates");
  });

  it("treats null import inventory as imported (THO-135 will refine)", () => {
    expect(
      classifyCriticalSourceMiss({
        ...baseSignals,
        imported: null,
        candidate_rank: null,
      }),
    ).toBe("absent_from_candidates");
  });
});
