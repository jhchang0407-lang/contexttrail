import type { ContextTrailConfig } from "../config/defaults.js";
import { matchesGlob } from "../scope/rules.js";
import type { QueryScope } from "./scope-match.js";
import type { Card } from "../types/card.js";
import type { CodeAnchor, CodeAnchorKind, ChunkScope, DocChunk } from "../types/chunk.js";
import type { QueryAnchors } from "./score.js";
import { matchAnchorValue } from "../anchor-match.js";

export type QueryMode = "anchored" | "signal_empty" | "unanchored";

export type QueryCompilationAnchorKind = "file" | "symbol" | "route";
export type QueryCompilationRecognition = "scope_inferred" | "exact_anchor_only" | "none";
export type QueryCompilationMode =
  | "anchor_derived"
  | "source_profile_alias"
  | "code_scopes_fallback"
  | "none";
export type QueryCompilationMatchSource =
  | "code_anchor"
  | "source_profile"
  | "code_scope"
  | "path_component";
export type QueryCompilationMatchKind =
  | "exact"
  | "case_insensitive"
  | "symbol_form_variant"
  | "source_path_exact"
  | "source_path_suffix"
  | "source_basename"
  | "source_basename_without_extension"
  | "source_alias_path"
  | "source_alias_filename"
  | "source_alias_package"
  | "source_text_filename"
  | "code_scope_rule"
  | "path_component_segment";

export type QueryCompilationContributor = {
  object_id: string;
  kind: "card" | "chunk";
  value: string;
  confidence: "high" | "medium" | "low" | "ambiguous";
  match_source?: QueryCompilationMatchSource;
  match_kind?: QueryCompilationMatchKind;
  source_path?: string;
};

export type QueryCompilationAnchor = {
  anchor: { kind: QueryCompilationAnchorKind; value: string };
  recognition: QueryCompilationRecognition;
  mode: QueryCompilationMode;
  scopes: QueryScope[];
  contributing_anchors: QueryCompilationContributor[];
};

export type QueryCompilation = {
  query_mode: QueryMode;
  provided_anchor_count: number;
  recognized_anchor_count: number;
  anchors: QueryCompilationAnchor[];
};

export type CompileQueryScopesArgs = {
  anchors: QueryAnchors;
  config: ContextTrailConfig;
  lookup: AnchorLookup;
  source_lookup?: SourceProfileAnchorLookup;
  task?: string;
};

type ScopeCandidate = {
  scope: QueryScope;
  contributor: QueryCompilationContributor;
  confidence_rank: number;
  source_rank: number;
  specificity_rank: number;
};

export type AnchorLookupContributor = {
  object_id: string;
  kind: "card" | "chunk";
  scope: ChunkScope;
  value: string;
  confidence: QueryCompilationContributor["confidence"];
  match_source?: QueryCompilationMatchSource;
  match_kind?: QueryCompilationMatchKind;
  source_path?: string;
};

export type AnchorLookup = (
  anchor: { kind: QueryCompilationAnchorKind; value: string },
) => AnchorLookupContributor[];

export type SourceProfileAnchorLookup = (
  anchor: { kind: "file"; value: string },
  task: string,
) => AnchorLookupContributor[];

const CONFIDENCE_RANK: Record<QueryCompilationContributor["confidence"], number> = {
  high: 4,
  medium: 3,
  low: 2,
  ambiguous: 1,
};

/**
 * Back-compat helper for older tests/callers. The production path uses
 * `compileQueryScopes`, which tries anchored card/chunk truth before this
 * file-only config fallback.
 */
export function inferQueryScopes(
  files: string[],
  config: ContextTrailConfig,
): QueryScope[] {
  const out: QueryScope[] = [];
  for (const path of files) {
    const rule = config.code_scopes.find((r) => matchesGlob(path, r.pattern));
    if (!rule) continue;
    const scope = scopeFromConfigRule(path, rule.scope);
    if (Object.keys(scope).length > 0) out.push(scope);
  }
  return out;
}

