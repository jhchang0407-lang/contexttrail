import { describe, expect, it } from "vitest";
import { renderCriticalSourceDiagnosis } from "./critical-source-diagnosis.js";
import type { Slice0Report } from "./slice0/report.js";

describe("renderCriticalSourceDiagnosis", () => {
  it("renders the actionable layer summaries without the full Slice 0 report", () => {
    const report = {
      schema_version: 1,
      generated_at: "2026-05-10T00:00:00.000Z",
      case_count: 2,
      answerable_cases: 2,
      unsupported_cases: 0,
      repos: ["demo"],
      metrics: {
        actual_top_source_top1_acceptable_rate: 0.5,
        actual_top_source_top3_acceptable_rate: 1,
      },
      failure_layer_counts: {
        none: 1,
        not_imported: 0,
        absent_from_candidates: 0,
        outside_top50: 0,
        below_threshold: 0,
        pack_loss: 0,
        display_loss: 1,
      },
      oracle_failure_report: {
        counts: {
          top1_pass: 1,
          unsupported_honest: 0,
          unsupported_false_confident: 0,
          query_mode_mismatch: 0,
          candidate_generation: 0,
          threshold_loss: 0,
          pack_loss: 0,
          source_selection_identified_unapplied: 1,
          source_selection_identified_display_gap: 0,
          source_selection_missed_owner: 0,
          answer_only_top1_miss: 0,
          source_rank_misorder: 0,
        },
        cases: [],
        top1_misses: [
          {
            repo: "demo",
            id: "case-b",
            layer: "source_selection_identified_unapplied",
            expected_top_source: "docs/b.md",
            acceptable_top_sources: ["docs/b.md"],
            expected_source_rank: 2,
            expected_reachable_at_5: true,
            expected_reachable_at_10: true,
            expected_reachable_at_20: true,
            expected_reachable_at_50: true,
            all_critical_reachable_at_5: true,
            all_critical_reachable_at_10: true,
            all_critical_reachable_at_20: true,
            all_critical_reachable_at_50: true,
            top1_acceptable: false,
            top3_acceptable: true,
            agent_answer_pass: true,
            expected_query_mode: "unanchored",
            actual_query_mode: "unanchored",
            source_selection_applied: false,
            source_selection_owner_rank: 1,
            source_selection_top_reason_codes: ["covers_label"],
            displayed_top3_sources: ["docs/a.md", "docs/b.md"],
          },
        ],
        reachability: {
          expected_at_5: 2,
          expected_at_10: 2,
          expected_at_20: 2,
          expected_at_50: 2,
          all_critical_at_50: 2,
          answerable_cases: 2,
        },
      },
    } as unknown as Slice0Report;

    const rendered = renderCriticalSourceDiagnosis(report);

    expect(rendered).toContain("Critical-source diagnosis");
    expect(rendered).toContain("source_selection_identified_unapplied");
    expect(rendered).toContain("demo/case-b");
    expect(rendered).toContain("Read");
  });
});
