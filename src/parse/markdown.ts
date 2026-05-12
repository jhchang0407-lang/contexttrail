import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import matter from "gray-matter";
import type { Root } from "mdast";

export type ParsedMarkdown = {
  ast: Root;
  frontmatter: Record<string, unknown>;
  /** The raw body string after frontmatter was stripped. */
  body: string;
  /**
   * Line-map info: how many lines in the original source come *before* the body
   * (i.e. occupied by the frontmatter block). Caller should add this to
   * mdast positions to recover original-source line numbers.
   */
  lineMap: { body_offset_lines: number };
};

const processor = unified().use(remarkParse).use(remarkGfm);

export function parse(source: string): ParsedMarkdown {
  const parsed = matter(source);
  const body = parsed.content;
  // gray-matter strips the leading frontmatter block. body_offset_lines is the
  // number of lines consumed by that block (including the closing `---` and
  // any trailing blank lines we lost).
  const headerLength = source.length - body.length;
  const headerSlice = source.slice(0, headerLength);
  const body_offset_lines = headerSlice ? headerSlice.split("\n").length - 1 : 0;
  const ast = processor.parse(body) as Root;
  return {
    ast,
    frontmatter: (parsed.data ?? {}) as Record<string, unknown>,
    body,
    lineMap: { body_offset_lines },
  };
}
