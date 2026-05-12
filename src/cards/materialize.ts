import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { stringify as stringifyYaml } from "yaml";
import { loadConfig } from "../config/load.js";
import { closeDb, openDb } from "../store/db.js";
import { getCardCountByType, listCards } from "../store/cards.js";
import type { CardAuthority, CardProvenance, CardType } from "../types/card.js";
import type { ChunkScope } from "../types/chunk.js";

function prefixForType(type: CardType): "C" | "S" | "E" {
  if (type === "constraint") return "C";
  if (type === "symbol_note") return "S";
  return "E";
}

export function cardFilename(id: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "untitled";
  return `${id.toLowerCase()}-${slug}.md`;
}

function diskCardIds(cwd: string, type: CardType): string[] {
  const cfg = loadConfig(cwd);
  const dir = join(cwd, cfg.cards.source_dir);
  if (!existsSync(dir)) return [];
  const prefix = prefixForType(type);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const parsed = matter(readFileSync(join(dir, name), "utf8")).data;
      return typeof parsed.id === "string" ? parsed.id : null;
    })
    .filter((id): id is string => !!id && id.startsWith(prefix));
}

function nextId(cwd: string, type: CardType): string {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const counts = getCardCountByType(db);
    const imported = listCards(db, { type }).map((card) => card.id);
    const onDisk = diskCardIds(cwd, type);
    const max = [...imported, ...onDisk]
      .map((id) => Number.parseInt(id.slice(1), 10))
      .filter((n) => Number.isFinite(n))
      .reduce((memo, n) => (n > memo ? n : memo), 0);
    const next = Math.max(max + 1, counts[type] + 1);
    return `${prefixForType(type)}${String(next).padStart(3, "0")}`;
  } finally {
    closeDb(db);
  }
}

export function nextCardIdentity(
  cwd: string,
  type: CardType,
  title: string,
): { card_id: string; path: string } {
  const cfg = loadConfig(cwd);
  const cardId = nextId(cwd, type);
  return {
    card_id: cardId,
    path: join(cwd, cfg.cards.source_dir, cardFilename(cardId, title)),
  };
}

function scaffoldTemplateFor(id: string, type: CardType): string {
  if (type === "constraint") {
    return `---
id: ${id}
type: constraint
title: TITLE
authority: accepted
provenance: human_authored
authored_by: TODO
scope:
  layer: project
  project: TODO
---

State the rule. "All X must Y."
`;
  }
  if (type === "symbol_note") {
    return `---
id: ${id}
type: symbol_note
title: TITLE
authority: accepted
provenance: human_authored
authored_by: TODO
scope:
  layer: module
  project: TODO
  module: TODO
symbol_anchors:
  - Module.SymbolName
---

Local semantics of the symbol that aren't visible from its signature.
`;
  }
  return `---
id: ${id}
type: evidence
title: TITLE
authority: accepted
provenance: human_authored
authored_by: TODO
scope:
  layer: module
  project: TODO
  module: TODO
command: pnpm test -- src/path/to.test.ts
covers:
  - C001
---

What this command demonstrates.
`;
}

type LinkedChunkWrite = {
  chunk_stable_key: string;
  version_pin: string;
  content_hash_pin: string;
  link_type: string;
  linked_at: string;
};

type ReviewTraceWrite = {
  source_review_item_id: string;
  history_path: string;
  material_review_item_ids: string[];
};

type ScaffoldWriteRequest = {
  kind: "scaffold";
  path: string;
  card_id: string;
  card_type: CardType;
};

type MaterializedWriteRequest = {
  kind: "materialized";
  path: string;
  card_id: string;
  card_type: CardType;
  title: string;
  authority: CardAuthority;
  provenance: CardProvenance;
  authored_by: string;
  scope: Omit<ChunkScope, "source">;
  symbol_anchors: string[];
  linked_chunks: LinkedChunkWrite[];
  review_trace: ReviewTraceWrite;
  body: string;
  command?: string;
  covers?: string[];
};

export type CardWriteRequest = ScaffoldWriteRequest | MaterializedWriteRequest;

export function writeCardFile(request: CardWriteRequest): void {
  if (request.kind === "scaffold") {
    writeFileSync(
      request.path,
      scaffoldTemplateFor(request.card_id, request.card_type),
      "utf8",
    );
    return;
  }

  const frontmatter: Record<string, unknown> = {
    id: request.card_id,
    type: request.card_type,
    title: request.title,
    authority: request.authority,
    provenance: request.provenance,
    authored_by: request.authored_by,
    scope: request.scope,
    symbol_anchors: request.symbol_anchors,
    linked_chunks: request.linked_chunks,
    review_trace: request.review_trace,
  };
  if (request.card_type === "evidence") {
    frontmatter.command = request.command ?? "";
    frontmatter.covers = request.covers ?? [];
  }
  const source = `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${request.body.trim()}\n`;
  writeFileSync(request.path, source, "utf8");
}
