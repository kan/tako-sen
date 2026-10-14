export type ConnectionFailure =
  "network" | "timeout" | "auth" | "profile" | "server" | "rate" | "invalid";

export class SuperConnectionError extends Error {
  constructor(readonly kind: ConnectionFailure) {
    super(
      {
        network: "通信が不安定です。接続が戻ると超級の記録を再同期します。",
        timeout:
          "通信がタイムアウトしました。接続を確認し、少し待って再試行します。",
        auth: "ログイン状態を確認してください。再ログイン後に超級の記録を同期します。",
        profile: "ゲーム名と公開ルールへの同意を確認してください。",
        server: "サーバーが一時的に応答できません。少し待って再試行します。",
        rate: "送信が混み合っています。少し待って再試行します。",
        invalid: "サーバーの応答を確認できません。再試行してください。",
      }[kind],
    );
  }
}

/** A failure whose message is written for the player. */
export class SuperNotice extends Error {}

/** The player-facing text of a failure; anything else (a developer error in
 * English, a JSON parse failure) becomes `fallback`. */
export function superNoticeText(error: unknown, fallback: string): string {
  return error instanceof SuperNotice || error instanceof SuperConnectionError
    ? error.message
    : fallback;
}

/** Buffer the small JSON response before clearing the timeout: headers alone
 * do not mean a request has completed on an intermittent mobile connection. */
export async function fetchSuperResponse(
  path: string,
  init: RequestInit,
  timeoutMs = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    if (!response.ok)
      throw new SuperConnectionError(
        response.status === 401
          ? "auth"
          : response.status === 403
            ? "profile"
            : response.status === 429
              ? "rate"
              : response.status >= 500
                ? "server"
                : "invalid",
      );
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    if (error instanceof SuperConnectionError) throw error;
    throw new SuperConnectionError(
      controller.signal.aborted ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function superRetryDelay(failures: number): number {
  return Math.min(300000, 30000 * 2 ** Math.min(Math.max(failures - 1, 0), 4));
}
