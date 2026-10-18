import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/vue", () => ({
  clerkPlugin: { name: "clerk" },
  Show: {},
  SignInButton: {},
  SignUpButton: {},
  useAuth: () => {
    throw new Error("Clerk must not be used while the login is bypassed.");
  },
}));

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
