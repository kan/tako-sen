import { analyzePuzzleDifficulty } from "./difficulty";
import { generatePuzzle } from "./generator";
import { cellIndex, DAILY_BOARD_SIZE, type Puzzle } from "./model";
import { validateSolution } from "./rules";
import { solvePuzzle } from "./solver";

export const DAILY_GENERATOR_VERSION = "daily-v1";

export function dailyDate(now: number): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isDailyDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/** Embeds the proven 8×8 hard problem in a 10×10 board. The two singleton
 * regions force the added rows and columns, leaving exactly the original
 * problem for the other eight pieces. */
export function generateDailyPuzzle(date: string): Puzzle {
  if (!isDailyDate(date)) throw new Error("Invalid daily date.");
  for (let sourceIndex = 0; sourceIndex < 4; sourceIndex += 1) {
    const source = generatePuzzle({
      version: "g2",
      difficulty: "hard",
      seed: `daily-v1:${date}:${sourceIndex}`,
    });
    for (let firstRow = 1; firstRow < 8; firstRow += 1) {
      for (let secondRow = firstRow + 2; secondRow < 10; secondRow += 1) {
        for (let firstCol = 1; firstCol < 8; firstCol += 1) {
          for (let secondCol = firstCol + 2; secondCol < 10; secondCol += 1) {
            for (const swapped of [false, true]) {
              const puzzle = expandPuzzle(
                source,
                date,
                [firstRow, secondRow],
                [firstCol, secondCol],
                swapped,
              );
              if (!validateSolution(puzzle).valid) continue;
              if (solvePuzzle(puzzle, { maxSolutions: 2 }).status !== "unique")
                continue;
              const analysis = analyzePuzzleDifficulty(puzzle);
              if (analysis.solved && analysis.rating === "hard") return puzzle;
            }
          }
        }
      }
    }
  }
  throw new Error("Could not build a hard daily puzzle.");
}

function expandPuzzle(
  source: Puzzle,
  date: string,
  addedRows: readonly [number, number],
  addedCols: readonly [number, number],
  swapped: boolean,
): Puzzle {
  const size = DAILY_BOARD_SIZE;
  const rows = Array.from({ length: size }, (_, row) => row).filter(
    (row) => !addedRows.includes(row),
  );
  const cols = Array.from({ length: size }, (_, col) => col).filter(
    (col) => !addedCols.includes(col),
  );
  const sourceRow = Array.from({ length: size }, (_, row) =>
    Math.max(0, rows.filter((item) => item <= row).length - 1),
  );
  const sourceCol = Array.from({ length: size }, (_, col) =>
    Math.max(0, cols.filter((item) => item <= col).length - 1),
  );
  const regions = Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    return source.regions[cellIndex(sourceRow[row], sourceCol[col])];
  });
  const extraPieces = [
    cellIndex(addedRows[0], addedCols[swapped ? 1 : 0], size),
    cellIndex(addedRows[1], addedCols[swapped ? 0 : 1], size),
  ];
  regions[extraPieces[0]] = 8;
  regions[extraPieces[1]] = 9;
  const solution = [
    ...source.solution.map((index) =>
      cellIndex(rows[Math.floor(index / 8)], cols[index % 8], size),
    ),
    ...extraPieces,
  ].sort((a, b) => a - b);
  return {
    size,
    regions,
    solution,
    givens: extraPieces,
    seed: date,
    difficulty: "hard",
    generatorVersion: DAILY_GENERATOR_VERSION,
  };
}
