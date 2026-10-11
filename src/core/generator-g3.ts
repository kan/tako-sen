import type { GenerateOptions, GeneratedPuzzle } from "./generator-g1";
import {
  analyzePuzzleDifficulty,
  type PuzzleDifficultyAnalysis,
} from "./difficulty";
import {
  cellCoord,
  cellIndex,
  orthogonalNeighbors,
  type Puzzle,
  type PuzzleDifficulty,
} from "./model";
import { createWideSeededRandom, shuffled, type RandomSource } from "./random";
import { solvePuzzle } from "./solver";

export interface RegionShapeLimits {
  /** Smallest region, apart from the single-cell region of an easy board. */
  readonly minSize: number;
  readonly maxSize: number;
  /** Longer over shorter side of a region's bounding box. */
  readonly maxAspect: number;
  /** Share of its bounding box a region must fill. */
  readonly minFill: number;
}

export interface BoardSpec {
  readonly size: 8 | 10;
  readonly version: string;
  readonly difficulty: PuzzleDifficulty;
  readonly shape: RegionShapeLimits;
  /** Easy boards keep exactly one single-cell region as a way in. */
  readonly singleton: boolean;
  /** A hard board must need region-depletion at least this often. */
  readonly hardMinDepletion: number;
  /** Fresh solutions tried before giving up. */
  readonly attempts: number;
  /** Move budget for reducing the board to one solution. */
  readonly uniqueBudget: number;
  /** Move budget for reaching the difficulty and the shape limits. */
  readonly refineBudget: number;
  /** Moves sampled per step while reducing; the most promising is tried. */
  readonly proposals: number;
  /** Rejections in a row after which reducing restarts from a new solution. */
  readonly stallLimit: number;
}

/** Solutions listed before the first move. Freshly grown boards have a few
 * thousand; an attempt that has more than this is dropped. */
const ENUMERATION_LIMIT = 200000;

const G3_SHAPE: RegionShapeLimits = {
  minSize: 3,
  maxSize: 14,
  maxAspect: 3,
  minFill: 0.4,
};

/** Every count is a move or attempt budget, never a time limit, so a seed
 * gives the same board in the browser and on the server. */
export function g3Spec(difficulty: PuzzleDifficulty): BoardSpec {
  return {
    size: 8,
    version: "g3",
    difficulty,
    shape: G3_SHAPE,
    singleton: difficulty === "easy",
    hardMinDepletion: 2,
    attempts: 16,
    uniqueBudget: 640,
    refineBudget: 400,
    proposals: 1,
    stallLimit: Infinity,
  };
}

/** `maxAttempts` is not read: the seed code alone must decide the board. */
export function generateG3(options: GenerateOptions = {}): GeneratedPuzzle {
  return generateBoard(
    options.seed ?? String(Date.now()),
    g3Spec(options.difficulty ?? "easy"),
  );
}

/**
 * Builds a board without givens in three stages: grow regions around a
 * solution, move border cells until that solution is the only one, then keep
 * moving them until the board has the wanted difficulty and region shapes.
 * It returns the first attempt that meets every condition, or else the
 * closest attempt that has one solution and can be solved by the supported
 * techniques, and throws when no attempt gets that far.
 */
export function generateBoard(seed: string, spec: BoardSpec): GeneratedPuzzle {
  let closest: (GeneratedPuzzle & { readonly distance: number }) | undefined;
  for (let attempt = 0; attempt < spec.attempts; attempt += 1) {
    const random = createWideSeededRandom(
      `${spec.version}:${spec.difficulty}:${seed}:${attempt}`,
    );
    const solution = generateSolution(spec.size, random);
    const singletonId = spec.singleton
      ? Math.floor(random.next() * spec.size)
      : -1;
    const start: Puzzle = {
      size: spec.size,
      regions: growRegions(spec.size, solution, random, singletonId),
      solution,
      seed,
      difficulty: spec.difficulty,
      generatorVersion: spec.version,
      givens: [],
    };
    // Growth can starve a region. Repairing that costs more moves than a
    // fresh start.
    if (
      start.regions.includes(-1) ||
      regionSizes(start).some(
        (size, id) => id !== singletonId && size < spec.shape.minSize,
      )
    )
      continue;

    const unique = reduceToOneSolution(start, spec, singletonId, random);
    if (!unique) continue;
    const refined = refine(unique, spec, singletonId, random);
    if (refined.distance === 0) return refined;
    // A board the supported techniques cannot solve is never returned.
    if (
      refined.analysis.solved &&
      (!closest || refined.distance < closest.distance)
    )
      closest = refined;
  }
  if (closest) return closest;
  throw new Error(`Failed to generate a solvable puzzle for seed: ${seed}`);
}

