/**
 * Wording shared by failure notices, so one situation reads the same on every
 * screen. A notice says what failed and what to do; PLAY_CONTINUES only adds
 * that the ordinary boards are unaffected.
 */
export const PLAY_CONTINUES = "通常の問題はこのまま遊べます。";

/** The fix for anything that could not be kept on this device. */
export const ALLOW_SITE_DATA =
  "ブラウザの設定でサイトのデータの保存を許可してください。";

/** Why OK on READY did not start a daily or super board, and what to do. */
export const START_FAILURE = {
  offline:
    "通信できないため開始できません。接続を確認して、もう一度 OK を押してください。",
  auth: "この端末の ID を確認できません。少し待ってから、もう一度 OK を押してください。",
  profile:
    "プレイヤー名と公開ルールへの同意が必要です。設定してから、もう一度 OK を押してください。",
  busy: "サーバーが混み合っています。少し待ってから、もう一度 OK を押してください。",
} as const;

/**
 * This device's ID changed (a transfer code, or a withdrawal) while a daily or
 * super board was open.
 */
export const accountChanged = (board: string) =>
  `この端末の ID が変わりました。通常プレイに戻り、${board}を開き直してください。`;

/**
 * This device has no kan-game.app ID yet: it has been offline since it was
 * first opened, or the ID platform did not answer.
 */
export const idUnavailable = (failed: string) =>
  `この端末の ID を確認できないため、${failed}。接続を確認してください。`;

/** What daily, super and sharing ask for. */
export const NAME_AND_ONLINE_REQUIRED =
  "プレイヤー名の設定とオンライン接続が必要です。";

/** Where clears go before a name is set (the account and settings dialogs). */
export const ID_STORAGE_NOTE =
  "クリアの記録は、この端末の ID で保存します。プレイヤー名を決めるまでは公開しません。";

/** A button press that needs the connection did not get through. */
export const PRESS_AGAIN_ONLINE = "接続を確認して、もう一度押してください。";

/**
 * Why switching this device's ID did not happen, when trying again can work
 * (a typed transfer code, a QR code, the old URL's link). A refused secret
 * is explained where it was entered.
 */
export function redeemRetryText(
  reason: "rate_limited" | "offline" | "failed",
): string {
  return reason === "rate_limited"
    ? "入力が多すぎます。1分ほど待ってから、もう一度押してください。"
    : reason === "offline"
      ? PRESS_AGAIN_ONLINE
      : "引き継げません。少し待ってから、もう一度押してください。";
}
