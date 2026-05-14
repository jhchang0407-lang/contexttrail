import type { Card, CardLink } from "../types/card.js";
import type { CodeAnchor, DocChunk } from "../types/chunk.js";
import type { PackResult, IncludedTrace, OmittedTrace } from "./pack.js";
import type { QueryCompilation, QueryMode } from "./query-scope.js";
import type { QueryAnchors, ScoreTrace } from "./score.js";

export const ASSEMBLY_STAGES = [
  "not_applicable",
  "primary_only",
  "parent",
  "siblings",
  "source_sibling",
  "linked_neighbor",
] as const;

export type StructuralAssemblyStage = (typeof ASSEMBLY_STAGES)[number];
export type StructuralNeighborRelation = Exclude<StructuralAssemblyStage, "not_applicable" | "primary_only">;

export type StructuralNeighborSelection = {
  version_id: string;
  relation: StructuralNeighborRelation;
  reason: string;
};

export type StructuralAssemblyMetadata = {
  stage_reached: StructuralAssemblyStage;
  root_version_id?: string;
  selected_neighbors: StructuralNeighborSelection[];
  early_stop_reason?: string;
};

export type ApplyStructuralAssemblyArgs = {
  query: string;
  query_mode: QueryMode;
  query_anchors: QueryAnchors;
  query_compilation: QueryCompilation;
  pack: PackResult;
  chunksByVersionId: Map<string, DocChunk>;
  cardsByCardId: Map<string, Card>;
  chunkTracesByVersionId: Map<string, ScoreTrace>;
  cardTracesByCardId: Map<string, ScoreTrace>;
  chunkAnchorsByVersionId: Map<string, CodeAnchor[]>;
  cardLinksByCardId: Map<string, CardLink[]>;
};

export type StructuralAssemblyResult = {
  pack: PackResult;
  metadata: StructuralAssemblyMetadata;
};

const RATIONALE_QUERY_PATTERN =
  /\b(why|decision|decisions|rationale|tradeoff|tradeoffs|adr|because|govern|security)\b/i;

export function applyStructuralAssembly(
  args: ApplyStructuralAssemblyArgs,
): StructuralAssemblyResult {
  const rootVersionId =
    args.query_mode === "anchored"
      ? resolveAssemblyRoot(args)
      : resolveUnanchoredAssemblyRoot(args);
  if (rootVersionId === undefined) {
    return {
      pack: args.pack,
      metadata: { stage_reached: "not_applicable", selected_neighbors: [] },
    };
  }

  const root = args.chunksByVersionId.get(rootVersionId);
  if (!root) {
    return {
      pack: args.pack,
      metadata: { stage_reached: "not_applicable", selected_neighbors: [] },
    };
  }

  if (args.query_mode !== "anchored") {
    const sourceSiblingSelection = selectSourceSibling(root, args);
    if (!sourceSiblingSelection) {
      return {
        pack: args.pack,
        metadata: { stage_reached: "not_applicable", selected_neighbors: [] },
      };
    }
    return {
      pack: rebuildPackWithStructuralPriority(args.pack, rootVersionId, [sourceSiblingSelection], args),
      metadata: {
        stage_reached: "source_sibling",
        root_version_id: rootVersionId,
        selected_neighbors: [sourceSiblingSelection],
        early_stop_reason: "unanchored onboarding source sibling added",
      },
    };
  }

  const siblingSelection = selectSibling(root, args);
  const linkedSelection = selectLinkedNeighbor(root, args);
  const parentSelection = selectParent(root, args);

  let stage: StructuralAssemblyStage = "primary_only";
  let selectedNeighbors: StructuralNeighborSelection[] = [];

  if (linkedSelection && shouldSeekRationale(args.query)) {
    stage = "linked_neighbor";
    selectedNeighbors = [linkedSelection];
  } else if (siblingSelection && shouldExpandSiblings(args.query_compilation, args.query)) {
    stage = "siblings";
    selectedNeighbors = [siblingSelection];
  } else if (parentSelection) {
    stage = "parent";
    selectedNeighbors = [parentSelection];
  }

  const nextPack =
    selectedNeighbors.length === 0
      ? args.pack
      : rebuildPackWithStructuralPriority(args.pack, rootVersionId, selectedNeighbors, args);

  return {
    pack: nextPack,
    metadata: {
      stage_reached: stage,
      root_version_id: rootVersionId,
      selected_neighbors: selectedNeighbors,
      early_stop_reason:
        stage === "primary_only" ? "root chunk was sufficient without structural expansion" : "first sufficient structural stage",
    },
  };
}