/**
 * Moves border cells, never accepting a move that adds solutions, until one
 * solution is left. Moving cell c out of its region kills every solution
 * through c, because that region then has no piece, and leaves the others
 * alone; so only the solutions through c on the new board are counted, and
 * the per-cell counts of the full enumeration are kept up to date.
 */
function reduceToOneSolution(
  start: Puzzle,
  spec: BoardSpec,
  singletonId: number,
  random: RandomSource,
): Puzzle | undefined {
  let current = start;
  let violations = shapeViolations(current, spec.shape, singletonId);
  const all = solvePuzzle(current, {
    maxSolutions: ENUMERATION_LIMIT,
  }).solutions;
  // The counts below are exact only for a complete enumeration.
  if (all.length >= ENUMERATION_LIMIT) return undefined;
  let count = all.length;
  const through = new Int32Array(spec.size * spec.size);
  for (const solution of all) for (const cell of solution) through[cell] += 1;

  let rejected = 0;
  for (
    let step = 0;
    step < spec.uniqueBudget && count > 1 && rejected < spec.stallLimit;
    step += 1
  ) {
    rejected += 1;
    const move = proposeMove(
      current,
      spec,
      singletonId,
      violations,
      random,
      through,
    );
    if (!move) continue;
    const moved = shapeViolations(move.puzzle, spec.shape, singletonId);
    if (moved > violations) continue;
    const removed = through[move.cell];
    const added = solvePuzzle(
      { ...move.puzzle, givens: [move.cell] },
      { maxSolutions: removed + 1 },
    ).solutions;
    if (added.length > removed) continue;
    rejected = 0;
    const gone = solvePuzzle(
      { ...current, givens: [move.cell] },
      { maxSolutions: removed },
    ).solutions;
    for (const solution of gone)
      for (const cell of solution) through[cell] -= 1;
    for (const solution of added)
      for (const cell of solution) through[cell] += 1;
    count += added.length - removed;
    current = move.puzzle;
    violations = moved;
  }
  // Every later stage relies on this board having one solution, so the
  // running count is confirmed by a search of its own.
  return count === 1 &&
    solvePuzzle(current, { maxSolutions: 2 }).status === "unique"
    ? current
    : undefined;
}

/**
 * Moves border cells while the board keeps one solution and stays solvable
 * by the supported techniques, never moving away from the wanted difficulty
 * or adding shape violations. `distance` is 0 when every condition is met.
 */
function refine(
  start: Puzzle,
  spec: BoardSpec,
  singletonId: number,
  random: RandomSource,
): GeneratedPuzzle & { readonly distance: number } {
  let puzzle = start;
  let analysis = analyzePuzzleDifficulty(puzzle);
  let shortfall = difficultyShortfall(analysis, spec);
  let violations = shapeViolations(puzzle, spec.shape, singletonId);
  const reached = () =>
    shortfall === 0 && violations === 0 && analysis.rating === spec.difficulty;

  for (let step = 0; step < spec.refineBudget && !reached(); step += 1) {
    const move = proposeMove(puzzle, spec, singletonId, violations, random);
    if (!move) continue;
    const moved = shapeViolations(move.puzzle, spec.shape, singletonId);
    if (moved > violations) continue;
    // As in reduceToOneSolution, the one solution survives the move, so the
    // board stays unique unless the moved cell now carries a solution.
    if (
      solvePuzzle({ ...move.puzzle, givens: [move.cell] }, { maxSolutions: 1 })
        .status !== "none"
    )
      continue;
    const next = analyzePuzzleDifficulty(move.puzzle);
    if (analysis.solved && !next.solved) continue;
    const nextShortfall = difficultyShortfall(next, spec);
    if (nextShortfall > shortfall) continue;
    puzzle = move.puzzle;
    analysis = next;
    shortfall = nextShortfall;
    violations = moved;
  }
  return {
    puzzle,
    analysis,
    distance: reached() ? 0 : 1 + shortfall * 10 + violations,
  };
}

