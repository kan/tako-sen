import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePuzzleWithAnalysis } from "../src/core/generator";

type Listener = (event: { data?: unknown }) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly posted: { id: number; options: unknown }[] = [];
  readonly listeners = new Map<string, Listener[]>();
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  postMessage(message: { id: number; options: unknown }): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

async function load() {
  vi.resetModules();
  return import("../src/ui/puzzle-generation");
}

const options = { seed: "background", difficulty: "easy" } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe("background puzzle generation", () => {
  it("generates synchronously when Workers are unavailable", async () => {
    const { canGenerateInBackground, generateInBackground } = await load();
    expect(canGenerateInBackground()).toBe(false);
    expect(await generateInBackground(options)).toEqual(
      generatePuzzleWithAnalysis(options),
    );
  });

  it("reuses one worker and matches replies to requests by id", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { canGenerateInBackground, generateInBackground } = await load();
    expect(canGenerateInBackground()).toBe(true);
    const first = generateInBackground(options);
    const second = generateInBackground({ ...options, seed: "other" });
    const [worker] = FakeWorker.instances;
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.posted.map((message) => message.options)).toEqual([
      options,
      { ...options, seed: "other" },
    ]);
    worker.emit("message", { id: worker.posted[1].id, generated: "second" });
    worker.emit("message", { id: worker.posted[0].id, generated: "first" });
    expect(await first).toBe("first");
    expect(await second).toBe("second");
  });

  it("rejects when generation fails inside the worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { generateInBackground } = await load();
    const result = generateInBackground(options);
    const [worker] = FakeWorker.instances;
    worker.emit("message", { id: worker.posted[0].id, error: "failed" });
    await expect(result).rejects.toThrow("failed");
  });

  it("finishes waiting requests on the main thread after a worker error", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { canGenerateInBackground, generateInBackground } = await load();
    const waiting = generateInBackground(options);
    const [worker] = FakeWorker.instances;
    worker.emit("error");
    expect(await waiting).toEqual(generatePuzzleWithAnalysis(options));
    expect(worker.terminated).toBe(true);
    expect(canGenerateInBackground()).toBe(false);
    expect(await generateInBackground(options)).toEqual(
      generatePuzzleWithAnalysis(options),
    );
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("finishes on the main thread when the worker stays silent", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("Worker", FakeWorker);
      const { canGenerateInBackground, generateInBackground } = await load();
      const waiting = generateInBackground(options);
      await vi.advanceTimersByTimeAsync(10000);
      expect(await waiting).toEqual(generatePuzzleWithAnalysis(options));
      expect(FakeWorker.instances[0].terminated).toBe(true);
      expect(canGenerateInBackground()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an aborted request by replacing the worker and resending the rest", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { generateInBackground } = await load();
    const controller = new AbortController();
    const aborted = generateInBackground(options, controller.signal);
    const kept = generateInBackground({ ...options, seed: "kept" });
    const [first] = FakeWorker.instances;
    controller.abort();
    await expect(aborted).rejects.toBe(controller.signal.reason);
    expect(first.terminated).toBe(true);
    const second = FakeWorker.instances[1];
    expect(second.posted.map((message) => message.options)).toEqual([
      { ...options, seed: "kept" },
    ]);
    second.emit("message", { id: second.posted[0].id, generated: "kept" });
    expect(await kept).toBe("kept");

    const already = new AbortController();
    already.abort();
    await expect(generateInBackground(options, already.signal)).rejects.toBe(
      already.signal.reason,
    );
    expect(second.posted).toHaveLength(1);
  });

  describe("fresh boards", () => {
    const board = (rating: string) => ({ analysis: { rating } });
    // 返信するたびに次の要求が送られるのを待つ。
    async function reply(worker: FakeWorker, index: number, data: object) {
      await vi.waitFor(() =>
        expect(worker.posted.length).toBeGreaterThan(index),
      );
      worker.emit("message", { id: worker.posted[index].id, ...data });
    }

    it("draws another seed when a board is rated differently or fails", async () => {
      vi.stubGlobal("Worker", FakeWorker);
      const { generateFreshInBackground } = await load();
      const result = generateFreshInBackground("hard");
      const [worker] = FakeWorker.instances;
      await reply(worker, 0, { generated: board("normal") });
      await reply(worker, 1, { error: "no board" });
      await reply(worker, 2, { generated: board("hard") });
      expect(await result).toEqual(board("hard"));
      const seeds = worker.posted.map(
        (message) => (message.options as { seed: string }).seed,
      );
      expect(new Set(seeds).size).toBe(3);
      expect(seeds.every((seed) => seed.startsWith("game-"))).toBe(true);
    });

    it("accepts a differently rated board after the last seed", async () => {
      vi.stubGlobal("Worker", FakeWorker);
      const { generateFreshInBackground } = await load();
      const result = generateFreshInBackground("hard");
      const [worker] = FakeWorker.instances;
      await reply(worker, 0, { generated: board("normal") });
      await reply(worker, 1, { error: "no board" });
      await reply(worker, 2, { generated: board("easy") });
      expect(await result).toEqual(board("easy"));
      expect(worker.posted).toHaveLength(3);
    });

    it("fails when no seed gives a board, and passes an abort on at once", async () => {
      vi.stubGlobal("Worker", FakeWorker);
      const { generateFreshInBackground } = await load();
      const failing = generateFreshInBackground("easy");
      const [worker] = FakeWorker.instances;
      for (let i = 0; i < 3; i += 1) await reply(worker, i, { error: "none" });
      await expect(failing).rejects.toThrow("none");
      expect(worker.posted).toHaveLength(3);

      const controller = new AbortController();
      const aborted = generateFreshInBackground("easy", controller.signal);
      await vi.waitFor(() => expect(worker.posted).toHaveLength(4));
      controller.abort();
      await expect(aborted).rejects.toBe(controller.signal.reason);
      // 中断の後は、別のシードを引き直さない。
      expect(
        FakeWorker.instances.flatMap((instance) => instance.posted),
      ).toHaveLength(4);
    });
  });

  it("falls back when the worker cannot be created", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked");
        }
      },
    );
    const { generateInBackground } = await load();
    expect(await generateInBackground(options)).toEqual(
      generatePuzzleWithAnalysis(options),
    );
  });
});
