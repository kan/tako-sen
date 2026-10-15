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
  auth: "ログイン状態を確認できません。ログインし直してから、もう一度 OK を押してください。",
  profile:
    "プレイヤー名と公開ルールへの同意が必要です。設定してから、もう一度 OK を押してください。",
  busy: "サーバーが混み合っています。少し待ってから、もう一度 OK を押してください。",
} as const;

/** The signed-in account changed while a daily or super board was open. */
export const accountChanged = (board: string) =>
  `ログイン中のアカウントが変わりました。通常プレイに戻り、${board}を開き直してください。`;
