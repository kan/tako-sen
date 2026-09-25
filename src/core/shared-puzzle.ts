import { generatePuzzle } from "./generator";
import { BOARD_SIZE, CELL_COUNT, type Puzzle } from "./model";
import { puzzleId } from "./puzzle-identity";
import { parsePuzzleSeedCode } from "./puzzle-code";
import { validateSolution } from "./rules";
import { solvePuzzle } from "./solver";

export interface SharedPuzzleSnapshot {
  readonly id: string;
  readonly size: number;
  readonly regions: readonly number[];
  readonly givens: readonly number[];
  readonly seed: string;
  readonly difficulty: "easy" | "normal" | "hard";
  readonly generatorVersion: string;
}

export async function createSharedPuzzleSnapshot(
  seedCode: string,
): Promise<SharedPuzzleSnapshot> {
  if (seedCode.length > 256) throw new Error("Seed code is too long.");
  const parsed = parsePuzzleSeedCode(seedCode);
  if (!parsed) throw new Error("Invalid seed code.");
  const puzzle = generatePuzzle({
    seed: parsed.seed,
    difficulty: parsed.difficulty,
  });
  return {
    id: await puzzleId(puzzle),
    size: puzzle.size,
    regions: [...puzzle.regions],
    givens: [...(puzzle.givens ?? [])],
    seed: puzzle.seed,
    difficulty: parsed.difficulty,
    generatorVersion: parsed.version,
  };
}

export async function restoreSharedPuzzleSnapshot(
  input: unknown,
): Promise<Puzzle> {
  if (!input || typeof input !== "object")
    throw new Error("Invalid shared puzzle.");
  const snapshot = input as Partial<SharedPuzzleSnapshot>;
  if (
    typeof snapshot.id !== "string" ||
    !/^p1:[0-9a-f]{64}$/.test(snapshot.id) ||
    snapshot.size !== BOARD_SIZE ||
    !Array.isArray(snapshot.regions) ||
    snapshot.regions.length !== CELL_COUNT ||
    !snapshot.regions.every(
      (id) => Number.isInteger(id) && id >= 0 && id < BOARD_SIZE,
    ) ||
    !Array.isArray(snapshot.givens) ||
    snapshot.givens.length > BOARD_SIZE ||
    !snapshot.givens.every(
      (cell) => Number.isInteger(cell) && cell >= 0 && cell < CELL_COUNT,
    ) ||
    typeof snapshot.seed !== "string" ||
    snapshot.seed.length === 0 ||
    snapshot.seed.length > 256 ||
    (snapshot.difficulty !== "easy" &&
      snapshot.difficulty !== "normal" &&
      snapshot.difficulty !== "hard") ||
    typeof snapshot.generatorVersion !== "string" ||
    !/^[a-z0-9-]{1,32}$/.test(snapshot.generatorVersion)
  ) {
    throw new Error("Invalid shared puzzle.");
  }
  const definition = {
    regions: snapshot.regions,
    givens: snapshot.givens,
  };
  const solved = solvePuzzle(definition, { maxSolutions: 2 });
  if (solved.status !== "unique")
    throw new Error("Shared puzzle is not unique.");
  const puzzle: Puzzle = {
    size: BOARD_SIZE,
    regions: [...snapshot.regions],
    givens: [...snapshot.givens],
    solution: solved.solutions[0],
    seed: snapshot.seed,
    difficulty: snapshot.difficulty,
    generatorVersion: snapshot.generatorVersion,
  };
  if (
    !validateSolution(puzzle).valid ||
    (await puzzleId(puzzle)) !== snapshot.id
  )
    throw new Error("Shared puzzle identity mismatch.");
  return puzzle;
}
