import { generatePuzzle } from "./generator";
import { cellCoord, createInitialPlayerState, type Puzzle } from "./model";
import { findLogicalMoves, type LogicalMove } from "./logical";
import { addExcludedMarks, placePiece } from "./player";
import { exclusionsFromPiece } from "./shortcuts";

export interface TutorialLesson {
  readonly puzzle: Puzzle;
  readonly firstPiece: number;
  readonly dragTargets: readonly number[];
  readonly dragReason: LogicalMove;
  readonly reasoningTarget: number;
  readonly reasoningMove: LogicalMove;
}

/** A fixed, independently solved beginner board. Tutorial marks never enter normal play. */
export function createTutorialLesson(): TutorialLesson {
  const puzzle = generatePuzzle({
    version: "g2",
    difficulty: "easy",
    seed: "interactive-tutorial-7",
  });
  const firstPiece = puzzle.solution.find(
    (index) =>
      !(puzzle.givens ?? []).includes(index) &&
      puzzle.regions.filter((region) => region === puzzle.regions[index])
        .length === 1,
  );
  if (firstPiece === undefined)
    throw new Error("Tutorial board needs an unplaced singleton region.");

  const placed = placePiece(
    puzzle,
    createInitialPlayerState(0, puzzle.givens),
    firstPiece,
  );
  const afterShortcut = addExcludedMarks(
    placed,
    exclusionsFromPiece(firstPiece, puzzle),
    puzzle.size,
  );
  const moves = findLogicalMoves(puzzle, afterShortcut);
  const dragReason = moves.find(
    (move) => contiguousTargets(move, afterShortcut.excluded).length >= 3,
  );
  if (!dragReason) throw new Error("Tutorial board needs a drag deduction.");
  const dragTargets = contiguousTargets(
    dragReason,
    afterShortcut.excluded,
  ).slice(0, 3);
  const afterDrag = addExcludedMarks(afterShortcut, dragTargets, puzzle.size);
  const reasoningMove = findLogicalMoves(puzzle, afterDrag).find((move) =>
    move.excludeCells.some((index) => !afterDrag.excluded.has(index)),
  );
  if (!reasoningMove)
    throw new Error("Tutorial board needs another exclusion deduction.");
  const reasoningTarget = reasoningMove.excludeCells.find(
    (index) => !afterDrag.excluded.has(index),
  )!;

  return {
    puzzle,
    firstPiece,
    dragTargets,
    dragReason,
    reasoningTarget,
    reasoningMove,
  };
}

function contiguousTargets(
  move: LogicalMove,
  excluded: ReadonlySet<number>,
): number[] {
  const available = move.excludeCells
    .filter((index) => !excluded.has(index))
    .sort((a, b) => a - b);
  for (const start of available) {
    const row = cellCoord(start).row;
    const run = [start];
    while (
      available.includes(run.at(-1)! + 1) &&
      cellCoord(run.at(-1)! + 1).row === row
    )
      run.push(run.at(-1)! + 1);
    if (run.length >= 3) return run;
  }
  return [];
}
