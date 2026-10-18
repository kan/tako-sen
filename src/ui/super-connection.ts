import { apiFetch, isIdFailure } from "./auth";
import { START_FAILURE } from "./notice-text";

export type ConnectionFailure =
  | "network"
  | "timeout"
  | "auth"
  | "profile"
  | "server"
  | "rate"
  | "conflict"
  | "invalid";

/** What went wrong and what happens next, for the background sync. */
export class SuperConnectionError extends Error {
  constructor(readonly kind: ConnectionFailure) {
    super(
      {
        network:
          "通信が不安定です。接続が戻ると超級の記録を自動で送り直します。",
        timeout:
          "通信がタイムアウトしました。少し待ってから自動で送り直します。",
        auth: "この端末の ID を確認し直しています。確認できると、超級の記録を送り直します。",
        profile:
          "プレイヤー名と公開ルールへの同意が必要です。アカウントから設定してください。",
        server:
          "サーバーが一時的に応答できません。少し待ってから自動で送り直します。",
        rate: "送信が混み合っています。少し待ってから自動で送り直します。",
        conflict:
          "サーバーの記録と食い違うため受け付けられませんでした。超級の案内を開き直してください。",
        invalid:
          "サーバーの応答を確認できません。少し待ってから、もう一度お試しください。",
      }[kind],
    );
  }
}

/** Why pressing OK on READY did not start the board, and what to do. */
export function superStartFailureText(error: unknown): string {
  const kind = error instanceof SuperConnectionError ? error.kind : undefined;
  switch (kind) {
    case "network":
    case "timeout":
      return START_FAILURE.offline;
    case "auth":
      return START_FAILURE.auth;
    case "profile":
      return START_FAILURE.profile;
    case "conflict":
      return "この挑戦権は使用済みか、別の画面で開始されています。通常プレイに戻り、超級の案内を開き直してください。";
    case "server":
    case "rate":
      return START_FAILURE.busy;
    default:
      return superNoticeText(
        error,
        "超級を開始できません。少し待ってから、もう一度 OK を押してください。",
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
    // apiFetch asks for the ID again after a 401 or 410.
    const response = await apiFetch(path, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok)
      throw new SuperConnectionError(
        isIdFailure(response.status)
          ? "auth"
          : response.status === 403
            ? "profile"
            : response.status === 429
              ? "rate"
              : response.status === 409
                ? "conflict"
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
