import type { ChunkScope, ChunkScopeLayer } from "../types/chunk.js";
import type { ContextTrailConfig } from "../config/defaults.js";
import { matchesGlob } from "./rules.js";

export type ResolveScopeArgs = {
  source_path: string;
  frontmatter: Record<string, unknown>;
  config: ContextTrailConfig;
};

type FrontmatterScope = {
  layer?: ChunkScopeLayer;
  project?: string;
  module?: string;
  team?: string;
  company?: string;
  feature?: string;
  domains?: string[];
  files?: string[];
  symbols?: string[];
  routes?: string[];
};

function readFrontmatterScope(fm: Record<string, unknown>): FrontmatterScope | undefined {
  const s = fm["scope"];
  if (!s || typeof s !== "object") return undefined;
  return s as FrontmatterScope;
}

function deriveModule(
  source_path: string,
  rule: ContextTrailConfig["doc_scopes"][number]["scope"],
): string | undefined {
  const segs = source_path.split("/").filter(Boolean);
  if (rule.module_from_path_after) {
    const marker = rule.module_from_path_after;
    const i = segs.indexOf(marker);
    if (i !== -1 && i + 1 < segs.length) return segs[i + 1];
  }
  if (typeof rule.module_from_path === "number") {
    const idx = rule.module_from_path;
    if (idx >= 0 && idx < segs.length) return segs[idx];
  }
  return undefined;
}

export function resolveScope(args: ResolveScopeArgs): ChunkScope {
  const { source_path, frontmatter, config } = args;

  // 1. Match against config rules in order; first match wins.
  const matched = config.doc_scopes.find((rule) =>
    matchesGlob(source_path, rule.pattern),
  );

  let layer: ChunkScopeLayer = "unknown";
  let project: string | undefined;
  let module_: string | undefined;
  let team: string | undefined;
  let company: string | undefined;
  const sourceMeta: ChunkScope["source"] = {};

  if (matched) {
    layer = matched.scope.layer;
    project = matched.scope.project;
    team = matched.scope.team;
    company = matched.scope.company;
    module_ = matched.scope.module ?? deriveModule(source_path, matched.scope);
    sourceMeta.config_rule = matched.id;
  }

  // 2. Frontmatter overrides per-field.
  const fm = readFrontmatterScope(frontmatter);
  if (fm) {
    sourceMeta.frontmatter = true;
    if (fm.layer) layer = fm.layer;
    if (fm.project) project = fm.project;
    if (fm.module) module_ = fm.module;
    if (fm.team) team = fm.team;
    if (fm.company) company = fm.company;
  }

  const scope: ChunkScope = {
    layer,
    source: sourceMeta,
  };
  if (project) scope.project = project;
  if (module_) scope.module = module_;
  if (team) scope.team = team;
  if (company) scope.company = company;
  if (fm?.feature) scope.feature = fm.feature;
  if (fm?.domains) scope.domains = fm.domains;
  if (fm?.files) scope.files = fm.files;
  if (fm?.symbols) scope.symbols = fm.symbols;
  if (fm?.routes) scope.routes = fm.routes;

  return scope;
}
