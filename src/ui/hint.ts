import type { LogicalMove } from "../core/logical";
import { BOARD_SIZE, cellIndex, regionCells, type Puzzle } from "../core/model";

export function canShowHint(isComplete: boolean): boolean {
  return !isComplete;
}

export function hintStageCount(move: LogicalMove): number {
  return move.technique === "contradiction" ? 4 : 3;
}

export function hintStageLines(
  move: LogicalMove,
  stage: number,
  contradictionCells: readonly number[] = [],
): string[] {
  if (move.technique === "contradiction") {
    if (stage === 1) return [move.explanation[0]];
    if (stage === 2) return [move.explanation[1]];
    if (stage === 3) return [move.explanation[2]];
    return contradictionCells.length > 0
      ? [
          `×を1つ外すだけで矛盾を解消できるセルが${contradictionCells.length}個見つかりました。盤面で示します。`,
        ]
      : [
          "1つの×を外すだけでは矛盾を解消できません。複数の×を見直してください。",
        ];
  }
  if (stage === 1)
    return [
      "盤面で強調した箇所に注目してください。まず自分で考えてみましょう。",
    ];
  if (stage === 2) return [move.explanation[0]];
  return move.explanation.slice(1);
}

export function hintFocusCells(
  puzzle: Pick<Puzzle, "regions">,
  move: LogicalMove,
  stage: number,
  contradictionCells: readonly number[] = [],
): readonly number[] {
  if (move.technique === "contradiction")
    return stage === 4 ? contradictionCells : stage >= 2 ? move.focusCells : [];
  if (stage === 1) {
    if (
      move.technique === "line-region" ||
      move.technique === "single-candidate"
    ) {
      const row = move.row;
      const col = move.col;
      if (row !== undefined)
        return Array.from({ length: BOARD_SIZE }, (_, col) =>
          cellIndex(row, col),
        );
      if (col !== undefined)
        return Array.from({ length: BOARD_SIZE }, (_, row) =>
          cellIndex(row, col),
        );
    }
    if (move.regionIds)
      return move.regionIds.flatMap((regionId) =>
        regionCells(puzzle, regionId),
      );
    if (move.regionId !== undefined)
      return [
        ...regionCells(puzzle, move.regionId),
        ...(move.affectedRegionId !== undefined
          ? regionCells(puzzle, move.affectedRegionId)
          : []),
      ];
  }
  return move.focusCells;
}

export function hintExcludeCells(
  move: LogicalMove,
  stage: number,
): readonly number[] {
  return move.technique !== "contradiction" && stage >= 3
    ? move.excludeCells
    : [];
}