function resolveAssemblyRoot(args: ApplyStructuralAssemblyArgs): string | undefined {
  const scoredIncluded = [...args.pack.included].sort(compareTraceScoreDesc);
  const top = scoredIncluded[0];
  if (!top) return undefined;

  const implementationPreferred = preferAnchoredImplementationRoot(scoredIncluded, args);
  if (implementationPreferred) return implementationPreferred;

  if (top.kind === "doc_chunk") return top.version_id;
  if (top.kind === "code") return bestIncludedChunkId(scoredIncluded);

  const links = args.cardLinksByCardId.get(top.card_id) ?? [];
  if (links.length === 0) return bestIncludedChunkId(scoredIncluded);

  const queryKeys = anchorKeysFromQuery(args.query_anchors);
  const linked = links
    .map((link) => {
      const trace = args.chunkTracesByVersionId.get(link.version_pin);
      if (!trace) return undefined;
      const anchors = args.chunkAnchorsByVersionId.get(link.version_pin) ?? [];
      const overlap = countOverlap(queryKeys, new Set(anchors.map(anchorKey)));
      return { version_id: link.version_pin, overlap, final_score: trace.final_score };
    })
    .filter((entry): entry is { version_id: string; overlap: number; final_score: number } => entry !== undefined)
    .sort((a, b) => b.overlap - a.overlap || b.final_score - a.final_score || a.version_id.localeCompare(b.version_id));

  return linked[0]?.version_id ?? bestIncludedChunkId(scoredIncluded);
}

function resolveUnanchoredAssemblyRoot(args: ApplyStructuralAssemblyArgs): string | undefined {
  const best = args.pack.included
    .filter((entry): entry is Extract<IncludedTrace, { kind: "doc_chunk" }> => entry.kind === "doc_chunk")
    .sort((a, b) => {
      const selectionBias = compareOptionalRank(a.source_selection_rank, b.source_selection_rank);
      if (selectionBias !== 0) return selectionBias;
      const rerankBias = compareOptionalRank(a.source_rerank_rank, b.source_rerank_rank);
      if (rerankBias !== 0) return rerankBias;
      return compareTraceScoreDesc(a, b);
    })[0];
  return best?.version_id;
}

function preferAnchoredImplementationRoot(
  included: IncludedTrace[],
  args: ApplyStructuralAssemblyArgs,
): string | undefined {
  if (!shouldSeekRationale(args.query)) return undefined;
  const queryKeys = anchorKeysFromQuery(args.query_anchors);
  const candidates = included
    .filter((entry): entry is Extract<IncludedTrace, { kind: "doc_chunk" }> => entry.kind === "doc_chunk")
    .map((entry) => {
      const chunk = args.chunksByVersionId.get(entry.version_id);
      if (!chunk) return undefined;
      const anchors = new Set((args.chunkAnchorsByVersionId.get(entry.version_id) ?? []).map(anchorKey));
      const overlap = countOverlap(queryKeys, anchors);
      return { chunk, final_score: entry.final_score, overlap };
    })
    .filter(
      (
        candidate,
      ): candidate is { chunk: DocChunk; final_score: number; overlap: number } => candidate !== undefined,
    )
    .filter((candidate) => candidate.chunk.scope.layer !== "decision" && !/\/adr\//i.test(candidate.chunk.source_path))
    .filter((candidate) => candidate.overlap > 0)
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        b.final_score - a.final_score ||
        a.chunk.version_id.localeCompare(b.chunk.version_id),
    );
  return candidates[0]?.chunk.version_id;
}

function bestIncludedChunkId(included: IncludedTrace[]): string | undefined {
  const best = included.filter((entry) => entry.kind === "doc_chunk").sort(compareTraceScoreDesc)[0];
  return best?.version_id;
}

