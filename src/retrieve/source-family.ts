/**
 * Deterministic source-family graph.
 *
 * Groups top-N candidate sources into families using only deterministic
 * evidence:
 *
 *   - Path hierarchy: same-dir sibling, same-grandparent cousin,
 *     directory-prefix parent/child.
 *   - Sibling-index conventions: `mocking.md` next to `mocking/x.md`,
 *     `index.md`, `README.md` as parent containers of dir siblings.
 *   - Basename similarity: identical stems across unrelated dirs are
 *     treated as cousins (same topical concept indexed twice).
 *   - SourceProfile aliases: shared `package`/`filename`/`path` alias
 *     values at high or medium confidence link two sources into a
 *     family even when the path tree gives no signal.
 *
 * The graph never invents a family from incidental query-token
 * overlap — two unrelated docs that happen to mention the same word
 * stay in different families.
 *
 * Diagnostic-only here; the pairwise adjudicator and ambiguity-aware
 * packing are the consumers.
 */
import type { SourceProfile, AliasConfidence, AliasKind } from "../types/source-profile.js";

export type SourceFamilyRelationship =
  | "parent"
  | "child"
  | "sibling"
  | "cousin"
  | "alone";

export type SourceFamilyMember = {
  source_path: string;
  family_id: string;
  relationship: SourceFamilyRelationship;
  /** Stable, ordered list of evidence strings used to place this member. */
  evidence: string[];
};

export type SourceFamily = {
  family_id: string;
  /** Path of the member chosen as the representative root. */
  root_source_path: string;
  member_paths: string[];
};

export type SourceFamilyGraph = {
  members: SourceFamilyMember[];
  families: SourceFamily[];
};

export type SourceFamilyInput = {
  source_path: string;
  profile: SourceProfile | null;
};

/** Aliases below this confidence are noise and don't link families. */
const STRONG_ALIAS_CONFIDENCES: ReadonlySet<AliasConfidence> = new Set(["high", "medium"]);
/** Alias kinds that survive a same-name across unrelated paths and
 *  still indicate the same product/topic. Title aliases alone are too
 *  generic and do not link. */
const LINKING_ALIAS_KINDS: ReadonlySet<AliasKind> = new Set([
  "package",
  "filename",
  "path",
  "symbol",
  "route",
]);

export function buildSourceFamilyGraph(inputs: SourceFamilyInput[]): SourceFamilyGraph {
  const n = inputs.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i: number): number {
    while (parent[i]! !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const evidence = new Map<number, string[]>();
  for (let i = 0; i < n; i += 1) evidence.set(i, []);

  // Pairwise link checks. n is bounded by SOURCE_SELECTION_TOP_N (50)
  // so O(n^2) is fine.
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const linked = pairwiseLink(inputs[i]!, inputs[j]!);
      if (linked.length > 0) {
        union(i, j);
        evidence.get(i)!.push(...linked);
        evidence.get(j)!.push(...linked);
      }
    }
  }

  // Group by representative root.
  const familyToIndices = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const list = familyToIndices.get(root);
    if (list) list.push(i);
    else familyToIndices.set(root, [i]);
  }

  // Stable family IDs by smallest member index.
  const families: SourceFamily[] = [];
  const familyIdByIndex = new Map<number, string>();
  let familyCounter = 0;
  for (const [, indices] of familyToIndices) {
    indices.sort((a, b) => a - b);
    const familyId = `family_${familyCounter}`;
    familyCounter += 1;
    for (const idx of indices) familyIdByIndex.set(idx, familyId);

    // Pick the root: prefer parent_container basenames (index/README/
    // same-name-as-parent-dir). Fall back to lowest-depth path, then
    // first-in-input.
    const rootIdx = pickRoot(indices, inputs);
    families.push({
      family_id: familyId,
      root_source_path: inputs[rootIdx]!.source_path,
      member_paths: indices.map((i) => inputs[i]!.source_path),
    });
  }

  const members: SourceFamilyMember[] = inputs.map((entry, idx) => {
    const familyId = familyIdByIndex.get(idx)!;
    const family = families.find((f) => f.family_id === familyId)!;
    const relationship = relationshipTo(entry, family);
    return {
      source_path: entry.source_path,
      family_id: familyId,
      relationship,
      evidence: dedupe(evidence.get(idx) ?? []),
    };
  });

  return { members, families };
}

