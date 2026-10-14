import { cellCoord, cellIndex, type Puzzle } from "../core/model";

export interface RegionPaletteColor {
  readonly background: string;
  readonly foreground?: string;
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
  { background: "#f1f2ee" },
  { background: "#565d67", foreground: "#ffffff" },
] as const;

const PALETTE_DISTANCES = [
  [0, 5, 4, 2, 6, 1, 4, 3, 4, 5],
  [5, 0, 2, 5, 1, 6, 3, 2, 4, 5],
  [4, 2, 0, 4, 3, 5, 4, 2, 4, 5],
  [2, 5, 4, 0, 6, 3, 5, 3, 4, 5],
  [6, 1, 3, 6, 0, 5, 2, 2, 4, 5],
  [1, 6, 5, 3, 5, 0, 3, 4, 4, 5],
  [4, 3, 4, 5, 2, 3, 0, 2, 4, 5],
  [3, 2, 2, 3, 2, 4, 2, 0, 4, 5],
  [4, 4, 4, 4, 4, 4, 4, 4, 0, 7],
  [5, 5, 5, 5, 5, 5, 5, 5, 7, 0],
] as const;

export function assignRegionColorIndexes(
  puzzle: Pick<Puzzle, "size" | "regions">,
): readonly number[] {
  const adjacency = regionAdjacency(puzzle);
  const colorIndexes = Array<number>(puzzle.size).fill(-1);

  for (let count = 0; count < puzzle.size; count += 1) {
    const regionId = nextRegionToColor(adjacency, colorIndexes);
    colorIndexes[regionId] = bestPaletteIndex(
      adjacency[regionId],
      colorIndexes,
      puzzle.size,
    );
  }

  return colorIndexes;
}

function regionColorForCell(
  puzzle: Pick<Puzzle, "size" | "regions">,
  colorIndexes: readonly number[],
  index: number,
): RegionPaletteColor {
  return REGION_PALETTE[colorIndexes[puzzle.regions[index]]];
}

/**
 * The base inline style of a board cell, shared by the game and the tutorial.
 * The board's own frame draws the outer edge, so edge cells draw no border
 * there: a translucent line over the frame made its width look uneven.
 */
export function cellBaseStyle(
  puzzle: Pick<Puzzle, "size" | "regions">,
  colorIndexes: readonly number[],
  index: number,
): Record<string, string> {
  const color = regionColorForCell(puzzle, colorIndexes, index);
  const borders = cellRegionBorders(puzzle, index);
  const { row, col } = cellCoord(index, puzzle.size);
  const last = puzzle.size - 1;
  const width = (edge: boolean, region: boolean) =>
    edge ? "0" : region ? "2px" : "1px";
  return {
    backgroundColor: color.background,
    color: color.foreground ?? "#2a1b14",
    // The dark Region would swallow the blue focus ring and the tako's dark
    // outline, so both get light versions there.
    "--focus-color": color.foreground ?? "#2026d2",
    ...(color.foreground ? { "--tako-halo": "#fffdf8" } : {}),
    borderTopWidth: width(row === 0, borders.top),
    borderRightWidth: width(col === last, borders.right),
    borderBottomWidth: width(row === last, borders.bottom),
    borderLeftWidth: width(col === 0, borders.left),
  };
}

export function cellRegionBorders(
  puzzle: Pick<Puzzle, "size" | "regions">,
  index: number,
): CellRegionBorders {
  const { row, col } = cellCoord(index, puzzle.size);
  const regionId = puzzle.regions[index];
  return {
    top:
      row === 0 ||
      puzzle.regions[cellIndex(row - 1, col, puzzle.size)] !== regionId,
    right:
      col === puzzle.size - 1 ||
      puzzle.regions[cellIndex(row, col + 1, puzzle.size)] !== regionId,
    bottom:
      row === puzzle.size - 1 ||
      puzzle.regions[cellIndex(row + 1, col, puzzle.size)] !== regionId,
    left:
      col === 0 ||
      puzzle.regions[cellIndex(row, col - 1, puzzle.size)] !== regionId,
  };
}

export function regionAdjacency(
  puzzle: Pick<Puzzle, "size" | "regions">,
): readonly ReadonlySet<number>[] {
  const adjacency = Array.from(
    { length: puzzle.size },
    () => new Set<number>(),
  );

  for (let index = 0; index < puzzle.regions.length; index += 1) {
    const { row, col } = cellCoord(index, puzzle.size);
    addNeighbor(row, col + 1);
    addNeighbor(row + 1, col);

    function addNeighbor(neighborRow: number, neighborCol: number): void {
      if (neighborRow >= puzzle.size || neighborCol >= puzzle.size) return;
      const a = puzzle.regions[index];
      const b =
        puzzle.regions[cellIndex(neighborRow, neighborCol, puzzle.size)];
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

  for (let regionId = 0; regionId < colorIndexes.length; regionId += 1) {
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
  paletteSize: number,
): number {
  let bestColorIndex = 0;
  let bestScore = -1;
  const usedColorIndexes = new Set(
    colorIndexes.filter((colorIndex) => colorIndex !== -1),
  );

  for (let colorIndex = 0; colorIndex < paletteSize; colorIndex += 1) {
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
