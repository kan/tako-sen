export interface RankedPuzzleCandidate {
  readonly puzzleId: string;
  readonly seedCode: string;
  readonly players: number;
}

export const RANDOM_PUZZLE_CHANCE = 0.2;

/** Pick the most populated available board; randomize ties and occasional fresh boards. */
export function chooseNextPuzzle(
  candidates: readonly RankedPuzzleCandidate[],
  excludedIds: ReadonlySet<string>,
  random: () => number,
): RankedPuzzleCandidate | undefined {
  if (random() < RANDOM_PUZZLE_CHANCE) return undefined;
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