export function compileQueryScopes(args: CompileQueryScopesArgs): {
  query_scopes: QueryScope[];
  query_compilation: QueryCompilation;
} {
  const provided = enumerateProvidedAnchors(args.anchors);
  const compiledAnchors: QueryCompilationAnchor[] = [];
  const queryScopes: QueryScope[] = [];

  for (const anchor of provided) {
    let contributors = args.lookup(anchor);
    let candidates = anchorDerivedCandidates(contributors);
    let mode: QueryCompilationMode = candidates.length > 0 ? "anchor_derived" : "none";

    if (
      candidates.length === 0 &&
      anchor.kind === "file" &&
      args.source_lookup
    ) {
      const aliasContributors = args.source_lookup(
        { kind: "file", value: anchor.value },
        args.task ?? "",
      );
      contributors = [...contributors, ...aliasContributors];
      candidates = anchorDerivedCandidates(contributors);
      if (candidates.length > 0 || aliasContributors.length > 0) {
        mode = "source_profile_alias";
      }
    }

    if (candidates.length === 0 && anchor.kind === "file") {
      candidates = codeScopeFallbackCandidates(args.config, anchor.value);
      if (candidates.length > 0) mode = "code_scopes_fallback";
    }

    // Soft anchor handling: when binary lookup + code_scopes config
    // both fail to bind, try a path-component fallback. Splits the file path
    // and treats each segment as a potential scope name (project/module).
    // Recognizes the anchor as partial — mode label still becomes anchored
    // when at least one segment hits a known scope, even if there's no exact
    // chunk anchor for the full path.
    if (candidates.length === 0 && anchor.kind === "file") {
      candidates = pathComponentFallbackCandidates(args.lookup, anchor.value);
      if (candidates.length > 0) mode = "code_scopes_fallback";
    }

    const scoped = dedupeAndCapCandidates(candidates, 10);
    const scopes = scoped.map((c) => c.scope);
    queryScopes.push(...scopes);

    const exactOnly = scopes.length === 0 && contributors.length > 0;
    const recognition: QueryCompilationRecognition =
      scopes.length > 0 ? "scope_inferred" : exactOnly ? "exact_anchor_only" : "none";

    compiledAnchors.push({
      anchor,
      recognition,
      mode,
      scopes,
      contributing_anchors: scoped.map((c) => c.contributor),
    });
  }

  const recognized_anchor_count = compiledAnchors.filter(
    (a) => a.recognition !== "none",
  ).length;
  const query_mode: QueryMode =
    provided.length === 0
      ? "unanchored"
      : recognized_anchor_count === 0
        ? "signal_empty"
        : "anchored";

  return {
    query_scopes: dedupeScopes(queryScopes),
    query_compilation: {
      query_mode,
      provided_anchor_count: provided.length,
      recognized_anchor_count,
      anchors: compiledAnchors,
    },
  };
}

function enumerateProvidedAnchors(
  anchors: QueryAnchors,
): { kind: QueryCompilationAnchorKind; value: string }[] {
  return [
    ...(anchors.files ?? []).map((value) => ({ kind: "file" as const, value })),
    ...(anchors.symbols ?? []).map((value) => ({ kind: "symbol" as const, value })),
    ...(anchors.routes ?? []).map((value) => ({ kind: "route" as const, value })),
  ];
}

function anchorDerivedCandidates(contributors: AnchorLookupContributor[]): ScopeCandidate[] {
  const out: ScopeCandidate[] = [];
  for (const contributor of contributors) {
    const candidate = candidateFromScope(contributor.scope, contributorFromLookup(contributor));
    if (candidate) out.push(candidate);
  }
  return out;
}

function contributorFromLookup(
  contributor: AnchorLookupContributor,
): QueryCompilationContributor {
  const out: QueryCompilationContributor = {
    object_id: contributor.object_id,
    kind: contributor.kind,
    value: contributor.value,
    confidence: contributor.confidence,
  };
  if (contributor.match_source) out.match_source = contributor.match_source;
  if (contributor.match_kind) out.match_kind = contributor.match_kind;
  if (contributor.source_path) out.source_path = contributor.source_path;
  return out;
}

/** Path-component scope inference. When `prisma/schema.prisma` doesn't
 *  resolve to any indexed chunk anchor or code_scopes rule, try the path
 *  segments individually as anchor values. Hits any chunk whose own anchors
 *  contain a segment match (e.g., chunks anchored on `linear` for a query
 *  on `src/linear/normalize-ticket.ts`). Returns scope candidates with
 *  medium confidence so they don't dominate true exact matches. */
function pathComponentFallbackCandidates(
  lookup: AnchorLookup,
  path: string,
): ScopeCandidate[] {
  const segments = path
    .split(/[\\/]/)
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/\.[^.]+$/, ""));
  const seen = new Set<string>();
  const candidates: ScopeCandidate[] = [];
  for (const segment of segments) {
    if (seen.has(segment) || segment.length < 2) continue;
    seen.add(segment);
    // Look up each segment as both a file-anchor value and a symbol-anchor
    // value, since a code-shaped segment like "RefundService" might be
    // indexed either way.
    for (const kind of ["file", "symbol"] as const) {
      const contributors = lookup({ kind, value: segment }).filter(
        (contributor) => contributor.value === segment,
      );
      for (const c of contributors) {
        const cand = candidateFromScope(c.scope, {
          object_id: c.object_id,
          kind: c.kind,
          value: segment,
          confidence: "low" as const,
          match_source: "path_component",
          match_kind: "path_component_segment",
        });
        if (cand) candidates.push(cand);
      }
    }
  }
  return candidates;
}

function codeScopeFallbackCandidates(
  config: ContextTrailConfig,
  path: string,
): ScopeCandidate[] {
  const rule = config.code_scopes.find((r) => matchesGlob(path, r.pattern));
  if (!rule) return [];
  const scope = scopeFromConfigRule(path, rule.scope);
  if (Object.keys(scope).length === 0) return [];
  return [
    {
      scope,
      contributor: {
        object_id: rule.id,
        kind: "chunk",
        value: path,
        confidence: "medium",
        match_source: "code_scope",
        match_kind: "code_scope_rule",
      },
      confidence_rank: CONFIDENCE_RANK.medium,
      source_rank: 0,
      specificity_rank: scopeSpecificity(scope),
    },
  ];
}

