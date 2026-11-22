import worker from "../src/worker/index";
import { createTestIdIssuer } from "kan-game/testing/test-id-cookie";

/**
 * The ID platform the Worker's tests sign cookies with. Its keys are made for
 * each test file, so no private key lives in the repository.
 */
export const ids = await createTestIdIssuer();

/** The vars that make the Worker accept the cookies of `ids`. */
export const idVars = {
  ID_COOKIE_NAME: ids.cookieName,
  ID_ISSUER: ids.issuer,
  ID_PUBLIC_KEYS: ids.publicKeys,
} satisfies Partial<Env>;

/** The ID the next requests of `fetchAs` are signed with; null for none. */
export const session: { account: string | null } = { account: null };

/**
 * The Worker's fetch handler, with the request signed as `session.account` by
 * a real ID cookie, which src/worker/auth.ts verifies as in production.
 */
export async function fetchAs(request: Request, env: Env): Promise<Response> {
  const signed = new Request(request);
  if (session.account !== null)
    signed.headers.set("Cookie", await ids.cookie(session.account));
  return worker.fetch(signed as Parameters<typeof worker.fetch>[0], {
    ...env,
    ...idVars,
  });
}

/**
 * The ID a test names `label`, as a UUID v4 like every kan-game.app ID (the
 * cookie's `sub` must be one). The same label gives the same ID in every run.
 */
export function testAccount(label: string): string {
  let hex = "";
  // FNV-1a of the label, once per 32 bits.
  for (let round = 0; hex.length < 32; round += 1) {
    let hash = (0x811c9dc5 ^ round) >>> 0;
    for (const char of label) {
      hash ^= char.codePointAt(0)!;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hex += hash.toString(16).padStart(8, "0");
  }
  const variant = "89ab"[parseInt(hex[16], 16) & 3];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
