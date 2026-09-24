import type { Puzzle } from "./model";

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

export async function puzzleId(
  puzzle: Pick<Puzzle, "size" | "regions" | "givens" | "generatorVersion">,
): Promise<string> {
  const input = new TextEncoder().encode(canonicalPuzzleDefinition(puzzle));
  const hash = await crypto.subtle.digest("SHA-256", input);
  const hex = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `p1:${hex}`;
}
