/**
 * The old URL after the switch to kan-game.app (main's docs/NEXT_PHASE.md
 * 「既存の記録の移行」). With MOVED_TO and MIGRATION_ENDS set, the site stops
 * taking writes, tells the screen where TAKO-SEN went, and hands each
 * signed-in player the token that takes their records over there.
 */
import { json } from "./http";

export interface Moved {
  /** The new origin, e.g. https://tako.kan-game.app. */
  readonly target: string;
  /** The last day of the migration period (YYYY-MM-DD, Japan time). */
  readonly endsOn: string;
}

export interface MovedEnv {
  readonly DB: D1Database;
  readonly MOVED_TO?: string;
  readonly MIGRATION_ENDS?: string;
}

/** The move, or null while the old URL still runs the game. */
export function movedState(env: MovedEnv): Moved | null {
  const to = env.MOVED_TO?.trim();
  const endsOn = env.MIGRATION_ENDS?.trim();
  if (!to || !endsOn) return null;
  let target: URL;
  try {
    target = new URL(to);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn))
    return null;
  return { target: target.origin, endsOn };
}

/** Whether the migration period is over: after its last day in Japan. */
export function migrationEnded(moved: Moved, now: number): boolean {
  return now > Date.parse(`${moved.endsOn}T23:59:59.999+09:00`);
}

export interface MovedRequest {
  readonly request: Request;
  readonly pathname: string;
  readonly moved: Moved | null;
  readonly env: MovedEnv;
  /** The origins allowed to call the API (ALLOWED_ORIGINS). */
  readonly origins: readonly string[];
  /** Checks the Clerk session; runs only for the token request. */
  readonly account: () => Promise<string | null>;
  readonly now?: number;
}

/**
 * The answer for a request, or null to serve it as before (the game before
 * the move; pages and reads of the records after it, which stay visible
 * until the end). GET /api/moved answers either way, with null before the
 * move, so the screen knows which to show.
 */
export async function handleMoved({
  request,
  pathname,
  moved,
  env,
  origins,
  account,
  now = Date.now(),
}: MovedRequest): Promise<Response | null> {
  const isMovedApi =
    pathname === "/api/moved" ||
    (moved !== null && pathname === "/api/migration-handoff");
  if (isMovedApi && request.method !== "GET")
    return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  if (pathname === "/api/moved") return json(moved);
  if (!moved) return null;
  if (pathname === "/api/migration-handoff") {
    // The same guards as the signed-in API in index.ts.
    if (origins.length === 0)
      return json({ error: "service_unavailable" }, 503);
    const origin = request.headers.get("Origin");
    if (origin && !origins.includes(origin))
      return json({ error: "forbidden_origin" }, 403);
    // The ID platform no longer takes the tokens.
    if (migrationEnded(moved, now))
      return json({ error: "migration_ended" }, 410);
    try {
      const accountId = await account();
      if (!accountId) return json({ error: "unauthorized" }, 401);
      const row = await env.DB.prepare(
        "SELECT token FROM migration_handoffs WHERE clerk_user_id = ?",
      )
        .bind(accountId)
        .first<{ token: string }>();
      return row
        ? json({ token: row.token })
        : json({ error: "no_records" }, 404);
    } catch {
      console.error(JSON.stringify({ event: "migration_handoff_failure" }));
      return json({ error: "service_unavailable" }, 503);
    }
  }
  // Clerk retries a refused delivery and finally turns the endpoint off, so
  // take it and change nothing: the records already live on under a
  // kan-game.app ID, where the player withdraws instead.
  if (pathname === "/api/clerk-webhook" && request.method === "POST") {
    console.log(JSON.stringify({ event: "clerk_webhook_ignored_after_move" }));
    return json({ ignored: true }, 202);
  }
  // Records are moved as they were at the switch: nothing may change them.
  if (
    pathname.startsWith("/api/") &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  )
    return json({ error: "moved", target: moved.target }, 410);
  return null;
}
