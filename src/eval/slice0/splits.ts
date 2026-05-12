/**
 * Dev / holdout split for the real-corpus eval (Slice 2 v2 / PRD-0012).
 *
 * The 5 original repos (bun, drizzle, prisma, ralph, tanstack) constitute the
 * dev panel — feature weights and rules in source-rerank.ts were tuned with
 * that panel in front of us. The 5 new repos (hono, vitest, trpc, turborepo,
 * zod) constitute the holdout — they have NOT been used to choose weights and
 * give us an honest signal on whether the rerank generalizes.
 *
 * Margin-based gates (holdout top-1 ≥ 75%, top-3 ≥ 93.8%, FCU = 0) are
 * applied to the holdout panel — the dev numbers are reported for context but
 * passing dev does not buy the gate.
 */
export const DEV_REPOS = [
  "bun",
  "drizzle",
  "prisma",
  "ralph",
  "tanstack",
] as const;

export const HOLDOUT_REPOS = [
  "hono",
  "vitest",
  "trpc",
  "turborepo",
  "zod",
] as const;

export type Split = "dev" | "holdout";

export function splitForRepo(repo: string): Split {
  if ((HOLDOUT_REPOS as readonly string[]).includes(repo)) return "holdout";
  return "dev";
}
