/**
 * 実績の定義と判定。判定はサーバーが D1 の記録を集計した値（AchievementStats）
 * から毎回やり直す。進み具合は保存しないので、定義を足しても値の移行は要らない。
 * 定義の順は一覧のタイルの並び順。id は D1 に保存するので、一度出したら変えない。
 */

/** D1 の記録から数える値 */
export type AchievementMetric =
  /** 通常（8×8。共有・シードの復元・再挑戦を含む）のクリア数 */
  | "normalClears"
  /** 通常の上級のクリア数 */
  | "hardClears"
  /** 通常をミスなしでクリアした数 */
  | "noMistakeClears"
  /** 通常の上級をミスなしでクリアした数 */
  | "noMistakeHardClears"
  /** 通常・デイリー・超級を、ヒントもミスもなしでクリアした数 */
  | "perfectSolves"
  /** デイリーをクリアした日数 */
  | "dailyClearDays"
  /** デイリーを連続でクリアした最長の日数 */
  | "dailyBestStreak"
  /** 超級のクリア数 */
  | "superClears"
  /** モードを問わず、クリアした日数（日本時間の日付） */
  | "clearDays";

export type AchievementStats = Readonly<Record<AchievementMetric, number>>;

export type AchievementCategory =
  "first" | "clears" | "no-mistake" | "daily" | "super" | "days";

interface AchievementBase {
  readonly id: string;
  readonly category: AchievementCategory;
  readonly name: string;
  readonly description: string;
  /** 未解除のあいだ、名前・条件・アイコンを伏せる */
  readonly secret?: boolean;
}

/** 記録から判定する実績。metric の値が threshold 以上になったら解除する */
export interface RecordAchievement extends AchievementBase {
  readonly metric: AchievementMetric;
  readonly threshold: number;
}

/** 記録からは判定できず、画面が解除を知らせる実績（遊び方の完了） */
export interface ClientAchievement extends AchievementBase {
  readonly metric: "client";
}

