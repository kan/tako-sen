import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * src/ui/auth.ts: the device's kan-game.app ID on the screen side. The module
 * keeps its state per page, so each test loads a fresh copy.
 */
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

let storage: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let listeners: Map<string, () => void>;
/** startId's retry timer for a device without an ID. */
let retryTick: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  listeners = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", {
    location: { href: "https://tako-dev.kan-game.app/" },
    addEventListener: (name: string, listener: () => void) =>
      listeners.set(name, listener),
    setInterval: (tick: () => void) => {
      retryTick = tick;
      return 0;
    },
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const load = () => import("../src/ui/auth");
const answer = (status: number, body: unknown = {}) =>
  Response.json(body, { status });

describe("the device's ID", () => {
  it("asks the ID platform once and remembers the confirmed ID", async () => {
    fetchMock.mockResolvedValue(answer(200, { id: ID_A, name: "タコ" }));
    const auth = await load();
    auth.startId();
    auth.startId();
    const { id, name, status } = auth.useId();
    await vi.waitFor(() => expect(status.value).toBe("ready"));
    expect(id.value).toBe(ID_A);
    expect(name.value).toBe("タコ");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/id/session", {
      method: "POST",
      headers: {},
      body: undefined,
    });
    expect(storage.get("tako-sen.kan-game-id.v1")).toBe(ID_A);
  });

  it("keeps the last known ID offline and asks again when back online", async () => {
    storage.set("tako-sen.kan-game-id.v1", ID_A);
    vi.stubGlobal("navigator", { onLine: false });
    const auth = await load();
    auth.startId();
    const { id, status } = auth.useId();
    await vi.waitFor(() => expect(status.value).toBe("offline"));
    // Clears made offline can still be kept for this ID.
    expect(id.value).toBe(ID_A);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true });
    fetchMock.mockResolvedValue(answer(200, { id: ID_A, name: null }));
    listeners.get("online")!();
    await vi.waitFor(() => expect(status.value).toBe("ready"));
  });

  it("starts without an ID on a device that never had one, and keeps asking", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const auth = await load();
    auth.startId();
    const { id, status } = auth.useId();
    await vi.waitFor(() => expect(status.value).toBe("offline"));
    expect(id.value).toBeNull();
    // The platform comes back while the browser stayed "online".
    fetchMock.mockResolvedValue(answer(200, { id: ID_A, name: null }));
    retryTick!();
    await vi.waitFor(() => expect(id.value).toBe(ID_A));
    // With an ID, the timer no longer asks.
    fetchMock.mockClear();
    retryTick!();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not let an older session answer undo a transfer", async () => {
    let answerSession!: (response: Response) => void;
    fetchMock.mockImplementation((path: string) =>
      path === "/api/id/session"
        ? new Promise<Response>((resolve) => (answerSession = resolve))
        : Promise.resolve(answer(200, { id: ID_B, name: null })),
    );
    const auth = await load();
    auth.startId();
    // The transfer is redeemed while the session request is still out: it
    // waits for that answer, so its own cookie is the one that stays.
    const redeemed = auth.redeemTransferCode("abcd2345");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      fetchMock.mock.calls.some(([path]) => path !== "/api/id/session"),
    ).toBe(false);
    answerSession(answer(200, { id: ID_A, name: null }));
    expect(await redeemed).toEqual({ ok: true });
    expect(auth.useId().id.value).toBe(ID_B);
    expect(storage.get("tako-sen.kan-game-id.v1")).toBe(ID_B);
    // A session asked for during the redeem waits for it too.
    fetchMock.mockImplementation(async (path: string) =>
      path === "/api/id/session"
        ? answer(200, { id: ID_B, name: null })
        : answer(200, { id: ID_A, name: null }),
    );
    const again = auth.redeemTransferCode("efgh2345");
    const session = auth.refreshId();
    await Promise.all([again, session]);
    expect(auth.useId().id.value).toBe(ID_B);
  });

  it("gets a new ID after the old one was withdrawn", async () => {
    storage.set("tako-sen.kan-game-id.v1", ID_A);
    fetchMock
      .mockResolvedValueOnce(answer(410, { error: "id_deleted" }))
      .mockResolvedValueOnce(answer(200, { id: ID_B, name: null }));
    const auth = await load();
    auth.startId();
    const { id, status } = auth.useId();
    await vi.waitFor(() => expect(status.value).toBe("ready"));
    expect(id.value).toBe(ID_B);
    expect(storage.get("tako-sen.kan-game-id.v1")).toBe(ID_B);
  });

  it("renews the ID when a game API says it was withdrawn", async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { id: ID_A, name: null }));
    const auth = await load();
    auth.startId();
    const { id, status } = auth.useId();
    await vi.waitFor(() => expect(id.value).toBe(ID_A));
    fetchMock
      .mockResolvedValueOnce(answer(410, { error: "id_deleted" }))
      .mockResolvedValueOnce(answer(200, { id: ID_B, name: null }));
    const response = await auth.apiFetch("/api/plays");
    expect(response.status).toBe(410);
    await vi.waitFor(() => expect(id.value).toBe(ID_B));
    expect(status.value).toBe("ready");
  });

  it("asks again after a 401 at most once a minute", async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    fetchMock.mockResolvedValue(answer(200, { id: ID_A, name: null }));
    const auth = await load();
    auth.startId();
    await vi.waitFor(() => expect(auth.useId().status.value).toBe("ready"));
    const sessions = () =>
      fetchMock.mock.calls.filter(([path]) => path === "/api/id/session")
        .length;
    fetchMock.mockImplementation(async (path: string) =>
      path === "/api/id/session"
        ? answer(200, { id: ID_A, name: null })
        : answer(401, { error: "unauthorized" }),
    );
    // A cookie that is not kept: every request keeps answering 401.
    await auth.apiFetch("/api/plays");
    await auth.apiFetch("/api/plays");
    expect(sessions()).toBe(1);
    now += 60_000;
    await auth.apiFetch("/api/plays");
    await vi.waitFor(() => expect(sessions()).toBe(2));
  });

  it("refuses an answer that is not an ID", async () => {
    fetchMock.mockResolvedValue(answer(200, { id: "not-a-uuid" }));
    const auth = await load();
    auth.startId();
    const { id, status } = auth.useId();
    await vi.waitFor(() => expect(status.value).toBe("unavailable"));
    expect(id.value).toBeNull();
  });
});

