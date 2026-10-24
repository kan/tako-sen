import {
  ACHIEVEMENTS,
  achievementProgress,
  isAchievementHidden,
  isAchievementUnlocked,
  longestDailyStreak,
  newlyUnlockedAchievementIds,
  type AchievementStats,
} from "../core/achievements";
import { ORDINARY_VERSIONS } from "./weekly-ranking";

/**
 * 実績の判定と保存（docs/NEXT_PHASE.md「実績の導入計画」、docs/DATA_CONTRACT.md
 * 「実績」）。判定は本人の記録から毎回数え直し、解除したことだけを achievements に残す。
 */

/** 一覧の 1 項目。progress は記録から判定する実績だけで、伏せる実績では null */
export interface AchievementState {
  readonly id: string;
  readonly unlockedAt: number | null;
  readonly progress: number | null;
}

const INSERT_ACHIEVEMENT = `INSERT INTO achievements (account_id, achievement_type, unlocked_at)
  VALUES (?, ?, ?) ON CONFLICT(account_id, achievement_type) DO NOTHING`;

// 日本時間の日付の番号。日本に夏時間はないので、9 時間ずらして 1 日の長さで割る。
// completed_at は整数のミリ秒なので、SQLite の整数の割り算で切り捨てになる。
const jstDay = (column: string) => `(${column} + 32400000) / 86400000`;

/**
 * 本人の記録を集計する 4 文。except に試行の play_id を渡すと、その試行を除いた値
 * （その記録を登録する前の値）になる。null なら全件（play_id IS NOT NULL）。
 * 3 種の記録はどれも play_id を持つ。
 */
