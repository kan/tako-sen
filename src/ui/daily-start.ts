import { isIdFailure } from "./auth";
import { START_FAILURE } from "./notice-text";

/** Why the server refused a start, keyed by the status it answers 409 with. */
const REFUSALS: Record<string, string> = {
  expired:
    "日付が変わったため、この盤面では挑戦できません。通常プレイに戻り、今日のデイリーを開き直してください。",
  already_started:
    "今日の挑戦は別の画面で始まっています。始めた端末で続けてください。",
  completed:
    "今日の挑戦はクリア済みです。通常プレイに戻ると、ランキングを確認できます。",
};

/**
 * What READY says when `POST /api/daily/start` refused the start: the HTTP
 * status, and for a 409 the `status` its body names.
 */
export function dailyStartFailureText(
  httpStatus: number,
  refusal?: unknown,
): string {
  if (isIdFailure(httpStatus)) return START_FAILURE.auth;
  if (httpStatus === 403) return START_FAILURE.profile;
  if (
    httpStatus === 409 &&
    typeof refusal === "string" &&
    Object.hasOwn(REFUSALS, refusal)
  )
    return REFUSALS[refusal];
  return START_FAILURE.busy;
}
