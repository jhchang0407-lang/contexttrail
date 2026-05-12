import { writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { CardType, FreshnessReason, FreshnessState } from "../types/card.js";

type FixtureScope = {
  layer: "company" | "team" | "project" | "module" | "decision" | "unknown";
  company?: string;
  team?: string;
  project?: string;
  module?: string;
  feature?: string;
  domains?: string[];
  routes?: string[];
};

export type EvalCardFixture = {
  id: string;
  type: CardType;
  title: string;
  authority?: "accepted" | "candidate" | "deprecated";
  scope: FixtureScope;
  files?: string[];
  routes?: string[];
  symbol_anchors?: string[];
  command?: string;
  covers?: string[];
  freshness_state?: FreshnessState;
  freshness_reason?: FreshnessReason;
  body: string;
};

export function renderCardFixture(fixture: EvalCardFixture): string {
  const frontmatter = {
    id: fixture.id,
    type: fixture.type,
    title: fixture.title,
    authority: fixture.authority ?? "accepted",
    scope: fixture.scope,
    files: fixture.files,
    routes: fixture.routes,
    symbol_anchors: fixture.symbol_anchors,
    command: fixture.command,
    covers: fixture.covers,
    freshness_state: fixture.freshness_state,
    freshness_reason: fixture.freshness_reason,
  };
  return [
    "---",
    YAML.stringify(frontmatter, { keepUndefined: false }).trimEnd(),
    "---",
    "",
    fixture.body.trim(),
    "",
  ].join("\n");
}

export function writeCardFixture(dir: string, fileName: string, fixture: EvalCardFixture): void {
  writeFileSync(join(dir, fileName), renderCardFixture(fixture));
}