function statsStatements(
  db: D1Database,
  accountId: string,
  except: string | null,
): D1PreparedStatement[] {
  return [
    db.prepare(
      `SELECT COUNT(*) AS clears,
         COALESCE(SUM(difficulty = 'hard'), 0) AS hard,
         COALESCE(SUM(mistakes = 0), 0) AS no_mistake,
         COALESCE(SUM(mistakes = 0 AND difficulty = 'hard'), 0) AS no_mistake_hard,
         COALESCE(SUM(mistakes = 0 AND hints_used = 0), 0) AS perfect
       FROM completed_plays
       WHERE account_id = ?1 AND play_id IS NOT ?2
         AND generator_version IN (${ORDINARY_VERSIONS})`,
    ),
    // デイリーは 1 日 1 行なので、連続日数のために日付を全部読む。
    db.prepare(
      `SELECT challenge_date AS date, (mistakes = 0 AND hints_used = 0) AS perfect
       FROM daily_attempts
       WHERE account_id = ?1 AND play_id IS NOT ?2 AND completed_at IS NOT NULL`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS clears,
         COALESCE(SUM(mistakes = 0 AND hints_used = 0), 0) AS perfect
       FROM super_attempts
       WHERE account_id = ?1 AND play_id IS NOT ?2 AND completed_at IS NOT NULL`,
    ),
    db.prepare(
      `SELECT COUNT(DISTINCT day) AS days FROM (
         SELECT ${jstDay("completed_at")} AS day FROM completed_plays
           WHERE account_id = ?1 AND play_id IS NOT ?2
         UNION ALL
         SELECT ${jstDay("completed_at")} FROM daily_attempts
           WHERE account_id = ?1 AND play_id IS NOT ?2 AND completed_at IS NOT NULL
         UNION ALL
         SELECT ${jstDay("completed_at")} FROM super_attempts
           WHERE account_id = ?1 AND play_id IS NOT ?2 AND completed_at IS NOT NULL)`,
    ),
  ].map((statement) => statement.bind(accountId, except));
}

function toStats([
  ordinary,
  daily,
  superPlays,
  days,
]: D1Result[]): AchievementStats {
  const normal = ordinary.results[0] as {
    clears: number;
    hard: number;
    no_mistake: number;
    no_mistake_hard: number;
    perfect: number;
  };
  const dailyRows = daily.results as { date: string; perfect: number }[];
  const superRow = superPlays.results[0] as { clears: number; perfect: number };
  const dailyPerfect = dailyRows.filter((row) => row.perfect === 1).length;
  return {
    normalClears: normal.clears,
    hardClears: normal.hard,
    noMistakeClears: normal.no_mistake,
    noMistakeHardClears: normal.no_mistake_hard,
    perfectSolves: normal.perfect + dailyPerfect + superRow.perfect,
    dailyClearDays: dailyRows.length,
    dailyBestStreak: longestDailyStreak(dailyRows.map((row) => row.date)),
    superClears: superRow.clears,
    clearDays: (days.results[0] as { days: number }).days,
  };
}

/**
 * 本人の記録の集計と保存済みの解除を、1 回の batch で読む。except を渡すと、
 * その試行を除いた集計（before）も同じ batch で読む。
 */
async function readAccount(
  db: D1Database,
  accountId: string,
  except: string | null = null,
): Promise<{
  stats: AchievementStats;
  before: AchievementStats | null;
  saved: Map<string, number>;
}> {
  const results = await db.batch([
    ...statsStatements(db, accountId, null),
    ...(except === null ? [] : statsStatements(db, accountId, except)),
    db
      .prepare(
        "SELECT achievement_type, unlocked_at FROM achievements WHERE account_id = ?",
      )
      .bind(accountId),
  ]);
  const saved = results[results.length - 1].results as {
    achievement_type: string;
    unlocked_at: number;
  }[];
  return {
    stats: toStats(results.slice(0, 4)),
    before: except === null ? null : toStats(results.slice(4, 8)),
    saved: new Map(saved.map((row) => [row.achievement_type, row.unlocked_at])),
  };
}

/**
 * 条件を満たした未保存の実績を保存する。戻り値は、この呼び出しの後で保存済みに
 * なっている id（同じ時に別の要求が保存した分も含む）。
 */
async function saveUnlocks(
  db: D1Database,
  accountId: string,
  stats: AchievementStats,
  saved: Map<string, number>,
  now: number,
): Promise<string[]> {
  const candidates = newlyUnlockedAchievementIds(stats, saved.keys());
  if (candidates.length > 0)
    await db.batch(
      candidates.map((id) =>
        db.prepare(INSERT_ACHIEVEMENT).bind(accountId, id, now),
      ),
    );
  return candidates;
}

/**
 * 記録を登録し、新しく登録できたら判定して保存する。応答の newAchievements には、
 * この記録を除いた集計では満たさず、含めた集計で満たす実績（この記録が越えさせた
 * 実績）だけを返す。導入前の記録や旧 URL から引き継いだ記録で満たしていた分は、
 * 保存はするが返さない。どの要求が保存したかによらないので、同時の要求で知らせが
 * 消えたり重なったりしない。判定に失敗しても、記録の登録は成功として返す。
 */
export async function recordWithAchievements<T>(
  db: D1Database,
  accountId: string,
  now: number,
  playId: string,
  record: () => Promise<T>,
  isNew: (result: T) => boolean,
): Promise<{ result: T; newAchievements: string[] }> {
  const result = await record();
  if (!isNew(result)) return { result, newAchievements: [] };
  try {
    const { stats, before, saved } = await readAccount(db, accountId, playId);
    await saveUnlocks(db, accountId, stats, saved, now);
    return {
      result,
      newAchievements: ACHIEVEMENTS.filter(
        (definition) =>
          isAchievementUnlocked(definition, stats) &&
          !isAchievementUnlocked(definition, before!),
      ).map((definition) => definition.id),
    };
  } catch (error) {
    logFailure(error);
    return { result, newAchievements: [] };
  }
}

/** GET /api/achievements。判定し直してから、全定義の状態を定義の順に返す */
export async function listAchievements(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<AchievementState[]> {
  const { stats, saved } = await readAccount(db, accountId);
  const unlocked = await saveUnlocks(db, accountId, stats, saved, now);
  return ACHIEVEMENTS.map((definition) => {
    const unlockedAt =
      saved.get(definition.id) ??
      (unlocked.includes(definition.id) ? now : null);
    return {
      id: definition.id,
      unlockedAt,
      progress:
        definition.metric === "client" ||
        isAchievementHidden(definition, unlockedAt !== null)
          ? null
          : achievementProgress(definition, stats),
    };
  });
}

/**
 * POST /api/achievements/unlock。画面から知らせてよい実績（遊び方）を保存する。
 * id は呼び出し側が isClientUnlockable で確かめておく。新しく保存したら true。
 */
export async function unlockClientAchievement(
  db: D1Database,
  accountId: string,
  id: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(INSERT_ACHIEVEMENT)
    .bind(accountId, id, now)
    .run();
  return result.meta.changes > 0;
}

function logFailure(error: unknown): void {
  console.error(
    JSON.stringify({
      event: "achievement_evaluation_failure",
      error: String(error),
    }),
  );
}
