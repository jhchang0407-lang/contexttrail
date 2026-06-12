import type { MessagePort } from "node:worker_threads";

/**
 * Persistent document-extraction worker: protocol types plus the worker
 * script source.
 *
 * Document extraction used to spawn a fresh `node -e` child per file, which
 * paid ~100ms of process spawn + pdf-parse module load for every PDF/DOCX.
 * The pool (extractor-pool.ts) instead keeps worker_threads alive that load
 * pdf-parse/mammoth once and serve extraction requests over a MessageChannel,
 * with a SharedArrayBuffer + Atomics handshake so the main thread can keep a
 * fully synchronous facade (loadDocumentForImport must stay sync).
 *
 * The worker is launched from a source string (`eval: true`) rather than a
 * file URL on purpose: the same string works compiled in dist/, under vitest,
 * and under tsx, with no .ts/.js worker-file resolution gymnastics — the same
 * reason the previous implementation embedded its extractor scripts inline.
 */

/** Kinds of extraction jobs the worker understands. */
export type ExtractorJobKind = "pdf" | "docx-html" | "docx-raw";

export type ExtractorJobRequest = {
  id: number;
  kind: ExtractorJobKind;
  path: string;
};

export type ExtractorJobResponse =
  | { id: number; ok: true; json: string }
  | { id: number; ok: false; code: "payload_too_large" }
  | { id: number; ok: false; code: "extractor_error"; reason: string };

export type ExtractorWorkerData = {
  /** Worker side of the job channel; responses flow back over the same port. */
  port: MessagePort;
  /** Shared signal array: one completion counter slot + per-worker ready slots. */
  signal: Int32Array<SharedArrayBuffer>;
  /** Index of the pool-wide completion counter inside `signal`. */
  counterSlot: number;
  /** Index of this worker's ready flag inside `signal`. */
  readySlot: number;
  /** Absolute resolved entrypoints, resolved by the main thread. */
  modulePaths: { pdfParse: string; mammoth: string };
  /** Max serialized response size; larger results fail like ENOBUFS used to. */
  maxPayloadBytes: number;
  /** Page cap for ruled-table detection (see PDF_TABLE_DETECTION_MAX_PAGES). */
  pdfTableDetectionMaxPages: number;
};

/**
 * Cap on extractor output (now the serialized worker response payload; was
 * the subprocess stdout buffer). Dense PDFs exceeded an earlier 64MB ceiling
 * and died with a cryptic ENOBUFS before returning any text, hence 256MB.
 * The user-facing failure message is owned by document-text.ts.
 */
export const EXTRACTOR_MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;

/**
 * Ruled-table detection walks every page's operator list, which gets costly on
 * very large PDFs; positioned text and form fields are still extracted in full.
 */
export const PDF_TABLE_DETECTION_MAX_PAGES = 50;

/**
 * Worker script (CommonJS, run via `new Worker(source, { eval: true })`).
 *
 * Contract with the pool:
 *  - on startup, stores 1 into `signal[readySlot]` and notifies;
 *  - for every request received on `port`, posts exactly one
 *    ExtractorJobResponse back on `port` and THEN increments
 *    `signal[counterSlot]` and notifies, so a blocked main thread always
 *    finds the response already queued when it wakes;
 *  - never throws out of the message handler: all failures (including an
 *    escaped async exception) are converted into an `extractor_error`
 *    response so the main thread cannot deadlock in Atomics.wait. This
 *    replaces the old EXTRACTOR_ERROR stderr sentinel — `reason` carries the
 *    same `err.message` text the sentinel line used to.
 */
