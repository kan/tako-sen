import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSuperResponse,
  superRetryDelay,
} from "../src/ui/super-connection";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("super connection", () => {
  it.each([
    [401, "auth"],
    [403, "profile"],
    [429, "rate"],
    [409, "conflict"],
    [503, "server"],
    [400, "invalid"],
  ])("classifies HTTP %s", async (status, kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: status as number })),
    );
    await expect(
      fetchSuperResponse("/api/super/progress", {}),
    ).rejects.toMatchObject({ kind });
  });
  it("classifies connection loss without inventing progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(
      fetchSuperResponse("/api/super/progress", {}),
    ).rejects.toMatchObject({ kind: "network" });
  });
  it("keeps the timeout active while receiving the body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path, init: RequestInit) => ({
        ok: true,
        text: () =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      })),
    );
    const pending = expect(
      fetchSuperResponse("/api/super/progress", {}, 100),
    ).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("returns a fully received response and clears its timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ progress: { count: 3 } })),
    );
    expect(
      await (await fetchSuperResponse("/api/super/progress", {})).json(),
    ).toEqual({ progress: { count: 3 } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("backs off repeated failures with a five-minute cap", () => {
    expect([1, 2, 3, 4, 5, 50].map(superRetryDelay)).toEqual([
      30000, 60000, 120000, 240000, 300000, 300000,
    ]);
  });
});
