import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import {
  MessageChannel,
  receiveMessageOnPort,
  Worker,
  type MessagePort,
} from "node:worker_threads";
import {
  EXTRACTOR_MAX_PAYLOAD_BYTES,
  EXTRACTOR_WORKER_SOURCE,
  PDF_TABLE_DETECTION_MAX_PAGES,
  type ExtractorJobKind,
  type ExtractorJobRequest,
  type ExtractorJobResponse,
  type ExtractorWorkerData,
} from "./extractor-worker.js";

/**
 * Pool of persistent extraction worker_threads with a synchronous facade.
 *
 * Callers stay synchronous (loadDocumentForImport's contract) via the
 * standard Atomics trick: the main thread posts a job on a MessageChannel
 * port and blocks on Atomics.wait over a SharedArrayBuffer counter; the
 * worker posts its response on the port FIRST, then increments the counter
 * and notifies; the woken main thread drains the response synchronously with
 * receiveMessageOnPort. The same counter serves batch submission: up to
 * pool-size jobs run in parallel and the main thread wakes on every
 * completion to collect results and submit the next job.
 *
 * Lifecycle: the pool is a lazy module singleton; workers are created on
 * first use and immediately unref()'d so an idle pool never keeps the
 * process (CLI or vitest worker) alive.
 */

export type ExtractorOutcome =
  | { ok: true; json: string }
  | { ok: false; code: "payload_too_large" }
  | { ok: false; code: "extractor_error"; reason: string };

export type ExtractorBatchJob = {
  /** Caller-chosen result key (e.g. the source path); must be unique. */
  key: string;
  kind: ExtractorJobKind;
  path: string;
};

const requireFromHere = createRequire(import.meta.url);

/** Slot 0 of the shared signal array is the pool-wide completion counter. */
const COUNTER_SLOT = 0;

/**
 * How long to wait for a freshly spawned worker's ready handshake. Startup
 * only loads the worker script (extractor modules load lazily per job), so
 * this is generous; a worker that misses it is treated as failed-to-start
 * instead of deadlocking the blocked main thread.
 */
const WORKER_READY_TIMEOUT_MS = 30_000;

type PoolWorker = {
  worker: Worker;
  /** Main-thread side of the channel; never started, drained synchronously. */
  port: MessagePort;
  /** Flips false on worker error/exit so the slot is respawned on next use. */
  alive: boolean;
};

class ExtractorPool {
  readonly size: number;
  private readonly signal: Int32Array<SharedArrayBuffer>;
  private readonly workers: (PoolWorker | undefined)[];
  /** Last completion-counter value the main thread has observed. */
  private observed = 0;
  private nextJobId = 1;

  constructor() {
    this.size = Math.max(1, Math.min(4, availableParallelism() - 1));
    this.signal = new Int32Array(
      new SharedArrayBuffer((1 + this.size) * Int32Array.BYTES_PER_ELEMENT),
    );
    this.workers = new Array<PoolWorker | undefined>(this.size).fill(undefined);
  }

