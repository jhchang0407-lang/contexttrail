/**
 * PRD-0033 / THO-250 — corpus-independent setup probe set.
 *
 * Six fixed queries that ask "can the engine find anything useful given
 * the current corpus?" Each probe is intentionally generic — no
 * ContextTrail-specific paths, scope tags, or domain keywords — so the
 * same set lives on every pilot repo. The `primary_contributors` probe
 * is a deliberate negative test: most repos don't have contributor
 * lists in docs, so `coverage_confidence='empty'` is the *expected*
 * result there. Either outcome is informative.
 */

export type ProbeCoverageConfidence = "confident" | "uncertain" | "empty";

export type SetupProbe = {
  readonly id: string;
  readonly task: string;
  readonly signal_empty: boolean;
  readonly rationale: string;
};

export const SETUP_PROBES: readonly SetupProbe[] = Object.freeze([
  Object.freeze({
    id: "project_overview",
    task: "project overview",
    signal_empty: false,
    rationale: "unanchored README-style query",
  }),
  Object.freeze({
    id: "configuration_options",
    task: "configuration options",
    signal_empty: false,
    rationale: "anchored on config keyword",
  }),
  Object.freeze({
    id: "test_setup",
    task: "test setup",
    signal_empty: false,
    rationale: "anchored on test keyword",
  }),
  Object.freeze({
    id: "build_deployment",
    task: "build deployment",
    signal_empty: false,
    rationale: "anchored on build / deploy keywords",
  }),
  Object.freeze({
    id: "architecture_decisions",
    task: "architecture decisions",
    signal_empty: false,
    rationale: "unanchored ADR-style query",
  }),
  Object.freeze({
    id: "primary_contributors",
    task: "primary contributors",
    signal_empty: true,
    rationale:
      "negative test — most repos don't have contributor lists in docs; 'empty' is the expected outcome",
  }),
]);

export type ProbeResult = {
  id: string;
  task: string;
  coverage_confidence: ProbeCoverageConfidence;
  signal_empty: boolean;
  rationale: string;
};

export type ProbeRetriever = (task: string) => Promise<{
  coverage_confidence: ProbeCoverageConfidence;
}>;

export async function runProbes(retriever: ProbeRetriever): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const probe of SETUP_PROBES) {
    const r = await retriever(probe.task);
    results.push({
      id: probe.id,
      task: probe.task,
      coverage_confidence: r.coverage_confidence,
      signal_empty: probe.signal_empty,
      rationale: probe.rationale,
    });
  }
  return results;
}
