import { createHash } from "node:crypto";
import type { Root, Heading, RootContent } from "mdast";
import { parse } from "./markdown.js";
import { count as countTokens } from "./tokens.js";
import type { DocChunk, ChunkScope } from "../types/chunk.js";

export type ChunkOptions = {
  source_path: string;
  source_content_hash: string;
  indexed_at: string;
  /** Target tokens per chunk before splitting an oversized section. */
  target_tokens: number;
  /** Hard cap; sections over this token count get split (or warned if atomic). */
  max_tokens: number;
  /** Default scope to attach to every chunk; chunker is scope-agnostic otherwise. */
  default_scope?: ChunkScope;
};

type Section = {
  heading_path: string[];
  heading_level: number;
  title: string;
  /** mdast nodes that make up the body (excluding the heading itself). */
  bodyNodes: RootContent[];
  /** start line in the body string (1-based, body-relative). */
  body_start_line: number;
  body_end_line: number;
};

const ATOMIC_TYPES = new Set(["code", "table", "list", "blockquote"]);

const DEFAULT_SCOPE: ChunkScope = {
  layer: "unknown",
  source: {},
};

function headingText(node: Heading): string {
  return (node.children ?? [])
    .map((c: any) =>
      c.type === "text" || c.type === "inlineCode" ? c.value : "",
    )
    .join("")
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function documentTitle(frontmatter: Record<string, unknown>, sourcePath: string): string {
  const title = frontmatter.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const leaf = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  return leaf.replace(/\.[^.]+$/, "") || leaf;
}

/** Walk top-level AST children and split into heading-scoped sections. */
function buildSections(ast: Root, syntheticTitle?: string): Section[] {
  const children = ast.children ?? [];
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];

  const firstHeadingIndex = children.findIndex((node) => node.type === "heading");
  const preambleNodes =
    firstHeadingIndex === -1 ? children : children.slice(0, firstHeadingIndex);
  if (syntheticTitle && preambleNodes.length > 0) {
    const positioned = preambleNodes.filter((node) => node.position);
    if (positioned.length > 0) {
      sections.push({
        heading_path: [syntheticTitle],
        heading_level: 1,
        title: syntheticTitle,
        bodyNodes: preambleNodes,
        body_start_line: positioned[0]!.position!.start.line,
        body_end_line: positioned[positioned.length - 1]!.position!.end.line,
      });
    }
  }

  for (let i = 0; i < children.length; i++) {
    const node = children[i]!;
    if (node.type === "heading") {
      const level = node.depth;
      const text = headingText(node);
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
        stack.pop();
      }
      stack.push({ level, text });
      const heading_path = stack.map((s) => s.text);
      // gather following nodes until next heading
      const bodyNodes: RootContent[] = [];
      let body_start_line = node.position?.end.line ?? 1;
      let body_end_line = body_start_line;
      let j = i + 1;
      while (j < children.length && children[j]!.type !== "heading") {
        const n = children[j]!;
        bodyNodes.push(n);
        if (n.position) body_end_line = n.position.end.line;
        if (bodyNodes.length === 1 && n.position)
          body_start_line = n.position.start.line;
        j++;
      }
      sections.push({
        heading_path,
        heading_level: level,
        title: text,
        bodyNodes,
        body_start_line,
        body_end_line,
      });
      // do not advance i past body nodes; outer loop continues at next iteration
      // and we only act on heading nodes, so non-heading nodes between are skipped naturally
    }
  }
  return sections;
}

/** Extract text body for a span of mdast nodes from the original body string. */
function nodesToText(nodes: RootContent[], body: string): string {
  if (nodes.length === 0) return "";
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  if (!first.position || !last.position) return "";
  return body.slice(first.position.start.offset!, last.position.end.offset!);
}

type Part = {
  text: string;
  tokens: number;
  warning?: string;
  start_line: number;
  end_line: number;
  /** PRD-0036 / 36.2 (B3): set when this part came from a forced-split atomic block. */
  split_part?: { index: number; total: number };
};

/**
 * PRD-0036 / 36.2 (B3): the chunker preserves atomic blocks (list, code, table)
 * whole when they exceed max_tokens but kept the original 7344-token blocks
 * from fastapi's `release-notes.md` consuming ~45% of a 16k budget. For blocks
 * past `2 × max_tokens`, force a split at the block-type's natural boundary.
 * Between `max_tokens` and `2 × max_tokens`, the atomic-block invariant still
 * holds — we keep the block whole with the existing warning.
 */
