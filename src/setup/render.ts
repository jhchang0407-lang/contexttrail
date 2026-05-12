/**
 * PRD-0033 / THO-251 — plain-text renderer for the contexttrail setup CLI.
 *
 * Matches the layout in PRD-0033's "contexttrail setup command" section.
 * `--explain` mode adds per-dimension evidence + per-probe rationale.
 */
import type { DimensionReport, SetupReadinessReport } from "./readiness-scan.js";
import type { NextStepSuggestion } from "./next-step.js";

export type RenderOpts = {
  report: SetupReadinessReport;
  suggestion: NextStepSuggestion;
  explain?: boolean;
};

export function renderSetupReadiness(opts: RenderOpts): string {
  const { report, suggestion, explain } = opts;
  const lines: string[] = [];
  lines.push(`ContextTrail setup readiness for ${report.cwd}`);
  lines.push("");

  const order: (keyof typeof report.dimensions)[] = [
    "corpus_coverage",
    "scope_coverage",
    "card_coverage",
    "retrieval_probes",
  ];
  for (const name of order) {
    const dim = report.dimensions[name];
    const label = `${name}:`.padEnd(22);
    const band = dim.score.padEnd(11);
    lines.push(`  ${label}${band}${dimensionSummary(name, dim)}`);
  }

  lines.push("");
  lines.push("Suggested next step:");
  if (suggestion.command) {
    lines.push(`  ${suggestion.command}`);
  }
  lines.push(`  → ${suggestion.message}`);
  lines.push("");

  if (!explain) {
    lines.push(
      "Run `contexttrail setup --explain` for per-dimension evidence and per-probe results.",
    );
  } else {
    lines.push("--- per-dimension evidence ---");
    for (const name of order) {
      const dim = report.dimensions[name];
      lines.push(`${name}:`);
      for (const [k, v] of Object.entries(dim.evidence)) {
        if (k === "per_probe" && Array.isArray(v)) {
          lines.push("  probes:");
          for (const p of v as Array<{
            id: string;
            coverage_confidence: string;
            signal_empty: boolean;
            rationale: string;
          }>) {
            const flag = p.signal_empty ? " [signal_empty]" : "";
            lines.push(
              `    ${p.id.padEnd(24)} ${p.coverage_confidence.padEnd(10)}${flag}  ${p.rationale}`,
            );
          }
        } else {
          lines.push(`  ${k}: ${JSON.stringify(v)}`);
        }
      }
    }
  }

  return lines.join("\n") + "\n";
}

function dimensionSummary(
  name: keyof SetupReadinessReport["dimensions"],
  dim: DimensionReport,
): string {
  const ev = dim.evidence;
  if (name === "corpus_coverage") {
    const found = ev["discoverable_markdown"];
    const imported = ev["imported_markdown"];
    return `(${String(found)} markdown found, ${String(imported)} imported)`;
  }
  if (name === "scope_coverage") {
    const scoped = ev["scoped_chunks"];
    const total = ev["total_chunks"];
    return `(${String(scoped)} / ${String(total)} chunks have layer ≠ unknown)`;
  }
  if (name === "card_coverage") {
    const accepted = ev["accepted_cards"];
    const constraints = ev["constraint_cards"];
    return `(${String(accepted)} accepted cards, ${String(constraints)} constraint)`;
  }
  if (name === "retrieval_probes") {
    const conf = ev["confident_probes"];
    const total = ev["total_probes"];
    if (total != null) return `(${String(conf)} / ${String(total)} probes confident)`;
    return `(${typeof ev["note"] === "string" ? ev["note"] : "n/a"})`;
  }
  return "";
}