function selectParent(
  root: DocChunk,
  args: ApplyStructuralAssemblyArgs,
): StructuralNeighborSelection | undefined {
  if (root.heading_path.length <= 1) return undefined;
  const parentHeadingPath = root.heading_path.slice(0, -1);
  const parent = [...args.chunksByVersionId.values()]
    .filter((chunk) => chunk.source_path === root.source_path)
    .find((chunk) => sameHeadingPath(chunk.heading_path, parentHeadingPath));
  if (!parent) return undefined;
  return {
    version_id: parent.version_id,
    relation: "parent",
    reason: "immediate parent section",
  };
}

function selectSibling(
  root: DocChunk,
  args: ApplyStructuralAssemblyArgs,
): StructuralNeighborSelection | undefined {
  const parentHeadingPath = root.heading_path.slice(0, -1);
  const rootAnchors = new Set((args.chunkAnchorsByVersionId.get(root.version_id) ?? []).map(anchorKey));
  const queryTokens = lexicalTokens(args.query);
  const siblings = [...args.chunksByVersionId.values()]
    .filter((chunk) => chunk.source_path === root.source_path)
    .filter((chunk) => chunk.version_id !== root.version_id)
    .filter((chunk) => chunk.heading_path.length === root.heading_path.length)
    .filter((chunk) => sameHeadingPath(chunk.heading_path.slice(0, -1), parentHeadingPath))
    .map((chunk) => {
      const headingBody = `${chunk.heading_path.join(" ")} ${chunk.body}`;
      const lexical = lexicalOverlap(queryTokens, lexicalTokens(headingBody));
      const anchorOverlap = countOverlap(
        rootAnchors,
        new Set((args.chunkAnchorsByVersionId.get(chunk.version_id) ?? []).map(anchorKey)),
      );
      const distance = Math.abs(chunk.start_line - root.start_line);
      const score = lexical + anchorOverlap * 0.25 + (distance <= 40 ? 0.2 : 0);
      return { chunk, score, lexical };
    })
    .filter((candidate) => candidate.score > 0.15 && candidate.lexical > 0)
    .sort((a, b) => b.score - a.score || a.chunk.start_line - b.chunk.start_line || a.chunk.version_id.localeCompare(b.chunk.version_id));

  const best = siblings[0];
  if (!best) return undefined;
  return {
    version_id: best.chunk.version_id,
    relation: "siblings",
    reason: "adjacent sibling with lexical overlap",
  };
}

function selectSourceSibling(
  root: DocChunk,
  args: ApplyStructuralAssemblyArgs,
): StructuralNeighborSelection | undefined {
  if (!shouldExpandOnboardingSourceSiblings(root, args.query)) return undefined;

  const rootDir = parentDir(root.source_path);
  if (rootDir === "") return undefined;

  const bySource = new Map<string, { chunk: DocChunk; trace: ScoreTrace; score: number }>();
  for (const chunk of args.chunksByVersionId.values()) {
    if (chunk.source_path === root.source_path) continue;
    if (parentDir(chunk.source_path) !== rootDir) continue;
    if (chunk.status !== "current") continue;

    const trace = args.chunkTracesByVersionId.get(chunk.version_id);
    if (!trace || trace.final_score < 0.05) continue;

    const priority = onboardingSourcePriority(chunk.source_path);
    if (priority <= 0) continue;

    const score = priority + trace.final_score * 0.05 - chunk.chunk_index * 1e-4;
    const existing = bySource.get(chunk.source_path);
    if (
      !existing ||
      score > existing.score ||
      (score === existing.score && chunk.version_id < existing.chunk.version_id)
    ) {
      bySource.set(chunk.source_path, { chunk, trace, score });
    }
  }

  const best = [...bySource.values()].sort(
    (a, b) =>
      b.score - a.score ||
      b.trace.final_score - a.trace.final_score ||
      a.chunk.source_path.localeCompare(b.chunk.source_path) ||
      a.chunk.version_id.localeCompare(b.chunk.version_id),
  )[0];

  if (!best) return undefined;
  return {
    version_id: best.chunk.version_id,
    relation: "source_sibling",
    reason: "same-directory onboarding source sibling",
  };
}

