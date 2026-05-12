import type { DocChunk } from "../types/chunk.js";
import type { SourceAlias, SourceProfile } from "../types/source-profile.js";
import { stemmedTokenSet } from "./tokenize.js";
import type {
  AnchorLookupContributor,
  QueryCompilationContributor,
  QueryCompilationMatchKind,
  SourceProfileAnchorLookup,
} from "./query-scope.js";

type SourceProfileFileMatch = {
  profile: SourceProfile;
  value: string;
  confidence: QueryCompilationContributor["confidence"];
  match_kind: QueryCompilationMatchKind;
  priority: number;
  high_precision: boolean;
};

const DEFAULT_MAX_SOURCE_MATCHES = 6;
const MAX_SCOPES_PER_SOURCE = 4;

const CONFIDENCE_RANK: Record<QueryCompilationContributor["confidence"], number> = {
  high: 4,
  medium: 3,
  low: 2,
  ambiguous: 1,
};

const MATCH_PRIORITY: Partial<Record<QueryCompilationMatchKind, number>> = {
  source_path_exact: 100,
  source_path_suffix: 90,
  source_alias_path: 80,
  source_basename: 70,
  source_basename_without_extension: 60,
  source_alias_filename: 55,
  source_alias_package: 75,
  source_text_filename: 45,
};

const FILENAME_LIKE_RE =
  /\b(?:[A-Za-z0-9][A-Za-z0-9_-]*\.)+[A-Za-z0-9][A-Za-z0-9_-]*\b|\b(?:Dockerfile|Makefile|Procfile|Rakefile|Gemfile)\b/g;

export function makeSourceProfileAnchorLookup(args: {
  profiles: SourceProfile[];
  chunks: DocChunk[];
  max_source_matches?: number;
}): SourceProfileAnchorLookup {
  const maxSourceMatches = args.max_source_matches ?? DEFAULT_MAX_SOURCE_MATCHES;
  const chunksBySource = groupCurrentChunksBySource(args.chunks);

  return (anchor, task) => {
    const matches = bestMatchPerSource(
      args.profiles.flatMap((profile) => matchProfile(profile, anchor.value)),
    );
    if (matches.length === 0) return [];

    const ambiguous = isAmbiguous(matches);
    const eligible = ambiguous
      ? matches.filter(
          (match) =>
            match.high_precision || hasTaskSupport(task, match.profile, anchor.value),
        )
      : matches;
    if (eligible.length === 0) return [];

    const selected = eligible
      .sort(compareMatches)
      .slice(0, maxSourceMatches);

    const contributors: AnchorLookupContributor[] = [];
    for (const match of selected) {
      const chunks = representativeChunks(chunksBySource.get(match.profile.source_path) ?? []);
      const confidence =
        ambiguous && !match.high_precision
          ? demoteAmbiguousConfidence(match.confidence)
          : match.confidence;
      for (const chunk of chunks) {
        contributors.push({
          object_id: chunk.version_id,
          kind: "chunk",
          scope: chunk.scope,
          value: match.value,
          confidence,
          match_source: "source_profile",
          match_kind: match.match_kind,
          source_path: match.profile.source_path,
        });
      }
    }
    return contributors;
  };
}

function matchProfile(profile: SourceProfile, rawAnchor: string): SourceProfileFileMatch[] {
  const anchorPath = normalizePath(rawAnchor);
  const sourcePath = normalizePath(profile.source_path);
  const out: SourceProfileFileMatch[] = [];

  pushMatch(out, profile, profile.source_path, "source_path_exact", "high", sourcePath === anchorPath);
  pushMatch(
    out,
    profile,
    profile.source_path,
    "source_path_suffix",
    "high",
    anchorPath.includes("/") && sourcePath.endsWith(`/${anchorPath}`),
  );

  const sourceBase = basename(sourcePath);
  const anchorBase = basename(anchorPath);
  pushMatch(
    out,
    profile,
    sourceBase,
    "source_basename",
    "medium",
    sourceBase.length > 0 && sourceBase === anchorBase,
  );
  pushMatch(
    out,
    profile,
    stripExtension(sourceBase),
    "source_basename_without_extension",
    "medium",
    sourceBase.length > 0 &&
      anchorBase.length > 0 &&
      stripExtension(sourceBase) === stripExtension(anchorBase),
  );

  for (const alias of profile.aliases) {
    const match = aliasFileMatchKind(alias, rawAnchor);
    if (!match) continue;
    pushMatch(out, profile, alias.value, match, alias.confidence, true);
  }

  for (const mention of filenameLikeMentions(profile)) {
    pushMatch(
      out,
      profile,
      mention,
      "source_text_filename",
      "medium",
      filenameMentionMatches(mention, rawAnchor),
    );
  }

  return out;
}

function pushMatch(
  out: SourceProfileFileMatch[],
  profile: SourceProfile,
  value: string,
  match_kind: QueryCompilationMatchKind,
  confidence: QueryCompilationContributor["confidence"],
  matched: boolean,
): void {
  if (!matched) return;
  out.push({
    profile,
    value,
    confidence,
    match_kind,
    priority: MATCH_PRIORITY[match_kind] ?? 0,
    high_precision:
      match_kind === "source_path_exact" ||
      match_kind === "source_path_suffix" ||
      (match_kind === "source_alias_path" && normalizePath(value).includes("/")),
  });
}

