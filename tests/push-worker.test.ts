import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import worker, { CRONS } from "../src/worker/index";
import { generateVapidKeys } from "../scripts/vapid-keys";
import { deleteAccount } from "../src/worker/history";
import {
  MAX_SUBSCRIPTIONS_PER_ACCOUNT,
  isPushServiceEndpoint,
  parseSubscription,
  saveSubscription,
  sendDailyNotifications,
} from "../src/worker/push";
import { migrateTestDatabase } from "./migrations";
import { auth } from "./auth-mock";

vi.mock("../src/worker/auth", () => import("./auth-mock"));

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
const ORIGIN = "https://example.com";
let vapid: { publicKey: string; privateKey: string };

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes as ArrayBuffer).toString("base64url");

/** A subscription as a browser hands it out: an ECDH key and an auth secret. */
async function browserSubscription(n: number) {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    keys: {
      p256dh: base64url(await crypto.subtle.exportKey("raw", pair.publicKey)),
      auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}

function env(): Env {
  return {
    ...platform.env,
    ALLOWED_ORIGINS: ORIGIN,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://kan-game.app",
  } as Env;
}

function call(path: string, method = "GET", body?: unknown) {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers:
        body === undefined
          ? { Origin: ORIGIN }
          : { Origin: ORIGIN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as Parameters<typeof worker.fetch>[0],
    env(),
  );
}

async function owners(): Promise<Record<string, string>> {
  const { results } = await platform.env.DB.prepare(
    "SELECT endpoint, account_id FROM push_subscriptions ORDER BY endpoint",
  ).all<{ endpoint: string; account_id: string }>();
  return Object.fromEntries(results.map((r) => [r.endpoint, r.account_id]));
}

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  await migrateTestDatabase(platform.env.DB);
  vapid = await generateVapidKeys();
});
afterAll(async () => platform?.dispose());
beforeEach(async () => {
  await platform.env.DB.prepare("DELETE FROM push_subscriptions").run();
});

describe("push subscriptions", () => {
  it("takes endpoints of the browsers' push services only", async () => {
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(
      true,
    );
    expect(isPushServiceEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushServiceEndpoint("https://example.com/hook")).toBe(false);
    expect(isPushServiceEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    const good = await browserSubscription(1);
    expect(parseSubscription(good)).toEqual({
      endpoint: good.endpoint,
      ...good.keys,
    });
    expect(
      parseSubscription({ ...good, endpoint: "https://example.com/x" }),
    ).toBeUndefined();
    expect(
      parseSubscription({ ...good, keys: { p256dh: "a b", auth: "x" } }),
    ).toBeUndefined();
  });

  it("gives the screen the public key, or nothing without a key pair", async () => {
    expect(await (await call("/api/push/key")).json()).toEqual({
      publicKey: vapid.publicKey,
    });
    const bare = await worker.fetch(
      new Request(`${ORIGIN}/api/push/key`) as Parameters<
        typeof worker.fetch
      >[0],
      { ...platform.env, ALLOWED_ORIGINS: ORIGIN } as Env,
    );
    expect(await bare.json()).toEqual({ publicKey: "" });
  });

  it("stores a device under its ID, moves it with the ID, and deletes only its own", async () => {
    const device = await browserSubscription(1);
    auth.account = null;
    expect((await call("/api/push/subscription", "POST", device)).status).toBe(
      401,
    );
    auth.account = "first";
    expect((await call("/api/push/subscription", "POST", device)).status).toBe(
      200,
    );
    expect(await owners()).toEqual({ [device.endpoint]: "first" });
    // The device took another ID over (a transfer code): it follows.
    auth.account = "second";
    await call("/api/push/subscription", "POST", device);
    expect(await owners()).toEqual({ [device.endpoint]: "second" });
    // Another ID cannot remove it.
    auth.account = "first";
    await call("/api/push/subscription", "DELETE", {
      endpoint: device.endpoint,
    });
    expect(Object.keys(await owners())).toHaveLength(1);
    auth.account = "second";
    await call("/api/push/subscription", "DELETE", {
      endpoint: device.endpoint,
    });
    expect(await owners()).toEqual({});
    expect(
      (
        await call("/api/push/subscription", "POST", {
          endpoint: "https://example.com/hook",
          keys: device.keys,
        })
      ).status,
    ).toBe(400);
  });

  it("refuses a device past the most an ID may have, and keeps the others", async () => {
    const db = platform.env.DB;
    const save = async (n: number) => {
      const device = await browserSubscription(n);
      return saveSubscription(
        db,
        "many",
        { endpoint: device.endpoint, ...device.keys },
        1000 + n,
      );
    };
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_ACCOUNT; i++)
      expect(await save(i)).toBe(true);
    expect(await save(MAX_SUBSCRIPTIONS_PER_ACCOUNT)).toBe(false);
    // A device already there may still send itself again.
    expect(await save(0)).toBe(true);
    expect(Object.keys(await owners())).toHaveLength(
      MAX_SUBSCRIPTIONS_PER_ACCOUNT,
    );
    auth.account = "many";
    const extra = await browserSubscription(99);
    expect((await call("/api/push/subscription", "POST", extra)).status).toBe(
      409,
    );
  });

  it("goes with a withdrawal", async () => {
    const device = await browserSubscription(1);
    await saveSubscription(
      platform.env.DB,
      "leaving",
      { endpoint: device.endpoint, ...device.keys },
      1,
    );
    await deleteAccount(platform.env.DB, "leaving");
    expect(await owners()).toEqual({});
  });
});

