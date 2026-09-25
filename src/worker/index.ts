import { createClerkClient } from "@clerk/backend";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { verifyCompletedPlayUpload } from "../core/online-history";
import { createSharedPuzzleSnapshot } from "../core/shared-puzzle";
import {
  deleteAccountHistory,
  listCompletedPlays,
  saveCompletedPlay,
} from "./history";
import { getSharedPuzzle, saveSharedPuzzle } from "./puzzles";

const maxBodyBytes = 4096;
const maxWebhookBytes = 65536;

export default {
  async fetch(request, env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/clerk-webhook") {
      if (request.method !== "POST")
        return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
      let event;
      try {
        const body = await readLimitedBody(request, maxWebhookBytes);
        event = await verifyWebhook(
          new Request(request.url, {
            method: "POST",
            headers: request.headers,
            body,
          }),
          { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET },
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "clerk_webhook_verification_failure",
            error: String(error),
          }),
        );
        return json({ error: "invalid_webhook" }, 400);
      }
      try {
        if (event.type === "user.deleted" && event.data.id) {
          await deleteAccountHistory(env.DB, event.data.id);
        }
        return json({ status: "ok" });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "clerk_webhook_storage_failure",
            error: String(error),
          }),
        );
        return json({ error: "service_unavailable" }, 503);
      }
    }
    if (pathname.startsWith("/api/puzzles/")) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      let id: string;
      try {
        id = decodeURIComponent(pathname.slice("/api/puzzles/".length));
      } catch {
        return json({ error: "invalid_puzzle_id" }, 400);
      }
      if (!/^p1:[0-9a-f]{64}$/.test(id))
        return json({ error: "invalid_puzzle_id" }, 400);
      try {
        const snapshot = await getSharedPuzzle(env.DB, id);
        return snapshot
          ? json({ puzzle: snapshot })
          : json({ error: "not_found" }, 404);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "shared_puzzle_read_failure",
            error: String(error),
          }),
        );
        return json({ error: "service_unavailable" }, 503);
      }
    }
    if (
      pathname !== "/api/plays" &&
      pathname !== "/api/account" &&
      pathname !== "/api/puzzles"
    ) {
      if (pathname.startsWith("/api/"))
        return json({ error: "not_found" }, 404);
      return env.ASSETS.fetch(request);
    }
    const isAccountDeletion = pathname === "/api/account";
    const isPuzzleCreation = pathname === "/api/puzzles";
    if (
      isAccountDeletion
        ? request.method !== "DELETE"
        : isPuzzleCreation
          ? request.method !== "POST"
          : request.method !== "GET" && request.method !== "POST"
    ) {
      return json({ error: "method_not_allowed" }, 405, {
        Allow: isAccountDeletion
          ? "DELETE"
          : isPuzzleCreation
            ? "POST"
            : "GET, POST",
      });
    }

    const authorizedParties = env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (authorizedParties.length === 0) {
      return json({ error: "service_unavailable" }, 503);
    }
    const origin = request.headers.get("Origin");
    if (origin && !authorizedParties.includes(origin)) {
      return json({ error: "forbidden_origin" }, 403);
    }

    try {
      const clerk = createClerkClient({
        publishableKey: env.CLERK_PUBLISHABLE_KEY,
        secretKey: env.CLERK_SECRET_KEY,
      });
      const auth = await clerk.authenticateRequest(request, {
        acceptsToken: "session_token",
        authorizedParties,
      });
      const accountId = auth.isAuthenticated ? auth.toAuth().userId : null;
      if (!accountId) return json({ error: "unauthorized" }, 401);

      if (isAccountDeletion) {
        await deleteAccountHistory(env.DB, accountId);
        await clerk.users.deleteUser(accountId);
        return json({ status: "deleted" });
      }

      if (isPuzzleCreation) {
        if (
          !request.headers.get("Content-Type")?.startsWith("application/json")
        )
          return json({ error: "unsupported_media_type" }, 415);
        let seedCode: unknown;
        try {
          const body: unknown = JSON.parse(await readLimitedBody(request, 512));
          seedCode =
            body && typeof body === "object" && "seedCode" in body
              ? body.seedCode
              : undefined;
        } catch {
          return json({ error: "invalid_body" }, 400);
        }
        if (typeof seedCode !== "string")
          return json({ error: "invalid_seed_code" }, 400);
        let snapshot;
        try {
          snapshot = await createSharedPuzzleSnapshot(seedCode);
        } catch {
          return json({ error: "invalid_seed_code" }, 400);
        }
        const outcome = await saveSharedPuzzle(env.DB, snapshot);
        return json(
          {
            puzzle:
              outcome === "created"
                ? snapshot
                : await getSharedPuzzle(env.DB, snapshot.id),
          },
          outcome === "created" ? 201 : 200,
        );
      }

      if (request.method === "GET") {
        return json({ plays: await listCompletedPlays(env.DB, accountId) });
      }
      if (
        !request.headers.get("Content-Type")?.startsWith("application/json")
      ) {
        return json({ error: "unsupported_media_type" }, 415);
      }
      let submitted: unknown;
      try {
        submitted = JSON.parse(await readLimitedBody(request, maxBodyBytes));
      } catch {
        return json({ error: "invalid_body" }, 400);
      }
      let play;
      try {
        play = await verifyCompletedPlayUpload(submitted);
      } catch {
        return json({ error: "invalid_play" }, 400);
      }
      const outcome = await saveCompletedPlay(env.DB, accountId, play);
      return outcome === "conflict"
        ? json({ error: "play_id_conflict" }, 409)
        : json({ status: outcome }, outcome === "created" ? 201 : 200);
    } catch (error) {
      console.error(
        JSON.stringify({ event: "history_api_failure", error: String(error) }),
      );
      return json({ error: "service_unavailable" }, 503);
    }
  },
} satisfies ExportedHandler<Env>;

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Body too large.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(data);
}