export type AchievementDefinition = RecordAchievement | ClientAchievement;

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    id: "tutorial_complete",
    category: "first",
    metric: "client",
    name: "はじめの一歩",
    description: "遊び方を最後まで終える",
  },
  {
    id: "clear_first",
    category: "first",
    metric: "normalClears",
    threshold: 1,
    name: "初クリア",
    description: "通常の問題を初めてクリアする",
  },
  {
    id: "clear_hard_first",
    category: "first",
    metric: "hardClears",
    threshold: 1,
    name: "上級デビュー",
    description: "上級を初めてクリアする",
  },
  {
    id: "clear_10",
    category: "clears",
    metric: "normalClears",
    threshold: 10,
    name: "10回クリア",
    description: "通常の問題を10回クリアする",
  },
  {
    id: "clear_50",
    category: "clears",
    metric: "normalClears",
    threshold: 50,
    name: "50回クリア",
    description: "通常の問題を50回クリアする",
  },
  {
    id: "clear_100",
    category: "clears",
    metric: "normalClears",
    threshold: 100,
    name: "100回クリア",
    description: "通常の問題を100回クリアする",
  },
  {
    id: "clear_500",
    category: "clears",
    metric: "normalClears",
    threshold: 500,
    name: "500回クリア",
    description: "通常の問題を500回クリアする",
    secret: true,
  },
  {
    id: "no_mistake",
    category: "no-mistake",
    metric: "noMistakeClears",
    threshold: 1,
    name: "ノーミス",
    description: "通常の問題をミスなしでクリアする",
  },
  {
    id: "no_mistake_hard",
    category: "no-mistake",
    metric: "noMistakeHardClears",
    threshold: 1,
    name: "上級ノーミス",
    description: "上級をミスなしでクリアする",
  },
  {
    id: "perfect_solve",
    category: "no-mistake",
    metric: "perfectSolves",
    threshold: 1,
    name: "Perfect Solve",
    description:
      "ヒントもミスもなしでクリアする（通常・デイリー・超級のどれでも）",
  },
  {
    id: "daily_first",
    category: "daily",
    metric: "dailyClearDays",
    threshold: 1,
    name: "デイリー初クリア",
    description: "デイリーを初めてクリアする",
  },
  {
    id: "daily_7",
    category: "daily",
    metric: "dailyClearDays",
    threshold: 7,
    name: "デイリー7日",
    description: "デイリーを7日クリアする",
  },
  {
    id: "daily_30",
    category: "daily",
    metric: "dailyClearDays",
    threshold: 30,
    name: "デイリー30日",
    description: "デイリーを30日クリアする",
  },
  {
    id: "daily_100",
    category: "daily",
    metric: "dailyClearDays",
    threshold: 100,
    name: "デイリー100日",
    description: "デイリーを100日クリアする",
  },
  {
    id: "daily_streak_7",
    category: "daily",
    metric: "dailyBestStreak",
    threshold: 7,
    name: "デイリー7日連続",
    description: "デイリーを7日続けてクリアする",
  },
  {
    id: "super_first",
    category: "super",
    metric: "superClears",
    threshold: 1,
    name: "超級初クリア",
    description: "超級を初めてクリアする",
  },
  {
    id: "super_10",
    category: "super",
    metric: "superClears",
    threshold: 10,
    name: "超級10回",
    description: "超級を10回クリアする",
  },
  {
    id: "days_7",
    category: "days",
    metric: "clearDays",
    threshold: 7,
    name: "7日クリア",
    description: "クリアした日が7日になる（モードは問わない）",
  },
  {
    id: "days_30",
    category: "days",
    metric: "clearDays",
    threshold: 30,
    name: "30日クリア",
    description: "クリアした日が30日になる（モードは問わない）",
  },
  {
    id: "days_100",
    category: "days",
    metric: "clearDays",
    threshold: 100,
    name: "100日クリア",
    description: "クリアした日が100日になる（モードは問わない）",
  },
];

export function achievementDefinition(
  id: string,
): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((item) => item.id === id);
}

/** 画面からの解除の知らせを受け付けてよい実績か */
export function isClientUnlockable(id: string): boolean {
  return achievementDefinition(id)?.metric === "client";
}

/** 記録から判定する実績が条件を満たすか。画面が解除する実績は常に false */
export function isAchievementUnlocked(
  definition: AchievementDefinition,
  stats: AchievementStats,
): boolean {
  return (
    definition.metric !== "client" &&
    stats[definition.metric] >= definition.threshold
  );
}

/** 条件を満たしたが、まだ解除として保存していない実績の id（定義の順） */
export function newlyUnlockedAchievementIds(
  stats: AchievementStats,
  alreadyUnlocked: Iterable<string>,
): string[] {
  const known = new Set(alreadyUnlocked);
  return ACHIEVEMENTS.filter(
    (item) => !known.has(item.id) && isAchievementUnlocked(item, stats),
  ).map((item) => item.id);
}

/** 詳細のダイアログに出す進み具合（threshold で頭打ち） */
export function achievementProgress(
  definition: RecordAchievement,
  stats: AchievementStats,
): number {
  return Math.min(stats[definition.metric], definition.threshold);
}

const dayMs = 86_400_000;

/**
 * デイリーを連続でクリアした最長の日数。引数はクリアした日の
 * challenge_date（YYYY-MM-DD）。順不同で、重複してもよい。読めない日付は捨てる
 * （NaN が 1 つでも混ざると並び替えの順が定まらず、結果全体が崩れるため）。
 */
export function longestDailyStreak(dates: Iterable<string>): number {
  const days = [...new Set(dates)]
    .map((date) => Date.parse(`${date}T00:00:00Z`))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let previous = Number.NaN;
  for (const day of days) {
    run = day - previous === dayMs ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}
