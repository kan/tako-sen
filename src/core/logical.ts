import {
  BOARD_SIZE,
  REGION_COUNT,
  cellCoord,
  cellIndex,
  isAdjacent,
  regionCells,
  type PlayerState,
  type Puzzle,
} from "./model";
import { regionLineExclusions } from "./shortcuts";
import { hasContradiction } from "./solver";

export type TechniqueId = "contradiction" | "single-candidate" | "region-line";

export interface LogicalMove {
  readonly technique: TechniqueId;
  readonly title: string;
  readonly regionId?: number;
  readonly row?: number;
  readonly col?: number;
  readonly focusCells: readonly number[];
  readonly excludeCells: readonly number[];
  readonly placeCell?: number;
  readonly explanation: readonly string[];
}

export function findLogicalMoves(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
): LogicalMove[] {
  if (hasContradiction(puzzle, state)) {
    return [
      {
        technique: "contradiction",
        title: "現在の盤面に矛盾があります",
        focusCells: [...state.excluded, ...state.fixedErrors],
        excludeCells: [],
        explanation: [
          "現在の×や確定済みの内容を前提にすると、完成できる配置が存在しません。",
          "どこかの×が、本来タコを置く必要があるセルを塞いでいる可能性があります。",
          "まず最近付けた×や、候補が極端に少ない行・列・Regionを見直してください。",
        ],
      },
    ];
  }

  return [
    ...findSingleCandidates(puzzle, state),
    ...findRegionLineMoves(puzzle, state),
  ];
}

function findSingleCandidates(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
): LogicalMove[] {
  const moves: LogicalMove[] = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    if (hasPieceInRow(state, row)) continue;
    const candidates = rowCandidates(puzzle, row, state);
    if (candidates.length === 1 && !state.pieces.has(candidates[0])) {
      moves.push({
        technique: "single-candidate",
        title: "行の残り候補が1つです",
        row,
        focusCells: candidates,
        excludeCells: [],
        placeCell: candidates[0],
        explanation: [
          "この行でタコを置ける未確定セルが1つだけ残っています。",
          "そのセルにタコを確定できます。",
        ],
      });
    }
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    if (hasPieceInColumn(state, col)) continue;
    const candidates = columnCandidates(puzzle, col, state);
    if (candidates.length === 1 && !state.pieces.has(candidates[0])) {
      moves.push({
        technique: "single-candidate",
        title: "列の残り候補が1つです",
        col,
        focusCells: candidates,
        excludeCells: [],
        placeCell: candidates[0],
        explanation: [
          "この列でタコを置ける未確定セルが1つだけ残っています。",
          "そのセルにタコを確定できます。",
        ],
      });
    }
  }

  for (let regionId = 0; regionId < REGION_COUNT; regionId += 1) {
    if (hasPieceInRegion(puzzle, state, regionId)) continue;
    const candidates = regionCells(puzzle, regionId).filter(
      (index) => isLegalCandidate(puzzle, state, index),
    );
    if (candidates.length === 1 && !state.pieces.has(candidates[0])) {
      moves.push({
        technique: "single-candidate",
        title: "Regionの残り候補が1つです",
        regionId,
        focusCells: candidates,
        excludeCells: [],
        placeCell: candidates[0],
        explanation: [
          "このRegionでタコを置ける未確定セルが1つだけ残っています。",
          "そのセルにタコを確定できます。",
        ],
      });
    }
  }

  return moves;
}

function findRegionLineMoves(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
): LogicalMove[] {
  const moves: LogicalMove[] = [];
  for (let regionId = 0; regionId < REGION_COUNT; regionId += 1) {
    const exclusions = regionLineExclusions(puzzle, state, regionId);
    if (exclusions.length === 0) continue;
    const candidates = regionCells(puzzle, regionId).filter(
      (index) => isLegalCandidate(puzzle, state, index),
    );
    const rows = new Set(candidates.map((index) => cellCoord(index).row));
    const columns = new Set(candidates.map((index) => cellCoord(index).col));
    moves.push({
      technique: "region-line",
      title: "Region-Line消去",
      regionId,
      row: rows.size === 1 ? [...rows][0] : undefined,
      col: columns.size === 1 ? [...columns][0] : undefined,
      focusCells: candidates,
      excludeCells: exclusions,
      explanation: [
        "このRegionの残り候補は同じ行または列に限定されています。",
        "このRegionのタコはそのライン上に必ず存在します。",
        "同じラインにある他Regionのセルは×にできます。",
      ],
    });
  }
  return moves;
}

function rowCandidates(
  puzzle: Pick<Puzzle, "regions">,
  row: number,
  state: PlayerState,
): number[] {
  return Array.from({ length: BOARD_SIZE }, (_, col) =>
    cellIndex(row, col),
  ).filter((index) => isLegalCandidate(puzzle, state, index));
}

function columnCandidates(
  puzzle: Pick<Puzzle, "regions">,
  col: number,
  state: PlayerState,
): number[] {
  return Array.from({ length: BOARD_SIZE }, (_, row) =>
    cellIndex(row, col),
  ).filter((index) => isLegalCandidate(puzzle, state, index));
}

function isBlocked(state: PlayerState, index: number): boolean {
  return (
    state.excluded.has(index) ||
    state.fixedErrors.has(index) ||
    state.pieces.has(index)
  );
}

function isLegalCandidate(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
  index: number,
): boolean {
  if (isBlocked(state, index)) return false;
  const { row, col } = cellCoord(index);
  const regionId = puzzle.regions[index];

  for (const piece of state.pieces) {
    const pieceCoord = cellCoord(piece);
    if (pieceCoord.row === row) return false;
    if (pieceCoord.col === col) return false;
    if (puzzle.regions[piece] === regionId) return false;
    if (isAdjacent(piece, index)) return false;
  }

  return true;
}

function hasPieceInRow(state: PlayerState, row: number): boolean {
  return [...state.pieces].some((index) => cellCoord(index).row === row);
}

function hasPieceInColumn(state: PlayerState, col: number): boolean {
  return [...state.pieces].some((index) => cellCoord(index).col === col);
}

function hasPieceInRegion(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
  regionId: number,
): boolean {
  return [...state.pieces].some((index) => puzzle.regions[index] === regionId);
}
