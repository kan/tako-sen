import { BOARD_SIZE, DAILY_BOARD_SIZE, type Puzzle } from "./model";
import { validateSolution } from "./rules";
import { solvePuzzle } from "./solver";

/** Whether `value` has the form of a puzzle ID (`p1:` and a SHA-256 hex). */
export function isPuzzleId(value: unknown): value is string {
  return typeof value === "string" && /^p1:[0-9a-f]{64}$/.test(value);
}

/** The seed and solution are deliberately absent: identity is the playable board. */
export function canonicalPuzzleDefinition(
  puzzle: Pick<Puzzle, "size" | "regions" | "givens" | "generatorVersion">,
): string {
  return JSON.stringify([
    "p1",
    puzzle.generatorVersion ?? "g1",
    puzzle.size,
    puzzle.regions,
    [...(puzzle.givens ?? [])].sort((a, b) => a - b),
  ]);
}

export async function puzzleId(puzzle: Puzzle): Promise<string> {
  if (
    (puzzle.size !== BOARD_SIZE && puzzle.size !== DAILY_BOARD_SIZE) ||
    !validateSolution(puzzle).valid ||
    new Set(puzzle.givens ?? []).size !== (puzzle.givens ?? []).length ||
    solvePuzzle(puzzle, { maxSolutions: 2 }).status !== "unique"
  ) {
    throw new Error("Cannot identify an invalid or non-unique puzzle.");
  }
  const input = new TextEncoder().encode(canonicalPuzzleDefinition(puzzle));
  const hash = await crypto.subtle.digest("SHA-256", input);
  const hex = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `p1:${hex}`;
}