function forceSplitAtomicBlock(
  node: any,
  body: string,
  max_tokens: number,
): Part[] | null {
  if (node.type === "list") return splitListBlock(node, body, max_tokens);
  if (node.type === "table") return splitTableBlock(node, body, max_tokens);
  if (node.type === "code") return splitCodeBlock(node, max_tokens);
  return null;
}

function rangeText(
  body: string,
  start: { offset?: number },
  end: { offset?: number },
): string {
  if (start.offset == null || end.offset == null) return "";
  return body.slice(start.offset, end.offset);
}

function splitListBlock(node: any, body: string, max_tokens: number): Part[] {
  const items: any[] = (node.children ?? []).filter((c: any) => c.position);
  if (items.length < 2) return [];
  return greedyGroupNodes(items, body, max_tokens);
}

function splitTableBlock(node: any, body: string, max_tokens: number): Part[] {
  const rows: any[] = (node.children ?? []).filter((c: any) => c.position);
  if (rows.length < 2) return [];
  return greedyGroupNodes(rows, body, max_tokens);
}

function greedyGroupNodes(
  units: any[],
  body: string,
  max_tokens: number,
): Part[] {
  const parts: Part[] = [];
  let bufStart: any | null = null;
  let bufEnd: any | null = null;
  let bufText = "";
  let bufTokens = 0;
  const flush = () => {
    if (bufStart == null) return;
    parts.push({
      text: bufText,
      tokens: bufTokens,
      start_line: bufStart.position.start.line,
      end_line: bufEnd!.position.end.line,
    });
    bufStart = null;
    bufEnd = null;
    bufText = "";
    bufTokens = 0;
  };
  for (const u of units) {
    const t = rangeText(body, u.position.start, u.position.end);
    const tk = countTokens(t);
    if (bufStart && bufTokens + tk > max_tokens) flush();
    if (bufStart == null) {
      bufStart = u;
      bufText = t;
      bufTokens = tk;
    } else {
      bufText += body.slice(bufEnd!.position.end.offset, u.position.start.offset) + t;
      bufTokens = countTokens(bufText);
    }
    bufEnd = u;
  }
  flush();
  return parts;
}

function splitCodeBlock(node: any, max_tokens: number): Part[] {
  // PRD: split on blank lines (or comment-delimited section boundaries).
  // We keep the fence in each part so each emitted chunk is still readable as
  // a self-contained code block. start_line/end_line are best-effort: the code
  // node's position covers the whole block; we narrow per-part by counting
  // lines within the value.
  const value = typeof node.value === "string" ? node.value : "";
  if (!value) return [];
  const lang = typeof node.lang === "string" ? node.lang : "";
  const meta = typeof node.meta === "string" && node.meta ? ` ${node.meta}` : "";
  const fence = "```";
  const segments = value.split(/\n\s*\n/);
  if (segments.length < 2) return [];

  const fenceTokens = countTokens(`${fence}${lang}${meta}\n${fence}\n`);
  const parts: Part[] = [];
  let bufSegments: string[] = [];
  let bufTokens = 0;
  const codeStartLine = node.position?.start?.line ?? 1;
  let consumedLines = 0;
  let bufStartLine = codeStartLine + 1; // first line inside fence

  const flush = () => {
    if (bufSegments.length === 0) return;
    const inner = bufSegments.join("\n\n");
    const text = `${fence}${lang}${meta}\n${inner}\n${fence}`;
    const innerLines = inner.split("\n").length;
    parts.push({
      text,
      tokens: countTokens(text),
      start_line: bufStartLine,
      end_line: bufStartLine + innerLines - 1,
    });
    bufSegments = [];
    bufTokens = 0;
  };

  for (const seg of segments) {
    const segTokens = countTokens(seg);
    if (
      bufSegments.length > 0 &&
      bufTokens + segTokens + fenceTokens > max_tokens
    ) {
      flush();
      bufStartLine = codeStartLine + 1 + consumedLines;
    }
    bufSegments.push(seg);
    bufTokens += segTokens;
    consumedLines += seg.split("\n").length + 1; // include the blank separator line
  }
  flush();
  return parts;
}

