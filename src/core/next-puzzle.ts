import type { PuzzleDifficulty } from "./model";

export type DifficultySelection = PuzzleDifficulty | "random";

/** Resolve once per new puzzle so recommendations and fallback use the same difficulty. */
export function resolveDifficultySelection(
  selection: DifficultySelection,
  random: () => number,
): PuzzleDifficulty {
  if (selection !== "random") return selection;
  const difficulties: readonly PuzzleDifficulty[] = ["easy", "normal", "hard"];
  return difficulties[Math.floor(random() * difficulties.length)]!;
}

export interface RankedPuzzleCandidate {
  readonly puzzleId: string;
  readonly seedCode: string;
  readonly players: number;
}

/** Pick the most populated available board; randomize ties, or generate when none remain. */
export function chooseNextPuzzle(
  candidates: readonly RankedPuzzleCandidate[],
  excludedIds: ReadonlySet<string>,
  random: () => number,
): RankedPuzzleCandidate | undefined {
  const available = candidates.filter(
    (candidate) =>
      !excludedIds.has(candidate.puzzleId) &&
      Number.isSafeInteger(candidate.players) &&
      candidate.players > 0,
  );
  if (!available.length) return undefined;
  const mostPlayers = Math.max(
    ...available.map((candidate) => candidate.players),
  );
  const popular = available.filter(
    (candidate) => candidate.players === mostPlayers,
  );
  return popular[Math.floor(random() * popular.length)];
}
