import { z } from "zod";
import matter from "gray-matter";
import { createHash } from "node:crypto";
import { count as countTokens } from "../parse/tokens.js";
import { FRESHNESS_STATES } from "../types/card.js";
import { seedFreshness } from "./freshness-policy.js";
import type {
  Card,
  CardType,
  EvidenceCard,
  ConstraintCard,
  SymbolNoteCard,
} from "../types/card.js";
import type { ChunkScope } from "../types/chunk.js";

/** Frontmatter scope shape for Cards. Mirrors the doc-chunk scope so
 *  hierarchical-down matching can compare like to like. */
const ScopeSchema = z.object({
  layer: z.enum([
    "company",
    "team",
    "project",
    "module",
    "decision",
    "unknown",
  ]),
  company: z.string().optional(),
  team: z.string().optional(),
  project: z.string().optional(),
  module: z.string().optional(),
  feature: z.string().optional(),
  domains: z.array(z.string()).optional(),
  routes: z.array(z.string()).optional(),
});

const IsoDatetimeSchema = z.preprocess((value) => {
  if (value instanceof Date) return value.toISOString();
  return value;
}, z.string().min(1));

const LinkSchema = z.object({
  chunk_stable_key: z.string(),
  version_pin: z.string(),
  content_hash_pin: z.string(),
  link_type: z.enum(["evidences", "mentions", "covers"]),
  linked_at: IsoDatetimeSchema,
});

const FrontmatterBaseSchema = z.object({
  id: z.string().regex(/^[CSE]\d{3,}$/, "id must match prefix C### / S### / E###"),
  type: z.enum(["constraint", "symbol_note", "evidence"]),
  title: z.string().min(1),
  authority: z.enum(["accepted", "candidate", "deprecated"]).default("accepted"),
  provenance: z.enum(["human_authored", "imported_from_doc", "system_derived"]).default("human_authored"),
  authored_by: z.string().default("unknown"),
  scope: ScopeSchema,
  symbol_anchors: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  routes: z.array(z.string()).default([]),
  command: z.string().optional(),
  covers: z.array(z.string()).optional(),
  linked_chunks: z.array(LinkSchema).default([]),
  freshness_state: z.enum(FRESHNESS_STATES).optional(),
  freshness_reason: z.enum(["all_links_current", "no_links", "version_drift", "tombstoned_link"]).optional(),
});

function prefixForType(t: CardType): "C" | "S" | "E" {
  if (t === "constraint") return "C";
  if (t === "symbol_note") return "S";
  return "E";
}

function validateTypeSpecific(
  fm: z.infer<typeof FrontmatterBaseSchema>,
): void {
  // id prefix must match type
  const expected = prefixForType(fm.type);
  if (!fm.id.startsWith(expected)) {
    throw new Error(
      `Card id '${fm.id}' has the wrong prefix for type '${fm.type}' (expected '${expected}###')`,
    );
  }
  if (fm.type === "symbol_note") {
    if (fm.symbol_anchors.length === 0) {
      throw new Error(
        "symbol_note Cards must declare at least one entry in symbol_anchors",
      );
    }
  }
  if (fm.type === "evidence") {
    if (!fm.command || fm.command.trim().length === 0) {
      throw new Error(
        "evidence Cards must declare a non-empty `command` field",
      );
    }
  }
}

export function parseCard(source: string, source_path: string): Card {
  const parsed = matter(source);
  let fm;
  try {
    fm = FrontmatterBaseSchema.parse(parsed.data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const msg = err.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      throw new Error(`Card frontmatter invalid: ${msg}`);
    }
    throw err;
  }
  validateTypeSpecific(fm);

  const body = parsed.content.trimStart();
  const source_hash = createHash("sha256").update(source).digest("hex").slice(0, 16);

  const scope: ChunkScope = {
    layer: fm.scope.layer,
    company: fm.scope.company,
    team: fm.scope.team,
    project: fm.scope.project,
    module: fm.scope.module,
    feature: fm.scope.feature,
    domains: fm.scope.domains,
    files: fm.files.length ? fm.files : undefined,
    symbols: fm.symbol_anchors.length ? fm.symbol_anchors : undefined,
    routes: fm.routes.length ? fm.routes : fm.scope.routes,
    source: { frontmatter: true },
  };

  const links = fm.linked_chunks.map((l) => ({
    card_id: fm.id,
    chunk_stable_key: l.chunk_stable_key,
    version_pin: l.version_pin,
    content_hash_pin: l.content_hash_pin,
    link_type: l.link_type,
    linked_at: l.linked_at,
  }));

  const seededFreshness = seedFreshness({
    linkCount: links.length,
    authoredState: fm.freshness_state,
    authoredReason: fm.freshness_reason,
  });

  const base = {
    id: fm.id,
    title: fm.title,
    body,
    authority: fm.authority,
    provenance: fm.provenance,
    authored_by: fm.authored_by,
    scope,
    symbol_anchors: fm.symbol_anchors,
    file_anchors: fm.files,
    route_anchors: fm.routes,
    links,
    freshness_state: seededFreshness.state,
    freshness_reason: seededFreshness.reason,
    author_review_state: "unreviewed" as const,
    token_count: countTokens(body),
    source_path,
    source_hash,
    updated_at: new Date().toISOString(),
  };

  if (fm.type === "evidence") {
    return {
      ...base,
      type: "evidence",
      command: fm.command!,
      covers: fm.covers ?? [],
    } satisfies EvidenceCard;
  }
  if (fm.type === "symbol_note") {
    return {
      ...base,
      type: "symbol_note",
    } satisfies SymbolNoteCard;
  }
  return {
    ...base,
    type: "constraint",
  } satisfies ConstraintCard;
}

export function tokenCountFor(card: Card): number {
  return countTokens(card.body);
}