function candidateFromScope(
  chunkScope: ChunkScope,
  contributor: QueryCompilationContributor,
): ScopeCandidate | null {
  const scope = queryScopeFromChunkScope(chunkScope);
  if (Object.keys(scope).length === 0) return null;
  return {
    scope,
    contributor,
    confidence_rank: CONFIDENCE_RANK[contributor.confidence],
    source_rank: contributor.kind === "card" ? 1 : 0,
    specificity_rank: scopeSpecificity(scope),
  };
}

function dedupeAndCapCandidates(candidates: ScopeCandidate[], cap: number): ScopeCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (b.confidence_rank !== a.confidence_rank) return b.confidence_rank - a.confidence_rank;
    if (b.source_rank !== a.source_rank) return b.source_rank - a.source_rank;
    if (b.specificity_rank !== a.specificity_rank) return b.specificity_rank - a.specificity_rank;
    return a.contributor.object_id.localeCompare(b.contributor.object_id);
  });
  const out: ScopeCandidate[] = [];
  const seen = new Set<string>();
  for (const c of sorted) {
    const key = scopeKey(c.scope);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
}

function dedupeScopes(scopes: QueryScope[]): QueryScope[] {
  const out: QueryScope[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    const key = scopeKey(scope);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(scope);
  }
  return out;
}

function scopeFromConfigRule(
  path: string,
  ruleScope: ContextTrailConfig["code_scopes"][number]["scope"],
): QueryScope {
  const scope: QueryScope = {};
  if (ruleScope.project) scope.project = ruleScope.project;
  if (ruleScope.team) scope.team = ruleScope.team;
  if (ruleScope.company) scope.company = ruleScope.company;
  if (ruleScope.module) scope.module = ruleScope.module;
  const segs = path.split("/").filter(Boolean);
  if (ruleScope.module_from_path_after) {
    const i = segs.indexOf(ruleScope.module_from_path_after);
    if (i !== -1 && i + 1 < segs.length) scope.module = segs[i + 1];
  }
  if (typeof ruleScope.module_from_path === "number") {
    const idx = ruleScope.module_from_path;
    if (idx >= 0 && idx < segs.length) scope.module = segs[idx];
  }
  return scope;
}

function queryScopeFromChunkScope(scope: ChunkScope): QueryScope {
  const out: QueryScope = {};
  if (scope.company) out.company = scope.company;
  if (scope.team) out.team = scope.team;
  if (scope.project) out.project = scope.project;
  if (scope.module) out.module = scope.module;
  if (scope.feature) out.feature = scope.feature;
  return out;
}

function scopeSpecificity(scope: QueryScope): number {
  if (scope.feature) return 5;
  if (scope.module) return 4;
  if (scope.project) return 3;
  if (scope.team) return 2;
  if (scope.company) return 1;
  return 0;
}

function scopeKey(scope: QueryScope): string {
  return JSON.stringify({
    company: scope.company ?? null,
    team: scope.team ?? null,
    project: scope.project ?? null,
    module: scope.module ?? null,
    feature: scope.feature ?? null,
  });
}

function cardAnchorMatch(
  card: Card,
  kind: CodeAnchorKind,
  value: string,
): { value: string; confidence: QueryCompilationContributor["confidence"] } | null {
  const values =
    kind === "file"
      ? card.file_anchors
      : kind === "symbol"
        ? card.symbol_anchors
        : kind === "route"
          ? (card.route_anchors ?? [])
          : [];
  for (const indexed of values) {
    if (indexed !== value) continue;
    return { value: indexed, confidence: "high" };
  }
  return null;
}

export function makeInMemoryAnchorLookup(args: {
  chunks: DocChunk[];
  cards: Card[];
  anchorsByChunkVersionId: Map<string, CodeAnchor[]>;
}): AnchorLookup {
  return ({ kind, value }) => {
    const out: AnchorLookupContributor[] = [];
    for (const card of args.cards) {
      if (card.authority === "deprecated") continue;
      if (card.freshness_state === "potentially_superseded") continue;
      const match = cardAnchorMatch(card, kind, value);
      if (!match) continue;
      out.push({
        object_id: card.id,
        kind: "card",
        scope: card.scope,
        value: match.value,
        confidence: match.confidence,
        match_source: "code_anchor",
        match_kind: "exact",
      });
    }
    for (const chunk of args.chunks) {
      if (chunk.status === "tombstoned") continue;
      for (const anchor of args.anchorsByChunkVersionId.get(chunk.version_id) ?? []) {
        const match = matchAnchorValue({ kind, value }, anchor);
        if (!match) continue;
        out.push({
          object_id: chunk.version_id,
          kind: "chunk",
          scope: chunk.scope,
          value: anchor.value,
          confidence: match.confidence,
          match_source: "code_anchor",
          match_kind: match.kind,
        });
      }
    }
    return out;
  };
}
