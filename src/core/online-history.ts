import { generatePuzzle } from "./generator";
import { parsePuzzleSeedCode } from "./puzzle-code";
import { isPuzzleId, puzzleId } from "./puzzle-identity";
import type { PlayResult } from "./results";
import {
  maximumHintStage,
  validHintProgress,
  type HintStage,
} from "./hint-progress";

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
  readonly maxHintStage?: HintStage | null;
}

export interface OnlinePlay extends CompletedPlayUpload {
  readonly isPublic: boolean;
}

/** Local userId is not an account credential and is never uploaded. */
export async function createCompletedPlayUpload(
  play: PlayResult,
): Promise<CompletedPlayUpload> {
  const code = checkPlayResult(play);
  const puzzle = generatePuzzle({
    version: code.version,
    seed: code.seed,
    difficulty: code.difficulty,
  });
  return uploadOf(play, await puzzleId(puzzle));
}

/** Throws unless the play is a well-formed completed one; gives its seed code. */
function checkPlayResult(
  play: PlayResult,
): NonNullable<ReturnType<typeof parsePuzzleSeedCode>> {
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
    !isNonnegativeSafeInteger(play.hintsUsed) ||
    !validHintProgress(play.maxHintStage, Number(play.hintsUsed))
  ) {
    throw new Error("Invalid completed play.");
  }
  const code = parsePuzzleSeedCode(play.seedCode);
  if (
    !code ||
    play.seedCode.length > 512 ||
    // Stored codes are matched by their prefix, so none may carry padding.
    play.seedCode !== play.seedCode.trim() ||
    code.version !== play.generatorVersion ||
    code.difficulty !== play.difficulty
  ) {
    throw new Error("Invalid puzzle seed code.");
  }
  return code;
}

/** The upload of a play that passed checkPlayResult, which proved the counts. */
function uploadOf(play: PlayResult, id: string): CompletedPlayUpload {
  return {
    playId: play.id,
    puzzleId: id,
    seedCode: play.seedCode,
    generatorVersion: play.generatorVersion,
    difficulty: play.difficulty,
    startedAt: play.startedAt,
    completedAt: play.completedAt!,
    elapsedSeconds: play.elapsedSeconds!,
    mistakes: play.mistakes!,
    hintsUsed: play.hintsUsed!,
    maxHintStage: maximumHintStage(play),
  };
}

/**
 * The upload as claimed, after the checks that need no board: field types,
 * hint progress, the seed code's form and the puzzle ID's form. Undefined when
 * any fails. The puzzle ID is still the client's claim; the Worker compares a
 * resend with what it stored before paying for verifyCompletedPlayUpload.
 */
export function parseCompletedPlayUpload(
  value: unknown,
): CompletedPlayUpload | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.playId !== "string" ||
    !isPuzzleId(record.puzzleId) ||
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
  )
    return undefined;
  const play: PlayResult = {
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
    maxHintStage: record.maxHintStage as HintStage | null | undefined,
  };
  try {
    checkPlayResult(play);
  } catch {
    return undefined;
  }
  return uploadOf(play, record.puzzleId);
}

/** The server recomputes the board identity instead of trusting the claim. */
export async function verifyCompletedPlayUpload(
  value: unknown,
): Promise<CompletedPlayUpload> {
  const claimed = parseCompletedPlayUpload(value);
  if (!claimed) throw new Error("Invalid completed play.");
  const record = value as Record<string, unknown>;
  const verified = await createCompletedPlayUpload({
    id: claimed.playId,
    userId: "",
    status: "completed",
    seedCode: claimed.seedCode,
    generatorVersion: claimed.generatorVersion,
    difficulty: claimed.difficulty,
    startedAt: claimed.startedAt,
    completedAt: claimed.completedAt,
    elapsedSeconds: claimed.elapsedSeconds,
    mistakes: claimed.mistakes,
    hintsUsed: claimed.hintsUsed,
    maxHintStage: record.maxHintStage as HintStage | null | undefined,
  });
  if (claimed.puzzleId !== verified.puzzleId) {
    throw new Error("Puzzle ID does not match the seed code.");
  }
  return verified;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
