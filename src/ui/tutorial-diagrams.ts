import { BOARD_SIZE, cellIndex, createInitialPlayerState } from "../core/model";
import { exclusionsFromPiece, regionLineExclusions } from "../core/shortcuts";

// 8×8盤面の左上4行×6列だけを説明用に描画する。別サイズのゲームではない。
const regions = Array.from(
  { length: BOARD_SIZE * BOARD_SIZE },
  (_, index) =>
    Math.floor(Math.floor(index / BOARD_SIZE) / 4) * 4 +
    Math.floor((index % BOARD_SIZE) / 2),
);
const visibleCells = Array.from({ length: 24 }, (_, index) =>
  cellIndex(Math.floor(index / 6), index % 6),
);
const piece = cellIndex(1, 3);
const pieceExclusions = new Set(exclusionsFromPiece(piece, { regions }));
const rulePieces = new Set([cellIndex(0, 1), piece]);
const ruleExclusions = new Set(
  [...rulePieces].flatMap((index) => exclusionsFromPiece(index, { regions })),
);
const lineState = {
  ...createInitialPlayerState(0),
  excluded: new Set(
    regions.flatMap((region, index) =>
      region === 1 && Math.floor(index / BOARD_SIZE) !== 1 ? [index] : [],
    ),
  ),
};
const lineExclusions = new Set(regionLineExclusions({ regions }, lineState, 1));

export interface TutorialDiagramCell {
  readonly index: number;
  readonly row: number;
  readonly col: number;
  readonly region: number;
  readonly mark: "piece" | "excluded" | "candidate" | "empty";
  readonly added: boolean;
  readonly borderRight: boolean;
  readonly borderBottom: boolean;
}

export function tutorialDiagramCells(
  kind: "rules" | "piece" | "line",
  after: boolean,
): readonly TutorialDiagramCell[] {
  return visibleCells.map((index) => {
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const added =
      after &&
      kind !== "rules" &&
      (kind === "piece" ? pieceExclusions : lineExclusions).has(index);
    let mark: TutorialDiagramCell["mark"] = "empty";
    if (kind === "rules") {
      if (rulePieces.has(index)) mark = "piece";
      else if (ruleExclusions.has(index)) mark = "excluded";
      else mark = "candidate";
    } else if (kind === "piece") {
      if (index === piece) mark = "piece";
      else if (added) mark = "excluded";
      else if (after) mark = "candidate";
    } else {
      if (lineState.excluded.has(index) || added) mark = "excluded";
      else if (regions[index] === 1) mark = "candidate";
    }
    return {
      index,
      row,
      col,
      region: regions[index],
      mark,
      added,
      borderRight: col === 5 || regions[index] !== regions[index + 1],
      borderBottom: row === 3 || regions[index] !== regions[index + BOARD_SIZE],
    };
  });
}