/** How far the analysis is from the wanted difficulty; 0 when it fits. */
function difficultyShortfall(
  analysis: PuzzleDifficultyAnalysis,
  spec: BoardSpec,
): number {
  if (!analysis.solved) return 10;
  const depletions = analysis.techniqueCounts["region-depletion"];
  const multiRegion = analysis.techniqueCounts["multi-region-line"];
  switch (spec.difficulty) {
    case "hard":
      return Math.max(0, spec.hardMinDepletion - depletions);
    case "normal":
      return depletions + (multiRegion === 0 ? 1 : 0);
    case "easy":
      return (
        depletions +
        multiRegion +
        Math.abs(openingPlacements(analysis) - (spec.singleton ? 1 : 0))
      );
  }
}

/** Pieces that can be placed at the start without any elimination technique. */
export function openingPlacements(analysis: PuzzleDifficultyAnalysis): number {
  let placed = 0;
  for (const step of analysis.steps) {
    if (
      step.technique !== "single-candidate" &&
      step.technique !== "missing-exclusion"
    )
      break;
    if (step.placed) placed += 1;
  }
  return placed;
}

interface RegionShape {
  readonly size: number;
  readonly aspect: number;
  readonly fill: number;
}

function regionShapes(puzzle: Pick<Puzzle, "size" | "regions">): RegionShape[] {
  const size: number = puzzle.size;
  const boxes = Array.from({ length: size }, () => ({
    top: size,
    bottom: -1,
    left: size,
    right: -1,
    cells: 0,
  }));
  puzzle.regions.forEach((id, index) => {
    const { row, col } = cellCoord(index, size);
    const box = boxes[id];
    box.top = Math.min(box.top, row);
    box.bottom = Math.max(box.bottom, row);
    box.left = Math.min(box.left, col);
    box.right = Math.max(box.right, col);
    box.cells += 1;
  });
  return boxes.map((box) => {
    const height = box.bottom - box.top + 1;
    const width = box.right - box.left + 1;
    return {
      size: box.cells,
      aspect: Math.max(height, width) / Math.min(height, width),
      fill: box.cells / (height * width),
    };
  });
}

function breaksLimits(shape: RegionShape, limits: RegionShapeLimits): boolean {
  return (
    shape.size < limits.minSize ||
    shape.size > limits.maxSize ||
    (shape.size >= 3 &&
      (shape.aspect > limits.maxAspect || shape.fill < limits.minFill))
  );
}

/** Regions outside the limits. The single-cell region must stay one cell. */
export function shapeViolations(
  puzzle: Pick<Puzzle, "size" | "regions">,
  limits: RegionShapeLimits,
  singletonId = -1,
): number {
  return regionShapes(puzzle).filter((shape, id) =>
    id === singletonId ? shape.size !== 1 : breaksLimits(shape, limits),
  ).length;
}

function regionSizes(puzzle: Pick<Puzzle, "size" | "regions">): number[] {
  const sizes = Array<number>(puzzle.size).fill(0);
  for (const id of puzzle.regions) sizes[id] += 1;
  return sizes;
}

/**
 * One border cell moved to a neighbouring region, or nothing when the pick
 * would disconnect a region. Solution cells never move, the single-cell
 * region neither gives nor takes cells, and no move takes a region below or
 * above the size limits. While a region breaks the limits, half of the picks
 * are restricted to moves that touch such a region.
 */
function proposeMove(
  current: Puzzle,
  spec: BoardSpec,
  singletonId: number,
  violations: number,
  random: RandomSource,
  through?: Int32Array,
): { readonly puzzle: Puzzle; readonly cell: number } | undefined {
  const sizes = regionSizes(current);
  let moves = borderMoves(current).filter(({ cell, destination }) => {
    const source = current.regions[cell];
    return (
      destination !== singletonId &&
      source !== singletonId &&
      sizes[source] - 1 >= spec.shape.minSize &&
      sizes[destination] + 1 <= spec.shape.maxSize
    );
  });
  if (violations > 0 && random.next() < 0.5) {
    const broken = regionShapes(current).map(
      (shape, id) => id !== singletonId && breaksLimits(shape, spec.shape),
    );
    const repairs = moves.filter(
      ({ cell, destination }) =>
        broken[destination] || broken[current.regions[cell]],
    );
    if (repairs.length > 0) moves = repairs;
  }
  if (moves.length === 0) return undefined;
  const pick = () => moves[Math.floor(random.next() * moves.length)];
  let move = pick();
  if (through) {
    // Prefer the cell that most solutions pass through: moving it removes
    // the most.
    for (let i = 1; i < spec.proposals; i += 1) {
      const other = pick();
      if (through[other.cell] > through[move.cell]) move = other;
    }
  }
  const source = current.regions[move.cell];
  const regions = [...current.regions];
  regions[move.cell] = move.destination;
  // The destination only gains a cell next to it and the other regions do
  // not change, so only the region that lost the cell can fall apart.
  return isConnected(regions, spec.size, source)
    ? { puzzle: { ...current, regions }, cell: move.cell }
    : undefined;
}

