import { type Puzzle, type PuzzleDifficulty } from "./model";
import { isSupportedGeneratorVersion } from "./generator";

export interface PuzzleSeedCode {
  readonly version: string;
  readonly difficulty: PuzzleDifficulty;
  readonly seed: string;
}

const CODE_PREFIX = "TAKO";

export function encodePuzzleSeed(
  puzzle: Pick<Puzzle, "seed" | "difficulty" | "generatorVersion">,
): string {
  const version = puzzle.generatorVersion ?? "g1";
  const difficulty = puzzle.difficulty ?? "easy";
  return `${CODE_PREFIX}:${version}:${difficulty}:${encodeURIComponent(puzzle.seed)}`;
}

export function parsePuzzleSeedCode(code: string): PuzzleSeedCode | undefined {
  const trimmed = code.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 4 || parts[0] !== CODE_PREFIX) return undefined;

  const [, version, difficulty, encodedSeed] = parts;
  if (!isSupportedGeneratorVersion(version)) return undefined;
  if (!isPuzzleDifficulty(difficulty)) return undefined;

  try {
    const seed = decodeURIComponent(encodedSeed);
    if (seed.length === 0) return undefined;
    return { version, difficulty, seed };
  } catch {
    return undefined;
  }
}

function isPuzzleDifficulty(value: string): value is PuzzleDifficulty {
  return value === "easy" || value === "normal" || value === "hard";
}
