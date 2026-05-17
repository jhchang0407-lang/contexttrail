import { encode as encodeCl100k } from "gpt-tokenizer/encoding/cl100k_base";

export type TokenCounter = (text: string) => number;

export function count(text: string): number {
  if (!text) return 0;
  return encodeCl100k(text, { disallowedSpecial: new Set() }).length;
}

export function makeTokenCounter(encoding: string): TokenCounter {
  if (encoding !== "cl100k_base") {
    throw new Error(
      `Unsupported tokenizer encoding: ${encoding}. v1 supports only cl100k_base.`,
    );
  }
  return count;
}