describe("transfer codes", () => {
  it("issues a code", async () => {
    fetchMock.mockResolvedValue(
      answer(200, { code: "ABCD2345", expiresAt: 1_800_000_000_000 }),
    );
    const auth = await load();
    expect(await auth.issueTransferCode()).toEqual({
      ok: true,
      code: "ABCD2345",
      expiresAt: 1_800_000_000_000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/id/transfer-codes",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("switches the device to the code's ID", async () => {
    fetchMock.mockResolvedValue(answer(200, { id: ID_B, name: "別のタコ" }));
    const auth = await load();
    expect(await auth.redeemTransferCode("abcd2345")).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ code: "abcd2345" });
    expect(auth.useId().id.value).toBe(ID_B);
    expect(storage.get("tako-sen.kan-game-id.v1")).toBe(ID_B);
  });

  it.each([
    [400, "invalid"],
    [429, "rate_limited"],
    [503, "failed"],
  ] as const)("reports %i as %s", async (status, reason) => {
    fetchMock.mockResolvedValue(answer(status, { error: "x" }));
    const auth = await load();
    expect(await auth.redeemTransferCode("abcd2345")).toEqual({
      ok: false,
      reason,
    });
  });
});

describe("the portal", () => {
  it.each([
    ["tako-dev.kan-game.app", "https://dev.kan-game.app/account"],
    ["tako.kan-game.app", "https://kan-game.app/account"],
    ["localhost", "http://localhost:8787/account"],
  ])("follows the game's host %s", async (host, url) => {
    const auth = await load();
    expect(auth.portalUrl("/account", host)).toBe(url);
  });
});
