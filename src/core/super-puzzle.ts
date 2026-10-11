import { generateTenBySeed } from "./daily-puzzle";
import { generateExactBoard, SUPER_V2_SPEC } from "./generator-g3";
import type { Puzzle } from "./model";
import { seedCodePrefix } from "./puzzle-code";

/**
 * New super boards use this version. super-v1 embedded an 8×8 board and gave
 * away two pieces; super-v2 builds the 10×10 board directly, without givens.
 * super-v1 stays reproducible for its shared codes, saves and rankings.
 */
export const SUPER_GENERATOR_VERSION = "super-v2";

/** The seed reaches no board of its version. Another seed may. */
export class SuperSeedError extends Error {}

const SUPER_GENERATORS: Record<string, (seed: string) => Puzzle> = {
  "super-v1": (seed) => generateTenBySeed(seed, "super-v1"),
  // A board that misses the difficulty or the shapes is not a super-v2 board.
  "super-v2": (seed) => {
    const board = generateExactBoard(seed, SUPER_V2_SPEC);
    if (!board || board.analysis.rating !== "hard")
      throw new SuperSeedError("Could not build a hard 10×10 puzzle.");
    return board.puzzle;
  },
};

export function isSuperVersion(version: unknown): version is string {
  return (
    typeof version === "string" && Object.hasOwn(SUPER_GENERATORS, version)
  );
}

export function generateSuperPuzzle(
  seed: string,
  version: string = SUPER_GENERATOR_VERSION,
): Puzzle {
  if (!isSuperSeed(seed)) throw new Error("Invalid super seed.");
  if (!isSuperVersion(version))
    throw new Error(`Unsupported super version: ${version}`);
  return SUPER_GENERATORS[version](seed);
}

export function isSuperSeed(seed: unknown): seed is string {
  return typeof seed === "string" && seed.length > 0 && seed.length <= 128;
}

/** Kept separate from ordinary seed parsing until the authenticated UI is wired.
 * Neither daily dates nor g1/g2 codes can enter this mode accidentally. */
export function encodeSuperSeed(
  seed: string,
  version: string = SUPER_GENERATOR_VERSION,
): string {
  if (!isSuperSeed(seed) || !isSuperVersion(version))
    throw new Error("Invalid super seed.");
  return `${seedCodePrefix(version)}hard:${encodeURIComponent(seed)}`;
}

export interface SuperSeedCode {
  readonly version: string;
  readonly seed: string;
}

export function parseSuperSeedCode(code: string): SuperSeedCode | undefined {
  const parts = code.trim().split(":");
  if (
    parts.length !== 4 ||
    parts[0] !== "TAKO" ||
    !isSuperVersion(parts[1]) ||
    parts[2] !== "hard"
  )
    return undefined;
  try {
    const seed = decodeURIComponent(parts[3]);
    return isSuperSeed(seed) ? { version: parts[1], seed } : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the board carries the version and the seed the code names. */
export function isSuperPuzzleOf(
  puzzle: Pick<Puzzle, "seed" | "generatorVersion">,
  seedCode: string,
): boolean {
  const code = parseSuperSeedCode(seedCode);
  return (
    code !== undefined &&
    puzzle.generatorVersion === code.version &&
    puzzle.seed === code.seed
  );
}

/** The seed of a super code of any supported version. */
export function parseSuperSeed(code: string): string | undefined {
  return parseSuperSeedCode(code)?.seed;
}
