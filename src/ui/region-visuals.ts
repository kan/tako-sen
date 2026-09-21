import {
  BOARD_SIZE,
  REGION_COUNT,
  cellCoord,
  cellIndex,
  type Puzzle,
} from "../core/model";

export interface RegionPaletteColor {
  readonly background: string;
}

export interface CellRegionBorders {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

export const REGION_PALETTE: readonly RegionPaletteColor[] = [
  { background: "#f3c66a" },
  { background: "#8ccbea" },
  { background: "#78cdb5" },
  { background: "#f2e56b" },
  { background: "#82add1" },
  { background: "#e99a70" },
  { background: "#e1a6cc" },
  { background: "#b8a1d9" },
] as const;

const PALETTE_DISTANCES = [
  [0, 5, 4, 2, 6, 1, 4, 3],
  [5, 0, 2, 5, 1, 6, 3, 2],
  [4, 2, 0, 4, 3, 5, 4, 2],
  [2, 5, 4, 0, 6, 3, 5, 3],
  [6, 1, 3, 6, 0, 5, 2, 2],
  [1, 6, 5, 3, 5, 0, 3, 4],
  [4, 3, 4, 5, 2, 3, 0, 2],
  [3, 2, 2, 3, 2, 4, 2, 0],
] as const;

export function assignRegionColorIndexes(
  puzzle: Pick<Puzzle, "regions">,
): readonly number[] {
  const adjacency = regionAdjacency(puzzle);
  const colorIndexes = Array<number>(REGION_COUNT).fill(-1);

  for (let count = 0; count < REGION_COUNT; count += 1) {
    const regionId = nextRegionToColor(adjacency, colorIndexes);
    colorIndexes[regionId] = bestPaletteIndex(
      adjacency[regionId],
      colorIndexes,
    );
  }

  return colorIndexes;
}

export function regionColorForCell(
  puzzle: Pick<Puzzle, "regions">,
  colorIndexes: readonly number[],
  index: number,
): RegionPaletteColor {
  return REGION_PALETTE[colorIndexes[puzzle.regions[index]]];
}

export function cellRegionBorders(
  puzzle: Pick<Puzzle, "regions">,
  index: number,
): CellRegionBorders {
  const { row, col } = cellCoord(index);
  const regionId = puzzle.regions[index];
  return {
    top: row === 0 || puzzle.regions[cellIndex(row - 1, col)] !== regionId,
    right:
      col === BOARD_SIZE - 1 ||
      puzzle.regions[cellIndex(row, col + 1)] !== regionId,
    bottom:
      row === BOARD_SIZE - 1 ||
      puzzle.regions[cellIndex(row + 1, col)] !== regionId,
    left: col === 0 || puzzle.regions[cellIndex(row, col - 1)] !== regionId,
  };
}

export function regionAdjacency(
  puzzle: Pick<Puzzle, "regions">,
): readonly ReadonlySet<number>[] {
  const adjacency = Array.from(
    { length: REGION_COUNT },
    () => new Set<number>(),
  );

  for (let index = 0; index < puzzle.regions.length; index += 1) {
    const { row, col } = cellCoord(index);
    addNeighbor(row, col + 1);
    addNeighbor(row + 1, col);

    function addNeighbor(neighborRow: number, neighborCol: number): void {
      if (neighborRow >= BOARD_SIZE || neighborCol >= BOARD_SIZE) return;
      const a = puzzle.regions[index];
      const b = puzzle.regions[cellIndex(neighborRow, neighborCol)];
      if (a === b) return;
      adjacency[a].add(b);
      adjacency[b].add(a);
    }
  }

  return adjacency;
}

function nextRegionToColor(
  adjacency: readonly ReadonlySet<number>[],
  colorIndexes: readonly number[],
): number {
  let bestRegionId = -1;
  let bestColoredNeighborCount = -1;
  let bestDegree = -1;

  for (let regionId = 0; regionId < REGION_COUNT; regionId += 1) {
    if (colorIndexes[regionId] !== -1) continue;
    const coloredNeighborCount = [...adjacency[regionId]].filter(
      (neighbor) => colorIndexes[neighbor] !== -1,
    ).length;
    const degree = adjacency[regionId].size;
    if (
      coloredNeighborCount > bestColoredNeighborCount ||
      (coloredNeighborCount === bestColoredNeighborCount && degree > bestDegree)
    ) {
      bestRegionId = regionId;
      bestColoredNeighborCount = coloredNeighborCount;
      bestDegree = degree;
    }
  }

  return bestRegionId;
}

function bestPaletteIndex(
  adjacentRegions: ReadonlySet<number>,
  colorIndexes: readonly number[],
): number {
  let bestColorIndex = 0;
  let bestScore = -1;
  const usedColorIndexes = new Set(
    colorIndexes.filter((colorIndex) => colorIndex !== -1),
  );

  for (
    let colorIndex = 0;
    colorIndex < REGION_PALETTE.length;
    colorIndex += 1
  ) {
    if (usedColorIndexes.has(colorIndex)) continue;

    const neighborColorIndexes = [...adjacentRegions]
      .map((regionId) => colorIndexes[regionId])
      .filter((neighborColorIndex) => neighborColorIndex !== -1);

    const score =
      neighborColorIndexes.length === 0
        ? 999
        : Math.min(
            ...neighborColorIndexes.map(
              (neighborColorIndex) =>
                PALETTE_DISTANCES[colorIndex][neighborColorIndex],
            ),
          );
    if (score > bestScore) {
      bestScore = score;
      bestColorIndex = colorIndex;
    }
  }

  return bestColorIndex;
}
