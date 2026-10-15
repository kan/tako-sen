/**
 * The login bypass's account and token rules, shared by the screen
 * (src/ui/auth.ts) and the Worker (src/worker/auth.ts) so the two cannot
 * drift apart. The bypass itself is local-dev only; see AGENTS.md.
 */

/** Test accounts are named dev-<name>, so they never collide with Clerk IDs. */
const BYPASS_ACCOUNT = /^dev-[a-z0-9-]{1,20}$/;
const TOKEN_PREFIX = "bypass:";

export function isBypassAccount(id: string | null | undefined): id is string {
  return !!id && BYPASS_ACCOUNT.test(id);
}

export function bypassToken(accountId: string): string {
  return `${TOKEN_PREFIX}${accountId}`;
}

export function isBypassToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

/** The test account a bypass token names, or null for any other token. */
export function bypassTokenAccount(token: string): string | null {
  if (!isBypassToken(token)) return null;
  const id = token.slice(TOKEN_PREFIX.length);
  return isBypassAccount(id) ? id : null;
}
