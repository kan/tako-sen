import {
  generatePuzzleWithAnalysis,
  type GenerateOptions,
  type GeneratedPuzzle,
} from "../core/generator";
import type { PuzzleDifficulty } from "../core/model";

export interface WorkerRequest {
  readonly id: number;
  readonly options: GenerateOptions;
}
export type WorkerReply =
  | { readonly id: number; readonly generated: GeneratedPuzzle }
  | { readonly id: number; readonly error: string };

interface PendingGeneration {
  readonly options: GenerateOptions;
  readonly resolve: (generated: GeneratedPuzzle) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

// Generation takes well under a second; a worker silent for this long was
// most likely discarded by the browser.
const REPLY_TIMEOUT_MS = 10000;

let worker: Worker | undefined;
let workerFailed = false;
let nextId = 0;
const pending = new Map<number, PendingGeneration>();

/** Whether generation can run without blocking input on the main thread. */
export function canGenerateInBackground(): boolean {
  return typeof Worker !== "undefined" && !workerFailed;
}

const FRESH_SEEDS = 3;

/**
 * A new board of the current generator version for a random seed. A
 * generator stops after a fixed number of attempts so that a seed code always
 * decides the same board: for a rare seed it then returns a board rated
 * differently from the request, or throws. A new game is not tied to a seed,
 * so another one is drawn. After the last seed a differently rated board is
 * accepted rather than failing; an abort is passed on without retrying.
 */
export async function generateFreshInBackground(
  difficulty: PuzzleDifficulty,
  signal?: AbortSignal,
): Promise<GeneratedPuzzle> {
  let rated: GeneratedPuzzle | undefined;
  let failure: unknown;
  for (let tries = 0; tries < FRESH_SEEDS; tries += 1) {
    try {
      rated = await generateInBackground(
        { seed: `game-${crypto.randomUUID()}`, difficulty },
        signal,
      );
      if (rated.analysis.rating === difficulty) return rated;
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = error;
    }
  }
  if (rated) return rated;
  throw failure;
}

/**
 * Generates a puzzle in a Web Worker so the board stays responsive. Without
 * Worker support, or once the worker has failed, it generates synchronously:
 * the result is the same because generation depends only on the options.
 * Aborting rejects the request and stops the worker from spending time on it.
 */
export function generateInBackground(
  options: GenerateOptions,
  signal?: AbortSignal,
): Promise<GeneratedPuzzle> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const active = startWorker();
    if (!active) {
      generateNow(options, resolve, reject);
      return;
    }
    const request: WorkerRequest = { id: nextId++, options };
    pending.set(request.id, {
      options,
      resolve,
      reject,
      timeout: setTimeout(abandonWorker, REPLY_TIMEOUT_MS),
    });
    active.postMessage(request);
    signal?.addEventListener(
      "abort",
      () => {
        const entry = take(request.id);
        if (!entry) return;
        entry.reject(signal.reason);
        restartWorker();
      },
      { once: true },
    );
  });
}

function generateNow(
  options: GenerateOptions,
  resolve: (generated: GeneratedPuzzle) => void,
  reject: (error: unknown) => void,
): void {
  try {
    resolve(generatePuzzleWithAnalysis(options));
  } catch (error) {
    reject(error);
  }
}

function take(id: number): PendingGeneration | undefined {
  const entry = pending.get(id);
  if (!entry) return undefined;
  pending.delete(id);
  clearTimeout(entry.timeout);
  return entry;
}

function stopWorker(): void {
  worker?.terminate();
  worker = undefined;
}

/** The worker cannot be trusted any more: finish its requests here. */
function abandonWorker(): void {
  workerFailed = true;
  stopWorker();
  for (const id of [...pending.keys()]) {
    const entry = take(id)!;
    generateNow(entry.options, entry.resolve, entry.reject);
  }
}

/**
 * A running generation cannot be interrupted, so a cancelled request is
 * dropped by replacing the worker and handing it the requests still wanted.
 */
function restartWorker(): void {
  stopWorker();
  if (pending.size === 0) return;
  const active = startWorker();
  if (!active) {
    abandonWorker();
    return;
  }
  for (const [id, { options }] of pending) {
    const request: WorkerRequest = { id, options };
    active.postMessage(request);
  }
}

function startWorker(): Worker | undefined {
  if (!canGenerateInBackground()) return undefined;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./puzzle-worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    workerFailed = true;
    return undefined;
  }
  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const entry = take(reply.id);
    if (!entry) return;
    if ("generated" in reply) entry.resolve(reply.generated);
    else entry.reject(new Error(reply.error));
  });
  // The worker script failed to load, crashed, or sent an unreadable reply.
  worker.addEventListener("error", abandonWorker);
  worker.addEventListener("messageerror", abandonWorker);
  return worker;
}
