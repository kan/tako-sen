import type { PuzzleDifficulty } from "./model";
import type { CompletedPlayUpload } from "./online-history";

export interface OnlineHistoryFilter {
  readonly difficulty?: PuzzleDifficulty;
  readonly since?: number;
  readonly query?: string;
}

export interface OnlineDifficultySummary {
  readonly difficulty: PuzzleDifficulty;
  readonly clears: number;
  readonly averageSeconds?: number;
  readonly bestSeconds?: number;
}

export interface OnlinePuzzleBest {
  readonly puzzleId: string;
  readonly seedCode: string;
  readonly attempts: number;
  readonly best: CompletedPlayUpload;
  readonly latestAt: number;
}

export interface OnlineHistoryView {
  readonly plays: readonly CompletedPlayUpload[];
  readonly count: number;
  readonly averageSeconds?: number;
  readonly byDifficulty: readonly OnlineDifficultySummary[];
  readonly puzzleBests: readonly OnlinePuzzleBest[];
  readonly recentTrend: readonly CompletedPlayUpload[];
}

const difficulties: readonly PuzzleDifficulty[] = ["easy", "normal", "hard"];

export function analyzeOnlineHistory(
  source: readonly CompletedPlayUpload[],
  filter: OnlineHistoryFilter = {},
): OnlineHistoryView {
  const query = filter.query?.trim().toLocaleLowerCase() ?? "";
  const plays = source
    .filter(
      (play) =>
        (!filter.difficulty || play.difficulty === filter.difficulty) &&
        (filter.since === undefined || play.completedAt >= filter.since) &&
        (!query ||
          play.seedCode.toLocaleLowerCase().includes(query) ||
          play.puzzleId.toLocaleLowerCase().includes(query)),
    )
    .sort(
      (a, b) =>
        b.completedAt - a.completedAt || a.playId.localeCompare(b.playId),
    );

  const byDifficulty = difficulties.map((difficulty) => {
    const group = plays.filter((play) => play.difficulty === difficulty);
    return {
      difficulty,
      clears: group.length,
      averageSeconds: averageSeconds(group),
      bestSeconds: group.length
        ? Math.min(...group.map((play) => play.elapsedSeconds))
        : undefined,
    };
  });

  const bests = new Map<string, OnlinePuzzleBest>();
  for (const play of plays) {
    const existing = bests.get(play.puzzleId);
    const best =
      !existing || comparePersonalBest(play, existing.best) < 0
        ? play
        : existing.best;
    bests.set(play.puzzleId, {
      puzzleId: play.puzzleId,
      seedCode: best.seedCode,
      attempts: (existing?.attempts ?? 0) + 1,
      best,
      latestAt: existing?.latestAt ?? play.completedAt,
    });
  }

  return {
    plays,
    count: plays.length,
    averageSeconds: averageSeconds(plays),
    byDifficulty,
    puzzleBests: [...bests.values()].sort(
      (a, b) => b.latestAt - a.latestAt || a.puzzleId.localeCompare(b.puzzleId),
    ),
    recentTrend: [...plays.slice(0, 10)].reverse(),
  };
}

function averageSeconds(
  plays: readonly CompletedPlayUpload[],
): number | undefined {
  return plays.length
    ? plays.reduce((total, play) => total + play.elapsedSeconds, 0) /
        plays.length
    : undefined;
}

function comparePersonalBest(
  a: CompletedPlayUpload,
  b: CompletedPlayUpload,
): number {
  return (
    a.elapsedSeconds - b.elapsedSeconds ||
    a.hintsUsed - b.hintsUsed ||
    a.mistakes - b.mistakes ||
    a.completedAt - b.completedAt ||
    a.playId.localeCompare(b.playId)
  );
}
