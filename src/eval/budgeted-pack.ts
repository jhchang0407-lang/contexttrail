import type { PresentedContextPack } from "../mcp/presenter.js";

export type BudgetedRankedEntry = PresentedContextPack["ranked"][number];

/**
 * PRD-0032 / slice 32.2 — kind-balanced packing.
 *
 * Audit (`docs/evals/prd-0032-composition-audit.md`) found that 23/26
 * (88.5%) of dropped agent-completion targets at 16k are kind_displaced:
 * the budget is consumed entirely by `chunk` entries before greedy-fit
 * reaches any `code` entry. Reserving a share of the post-locked budget
 * for `code` kind allows code-source entries to enter the pack even when
 * doc-chunks would otherwise dominate the budget.
 *
 * Reservation share: 30% of post-locked budget. Chosen from audit
 * evidence — the 23 displaced code entries average ~212 tokens; 30% of
 * 16k post-locked budget reserves ~4915 tokens, admitting ~23 code
 * entries comfortably while leaving 70% for chunks. Higher shares risk
 * displacing useful doc-chunks on doc-heavy corpora.
 *
 * Activation: the lever only fires when the pack contains at least one
 * `code` kind entry. On code-less corpora (e.g. parts of the 174-case
 * OSS panel) the reservation is structurally inert because no code
 * entry needs the reserved slots — the slack pass admits non-code
 * entries into the full remaining budget.
 *
 * Flag: `RETRIEVAL_PACK_KIND_BALANCED`. Default flipped to **on**
 * in slice 32.3 after verification confirmed +13 files at 16k with
 * no untargeted regression. Set the env var to `"false"` to disable
 * and recover bit-identical greedy-fit-by-rank behavior.
 */
const KIND_BALANCED_CODE_SHARE = 0.3;

function kindBalancedEnabledFromEnv(): boolean {
  return process.env.RETRIEVAL_PACK_KIND_BALANCED !== "false";
}

/**
 * Eval-only view of a fully assembled ranked list under a concrete token
 * budget. The production presenter already packs the base retrieval result,
 * but traversal/code eval paths can append candidates afterwards; PRD-0030
 * needs to measure only the entries that would still fit.
 *
 * When `RETRIEVAL_PACK_KIND_BALANCED` is on, the truncation uses a
 * two-pass kind-reserved policy (see comment above). When off,
 * pure-greedy-fit by rank is preserved bit-identically.
 */
export function budgetedRankedEntries(
  pack: PresentedContextPack,
  requestedBudget = pack.budget.requested,
): BudgetedRankedEntry[] {
  const lockedTokens = pack.locked.reduce((sum, entry) => sum + entry.tokens, 0);
  const remainingBudget = Math.max(0, requestedBudget - lockedTokens);

  if (!kindBalancedEnabledFromEnv()) {
    return greedyFitByRank(pack.ranked, remainingBudget);
  }

  return kindBalancedPack(pack.ranked, remainingBudget);
}

function greedyFitByRank(
  ranked: readonly BudgetedRankedEntry[],
  remainingBudget: number,
): BudgetedRankedEntry[] {
  const out: BudgetedRankedEntry[] = [];
  let used = 0;
  for (const entry of ranked) {
    if (used + entry.tokens > remainingBudget) continue;
    out.push(entry);
    used += entry.tokens;
  }
  return out;
}

function kindBalancedPack(
  ranked: readonly BudgetedRankedEntry[],
  remainingBudget: number,
): BudgetedRankedEntry[] {
  // Inert on code-less corpora: if no code entry exists, behavior must
  // be identical to greedy-fit. This protects doc-heavy panels (e.g.
  // 174-case OSS) from any reservation overhead.
  const hasCodeEntry = ranked.some((entry) => entry.kind === "code");
  if (!hasCodeEntry) {
    return greedyFitByRank(ranked, remainingBudget);
  }

  const codeReserve = Math.floor(remainingBudget * KIND_BALANCED_CODE_SHARE);
  const otherReserve = remainingBudget - codeReserve;

  const admittedIds = new Set<string>();
  let codeUsed = 0;
  let otherUsed = 0;

  // Pass 1: per-kind reservation — admit each kind in rank order up to
  // its reserved share. Smaller-later entries within a kind still benefit
  // from greedy-fit's reorder behavior (a large early code entry that
  // doesn't fit the code reserve gets skipped, and a smaller later code
  // entry can claim the slack).
  for (const entry of ranked) {
    if (entry.kind === "code") {
      if (codeUsed + entry.tokens <= codeReserve) {
        admittedIds.add(entry.id);
        codeUsed += entry.tokens;
      }
    } else {
      if (otherUsed + entry.tokens <= otherReserve) {
        admittedIds.add(entry.id);
        otherUsed += entry.tokens;
      }
    }
  }

  // Pass 2: slack — distribute unused capacity from either reserve to
  // any remaining unfit entry in rank order. Without this pass, a
  // code-reserved 30% would be wasted on a corpus that happens to have
  // a small number of small code entries.
  let totalUsed = codeUsed + otherUsed;
  for (const entry of ranked) {
    if (admittedIds.has(entry.id)) continue;
    if (totalUsed + entry.tokens <= remainingBudget) {
      admittedIds.add(entry.id);
      totalUsed += entry.tokens;
    }
  }

  // Output preserves rank order — same convention as greedy-fit by rank.
  return ranked.filter((entry) => admittedIds.has(entry.id));
}
