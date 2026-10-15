import { createClerkClient } from "@clerk/backend";
import {
  bypassTokenAccount,
  isBypassAccount,
  isBypassToken,
} from "../core/auth-bypass";

/**
 * The login bypass for auditing signed-in screens locally. It is on only when
 * `npm run dev:roji:bypass` passes AUTH_BYPASS=1 to `wrangler dev` with
 * `--var`; wrangler.jsonc and .dev.vars never set it, so a deployed Worker
 * cannot accept these tokens.
 */
export type AuthEnv = Pick<
  Env,
  "CLERK_PUBLISHABLE_KEY" | "CLERK_SECRET_KEY"
> & {
  readonly AUTH_BYPASS?: string;
};

/**
 * The variable alone is not enough: a deployed Worker is reached by its public
 * hostname, so a variable set there by mistake still opens nothing.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const bypassEnabled = (env: AuthEnv, url?: string) =>
  env.AUTH_BYPASS === "1" &&
  (url === undefined || LOOPBACK.has(new URL(url).hostname));

function clerkClient(env: AuthEnv) {
  return createClerkClient({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
  });
}

/** The signed-in account of a request, or null. */
export async function authenticateAccount(
  request: Request,
  env: AuthEnv,
  authorizedParties: string[],
): Promise<string | null> {
  if (bypassEnabled(env, request.url)) {
    const header = request.headers.get("Authorization") ?? "";
    const token = header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : "";
    // A malformed bypass token is refused here: without Clerk keys locally,
    // passing it on would throw instead of answering 401.
    if (isBypassToken(token)) return bypassTokenAccount(token);
  }
  const auth = await clerkClient(env).authenticateRequest(request, {
    acceptsToken: "session_token",
    authorizedParties,
  });
  return auth.isAuthenticated ? auth.toAuth().userId : null;
}

/** Deletes the sign-in account itself; test accounts have none to delete. */
export async function deleteSignInAccount(
  env: AuthEnv,
  accountId: string,
): Promise<void> {
  if (bypassEnabled(env) && isBypassAccount(accountId)) return;
  await clerkClient(env).users.deleteUser(accountId);
}
