import type { PlayerState, Puzzle, PuzzleDifficulty } from "./model";

export interface PlayResult {
  readonly id: string;
  readonly userId: string;
  readonly seedCode: string;
  readonly generatorVersion: string;
  readonly difficulty: PuzzleDifficulty;
  readonly startedAt: number;
  readonly status: "in-progress" | "completed";
  readonly completedAt?: number;
  readonly elapsedSeconds?: number;
  readonly mistakes?: number;
  readonly hintsUsed?: number;
}

export interface ResultHistory {
  readonly version: 1;
  readonly userId: string;
  readonly plays: readonly PlayResult[];
}

export interface DifficultySummary {
  readonly difficulty: PuzzleDifficulty;
  readonly plays: number;
  readonly clears: number;
  readonly averageSeconds: number | undefined;
  readonly averageMistakes: number | undefined;
  readonly averageHints: number | undefined;
}

export interface UserSummary {
  readonly plays: number;
  readonly clears: number;
  readonly personalBests: number;
  readonly recentSeeds: readonly string[];
  readonly byDifficulty: readonly DifficultySummary[];
}

export function hasPlayerMarks(
  puzzle: Pick<Puzzle, "givens">,
  state: PlayerState,
): boolean {
  const givens = new Set(puzzle.givens ?? []);
  return (
    state.excluded.size > 0 ||
    state.fixedErrors.size > 0 ||
    [...state.pieces].some((piece) => !givens.has(piece))
  );
}

export function playerMarksChanged(
  before: PlayerState,
  after: PlayerState,
): boolean {
  return (
    !sameSet(before.excluded, after.excluded) ||
    !sameSet(before.pieces, after.pieces) ||
    !sameSet(before.fixedErrors, after.fixedErrors)
  );
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

export function startPlay(
  history: ResultHistory,
  play: Omit<PlayResult, "userId" | "status">,
): ResultHistory {
  if (history.plays.some((existing) => existing.id === play.id)) return history;
  return {
    ...history,
    plays: [
      ...history.plays,
      { ...play, userId: history.userId, status: "in-progress" },
    ],
  };
}

export function finishPlay(
  history: ResultHistory,
  id: string,
  completedAt: number,
  mistakes: number,
  hintsUsed: number,
): ResultHistory {
  if (
    !history.plays.some(
      (play) => play.id === id && play.status === "in-progress",
    )
  ) {
    return history;
  }
  return {
    ...history,
    plays: history.plays.map((play) =>
      play.id === id && play.status === "in-progress"
        ? {
            ...play,
            status: "completed" as const,
            completedAt,
            elapsedSeconds: Math.max(
              0,
              Math.floor((completedAt - play.startedAt) / 1000),
            ),
            mistakes,
            hintsUsed,
          }
        : play,
    ),
  };
}

export function sameSeedRanking(
  history: ResultHistory,
  seedCode: string,
): PlayResult[] {
  return history.plays
    .filter(
      (play) =>
        play.userId === history.userId &&
        play.status === "completed" &&
        play.seedCode === seedCode,
    )
    .sort(compareResults);
}

function compareResults(a: PlayResult, b: PlayResult): number {
  return (
    (a.elapsedSeconds ?? Infinity) - (b.elapsedSeconds ?? Infinity) ||
    (a.hintsUsed ?? Infinity) - (b.hintsUsed ?? Infinity) ||
    (a.mistakes ?? Infinity) - (b.mistakes ?? Infinity) ||
    (a.completedAt ?? 0) - (b.completedAt ?? 0)
  );
}

export function summarizeUser(history: ResultHistory): UserSummary {
  const plays = history.plays.filter((play) => play.userId === history.userId);
  const completed = plays.filter((play) => play.status === "completed");
  const difficulties: PuzzleDifficulty[] = ["easy", "normal", "hard"];
  const bests = new Map<string, PlayResult>();
  let personalBests = 0;
  for (const play of [...completed].sort(
    (a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0),
  )) {
    const best = bests.get(play.seedCode);
    if (!best || compareResults(play, best) < 0) {
      bests.set(play.seedCode, play);
      personalBests += 1;
    }
  }
  return {
    plays: plays.length,
    clears: completed.length,
    personalBests,
    recentSeeds: [
      ...new Set(
        [...plays]
          .sort((a, b) => b.startedAt - a.startedAt)
          .map((play) => play.seedCode),
      ),
    ].slice(0, 5),
    byDifficulty: difficulties.map((difficulty) => {
      const attempts = plays.filter((play) => play.difficulty === difficulty);
      const clears = attempts.filter((play) => play.status === "completed");
      const average = (
        get: (play: PlayResult) => number | undefined,
      ): number | undefined =>
        clears.length
          ? clears.reduce((sum, play) => sum + (get(play) ?? 0), 0) /
            clears.length
          : undefined;
      return {
        difficulty,
        plays: attempts.length,
        clears: clears.length,
        averageSeconds: average((play) => play.elapsedSeconds),
        averageMistakes: average((play) => play.mistakes),
        averageHints: average((play) => play.hintsUsed),
      };
    }),
  };
}