function aliasFileMatchKind(
  alias: SourceAlias,
  rawAnchor: string,
): QueryCompilationMatchKind | null {
  if (alias.kind === "path" && pathAliasMatches(alias.value, rawAnchor)) {
    return "source_alias_path";
  }
  if (alias.kind === "filename" && basenameAliasMatches(alias.value, rawAnchor)) {
    return "source_alias_filename";
  }
  if (alias.kind === "package" && basenameAliasMatches(alias.value, rawAnchor)) {
    return "source_alias_package";
  }
  return null;
}

function pathAliasMatches(aliasValue: string, rawAnchor: string): boolean {
  const aliasPath = normalizePath(aliasValue);
  const anchorPath = normalizePath(rawAnchor);
  if (aliasPath === anchorPath) return true;
  if (stripExtension(aliasPath) === stripExtension(anchorPath)) return true;
  return anchorPath.includes("/") && aliasPath.endsWith(`/${stripExtension(anchorPath)}`);
}

function basenameAliasMatches(aliasValue: string, rawAnchor: string): boolean {
  const aliasBase = normalizeComparableBasename(aliasValue);
  const anchorBase = normalizeComparableBasename(rawAnchor);
  if (!aliasBase || !anchorBase) return false;
  return aliasBase === anchorBase || stripExtension(aliasBase) === stripExtension(anchorBase);
}

function filenameMentionMatches(mention: string, rawAnchor: string): boolean {
  const mentionBase = normalizeComparableBasename(mention);
  const anchorBase = normalizeComparableBasename(rawAnchor);
  if (!mentionBase || !anchorBase) return false;
  return mentionBase === anchorBase || stripExtension(mentionBase) === stripExtension(anchorBase);
}

function filenameLikeMentions(profile: SourceProfile): string[] {
  const texts = [
    profile.title,
    profile.h1 ?? "",
    profile.intro ?? "",
    ...profile.heading_outline
      .filter((heading) => heading.level >= 2 && heading.level <= 3)
      .map((heading) => heading.text),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(FILENAME_LIKE_RE)) {
      const value = match[0];
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

function bestMatchPerSource(matches: SourceProfileFileMatch[]): SourceProfileFileMatch[] {
  const bySource = new Map<string, SourceProfileFileMatch>();
  for (const match of matches) {
    const existing = bySource.get(match.profile.source_path);
    if (!existing || compareMatches(match, existing) < 0) {
      bySource.set(match.profile.source_path, match);
    }
  }
  return [...bySource.values()];
}

function isAmbiguous(matches: SourceProfileFileMatch[]): boolean {
  if (matches.length <= 1) return false;
  return matches.some((match) => !match.high_precision);
}

function compareMatches(a: SourceProfileFileMatch, b: SourceProfileFileMatch): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (CONFIDENCE_RANK[b.confidence] !== CONFIDENCE_RANK[a.confidence]) {
    return CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
  }
  return a.profile.source_path.localeCompare(b.profile.source_path);
}

function hasTaskSupport(task: string, profile: SourceProfile, rawAnchor: string): boolean {
  const taskTokens = stemmedTokenSet(task);
  if (taskTokens.size === 0) return false;
  const anchorTokens = stemmedTokenSet(rawAnchor);
  for (const token of profileSupportTokens(profile)) {
    if (!taskTokens.has(token)) continue;
    if (anchorTokens.has(token)) continue;
    return true;
  }
  return false;
}

function profileSupportTokens(profile: SourceProfile): Set<string> {
  return stemmedTokenSet(
    [
      profile.source_path,
      profile.title,
      profile.h1 ?? "",
      profile.intro ?? "",
      profile.heading_outline
        .filter((heading) => heading.level >= 2 && heading.level <= 3)
        .map((heading) => heading.text)
        .join(" "),
      profile.aliases.map((alias) => alias.value).join(" "),
    ].join(" "),
  );
}

function demoteAmbiguousConfidence(
  confidence: QueryCompilationContributor["confidence"],
): QueryCompilationContributor["confidence"] {
  if (confidence === "low" || confidence === "ambiguous") return "ambiguous";
  return "low";
}

function groupCurrentChunksBySource(chunks: DocChunk[]): Map<string, DocChunk[]> {
  const out = new Map<string, DocChunk[]>();
  for (const chunk of chunks) {
    if (chunk.status !== "current") continue;
    const list = out.get(chunk.source_path) ?? [];
    list.push(chunk);
    out.set(chunk.source_path, list);
  }
  return out;
}

function representativeChunks(chunks: DocChunk[]): DocChunk[] {
  const sorted = [...chunks].sort((a, b) => {
    if (a.chunk_index !== b.chunk_index) return a.chunk_index - b.chunk_index;
    if (a.heading_level !== b.heading_level) return a.heading_level - b.heading_level;
    return a.version_id.localeCompare(b.version_id);
  });
  const out: DocChunk[] = [];
  const seenScopes = new Set<string>();
  for (const chunk of sorted) {
    const key = scopeKey(chunk.scope);
    if (seenScopes.has(key)) continue;
    seenScopes.add(key);
    out.push(chunk);
    if (out.length >= MAX_SCOPES_PER_SOURCE) break;
  }
  return out;
}

function scopeKey(scope: DocChunk["scope"]): string {
  return JSON.stringify({
    company: scope.company ?? null,
    team: scope.team ?? null,
    project: scope.project ?? null,
    module: scope.module ?? null,
    feature: scope.feature ?? null,
  });
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function normalizeComparableBasename(value: string): string {
  return basename(normalizePath(value));
}

function stripExtension(value: string): string {
  return value.replace(/\.[^.]+$/, "");
}