/** Split a section's body nodes into greedy-filled chunks ≤ target_tokens. */
function splitBody(
  nodes: RootContent[],
  body: string,
  target_tokens: number,
  max_tokens: number,
): Part[] {
  if (nodes.length === 0) {
    return [{ text: "", tokens: 0, start_line: 0, end_line: 0 }];
  }
  const totalText = nodesToText(nodes, body);
  const totalTokens = countTokens(totalText);
  if (totalTokens <= max_tokens) {
    return [
      {
        text: totalText,
        tokens: totalTokens,
        start_line: nodes[0]!.position!.start.line,
        end_line: nodes[nodes.length - 1]!.position!.end.line,
      },
    ];
  }

  // Section exceeds max_tokens → greedy-fill by node, preserving atomic blocks.
  const out: Part[] = [];
  let bufNodes: RootContent[] = [];
  let bufTokens = 0;

  const flush = () => {
    if (bufNodes.length === 0) return;
    const text = nodesToText(bufNodes, body);
    out.push({
      text,
      tokens: countTokens(text),
      start_line: bufNodes[0]!.position!.start.line,
      end_line: bufNodes[bufNodes.length - 1]!.position!.end.line,
    });
    bufNodes = [];
    bufTokens = 0;
  };

  for (const node of nodes) {
    const nodeText = nodesToText([node], body);
    const nodeTokens = countTokens(nodeText);

    if (nodeTokens > max_tokens) {
      flush();
      // PRD-0036 / 36.2 (B3): for atomic blocks past 2× max_tokens, force a
      // split at the natural boundary (list-item / table row / code blank
      // line). Below 2× max_tokens we preserve the atomic-block invariant.
      if (nodeTokens > 2 * max_tokens && ATOMIC_TYPES.has(node.type)) {
        const split = forceSplitAtomicBlock(node, body, max_tokens);
        if (split && split.length >= 2) {
          const total = split.length;
          const warning = `Atomic ${node.type} block split across ${total} parts (${nodeTokens} total tokens).`;
          split.forEach((p, i) => {
            out.push({
              ...p,
              warning,
              split_part: { index: i + 1, total },
            });
          });
          continue;
        }
      }
      // preserve_and_warn fallback — emit as its own fat chunk with a warning.
      out.push({
        text: nodeText,
        tokens: nodeTokens,
        warning: ATOMIC_TYPES.has(node.type)
          ? `Atomic ${node.type} block exceeds max_tokens (${nodeTokens} > ${max_tokens}); kept as single chunk.`
          : `Block of type '${node.type}' exceeds max_tokens (${nodeTokens} > ${max_tokens}); kept as single chunk.`,
        start_line: node.position!.start.line,
        end_line: node.position!.end.line,
      });
      continue;
    }

    if (bufTokens + nodeTokens > target_tokens && bufNodes.length > 0) {
      flush();
    }
    bufNodes.push(node);
    bufTokens += nodeTokens;
  }
  flush();
  return out;
}

export function chunk(source: string, opts: ChunkOptions): DocChunk[] {
  const { ast, body, frontmatter } = parse(source);
  const sections = buildSections(
    ast,
    documentTitle(frontmatter, opts.source_path),
  );
  const scope = opts.default_scope ?? DEFAULT_SCOPE;
  const doc_id = sha256(opts.source_path).slice(0, 16);

  const out: DocChunk[] = [];
  for (const sec of sections) {
    const parts = splitBody(
      sec.bodyNodes,
      body,
      opts.target_tokens,
      opts.max_tokens,
    );
    const chunk_count = parts.length;
    parts.forEach((part, idx) => {
      const chunk_index = idx + 1; // 1-based intra-section
      const stable_seed = `${opts.source_path}::${sec.heading_path.join(" > ")}::${chunk_index}`;
      const stable_key = sha256(stable_seed).slice(0, 16);
      const chunk_content_hash = sha256(part.text);
      const version_id = sha256(`${stable_key}:${chunk_content_hash}`).slice(0, 16);
      const docChunk: DocChunk = {
        stable_key,
        version_id,
        source_path: opts.source_path,
        doc_id,
        heading_path: sec.heading_path,
        heading_level: sec.heading_level,
        chunk_index,
        chunk_count,
        title: sec.title,
        body: part.text,
        token_count: part.tokens,
        chunk_content_hash,
        source_content_hash: opts.source_content_hash,
        start_line: part.start_line,
        end_line: part.end_line,
        heading_slug: slugify(sec.title),
        status: "current",
        indexed_at: opts.indexed_at,
        scope,
      };
      if (part.warning) docChunk.warnings = [part.warning];
      if (part.split_part) docChunk.split_part = part.split_part;
      out.push(docChunk);
    });
  }
  return out;
}
