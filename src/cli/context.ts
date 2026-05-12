import {
  openRetrievalRuntime,
  closeRetrievalRuntime,
  runRetrievalPipeline,
} from "../retrieve/runtime.js";
import {
  renderTextFromView,
  renderJsonFromView,
  type ContextPackJson,
} from "../retrieve/render.js";
import type { PackResult } from "../retrieve/pack.js";
import type { DocChunk } from "../types/chunk.js";
import type { Card } from "../types/card.js";
import { buildRetrievalView } from "../retrieve/view.js";

export type ContextOpts = {
  files?: string[];
  symbols?: string[];
  routes?: string[];
  budget?: "small" | "default" | "large";
  json?: boolean;
  explain?: boolean;
};

export type ContextRunResult = {
  text?: string;
  json?: ContextPackJson;
  pack: PackResult;
  chunksByVersionId: Map<string, DocChunk>;
  cardsByCardId: Map<string, Card>;
};

export function runContext(
  cwd: string,
  query: string,
  opts: ContextOpts,
): ContextRunResult {
  const runtime = openRetrievalRuntime({ cwd });
  try {
    const result = runRetrievalPipeline(
      runtime,
      {
        task: query,
        query_anchors: {
          files: opts.files,
          symbols: opts.symbols,
          routes: opts.routes,
        },
        budget: opts.budget ?? "default",
        explain: opts.explain,
      },
    );

    const view = buildRetrievalView({
      query,
      result,
      has_sources: result.chunksByVersionId.size > 0,
      explain: opts.explain,
    });
    const out: ContextRunResult = {
      pack: result.pack,
      chunksByVersionId: result.chunksByVersionId,
      cardsByCardId: result.cardsByCardId,
    };
    if (opts.json) out.json = renderJsonFromView(view);
    else out.text = renderTextFromView(view);
    return out;
  } finally {
    closeRetrievalRuntime(runtime);
  }
}
