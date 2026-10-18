import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { authenticateAccount } from "../src/worker/auth";
import { deleteAccount } from "../src/worker/history";
import worker from "../src/worker/index";
import {
  createTestIdIssuer,
  type TestIdIssuer,
} from "./kan-game/test-id-cookie";
import { migrateTestDatabase } from "./migrations";

const origin = "https://tako-dev.kan-game.app";
let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
/** The ID platform whose key TAKO-SEN knows, and one whose key it does not. */
let ids: TestIdIssuer;
let stranger: TestIdIssuer;

function env(id?: Partial<Pick<Env, "ID">>): Env {
  return {
    DB: platform.env.DB,
    ALLOWED_ORIGINS: origin,
    ID_COOKIE_NAME: ids.cookieName,
    ID_ISSUER: ids.issuer,
    ID_PUBLIC_KEYS: ids.publicKeys,
    ...id,
  } as unknown as Env;
}

const cookie = (sub: string) => ids.cookie(sub);

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "./tests/wrangler.jsonc",
    persist: false,
    remoteBindings: false,
  });
  await migrateTestDatabase(platform.env.DB);
  ids = await createTestIdIssuer();
  stranger = await createTestIdIssuer({ kid: "other-key" });
});

afterAll(async () => {
  await platform?.dispose();
});

describe("the ID cookie", () => {
  const request = (headers: HeadersInit) =>
    new Request(`${origin}/api/plays`, { headers });

  it("names the account of a signed cookie", async () => {
    const id = crypto.randomUUID();
    expect(
      await authenticateAccount(request({ Cookie: await cookie(id) }), env()),
    ).toEqual({ status: "ok", accountId: id });
  });

  it("refuses a missing cookie, another issuer, an unknown key and an expired one", async () => {
    const id = crypto.randomUUID();
    for (const header of [
      "",
      await ids.cookie(id, { iss: "kan-game.app" }),
      await stranger.cookie(id),
      // Expired: signed 400 days and a second ago.
      await ids.cookie(id, { nowMs: Date.now() - 400 * 86_400_000 - 1000 }),
    ])
      expect(
        await authenticateAccount(request({ Cookie: header }), env()),
      ).toEqual({ status: "unauthorized" });
  });

  it("refuses a withdrawn ID whose cookie is still valid", async () => {
    const id = crypto.randomUUID();
    await deleteAccount(platform.env.DB, id);
    const headers = { Cookie: await cookie(id), Origin: origin };
    expect(await authenticateAccount(request(headers), env())).toEqual({
      status: "deleted",
    });
    const response = await worker.fetch(
      request(headers) as Parameters<typeof worker.fetch>[0],
      env(),
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "id_deleted" });
  });
});

describe("the Worker's API", () => {
  const call = (path: string, init: RequestInit, id?: Pick<Env, "ID">) =>
    worker.fetch(
      new Request(`${origin}${path}`, init) as Parameters<
        typeof worker.fetch
      >[0],
      env(id),
    );

  it("passes /api/id/* on to the ID platform unchanged", async () => {
    const fetch = vi.fn(async (_request: Request) =>
      Response.json({ id: "from-platform" }),
    );
    const response = await call(
      "/api/id/session",
      {
        method: "POST",
        headers: { Origin: origin, "CF-Connecting-IP": "203.0.113.7" },
      },
      { ID: { fetch } as unknown as Env["ID"] },
    );
    expect(await response.json()).toEqual({ id: "from-platform" });
    const forwarded = fetch.mock.calls[0][0];
    expect(forwarded.url).toBe(`${origin}/api/id/session`);
    expect(forwarded.method).toBe("POST");
    expect(forwarded.headers.get("CF-Connecting-IP")).toBe("203.0.113.7");
    expect(forwarded.headers.get("Origin")).toBe(origin);
  });

  it("answers in JSON when the ID platform cannot be reached", async () => {
    const fetch = async () => {
      throw new Error("no such service");
    };
    const response = await call(
      "/api/id/session",
      { method: "POST", headers: { Origin: origin } },
      { ID: { fetch } as unknown as Env["ID"] },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });

  it("requires an allowed Origin to change state, but not to read", async () => {
    const headers = { Cookie: await cookie(crypto.randomUUID()) };
    const post = { method: "POST", headers };
    expect((await call("/api/plays", post)).status).toBe(403);
    expect(
      (
        await call("/api/plays", {
          ...post,
          headers: { ...headers, Origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
    expect((await call("/api/plays", { headers })).status).toBe(200);
  });

  it("no longer serves the Clerk routes", async () => {
    const init = { method: "POST", headers: { Origin: origin } };
    expect((await call("/api/clerk-webhook", init)).status).toBe(404);
    expect(
      (await call("/api/account", { ...init, method: "DELETE" })).status,
    ).toBe(404);
  });
});
