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

export type TechniqueId =
  | "contradiction"
  | "single-candidate"
  | "region-line"
  | "multi-region-line"
  | "region-depletion";

export interface LogicalMove {
  readonly technique: TechniqueId;
  readonly title: string;
  readonly regionId?: number;
  readonly regionIds?: readonly number[];
  readonly affectedRegionId?: number;
  readonly row?: number;
  readonly col?: number;
  readonly rows?: readonly number[];
  readonly cols?: readonly number[];
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
    ...findMultiRegionLineMoves(puzzle, state),
    ...findRegionDepletionMoves(puzzle, state),
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
    const candidates = regionCells(puzzle, regionId).filter((index) =>
      isLegalCandidate(puzzle, state, index),
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

function findRegionDepletionMoves(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
): LogicalMove[] {
  const moves: LogicalMove[] = [];

  for (
    let assumedCell = 0;
    assumedCell < puzzle.regions.length;
    assumedCell += 1
  ) {
    if (!isLegalCandidate(puzzle, state, assumedCell)) continue;

    const assumedRegionId = puzzle.regions[assumedCell];
    for (
      let affectedRegionId = 0;
      affectedRegionId < REGION_COUNT;
      affectedRegionId += 1
    ) {
      if (affectedRegionId === assumedRegionId) continue;
      if (hasPieceInRegion(puzzle, state, affectedRegionId)) continue;

      const affectedCandidates = regionCells(puzzle, affectedRegionId).filter(
        (index) => isLegalCandidate(puzzle, state, index),
      );
      if (affectedCandidates.length === 0) continue;

      const remainingCandidates = affectedCandidates.filter(
        (index) => !assumedPieceBlocks(puzzle, assumedCell, index),
      );
      if (remainingCandidates.length > 0) continue;

      moves.push({
        technique: "region-depletion",
        title: "置くと別Regionの候補がなくなります",
        regionId: assumedRegionId,
        affectedRegionId,
        focusCells: [assumedCell, ...affectedCandidates],
        excludeCells: [assumedCell],
        explanation: [
          "注目セルにタコを置くと仮定します。",
          "すると、関連するRegionでタコを置ける候補がすべて消えてしまいます。",
          "各Regionには必ず1つタコが必要なので、この仮定は成り立ちません。",
          "したがって、注目セルは×にできます。",
        ],
      });
      break;
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
    const candidates = regionCells(puzzle, regionId).filter((index) =>
      isLegalCandidate(puzzle, state, index),
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

function findMultiRegionLineMoves(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
): LogicalMove[] {
  const regionCandidates = Array.from(
    { length: REGION_COUNT },
    (_, regionId) => ({
      regionId,
      candidates: hasPieceInRegion(puzzle, state, regionId)
        ? []
        : regionCells(puzzle, regionId).filter((index) =>
            isLegalCandidate(puzzle, state, index),
          ),
    }),
  ).filter(({ candidates }) => candidates.length > 0);
  const moves: LogicalMove[] = [];
  const seen = new Set<string>();

  for (let size = 2; size < regionCandidates.length; size += 1) {
    for (const group of combinations(regionCandidates, size)) {
      const regionIds = uniqueSorted(group.map(({ regionId }) => regionId));
      const focusCells = group.flatMap(({ candidates }) => candidates);
      const rows = uniqueSorted(
        focusCells.map((index) => cellCoord(index).row),
      );
      if (rows.length === size) {
        const excludeCells = lineSetExclusions(
          puzzle,
          state,
          "row",
          rows,
          regionIds,
        );
        const key = `row:${regionIds.join(",")}:${rows.join(",")}`;
        if (excludeCells.length > 0 && !seen.has(key)) {
          seen.add(key);
          moves.push({
            technique: "multi-region-line",
            title: "複数RegionのRegion-Line消去",
            regionIds,
            rows,
            focusCells,
            excludeCells,
            explanation: [
              `${size}つのRegionの候補が、同じ${size}本の行だけに閉じ込められています。`,
              `この${size}本の行には、それらのRegionのタコが必ず${size}匹入ります。`,
              "そのため、同じ行にある他Regionのセルは×にできます。",
            ],
          });
        }
      }

      const cols = uniqueSorted(
        focusCells.map((index) => cellCoord(index).col),
      );
      if (cols.length === size) {
        const excludeCells = lineSetExclusions(
          puzzle,
          state,
          "col",
          cols,
          regionIds,
        );
        const key = `col:${regionIds.join(",")}:${cols.join(",")}`;
        if (excludeCells.length > 0 && !seen.has(key)) {
          seen.add(key);
          moves.push({
            technique: "multi-region-line",
            title: "複数RegionのRegion-Line消去",
            regionIds,
            cols,
            focusCells,
            excludeCells,
            explanation: [
              `${size}つのRegionの候補が、同じ${size}本の列だけに閉じ込められています。`,
              `この${size}本の列には、それらのRegionのタコが必ず${size}匹入ります。`,
              "そのため、同じ列にある他Regionのセルは×にできます。",
            ],
          });
        }
      }
    }
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

function combinations<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  const current: T[] = [];
  visit(0);
  return result;

  function visit(start: number): void {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (
      let index = start;
      index <= items.length - (size - current.length);
      index += 1
    ) {
      current.push(items[index]);
      visit(index + 1);
      current.pop();
    }
  }
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function lineSetExclusions(
  puzzle: Pick<Puzzle, "regions">,
  state: PlayerState,
  axis: "row" | "col",
  lines: readonly number[],
  sourceRegionIds: readonly number[],
): number[] {
  const sourceRegions = new Set(sourceRegionIds);
  const exclusions = new Set<number>();

  for (const line of lines) {
    for (let offset = 0; offset < BOARD_SIZE; offset += 1) {
      const index =
        axis === "row" ? cellIndex(line, offset) : cellIndex(offset, line);
      if (!sourceRegions.has(puzzle.regions[index])) exclusions.add(index);
    }
  }

  return [...exclusions].filter((index) => !isBlocked(state, index));
}

function assumedPieceBlocks(
  puzzle: Pick<Puzzle, "regions">,
  assumedPiece: number,
  target: number,
): boolean {
  const assumedCoord = cellCoord(assumedPiece);
  const targetCoord = cellCoord(target);
  return (
    assumedCoord.row === targetCoord.row ||
    assumedCoord.col === targetCoord.col ||
    puzzle.regions[assumedPiece] === puzzle.regions[target] ||
    isAdjacent(assumedPiece, target)
  );
}
