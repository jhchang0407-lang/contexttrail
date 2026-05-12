/**
 * THO-134 / PRD-0013 V2.5.1 — runner outcome.
 *
 * Pure mapping from a Slice0Report to (exit_code, error messages). The
 * real-corpus eval CLI used to embed this logic, which made the holdout
 * panel — the actual ship verdict — hard to enforce alongside the combined
 * panel. Splitting it lets us test every gate transition.
 */
import type { Slice0Report } from "./report.js";
import { FALSE_CONFIDENT_TOLERANCE } from "./branch.js";

export type CeilingProbeOutcome = {
  exit_code: 0 | 1;
  errors: string[];
};

export function summarizeCeilingProbeOutcome(
  report: Slice0Report,
): CeilingProbeOutcome {
  const errors: string[] = [];

  if (report.metrics.synthetic_regression) {
    const failed = report.synthetic_failed_gates.join(", ") || "(unknown)";
    errors.push(`synthetic regression: ${failed}`);
  }

  const fcu = report.metrics.false_confident_unsupported;
  if (fcu > FALSE_CONFIDENT_TOLERANCE) {
    errors.push(
      `false-confident unsupported regressed (${fcu} > tolerance ${FALSE_CONFIDENT_TOLERANCE})`,
    );
  }

  // Holdout panel is the PRD-0013 ship verdict; combined panel is context.
  // Both are enforced; surfacing each separately keeps remediation specific.
  if (report.holdout_gates && !report.holdout_gates.passed) {
    const detail = report.holdout_gates.failures
      .map((f) => `${f.gate} (${f.message})`)
      .join("; ");
    errors.push(`Holdout gates failed: ${detail}`);
  }
  if (report.slice2_gates && !report.slice2_gates.passed) {
    const detail = report.slice2_gates.failures
      .map((f) => `${f.gate} (${f.message})`)
      .join("; ");
    errors.push(`Combined Slice 2 gates failed: ${detail}`);
  }

  return { exit_code: errors.length === 0 ? 0 : 1, errors };
}