function selectLinkedNeighbor(
  root: DocChunk,
  args: ApplyStructuralAssemblyArgs,
): StructuralNeighborSelection | undefined {
  const rootAnchors = new Set((args.chunkAnchorsByVersionId.get(root.version_id) ?? []).map(anchorKey));
  const queryKeys = anchorKeysFromQuery(args.query_anchors);
  const candidates = [...args.chunksByVersionId.values()]
    .filter((chunk) => chunk.source_path !== root.source_path)
    .filter((chunk) => chunk.scope.project !== undefined && chunk.scope.project === root.scope.project)
    .filter((chunk) => chunk.scope.layer === "decision" || /\/adr\//i.test(chunk.source_path))
    .map((chunk) => {
      const anchors = new Set((args.chunkAnchorsByVersionId.get(chunk.version_id) ?? []).map(anchorKey));
      const rootOverlap = countOverlap(rootAnchors, anchors);
      const queryOverlap = countOverlap(queryKeys, anchors);
      const trace = args.chunkTracesByVersionId.get(chunk.version_id);
      return {
        chunk,
        score: rootOverlap * 2 + queryOverlap * 2 + (trace?.final_score ?? 0),
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.version_id.localeCompare(b.chunk.version_id));

  const best = candidates[0];
  if (!best) return undefined;
  return {
    version_id: best.chunk.version_id,
    relation: "linked_neighbor",
    reason: "shared anchored rationale signal",
  };
}

function rebuildPackWithStructuralPriority(
  pack: PackResult,
  rootVersionId: string,
  selectedNeighbors: StructuralNeighborSelection[],
  args: ApplyStructuralAssemblyArgs,
): PackResult {
  const originalUniverse = new Map<string, IncludedTrace | OmittedTrace>();
  for (const entry of pack.included) originalUniverse.set(entry.version_id, entry);
  for (const entry of pack.omitted) originalUniverse.set(entry.version_id, entry);

  const preferredOrder = [
    rootVersionId,
    ...selectedNeighbors.map((selection) => selection.version_id),
    ...pack.included.map((entry) => entry.version_id),
  ].filter((version_id, index, all) => all.indexOf(version_id) === index);

  const requested = pack.budget.requested;
  const lockedTotal = pack.locked.reduce((sum, entry) => sum + entry.token_count, 0);
  const remainingBudget = Math.max(0, requested - lockedTotal);
  const included: IncludedTrace[] = [];
  const includedIds = new Set<string>();
  let used = 0;

  for (const version_id of preferredOrder) {
    const candidate = candidateAsIncluded(version_id, originalUniverse.get(version_id), args);
    if (!candidate || includedIds.has(version_id)) continue;
    if (used + candidate.token_count > remainingBudget) continue;
    included.push(candidate);
    includedIds.add(version_id);
    used += candidate.token_count;
  }

  const omitted: OmittedTrace[] = [];
  for (const [version_id, candidate] of originalUniverse.entries()) {
    if (includedIds.has(version_id)) continue;
    if (candidate && "omitted_reason" in candidate) {
      omitted.push(candidate);
      continue;
    }
    const displaced = candidateAsIncluded(version_id, candidate, args);
    if (!displaced) continue;
    omitted.push({
      ...displaced,
      omitted_reason: "budget",
      reason: "deprioritized by structural assembly within fixed pack budget",
    });
  }

  return {
    ...pack,
    included,
    omitted,
    total_tokens: lockedTotal + used,
    budget: {
      ...pack.budget,
      used: lockedTotal + used,
    },
  };
}

function candidateAsIncluded(
  version_id: string,
  candidate: IncludedTrace | OmittedTrace | undefined,
  args: ApplyStructuralAssemblyArgs,
): IncludedTrace | undefined {
  if (candidate && candidate.kind === "code") {
    if ("omitted_reason" in candidate) {
      const {
        omitted_reason: _omittedReason,
        reason: _reason,
        ...trace
      } = candidate;
      return trace;
    }
    return candidate;
  }
  if (candidate && candidate.kind === "doc_chunk") {
    return {
      version_id: candidate.version_id,
      bm25_norm: candidate.bm25_norm,
      heading_match: candidate.heading_match,
      scope_match: candidate.scope_match,
      mention_overlap: candidate.mention_overlap,
      specificity: candidate.specificity,
      text_score: candidate.text_score,
      final_score: candidate.final_score,
      token_count: candidate.token_count,
      packing_score: candidate.packing_score,
      structural_multiplier: candidate.structural_multiplier,
      doc_role: candidate.doc_role,
      role_source: candidate.role_source,
      role_multiplier: candidate.role_multiplier,
      kind: "doc_chunk",
      source_rerank_rank: candidate.source_rerank_rank,
      source_selection_rank: candidate.source_selection_rank,
    };
  }

  if (candidate && candidate.kind === "card") {
    return {
      version_id: candidate.version_id,
      bm25_norm: candidate.bm25_norm,
      heading_match: candidate.heading_match,
      scope_match: candidate.scope_match,
      mention_overlap: candidate.mention_overlap,
      specificity: candidate.specificity,
      text_score: candidate.text_score,
      final_score: candidate.final_score,
      token_count: candidate.token_count,
      packing_score: candidate.packing_score,
      structural_multiplier: candidate.structural_multiplier,
      doc_role: candidate.doc_role,
      role_source: candidate.role_source,
      role_multiplier: candidate.role_multiplier,
      kind: "card",
      card_id: candidate.card_id,
      card_type: candidate.card_type,
    };
  }

  const chunkTrace = args.chunkTracesByVersionId.get(version_id);
  if (chunkTrace) {
    return { ...chunkTrace, kind: "doc_chunk" };
  }
  const cardTrace = [...args.cardTracesByCardId.entries()].find(([, trace]) => trace.version_id === version_id);
  if (cardTrace) {
    const [cardId, trace] = cardTrace;
    const card = args.cardsByCardId.get(cardId);
    if (!card) return undefined;
    return { ...trace, kind: "card", card_id: cardId, card_type: card.type };
  }
  return undefined;
}

function shouldSeekRationale(query: string): boolean {
  return RATIONALE_QUERY_PATTERN.test(query);
}

function shouldExpandSiblings(compilation: QueryCompilation, query: string): boolean {
  if (compilation.anchors.length >= 2) return true;
  return /\b(and|alongside|together|plus|also|both)\b/i.test(query);
}

function shouldExpandOnboardingSourceSiblings(root: DocChunk, query: string): boolean {
  const source = root.source_path.toLowerCase();
  const queryLower = query.toLowerCase();
  if (
    !/\b(add|adding|start|started|setup|install|onboard|bootstrap|new|initial)\b/.test(queryLower)
  ) {
    return false;
  }
  return (
    source.includes("/getting-started/") ||
    source.includes("/quick-start") ||
    source.includes("/quickstart") ||
    source.includes("/installation") ||
    source.includes("/install") ||
    source.includes("/setup") ||
    source.includes("/add-to-existing")
  );
}

function onboardingSourcePriority(sourcePath: string): number {
  const base = basenameWithoutExtension(sourcePath).toLowerCase();
  if (/^(installation|install)$/.test(base)) return 5;
  if (/^(setup|getting-started|quick-start|quickstart)$/.test(base)) return 4;
  if (/^(index|overview)$/.test(base)) return 3;
  if (base.includes("add-to-existing")) return 2;
  return 0;
}

function compareTraceScoreDesc(a: { final_score: number; version_id: string }, b: { final_score: number; version_id: string }): number {
  return b.final_score - a.final_score || a.version_id.localeCompare(b.version_id);
}

function compareOptionalRank(a?: number, b?: number): number {
  if (a !== undefined && b !== undefined && a !== b) return a - b;
  if (a !== undefined && b === undefined) return -1;
  if (a === undefined && b !== undefined) return 1;
  return 0;
}

function sameHeadingPath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function basenameWithoutExtension(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

function lexicalTokens(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

function lexicalOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  return countOverlap(a, b) / new Set([...a, ...b]).size;
}

function anchorKey(anchor: Pick<CodeAnchor, "kind" | "value">): string {
  return `${anchor.kind}:${anchor.value}`;
}

function anchorKeysFromQuery(query: QueryAnchors): Set<string> {
  const keys = new Set<string>();
  for (const file of query.files ?? []) keys.add(`file:${file}`);
  for (const symbol of query.symbols ?? []) keys.add(`symbol:${symbol}`);
  for (const route of query.routes ?? []) keys.add(`route:${route}`);
  return keys;
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const key of a) if (b.has(key)) count++;
  return count;
}