describe("the daily notice", () => {
  it("is sent to every device and forgets those the push service no longer knows", async () => {
    const db = platform.env.DB;
    const devices = await Promise.all([1, 2, 3].map(browserSubscription));
    for (const [i, device] of devices.entries())
      await saveSubscription(
        db,
        `id-${i}`,
        { endpoint: device.endpoint, ...device.keys },
        i,
      );
    const send = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method?.toUpperCase()).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toMatch(/^vapid t=/);
      expect(headers["content-encoding"]).toBe("aes128gcm");
      return new Response(null, {
        status: String(url).endsWith("device-2") ? 410 : 201,
      });
    });
    const counts = await sendDailyNotifications(env(), send);
    expect(send).toHaveBeenCalledTimes(3);
    expect(counts).toEqual({ sent: 2, gone: 1, failed: 0 });
    expect(Object.keys(await owners()).sort()).toEqual([
      devices[0].endpoint,
      devices[2].endpoint,
    ]);
  });

  it("sends nothing without a key pair", async () => {
    const device = await browserSubscription(1);
    await saveSubscription(
      platform.env.DB,
      "quiet",
      { endpoint: device.endpoint, ...device.keys },
      1,
    );
    const send = vi.fn();
    expect(await sendDailyNotifications(platform.env, send)).toEqual({
      sent: 0,
      gone: 0,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("is what the 0:05 cron runs, apart from preparing the board", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    try {
      const device = await browserSubscription(1);
      await saveSubscription(
        platform.env.DB,
        "cron",
        { endpoint: device.endpoint, ...device.keys },
        1,
      );
      await worker.scheduled(
        {
          cron: CRONS.dailyNotice,
          scheduledTime: Date.now(),
        } as ScheduledController,
        env(),
      );
      expect(send).toHaveBeenCalledWith(device.endpoint, expect.anything());
    } finally {
      send.mockRestore();
    }
  });

  it("names every cron of wrangler.jsonc, and runs nothing for another", async () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    const crons = [...config.matchAll(/"crons": \[([^\]]*)\]/g)].map((m) =>
      JSON.parse(`[${m[1]}]`),
    );
    expect(crons.length).toBeGreaterThan(0);
    for (const environment of crons)
      expect(environment).toEqual(Object.values(CRONS));
    const send = vi.spyOn(globalThis, "fetch");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await worker.scheduled(
        { cron: "0 0 * * *", scheduledTime: Date.now() } as ScheduledController,
        env(),
      );
      expect(send).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("unknown_cron"),
      );
    } finally {
      send.mockRestore();
      error.mockRestore();
    }
  });
});
