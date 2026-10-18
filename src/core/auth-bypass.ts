/**
 * The login bypass's account rules for the screen (src/ui/auth.ts). The
 * bypass itself is local-dev only; see AGENTS.md.
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