function pairwiseLink(a: SourceFamilyInput, b: SourceFamilyInput): string[] {
  const evidence: string[] = [];
  const aSegs = a.source_path.toLowerCase().split("/");
  const bSegs = b.source_path.toLowerCase().split("/");
  const aDir = aSegs.slice(0, -1);
  const bDir = bSegs.slice(0, -1);
  const aDirJoined = aDir.join("/");
  const bDirJoined = bDir.join("/");
  const aStem = stemOf(aSegs[aSegs.length - 1] ?? "");
  const bStem = stemOf(bSegs[bSegs.length - 1] ?? "");
  const sharedBasename = aStem.length >= 4 && aStem === bStem;
  const aliasMatch = sharedLinkingAlias(a.profile, b.profile);

  // Sibling-index parent/child: one path's stem-as-dir is a prefix of
  // the other (`docs/mocking.md` and `docs/mocking/x.md`).
  const aStemDir = (aDir.length > 0 ? aDirJoined + "/" : "") + aStem + "/";
  if (bDirJoined === aStemDir.replace(/\/$/, "") || bDirJoined.startsWith(aStemDir)) {
    evidence.push("sibling_index_parent_of_dir");
  }
  const bStemDir = (bDir.length > 0 ? bDirJoined + "/" : "") + bStem + "/";
  if (aDirJoined === bStemDir.replace(/\/$/, "") || aDirJoined.startsWith(bStemDir)) {
    evidence.push("sibling_index_parent_of_dir");
  }

  // Same-dir sibling — only links when the parent dir is specific
  // enough (≥ 2 path segments). A bare `docs/` parent links every
  // doc in the corpus and is too eager.
  if (aDir.length >= 2 && aDirJoined === bDirJoined) {
    evidence.push("same_parent_dir");
  }

  // Same grandparent dir cousin — only when the grandparent itself is
  // specific (≥ 2 segments) OR there is corroborating basename/alias.
  if (
    aDir.length >= 2 &&
    bDir.length >= 2 &&
    aDir.slice(0, -1).join("/") === bDir.slice(0, -1).join("/") &&
    aDirJoined !== bDirJoined
  ) {
    const grandLength = aDir.length - 1;
    if (grandLength >= 2 || sharedBasename || aliasMatch) {
      evidence.push("same_grandparent_dir");
    }
  }

  // Identical stems across unrelated dirs (basename similarity). Only
  // counts at length ≥ 4 so generic stems ("doc", "api") don't link.
  if (sharedBasename) {
    evidence.push(`shared_basename:${aStem}`);
  }

  // Shared linking aliases.
  if (aliasMatch) evidence.push(`shared_alias:${aliasMatch}`);

  return evidence;
}

function sharedLinkingAlias(a: SourceProfile | null, b: SourceProfile | null): string | null {
  if (!a || !b) return null;
  const aSet = new Map<string, AliasKind>();
  for (const alias of a.aliases) {
    if (!STRONG_ALIAS_CONFIDENCES.has(alias.confidence)) continue;
    if (!LINKING_ALIAS_KINDS.has(alias.kind)) continue;
    aSet.set(`${alias.kind}:${alias.value.toLowerCase()}`, alias.kind);
  }
  for (const alias of b.aliases) {
    if (!STRONG_ALIAS_CONFIDENCES.has(alias.confidence)) continue;
    if (!LINKING_ALIAS_KINDS.has(alias.kind)) continue;
    const key = `${alias.kind}:${alias.value.toLowerCase()}`;
    if (aSet.has(key)) return key;
  }
  return null;
}

function stemOf(basename: string): string {
  return basename.replace(/\.[^.]*$/, "").toLowerCase();
}

function pickRoot(indices: number[], inputs: SourceFamilyInput[]): number {
  // Prefer index/README, then files whose stem matches their parent
  // dir name, then lowest-depth path.
  const ranked = [...indices].sort((aIdx, bIdx) => {
    const aRank = parentRank(inputs[aIdx]!.source_path);
    const bRank = parentRank(inputs[bIdx]!.source_path);
    if (aRank !== bRank) return aRank - bRank;
    const aDepth = inputs[aIdx]!.source_path.split("/").length;
    const bDepth = inputs[bIdx]!.source_path.split("/").length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return aIdx - bIdx;
  });
  return ranked[0]!;
}

function parentRank(source_path: string): number {
  const segs = source_path.toLowerCase().split("/");
  const stem = stemOf(segs[segs.length - 1] ?? "");
  const parentDir = segs[segs.length - 2] ?? "";
  if (stem === "index" || stem === "readme") return 0;
  if (parentDir && stem === parentDir) return 1;
  return 2;
}

function relationshipTo(
  entry: SourceFamilyInput,
  family: SourceFamily,
): SourceFamilyRelationship {
  if (family.member_paths.length === 1) return "alone";

  const otherPaths = family.member_paths.filter((p) => p !== entry.source_path);
  // Am I a parent of any other family member?
  if (otherPaths.some((other) => isParentOf(entry.source_path, other))) {
    return "parent";
  }
  // Is any other family member a parent of me?
  if (otherPaths.some((other) => isParentOf(other, entry.source_path))) {
    return "child";
  }
  // Sibling: at least one other member shares my parent dir.
  const myDir = dirOf(entry.source_path);
  if (otherPaths.some((other) => dirOf(other) === myDir && myDir.length > 0)) {
    return "sibling";
  }
  return "cousin";
}

function isParentOf(parentPath: string, childPath: string): boolean {
  const pSegs = parentPath.toLowerCase().split("/");
  const cSegs = childPath.toLowerCase().split("/");
  const pStem = stemOf(pSegs[pSegs.length - 1] ?? "");
  const pDir = pSegs.slice(0, -1).join("/");
  const cDir = cSegs.slice(0, -1).join("/");

  // README/index in the same dir as child is its parent.
  if ((pStem === "readme" || pStem === "index") && pDir === cDir) return true;

  // Sibling-index: parent's stem-dir is the child's dir or a strict
  // prefix of it (`docs/mocking.md` parent of `docs/mocking/x.md`).
  const stemDir = (pDir ? pDir + "/" : "") + pStem;
  if (cDir === stemDir || cDir.startsWith(stemDir + "/")) return true;

  return false;
}

function dirOf(p: string): string {
  return p.toLowerCase().split("/").slice(0, -1).join("/");
}

function dedupe<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
