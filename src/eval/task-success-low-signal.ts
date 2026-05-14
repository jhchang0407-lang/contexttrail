import type { AgentTaskSuccessVerdict } from "./task-success.js";

export const TASK_SUCCESS_LOW_SIGNAL_MISS_SHAPES = [
  "none",
  "no_right_files",
  "reached_files_but_change_miss",
  "low_signal_no_right_files",
  "low_signal_file_hit_but_change_miss",
  "signal_empty_unresolved",
  "signal_empty_file_hit_but_change_miss",
] as const;

export type TaskSuccessLowSignalMissShape =
  (typeof TASK_SUCCESS_LOW_SIGNAL_MISS_SHAPES)[number];

export type TaskSuccessLowSignalBucketSummary = {
  cases: number;
  reachedRightFiles: number;
  acceptableChange: number;
};

export type TaskSuccessLowSignalSummary = {
  buckets: Record<
    AgentTaskSuccessVerdict["lowSignalExpectation"],
    TaskSuccessLowSignalBucketSummary
  >;
  missShapes: Record<TaskSuccessLowSignalMissShape, number>;
  reportingOnly: true;
};

export function classifyLowSignalMissShape(
  verdict: AgentTaskSuccessVerdict,
): TaskSuccessLowSignalMissShape {
  if (verdict.reachedRightFiles && verdict.acceptableChange) return "none";
  if (verdict.lowSignalExpectation === "signal_empty") {
    return verdict.reachedRightFiles
      ? "signal_empty_file_hit_but_change_miss"
      : "signal_empty_unresolved";
  }
  if (verdict.lowSignalExpectation === "low_signal") {
    return verdict.reachedRightFiles
      ? "low_signal_file_hit_but_change_miss"
      : "low_signal_no_right_files";
  }
  return verdict.reachedRightFiles
    ? "reached_files_but_change_miss"
    : "no_right_files";
}

export function summarizeTaskSuccessLowSignal(
  verdicts: AgentTaskSuccessVerdict[],
): TaskSuccessLowSignalSummary {
  const buckets: TaskSuccessLowSignalSummary["buckets"] = {
    ordinary: { cases: 0, reachedRightFiles: 0, acceptableChange: 0 },
    low_signal: { cases: 0, reachedRightFiles: 0, acceptableChange: 0 },
    signal_empty: { cases: 0, reachedRightFiles: 0, acceptableChange: 0 },
  };
  const missShapes = Object.fromEntries(
    TASK_SUCCESS_LOW_SIGNAL_MISS_SHAPES.map((shape) => [shape, 0]),
  ) as TaskSuccessLowSignalSummary["missShapes"];

  for (const verdict of verdicts) {
    const bucket = buckets[verdict.lowSignalExpectation];
    bucket.cases += 1;
    if (verdict.reachedRightFiles) bucket.reachedRightFiles += 1;
    if (verdict.acceptableChange) bucket.acceptableChange += 1;
    missShapes[classifyLowSignalMissShape(verdict)] += 1;
  }

  return {
    buckets,
    missShapes,
    reportingOnly: true,
  };
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function renderTaskSuccessLowSignalReport(
  summary: TaskSuccessLowSignalSummary,
): string {
  const lines: string[] = [];
  lines.push("========== LOW-SIGNAL TASK-SUCCESS REPORT ==========");
  lines.push(
    "This report is reporting-only. It names repeated miss shapes but does not change recovery behavior by itself.",
  );
  lines.push("");
  lines.push("Buckets:");
  for (const [name, bucket] of Object.entries(summary.buckets)) {
    lines.push(
      `  ${name.padEnd(12)} cases=${bucket.cases}  reached_right_files=${bucket.reachedRightFiles}/${bucket.cases} (${pct(bucket.reachedRightFiles, bucket.cases)})  acceptable_change=${bucket.acceptableChange}/${bucket.cases} (${pct(bucket.acceptableChange, bucket.cases)})`,
    );
  }
  lines.push("");
  lines.push("Miss shapes:");
  for (const shape of TASK_SUCCESS_LOW_SIGNAL_MISS_SHAPES) {
    lines.push(`  ${shape.padEnd(36)} ${summary.missShapes[shape]}`);
  }
  return `${lines.join("\n")}\n`;
}