function isConnected(
  regions: readonly number[],
  size: number,
  id: number,
): boolean {
  const start = regions.indexOf(id);
  const seen = new Set([start]);
  const pending = [start];
  while (pending.length > 0) {
    for (const neighbor of orthogonalNeighbors(pending.pop()!, size)) {
      if (regions[neighbor] !== id || seen.has(neighbor)) continue;
      seen.add(neighbor);
      pending.push(neighbor);
    }
  }
  return seen.size === regions.filter((region) => region === id).length;
}

function borderMoves(
  puzzle: Pick<Puzzle, "size" | "regions" | "solution">,
): { readonly cell: number; readonly destination: number }[] {
  const moves: { cell: number; destination: number }[] = [];
  const isSolution = new Set(puzzle.solution);
  puzzle.regions.forEach((region, cell) => {
    if (isSolution.has(cell)) return;
    const seen = new Set<number>();
    for (const neighbor of orthogonalNeighbors(cell, puzzle.size)) {
      const destination = puzzle.regions[neighbor];
      if (destination === region || seen.has(destination)) continue;
      seen.add(destination);
      moves.push({ cell, destination });
    }
  });
  return moves;
}

/** One piece per row and column, none touching: a row-by-row backtrack. */
function generateSolution(size: number, random: RandomSource): number[] {
  const columns = Array.from({ length: size }, (_, col) => col);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const remaining = shuffled(columns, random);
    const solution: number[] = [];
    if (placeRow(0)) return solution;

    function placeRow(row: number): boolean {
      if (row === size) return true;
      const previousCol = row === 0 ? -2 : solution[row - 1] % size;
      for (const col of shuffled(remaining, random)) {
        if (Math.abs(previousCol - col) <= 1) continue;
        solution.push(cellIndex(row, col, size));
        remaining.splice(remaining.indexOf(col), 1);
        if (placeRow(row + 1)) return true;
        remaining.push(col);
        solution.pop();
      }
      return false;
    }
  }
  throw new Error("Failed to generate a complete piece placement.");
}

/**
 * Grows every region from its solution cell, always extending one of the
 * smallest regions so that none is starved. The region with `singletonId`
 * stays a single cell.
 */
function growRegions(
  size: number,
  solution: readonly number[],
  random: RandomSource,
  singletonId: number,
): number[] {
  const regions = Array<number>(size * size).fill(-1);
  const frontiers = Array.from({ length: size }, () => new Set<number>());
  const sizes = Array<number>(size).fill(1);
  solution.forEach((cell, id) => {
    regions[cell] = id;
    if (id === singletonId) return;
    for (const neighbor of orthogonalNeighbors(cell, size))
      frontiers[id].add(neighbor);
  });

  let unassigned = size * size - size;
  while (unassigned > 0) {
    const growable = shuffled(
      Array.from({ length: size }, (_, id) => id).filter(
        (id) => id !== singletonId && frontiers[id].size > 0,
      ),
      random,
    );
    if (growable.length === 0) break;
    const smallest = Math.min(...growable.map((id) => sizes[id]));
    const id = growable.find((candidate) => sizes[candidate] <= smallest + 1)!;
    const next = shuffled([...frontiers[id]], random)[0];
    frontiers[id].delete(next);
    if (regions[next] !== -1) continue;
    regions[next] = id;
    sizes[id] += 1;
    unassigned -= 1;
    for (const neighbor of orthogonalNeighbors(next, size))
      if (regions[neighbor] === -1) frontiers[id].add(neighbor);
  }
  return regions;
}