export const EXTRACTOR_WORKER_SOURCE = `
"use strict";
const { workerData } = require("node:worker_threads");
const { readFile } = require("node:fs/promises");
const {
  port,
  signal,
  counterSlot,
  readySlot,
  modulePaths,
  maxPayloadBytes,
  pdfTableDetectionMaxPages,
} = workerData;

let pdfParseModule;
let mammothModule;

/** Bound so a pathological error message cannot bloat the response channel;
 *  the main thread truncates to its own warning cap anyway. */
const MAX_REASON_CHARS = 2000;

function failureReason(err) {
  const reason = err && err.message ? err.message : String(err);
  return String(reason).slice(0, MAX_REASON_CHARS);
}

async function extractPdf(inputPath) {
  if (!pdfParseModule) pdfParseModule = require(modulePaths.pdfParse);
  const parser = new pdfParseModule.PDFParse({ data: await readFile(inputPath) });
  const out = { page_count: 0, pages: [], fields: [], tables: [], notes: [] };
  try {
    if (typeof parser.load !== "function") {
      throw new Error("pdf-parse internal load() is unavailable; positioned text extraction needs a compatible pdf-parse version");
    }
    const doc = await parser.load();
    out.page_count = doc.numPages;
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      for (const item of content.items) {
        if (typeof item.str !== "string" || item.str.length === 0) continue;
        const point = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        items.push({
          str: item.str,
          x: Math.round(point[0] * 100) / 100,
          y: Math.round(point[1] * 100) / 100,
          width: Math.round((item.width || 0) * 100) / 100,
          height: Math.round((item.height || 0) * 100) / 100,
        });
      }
      out.pages.push({ num: pageNum, items });
      let annotations = [];
      try {
        annotations = (await page.getAnnotations()) || [];
      } catch {
        annotations = [];
      }
      for (const annotation of annotations) {
        if (annotation.subtype !== "Widget" || annotation.hidden) continue;
        const label = String(annotation.alternativeText || annotation.fieldName || "").trim();
        let value = "";
        if (annotation.fieldType === "Tx" || annotation.fieldType === "Ch") {
          const raw = annotation.fieldValue;
          value = Array.isArray(raw) ? raw.filter(Boolean).join(", ") : String(raw ?? "");
        } else if (annotation.fieldType === "Btn" && !annotation.pushButton) {
          const raw = annotation.fieldValue;
          if (annotation.checkBox) {
            value = raw && raw !== "Off" ? "checked" : "";
          } else if (raw && raw !== "Off" && raw === annotation.buttonValue) {
            value = String(raw);
          }
        }
        value = value.trim();
        if (!value) continue;
        out.fields.push({ page: pageNum, label, value });
      }
      page.cleanup();
    }
    if (doc.numPages > 0 && doc.numPages <= pdfTableDetectionMaxPages) {
      try {
        const tableResult = await parser.getTable();
        for (const pageResult of tableResult.pages || []) {
          for (const rows of pageResult.tables || []) {
            out.tables.push({ page: pageResult.num, rows });
          }
        }
      } catch (err) {
        out.notes.push("PDF ruled-table detection failed: " + (err && err.message ? err.message : String(err)));
      }
    }
  } finally {
    await parser.destroy();
  }
  return out;
}

async function extractDocxHtml(inputPath) {
  if (!mammothModule) mammothModule = require(modulePaths.mammoth);
  const result = await mammothModule.convertToHtml({ path: inputPath });
  return {
    html: result.value || "",
    messages: (result.messages || []).map((message) => message.message || String(message)).filter(Boolean),
  };
}

async function extractDocxRaw(inputPath) {
  if (!mammothModule) mammothModule = require(modulePaths.mammoth);
  const result = await mammothModule.extractRawText({ path: inputPath });
  return { text: result.value || "" };
}

async function handleJob(job) {
  if (job.kind === "pdf") return extractPdf(job.path);
  if (job.kind === "docx-html") return extractDocxHtml(job.path);
  if (job.kind === "docx-raw") return extractDocxRaw(job.path);
  throw new Error("unknown extraction job kind: " + job.kind);
}

function respond(response) {
  try {
    port.postMessage(response);
  } catch (err) {
    // A response that cannot be serialized must still unblock the main
    // thread; degrade it to a failure rather than dropping the reply.
    port.postMessage({ id: response.id, ok: false, code: "extractor_error", reason: failureReason(err) });
  }
  Atomics.add(signal, counterSlot, 1);
  Atomics.notify(signal, counterSlot);
}

let activeJobId = null;

port.on("message", (job) => {
  activeJobId = job.id;
  handleJob(job).then(
    (result) => {
      let response;
      try {
        const json = JSON.stringify(result);
        response =
          Buffer.byteLength(json, "utf8") > maxPayloadBytes
            ? { id: job.id, ok: false, code: "payload_too_large" }
            : { id: job.id, ok: true, json };
      } catch (err) {
        response = { id: job.id, ok: false, code: "extractor_error", reason: failureReason(err) };
      }
      activeJobId = null;
      respond(response);
    },
    (err) => {
      activeJobId = null;
      respond({ id: job.id, ok: false, code: "extractor_error", reason: failureReason(err) });
    },
  );
});

// Last-resort net: an exception escaping the async handler would otherwise
// kill this thread while the main thread is blocked in Atomics.wait.
process.on("uncaughtException", (err) => {
  if (activeJobId !== null) {
    const id = activeJobId;
    activeJobId = null;
    respond({ id, ok: false, code: "extractor_error", reason: failureReason(err) });
  }
});

Atomics.store(signal, readySlot, 1);
Atomics.notify(signal, readySlot);
`;
