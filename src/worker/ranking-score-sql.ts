import {
  HINT_PENALTY,
  MISTAKE_PENALTY,
  SCORE_BASE,
} from "../core/ranking-score";

/** Keep D1 rankings aligned with the client-side score formula. */
export function rankingScoreSql(alias: "a" | "c"): string {
  return `${SCORE_BASE} - ${alias}.elapsed_seconds - ${MISTAKE_PENALTY} * ${alias}.mistakes - ${HINT_PENALTY} * ${alias}.hints_used`;
}
