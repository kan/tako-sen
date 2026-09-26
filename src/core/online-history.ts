import { generatePuzzle } from "./generator";
import { parsePuzzleSeedCode } from "./puzzle-code";
import { puzzleId } from "./puzzle-identity";
import type { PlayResult } from "./results";

export interface CompletedPlayUpload {
  readonly playId: string;
  readonly puzzleId: string;
  readonly seedCode: string;
  readonly generatorVersion: string;
  readonly difficulty: "easy" | "normal" | "hard";
  readonly startedAt: number;
  readonly completedAt: number;
  readonly elapsedSeconds: number;
  readonly mistakes: number;
  readonly hintsUsed: number;
}

export interface OnlinePlay extends CompletedPlayUpload {
  readonly isPublic: boolean;
}

/** Local userId is not an account credential and is never uploaded. */
export async function createCompletedPlayUpload(
  play: PlayResult,
): Promise<CompletedPlayUpload> {
  if (
    play.status !== "completed" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      play.id,
    ) ||
    !Number.isSafeInteger(play.startedAt) ||
    play.startedAt < 0 ||
    !isNonnegativeSafeInteger(play.completedAt) ||
    play.completedAt < play.startedAt ||
    !isNonnegativeSafeInteger(play.elapsedSeconds) ||
    !isNonnegativeSafeInteger(play.mistakes) ||
    !isNonnegativeSafeInteger(play.hintsUsed)
  ) {
    throw new Error("Invalid completed play.");
  }
  const code = parsePuzzleSeedCode(play.seedCode);
  if (
    !code ||
    play.seedCode.length > 512 ||
    code.version !== play.generatorVersion ||
    code.difficulty !== play.difficulty
  ) {
    throw new Error("Invalid puzzle seed code.");
  }
  const puzzle = generatePuzzle({
    seed: code.seed,
    difficulty: code.difficulty,
  });
  return {
    playId: play.id,
    puzzleId: await puzzleId(puzzle),
    seedCode: play.seedCode,
    generatorVersion: play.generatorVersion,
    difficulty: play.difficulty,
    startedAt: play.startedAt,
    completedAt: play.completedAt,
    elapsedSeconds: play.elapsedSeconds,
    mistakes: play.mistakes,
    hintsUsed: play.hintsUsed,
  };
}

/** The server recomputes the board identity instead of trusting the claim. */
export async function verifyCompletedPlayUpload(
  value: unknown,
): Promise<CompletedPlayUpload> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid completed play.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.playId !== "string" ||
    typeof record.puzzleId !== "string" ||
    typeof record.seedCode !== "string" ||
    typeof record.generatorVersion !== "string" ||
    (record.difficulty !== "easy" &&
      record.difficulty !== "normal" &&
      record.difficulty !== "hard") ||
    !isNonnegativeSafeInteger(record.startedAt) ||
    !isNonnegativeSafeInteger(record.completedAt) ||
    !isNonnegativeSafeInteger(record.elapsedSeconds) ||
    !isNonnegativeSafeInteger(record.mistakes) ||
    !isNonnegativeSafeInteger(record.hintsUsed)
  ) {
    throw new Error("Invalid completed play.");
  }
  const verified = await createCompletedPlayUpload({
    id: record.playId,
    userId: "",
    status: "completed",
    seedCode: record.seedCode,
    generatorVersion: record.generatorVersion,
    difficulty: record.difficulty,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    elapsedSeconds: record.elapsedSeconds,
    mistakes: record.mistakes,
    hintsUsed: record.hintsUsed,
  });
  if (record.puzzleId !== verified.puzzleId) {
    throw new Error("Puzzle ID does not match the seed code.");
  }
  return verified;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