  /**
   * Runs jobs through the pool, blocking until all have completed. At most
   * `size` jobs are in flight at once; results are keyed by job key. Worker
   * failures surface as `extractor_error` outcomes, never as throws, so the
   * caller's message shaping stays in one place.
   */
  run(
    jobs: ExtractorBatchJob[],
    onProgress?: (done: number, total: number) => void,
  ): Map<string, ExtractorOutcome> {
    const results = new Map<string, ExtractorOutcome>();
    if (jobs.length === 0) return results;
    const lanes: PoolWorker[] = [];
    for (let i = 0; i < Math.min(this.size, jobs.length); i++) {
      const lane = this.ensureWorker(i);
      if (lane) lanes.push(lane);
    }
    if (lanes.length === 0) {
      for (const job of jobs) {
        results.set(job.key, {
          ok: false,
          code: "extractor_error",
          reason: "extraction worker failed to start",
        });
      }
      return results;
    }

    const keysById = new Map<number, string>();
    let nextJob = 0;
    const submit = (lane: PoolWorker): void => {
      if (nextJob >= jobs.length) return;
      const job = jobs[nextJob++]!;
      const id = this.nextJobId++;
      keysById.set(id, job.key);
      const request: ExtractorJobRequest = { id, kind: job.kind, path: job.path };
      lane.port.postMessage(request);
    };
    for (const lane of lanes) submit(lane);

    while (results.size < jobs.length) {
      let drainedAny = false;
      for (const lane of lanes) {
        for (;;) {
          const received = receiveMessageOnPort(lane.port);
          if (!received) break;
          drainedAny = true;
          const response = received.message as ExtractorJobResponse;
          const key = keysById.get(response.id);
          if (key === undefined) continue;
          keysById.delete(response.id);
          results.set(key, outcomeFromResponse(response));
          onProgress?.(results.size, jobs.length);
          submit(lane);
        }
      }
      if (results.size >= jobs.length) break;
      if (drainedAny) continue;
      // Sleep until some worker bumps the completion counter. The expected-
      // value check makes this race-free: a completion that landed after the
      // drain above already moved the counter past `observed`, so the wait
      // returns immediately instead of missing the wakeup.
      const current = Atomics.load(this.signal, COUNTER_SLOT);
      if (current === this.observed) {
        Atomics.wait(this.signal, COUNTER_SLOT, current);
      }
      this.observed = Atomics.load(this.signal, COUNTER_SLOT);
    }
    return results;
  }

  private ensureWorker(index: number): PoolWorker | undefined {
    const existing = this.workers[index];
    if (existing?.alive) return existing;
    const readySlot = 1 + index;
    Atomics.store(this.signal, readySlot, 0);
    const { port1, port2 } = new MessageChannel();
    const workerData: ExtractorWorkerData = {
      port: port2,
      signal: this.signal,
      counterSlot: COUNTER_SLOT,
      readySlot,
      modulePaths: {
        pdfParse: requireFromHere.resolve("pdf-parse"),
        mammoth: requireFromHere.resolve("mammoth"),
      },
      maxPayloadBytes: EXTRACTOR_MAX_PAYLOAD_BYTES,
      pdfTableDetectionMaxPages: PDF_TABLE_DETECTION_MAX_PAGES,
    };
    let worker: Worker;
    try {
      worker = new Worker(EXTRACTOR_WORKER_SOURCE, {
        eval: true,
        workerData,
        transferList: [port2],
      });
    } catch {
      return undefined;
    }
    // Idle workers must not keep the process alive: the CLI and vitest both
    // need to exit naturally once real work is done.
    worker.unref();
    const entry: PoolWorker = { worker, port: port1, alive: true };
    worker.on("error", () => {
      entry.alive = false;
    });
    worker.on("exit", () => {
      entry.alive = false;
    });
    Atomics.wait(this.signal, readySlot, 0, WORKER_READY_TIMEOUT_MS);
    if (Atomics.load(this.signal, readySlot) !== 1) {
      entry.alive = false;
      void worker.terminate();
      this.workers[index] = undefined;
      return undefined;
    }
    this.workers[index] = entry;
    return entry;
  }
}

function outcomeFromResponse(response: ExtractorJobResponse): ExtractorOutcome {
  if (response.ok) return { ok: true, json: response.json };
  if (response.code === "payload_too_large") {
    return { ok: false, code: "payload_too_large" };
  }
  return { ok: false, code: "extractor_error", reason: response.reason };
}

let pool: ExtractorPool | undefined;

function getPool(): ExtractorPool {
  if (!pool) pool = new ExtractorPool();
  return pool;
}

/** Runs one extraction job, blocking the main thread until it completes. */
export function runExtractorJobSync(kind: ExtractorJobKind, path: string): ExtractorOutcome {
  const key = "job";
  return getPool().run([{ key, kind, path }]).get(key)!;
}

/**
 * Runs a batch of extraction jobs with up to pool-size parallelism, blocking
 * until all complete. Returns outcomes keyed by each job's `key`.
 */
export function runExtractorJobsSync(
  jobs: ExtractorBatchJob[],
  onProgress?: (done: number, total: number) => void,
): Map<string, ExtractorOutcome> {
  return getPool().run(jobs, onProgress);
}
