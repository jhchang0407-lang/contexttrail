import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PresentedContextPack } from "../mcp/presenter.js";
import { assembleContextPackWithLinks } from "../retrieve/assemble-with-links.js";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { closeDb, openDb } from "../store/db.js";
import {
  extractMentionedPaths,
  withCodeSourceIndexOverride,
} from "./agent-completion-probe.js";
import { COMMIT_GROUNDED_EVAL_IMPORT_GLOBS } from "./import-globs.js";
import { prepareCommitGroundedEvalWorkspace } from "./import-globs.js";
import {
  AGENT_TASK_SUCCESS_CASES,
  evaluateTaskSuccessCase,
  type AgentTaskSuccessCase,
  type AgentTaskSuccessObservation,
  type AgentTaskSuccessVerdict,
} from "./task-success.js";

export type TaskSuccessHonestyCase = {
  ticket: string;
  queryModeHonest: boolean;
  coverageConfidenceHonest: boolean;
  packReadinessHonest: boolean;
};

export type TaskSuccessHonestySummary = {
  queryModeHonest: boolean;
  coverageConfidenceHonest: boolean;
  packReadinessHonest: boolean;
  rows: TaskSuccessHonestyCase[];
};

export type TaskSuccessEvalSummary = {
  verdicts: AgentTaskSuccessVerdict[];
  honesty: TaskSuccessHonestySummary;
};

export type TaskSuccessEvalOptions = {
  repoRoot: string;
  cases: AgentTaskSuccessCase[];
  budgetTokensOverride?: number;
  codeSourceIndexEnabled?: boolean;
};

function collectTaskSuccessObservation(
  pack: Pick<PresentedContextPack, "ranked">,
): AgentTaskSuccessObservation {
  const surfaced_files = new Set<string>();
  const changed_files = new Set<string>();
  const support_cluster_files = new Set<string>();

  for (const entry of pack.ranked) {
    for (const path of extractMentionedPaths(entry)) surfaced_files.add(path);
    if (entry.source_path) surfaced_files.add(entry.source_path);
    if (entry.kind === "code" && entry.source_path) changed_files.add(entry.source_path);
    if (
      entry.kind === "code" &&
      entry.source_path &&
      entry.support_cluster?.role === "support"
    ) {
      support_cluster_files.add(entry.source_path);
    }
  }

  return {
    surfaced_files: [...surfaced_files],
    changed_files: [...changed_files],
    support_cluster_files: [...support_cluster_files],
  };
}

function hasRequiredAnchors(fixture: AgentTaskSuccessCase): boolean {
  return (
    fixture.required_anchors.files.length > 0 ||
    fixture.required_anchors.symbols.length > 0 ||
    fixture.required_anchors.routes.length > 0
  );
}

export function evaluateTaskSuccessHonesty(args: {
  fixture: AgentTaskSuccessCase;
  pack: Pick<
    PresentedContextPack,
    "query_mode" | "coverage_confidence" | "explain"
  >;
  verdict: AgentTaskSuccessVerdict;
}): TaskSuccessHonestyCase {
  const packReadinessState = args.pack.explain?.pack_readiness?.state;
  const queryModeHonest = hasRequiredAnchors(args.fixture)
    ? args.pack.query_mode === "anchored"
    : args.pack.query_mode !== "signal_empty";
  const coverageConfidenceHonest = args.verdict.reachedRightFiles
    ? args.pack.coverage_confidence !== "empty"
    : args.pack.coverage_confidence !== "confident";
  const packReadinessHonest =
    packReadinessState !== undefined &&
    (args.verdict.acceptableChange
      ? packReadinessState !== "unsupported"
      : packReadinessState !== "ready");

  return {
    ticket: args.fixture.ticket,
    queryModeHonest,
    coverageConfidenceHonest,
    packReadinessHonest,
  };
}

export function summarizeTaskSuccessHonesty(
  rows: TaskSuccessHonestyCase[],
): TaskSuccessHonestySummary {
  return {
    queryModeHonest: rows.every((row) => row.queryModeHonest),
    coverageConfidenceHonest: rows.every(
      (row) => row.coverageConfidenceHonest,
    ),
    packReadinessHonest: rows.every((row) => row.packReadinessHonest),
    rows,
  };
}

export async function runTaskSuccessEvalForPanel(
  options: TaskSuccessEvalOptions,
): Promise<TaskSuccessEvalSummary> {
  return withCodeSourceIndexOverride(options.codeSourceIndexEnabled, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-task-success-"));
    try {
      init(cwd);
      prepareCommitGroundedEvalWorkspace({
        repoRoot: options.repoRoot,
        cwd,
      });
      runImport(cwd, [...COMMIT_GROUNDED_EVAL_IMPORT_GLOBS]);
      const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
      try {
        const verdicts: AgentTaskSuccessVerdict[] = [];
        const honestyRows: TaskSuccessHonestyCase[] = [];
        for (const fixture of options.cases) {
          const { pack } = assembleContextPackWithLinks({
            db,
            cwd,
            explain: true,
            request: {
              task: fixture.task,
              query_anchors: fixture.required_anchors,
              budget: fixture.budget,
              expected_locked: [],
              explain: true,
            },
            maxHops: 2,
            ...(options.budgetTokensOverride !== undefined
              ? { budgetTokensOverride: options.budgetTokensOverride }
              : {}),
          });
          const verdict = evaluateTaskSuccessCase({
            fixture,
            observation: collectTaskSuccessObservation(pack),
          });
          verdicts.push(verdict);
          honestyRows.push(
            evaluateTaskSuccessHonesty({
              fixture,
              pack,
              verdict,
            }),
          );
        }
        return {
          verdicts,
          honesty: summarizeTaskSuccessHonesty(honestyRows),
        };
      } finally {
        closeDb(db);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

export async function runPrimaryTaskSuccessEval(
  options: Omit<TaskSuccessEvalOptions, "cases">,
): Promise<TaskSuccessEvalSummary> {
  return runTaskSuccessEvalForPanel({
    ...options,
    cases: AGENT_TASK_SUCCESS_CASES,
  });
}
