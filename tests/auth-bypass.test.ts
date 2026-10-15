import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  account: null as string | null,
  deleted: [] as string[],
}));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: async () => ({
      isAuthenticated: clerk.account !== null,
      toAuth: () => ({ userId: clerk.account }),
    }),
    users: {
      deleteUser: async (id: string) => {
        clerk.deleted.push(id);
      },
    },
  }),
}));
vi.mock("@clerk/vue", () => ({
  clerkPlugin: { name: "clerk" },
  Show: {},
  SignInButton: {},
  SignUpButton: {},
  useAuth: () => {
    throw new Error("Clerk must not be used while the login is bypassed.");
  },
}));

import { authenticateAccount, deleteSignInAccount } from "../src/worker/auth";

const keys = { CLERK_PUBLISHABLE_KEY: "pk", CLERK_SECRET_KEY: "sk" };
const withToken = (token: string, origin = "http://127.0.0.1:8787") =>
  new Request(`${origin}/api/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });

describe("worker login bypass", () => {
  beforeEach(() => {
    clerk.account = null;
    clerk.deleted = [];
  });

  it("ignores bypass tokens unless AUTH_BYPASS is set", async () => {
    expect(await authenticateAccount(withToken("bypass:dev-a"), keys, [])).toBe(
      null,
    );
    expect(
      await authenticateAccount(
        withToken("bypass:dev-a"),
        { ...keys, AUTH_BYPASS: "0" },
        [],
      ),
    ).toBe(null);
  });

  it("accepts only dev- test accounts when AUTH_BYPASS is set", async () => {
    const env = { ...keys, AUTH_BYPASS: "1" };
    expect(await authenticateAccount(withToken("bypass:dev-a"), env, [])).toBe(
      "dev-a",
    );
    expect(
      await authenticateAccount(withToken("bypass:user_123"), env, []),
    ).toBe(null);
    // Real Clerk sessions keep working beside the bypass.
    clerk.account = "user_123";
    expect(await authenticateAccount(withToken("clerk"), env, [])).toBe(
      "user_123",
    );
    // A malformed bypass token never reaches Clerk.
    expect(
      await authenticateAccount(withToken("bypass:Bad_Name"), env, []),
    ).toBe(null);
  });

  it("refuses bypass tokens on a public hostname even with AUTH_BYPASS", async () => {
    const env = { ...keys, AUTH_BYPASS: "1" };
    expect(
      await authenticateAccount(
        withToken("bypass:dev-a", "https://tako-sen.example.workers.dev"),
        env,
        [],
      ),
    ).toBe(null);
  });

  it("deletes only real sign-in accounts", async () => {
    await deleteSignInAccount({ ...keys, AUTH_BYPASS: "1" }, "dev-a");
    expect(clerk.deleted).toEqual([]);
    await deleteSignInAccount(keys, "user_123");
    expect(clerk.deleted).toEqual(["user_123"]);
  });
});

describe("screen login bypass", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const load = (search: string) => {
    vi.stubGlobal("window", {
      location: { href: `https://tako-sen.test/${search}` },
    });
    return import("../src/ui/auth");
  };

  it("stays off in a production build even with the flag", async () => {
    vi.stubEnv("VITE_AUTH_BYPASS", "1");
    vi.stubEnv("DEV", false);
    const auth = await load("");
    expect(auth.authBypass).toBe(false);
  });

  it("signs in the account from ?as= and signs out on request", async () => {
    vi.stubEnv("VITE_AUTH_BYPASS", "1");
    vi.stubEnv("DEV", true);
    const auth = await load("?as=dev-b");
    expect(auth.authBypass).toBe(true);
    expect(auth.onlineAuthEnabled).toBe(true);
    const session = auth.useAuth();
    expect(session.isSignedIn.value).toBe(true);
    expect(await session.getToken()).toBe("bypass:dev-b");
    await session.signOut();
    expect(session.isSignedIn.value).toBe(false);
    expect(await session.getToken()).toBe(null);
  });

  it("keeps a sign-out across reloads until the sign-in button", async () => {
    vi.stubEnv("VITE_AUTH_BYPASS", "1");
    vi.stubEnv("DEV", true);
    await (await load("?as=dev-b")).useAuth().signOut();
    vi.resetModules();
    const reloaded = await load("?as=dev-b");
    expect(reloaded.useAuth().isSignedIn.value).toBe(false);
  });

  it("does not load Clerk while the login is bypassed", async () => {
    vi.stubEnv("VITE_AUTH_BYPASS", "1");
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test");
    vi.stubEnv("DEV", true);
    const use = vi.fn();
    (await load("")).installAuth({ use } as never);
    expect(use).not.toHaveBeenCalled();
    vi.stubEnv("DEV", false);
    vi.resetModules();
    (await load("")).installAuth({ use } as never);
    expect(use).toHaveBeenCalledOnce();
  });

  it("falls back to dev-player for a missing or malformed account", async () => {
    vi.stubEnv("VITE_AUTH_BYPASS", "1");
    vi.stubEnv("DEV", true);
    const auth = await load("?as=Robert');DROP");
    expect(await auth.useAuth().getToken()).toBe("bypass:dev-player");
  });
});
