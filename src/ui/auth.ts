import { readonly, ref, type Ref } from "vue";

/**
 * The kan-game.app ID of this device: the one place the screens get it from
 * (kan/game docs/ID_DESIGN.md). Every visitor gets an ID automatically from
 * POST /api/id/session, which this origin passes on to the ID platform. The
 * ID itself lives in an HttpOnly cookie that goes with every /api request, so
 * the screens never send a token; they only need to know which ID it is.
 */

export type IdStatus =
  /** Asking the ID platform; the last known ID, if any, is already set. */
  | "loading"
  /** The ID platform confirmed `id`. */
  | "ready"
  /** No connection. `id` is the last one this device knew, if any. */
  | "offline"
  /** The platform refused (rate limit, outage). It is asked again later. */
  | "unavailable";

export interface KanGameId {
  /** The ID, or null before this device ever got one. */
  readonly id: Readonly<Ref<string | null>>;
  /** The kan-game.app name, possibly chosen in another game. */
  readonly name: Readonly<Ref<string | null>>;
  readonly status: Readonly<Ref<IdStatus>>;
}

/**
 * The last ID the platform confirmed. Not a credential (the cookie is), but
 * it lets a device that already has an ID keep its offline clears for it.
 */
const ID_KEY = "tako-sen.kan-game-id.v1";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function storedId(): string | null {
  try {
    const value = localStorage.getItem(ID_KEY);
    return value && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

function storeId(value: string | null): void {
  try {
    if (value) localStorage.setItem(ID_KEY, value);
    else localStorage.removeItem(ID_KEY);
  } catch {
    // Without storage the ID is known again once the platform answers.
  }
}

const id = ref<string | null>(null);
const name = ref<string | null>(null);
const status = ref<IdStatus>("loading");
let started = false;
let pending: Promise<void> | undefined;
/**
 * Each request that can name the device's ID takes a number, and only the
 * latest one's answer counts: a session answer sent with the old cookie must
 * not undo a transfer code redeemed after it.
 */
let latestRequest = 0;

interface IdResponse {
  id: string;
  name: string | null;
}

function accept(body: unknown, request: number): boolean {
  const value = body as Partial<IdResponse> | null;
  if (typeof value?.id !== "string" || !UUID.test(value.id)) return false;
  if (request !== latestRequest) return true;
  id.value = value.id;
  name.value = typeof value.name === "string" ? value.name : null;
  status.value = "ready";
  storeId(value.id);
  return true;
}

function postId(path: string, body?: unknown): Promise<Response> {
  return fetch(`/api/id/${path}`, {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function askSession(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    status.value = "offline";
    return;
  }
  const request = ++latestRequest;
  status.value = "loading";
  try {
    let response = await postId("session");
    // A withdrawn ID: that answer cleared its cookie, and asking again issues
    // a new ID (kan/game src/session.ts).
    if (response.status === 410 && request === latestRequest) {
      forgetId();
      response = await postId("session");
    }
    if (response.ok && accept(await response.json(), request)) return;
    if (request === latestRequest) status.value = "unavailable";
  } catch {
    if (request === latestRequest) status.value = "offline";
  }
}

let lastAsked = -Infinity;

/**
 * A redeem in flight. The session waits for it, and it waits for the session:
 * the two set the same cookie, so the one that answers last must be the one
 * that was sent last.
 */
let redeeming: Promise<unknown> | undefined;

/** Asks the ID platform for this device's ID, once at a time. */
export function refreshId(): Promise<void> {
  pending ??= (redeeming ?? Promise.resolve())
    .catch(() => {})
    .then(askSession)
    .finally(() => {
      pending = undefined;
    });
  lastAsked = Date.now();
  return pending;
}

/**
 * A 401 asks again at most this often: a device whose cookie is not kept
 * would otherwise ask after every request its retry timers make.
 */
const UNAUTHORIZED_RETRY_MS = 60_000;

function forgetId(): void {
  id.value = null;
  name.value = null;
  storeId(null);
}

/** How often a device without an ID asks again (the platform was down). */
const NO_ID_RETRY_MS = 30_000;

/**
 * Starts the ID once per page: the last known ID at once, then the platform's
 * answer, again whenever the connection comes back, and every half minute for
 * as long as the device has no ID.
 */
export function startId(): void {
  if (started) return;
  started = true;
  id.value = storedId();
  window.addEventListener("online", () => void refreshId());
  window.setInterval(() => {
    if (!id.value) void refreshId();
  }, NO_ID_RETRY_MS);
  void refreshId();
}

export function useId(): KanGameId {
  return { id: readonly(id), name: readonly(name), status: readonly(status) };
}

/**
 * A status that means the request's ID is the problem, not the request: 401
 * (no valid cookie) or 410 (the ID was withdrawn on kan-game.app).
 */
export function isIdFailure(status: number): boolean {
  return status === 401 || status === 410;
}

/**
 * fetch for TAKO-SEN's own API, which reads the ID from the cookie. After a
 * 410 the withdrawn ID is dropped and a new one fetched; after a 401 (the
 * cookie was cleared, or never set while offline) the ID is asked for again.
 * Screens keyed by `id` follow. The response is returned as it is.
 */
export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 410) {
    forgetId();
    void refreshId();
  } else if (
    response.status === 401 &&
    Date.now() - lastAsked >= UNAUTHORIZED_RETRY_MS
  )
    void refreshId();
  return response;
}

export type TransferCodeIssue =
  | { ok: true; code: string; expiresAt: number }
  | { ok: false; reason: "offline" | "failed" };

/** Issues a one-time code that moves this ID to another device (10 minutes). */
export async function issueTransferCode(): Promise<TransferCodeIssue> {
  try {
    const response = await postId("transfer-codes");
    if (!response.ok) return { ok: false, reason: "failed" };
    const body = (await response.json()) as {
      code?: unknown;
      expiresAt?: unknown;
    };
    return typeof body.code === "string" && typeof body.expiresAt === "number"
      ? { ok: true, code: body.code, expiresAt: body.expiresAt }
      : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

export type Redeem =
  | { ok: true }
  | { ok: false; reason: "invalid" | "rate_limited" | "offline" | "failed" };

/**
 * A redeem API of the ID platform: switches this device to the ID a secret
 * belongs to. The device's previous ID keeps its records; they are not merged.
 */
function redeem(path: string, body: unknown): Promise<Redeem> {
  const running = (pending ?? Promise.resolve())
    .then(() => sendRedeem(path, body))
    .finally(() => {
      if (redeeming === running) redeeming = undefined;
    });
  redeeming = running;
  return running;
}

async function sendRedeem(path: string, body: unknown): Promise<Redeem> {
  const request = ++latestRequest;
  try {
    const response = await postId(path, body);
    if (response.ok && accept(await response.json(), request))
      return { ok: true };
    if (response.status === 400) return { ok: false, reason: "invalid" };
    if (response.status === 429) return { ok: false, reason: "rate_limited" };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** Moves this device to the ID that issued a transfer code. */
export function redeemTransferCode(code: string): Promise<Redeem> {
  return redeem("transfer-codes/redeem", { code });
}

/**
 * Moves this device to the ID that holds the player's records from the old
 * URL (a migration token, src/core/handoff.ts).
 */
export function redeemMigrationToken(token: string): Promise<Redeem> {
  return redeem("migration/redeem", { token });
}

/**
 * A page of the kan-game.app portal: the account screen (recovery codes,
 * withdrawal) and the privacy policy live there, not in each game. The portal
 * follows this page's host (tako-dev.kan-game.app → dev.kan-game.app), so a
 * build cannot point at another environment's portal. Any other public host
 * gets the production portal; only local hosts get the local one.
 */
export function portalUrl(
  path: "/account" | "/privacy" | "/terms",
  host = new URL(window.location.href).hostname,
): string {
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    // A phone reaching the dev machine by its LAN address.
    /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const portal = host.endsWith(".kan-game.app")
    ? host.split(".")[0].endsWith("-dev")
      ? "https://dev.kan-game.app"
      : "https://kan-game.app"
    : local
      ? // kan/game's portal runs beside the game; a phone needs the dev
        // machine's address here (VITE_KAN_GAME_PORTAL).
        import.meta.env.VITE_KAN_GAME_PORTAL || "http://localhost:8787"
      : "https://kan-game.app";
  return new URL(path, portal).href;
}
