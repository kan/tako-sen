import { generateTenBySeed } from "./daily-puzzle";
import type { Puzzle } from "./model";

export const SUPER_GENERATOR_VERSION = "super-v1";

export function generateSuperPuzzle(seed: string): Puzzle {
  if (!isSuperSeed(seed)) throw new Error("Invalid super seed.");
  return generateTenBySeed(seed, SUPER_GENERATOR_VERSION);
}

export function isSuperSeed(seed: unknown): seed is string {
  return typeof seed === "string" && seed.length > 0 && seed.length <= 128;
}

/** Kept separate from ordinary seed parsing until the authenticated UI is wired.
 * Neither daily dates nor g1/g2 codes can enter this mode accidentally. */
export function encodeSuperSeed(seed: string): string {
  if (!isSuperSeed(seed)) throw new Error("Invalid super seed.");
  return `TAKO:${SUPER_GENERATOR_VERSION}:hard:${encodeURIComponent(seed)}`;
}

export function parseSuperSeed(code: string): string | undefined {
  const parts = code.trim().split(":");
  if (
    parts.length !== 4 ||
    parts[0] !== "TAKO" ||
    parts[1] !== SUPER_GENERATOR_VERSION ||
    parts[2] !== "hard"
  )
    return undefined;
  try {
    const seed = decodeURIComponent(parts[3]);
    return isSuperSeed(seed) ? seed : undefined;
  } catch {
    return undefined;
  }
}
