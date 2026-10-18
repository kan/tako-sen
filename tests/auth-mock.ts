import type { Authentication } from "../src/worker/auth";

/**
 * Stands in for src/worker/auth.ts in the Worker's API tests, which set
 * `auth.account` to the ID a request is signed with (null for none). The
 * cookie itself is verified in tests/id-auth.test.ts.
 *
 *   vi.mock("../src/worker/auth", () => import("./auth-mock"));
 *   import { auth } from "./auth-mock";
 */
export const auth: { account: string | null } = { account: null };

export async function authenticateAccount(): Promise<Authentication> {
  return auth.account !== null
    ? { status: "ok", accountId: auth.account }
    : { status: "unauthorized" };
}
