/**
 * Source-scoped chunk selector for PRD-0015 Slice 3.
 *
 * Once a source has been selected, this module decides which chunks
 * inside that source should enter the Context Pack. It receives all
 * source-local chunk candidates, the task's named needs, and an
 * optional token budget; it returns ordered selections (each with a
 * stable reason) plus an `omitted` list when budget pressure forces
 * trade-offs.
 *
 * Reasons follow PRD-0015 §Deep Modules:
 *   - "primary"          best-scoring chunk in the source
 *   - "intro"            source intro / first-section orientation
 *   - "parent"           the parent section above the primary
 *   - "sibling"          a same-parent neighbor (e.g. setup/install steps)
 *   - "linked_neighbor"  directly linked / referenced section
 *   - "exact_heading"    exact-heading match for an anchored task
 */
import type { TaskNeed } from "./task-need.js";

export const CHUNK_SELECTION_REASONS = [
  "primary",
  "intro",
  "parent",
  "sibling",
  "linked_neighbor",
  "exact_heading",
] as const;
export type ChunkSelectionReason = typeof CHUNK_SELECTION_REASONS[number];

export type SourceChunkCandidate = {
  id: string;
  source_path: string;
  heading_path: string[];
  heading_level: number;
  chunk_index: number;
  chunk_count: number;
  score: number;
  tokens?: number;
};

export type ChunkSelection = {
  chunkId: string;
  reason: ChunkSelectionReason;
};

export type ChunkOmission = {
  chunkId: string;
  /** Reason the chunk was dropped after being a candidate addition. */
  omitReason: "budget";
  /** Reason the chunk would have been added if budget allowed. */
  intendedReason: ChunkSelectionReason;
};

export type ChunkSelectorInputs = {
  sourcePath: string;
  candidates: SourceChunkCandidate[];
  needs: TaskNeed[];
  budgetTokens?: number;
};

export type ChunkSelectorResult = {
  selections: ChunkSelection[];
  omitted: ChunkOmission[];
};

export function selectSourceScopedChunks(
  inputs: ChunkSelectorInputs,
): ChunkSelectorResult {
  const local = inputs.candidates.filter((c) => c.source_path === inputs.sourcePath);
  if (local.length === 0) return { selections: [], omitted: [] };

  const primary = pickPrimary(local);
  const considered = new Set<string>([primary.id]);
  const intended: { candidate: SourceChunkCandidate; reason: ChunkSelectionReason }[] = [
    { candidate: primary, reason: "primary" },
  ];

  if (inputs.needs.includes("overview_orientation")) {
    const intro = pickIntro(local);
    if (intro && !considered.has(intro.id)) {
      considered.add(intro.id);
      intended.push({ candidate: intro, reason: "intro" });
    }
  }

  if (inputs.needs.includes("setup_install")) {
    const sibling = pickSibling(local, primary, considered);
    if (sibling) {
      considered.add(sibling.id);
      intended.push({ candidate: sibling, reason: "sibling" });
    }
  }

  if (inputs.needs.includes("decision_rationale")) {
    const parent = pickParent(local, primary, considered) ??
      pickRationaleSection(local, considered);
    if (parent) {
      considered.add(parent.id);
      intended.push({ candidate: parent, reason: "parent" });
    }
  }

  return applyBudget(intended, inputs.budgetTokens);
}

function applyBudget(
  intended: { candidate: SourceChunkCandidate; reason: ChunkSelectionReason }[],
  budgetTokens?: number,
): ChunkSelectorResult {
  const selections: ChunkSelection[] = [];
  const omitted: ChunkOmission[] = [];
  let used = 0;
  for (const item of intended) {
    const cost = item.candidate.tokens ?? 0;
    if (budgetTokens !== undefined && used + cost > budgetTokens && selections.length > 0) {
      omitted.push({
        chunkId: item.candidate.id,
        omitReason: "budget",
        intendedReason: item.reason,
      });
      continue;
    }
    selections.push({ chunkId: item.candidate.id, reason: item.reason });
    used += cost;
  }
  return { selections, omitted };
}

function pickParent(
  candidates: SourceChunkCandidate[],
  primary: SourceChunkCandidate,
  selected: Set<string>,
): SourceChunkCandidate | undefined {
  if (primary.heading_path.length < 2) return undefined;
  const parentPath = primary.heading_path.slice(0, -1);
  const parentKey = parentPath.join(" > ");
  // Parent chunk has heading_path equal to the parent path of the primary.
  const matches = candidates.filter((c) => {
    if (selected.has(c.id)) return false;
    return c.heading_path.join(" > ") === parentKey;
  });
  if (matches.length === 0) return undefined;
  return matches.reduce((best, c) => (c.score > best.score ? c : best));
}

const RATIONALE_HEADING_PATTERN = /\b(why|rationale|decision|trade[- ]?off|problem|works?|how|concept|context|consequence)s?\b/i;

function pickRationaleSection(
  candidates: SourceChunkCandidate[],
  selected: Set<string>,
): SourceChunkCandidate | undefined {
  let best:
    | { candidate: SourceChunkCandidate; rationaleScore: number }
    | undefined;
  for (const candidate of candidates) {
    if (selected.has(candidate.id)) continue;
    const leafHeading = candidate.heading_path[candidate.heading_path.length - 1] ?? "";
    if (!RATIONALE_HEADING_PATTERN.test(leafHeading)) continue;
    const depthPenalty = Math.max(0, candidate.heading_path.length - 1) * 0.25;
    const rationaleScore = 1 - depthPenalty + candidate.score * 0.001;
    if (!best || rationaleScore > best.rationaleScore) {
      best = { candidate, rationaleScore };
    }
  }
  return best?.candidate;
}

function pickPrimary(candidates: SourceChunkCandidate[]): SourceChunkCandidate {
  let best = candidates[0]!;
  for (const c of candidates) {
    if (c.score > best.score) best = c;
  }
  return best;
}

function pickSibling(
  candidates: SourceChunkCandidate[],
  primary: SourceChunkCandidate,
  selected: Set<string>,
): SourceChunkCandidate | undefined {
  if (primary.heading_path.length === 0) return undefined;
  const parentPath = primary.heading_path.slice(0, -1);
  if (parentPath.length === 0) return undefined;
  const parentKey = parentPath.join(" > ");
  const siblings = candidates.filter((c) => {
    if (selected.has(c.id)) return false;
    if (c.heading_path.length !== primary.heading_path.length) return false;
    return c.heading_path.slice(0, -1).join(" > ") === parentKey;
  });
  if (siblings.length === 0) return undefined;
  // Prefer the highest-scoring sibling (most relevant evidence still
  // grouped under the same parent).
  return siblings.reduce((best, c) => (c.score > best.score ? c : best));
}

function pickIntro(candidates: SourceChunkCandidate[]): SourceChunkCandidate | undefined {
  // Source intro = shallowest heading_level, earliest in document order.
  const sorted = [...candidates].sort((a, b) => {
    if (a.heading_level !== b.heading_level) return a.heading_level - b.heading_level;
    if (a.heading_path.length !== b.heading_path.length) return a.heading_path.length - b.heading_path.length;
    return a.chunk_index - b.chunk_index;
  });
  return sorted[0];
}
