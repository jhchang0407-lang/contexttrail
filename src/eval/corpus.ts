import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  ANCHOR_SOURCES,
  ASSEMBLY_NEEDS,
  ASSEMBLY_STAGES,
  EXPECTATION_KINDS,
  FACT_FINDING_CAPABILITIES,
  QUERY_INTENTS,
  type EvalCase,
} from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
export const EVAL_SET_PATH = resolve(REPO_ROOT, "tests", "fixtures", "eval-set.yaml");

export const EVAL_SET = YAML.parse(readFileSync(EVAL_SET_PATH, "utf8")) as EvalCase[];
export const EXPECTED_EVAL_CASES = EVAL_SET.length;

export function validateEvalSet(cases: EvalCase[]): void {
  for (const entry of cases) {
    const missing = [
      entry.query_intent === undefined ? "query_intent" : undefined,
      entry.assembly_need === undefined ? "assembly_need" : undefined,
      entry.expectation_kind === undefined ? "expectation_kind" : undefined,
      entry.capabilities === undefined ? "capabilities" : undefined,
    ].filter((field): field is string => field !== undefined);

    if (missing.length > 0) {
      throw new Error(`Eval case '${entry.id}' is missing ${missing.join(", ")}`);
    }
    validateEnum(entry, "query_intent", QUERY_INTENTS);
    validateEnum(entry, "assembly_need", ASSEMBLY_NEEDS);
    validateEnum(entry, "expectation_kind", EXPECTATION_KINDS);
    validateEnum(entry, "anchor_source", ANCHOR_SOURCES);
    validateOptionalStage(entry);
    if (entry.capabilities !== undefined && entry.capabilities.length === 0) {
      throw new Error(`Eval case '${entry.id}' must include at least one capability`);
    }
    for (const capability of entry.capabilities ?? []) {
      if (!FACT_FINDING_CAPABILITIES.includes(capability)) {
        throw new Error(`Eval case '${entry.id}' has unknown capability '${capability}'`);
      }
    }
  }
}

function validateEnum<const T extends readonly string[]>(
  entry: EvalCase,
  field: "query_intent" | "assembly_need" | "expectation_kind" | "anchor_source",
  allowed: T,
): void {
  const value = entry[field];
  if (value !== undefined && !allowed.includes(value)) {
    throw new Error(`Eval case '${entry.id}' has unknown ${field} '${value}'`);
  }
}

function validateOptionalStage(entry: EvalCase): void {
  const value = entry.minimal_sufficient_stage;
  if (value !== undefined && !ASSEMBLY_STAGES.includes(value)) {
    throw new Error(`Eval case '${entry.id}' has unknown minimal_sufficient_stage '${value}'`);
  }
}
