import { describe, expect, it } from "vitest";
import { generatePuzzleWithAnalysis } from "../src/core/generator";
import {
  BOARD_SIZE,
  type Puzzle,
  type PuzzleDifficulty,
} from "../src/core/model";
import { validatePuzzleShape, validateSolution } from "../src/core/rules";
import { solvePuzzle } from "../src/core/solver";
import { createSeededRandom, shuffled } from "../src/core/random";

// 通常は代表seedだけを検証し、大量監査はCIまたは明示的なauditモードで行う。
const fullAudit = import.meta.env.MODE === "audit";
// 固定コーパスで失敗を再現可能にする。全盤面の網羅や一様分布の証明ではない。
const seeds = [
  "",
  "0",
  "1",
  "タコ🐙",
  ...Array.from(
    { length: fullAudit ? 60 : 4 },
    (_, i) => `generator-audit:${i}`,
  ),
];
const difficulties: PuzzleDifficulty[] = ["easy", "normal", "hard"];

// Region IDの付け替えやseedの違いを、盤面の多様性として数えない。
function geometrySignature(puzzle: Puzzle): string {
  const ids = new Map<number, number>();
  return JSON.stringify(
    puzzle.regions.map((id) => {
      if (!ids.has(id)) ids.set(id, ids.size);
      return ids.get(id);
    }),
  );
}

function shapeSignature(puzzle: Puzzle): string {
  const signatures: string[] = [];
  for (let reflect = 0; reflect < 2; reflect++) {
    for (let turns = 0; turns < 4; turns++) {
      const regions = new Array<number>(BOARD_SIZE ** 2);
      puzzle.regions.forEach((region, cell) => {
        let row = Math.floor(cell / BOARD_SIZE);
        let col = cell % BOARD_SIZE;
        if (reflect) col = BOARD_SIZE - 1 - col;
        for (let i = 0; i < turns; i++)
          [row, col] = [col, BOARD_SIZE - 1 - row];
        regions[row * BOARD_SIZE + col] = region;
      });
      signatures.push(geometrySignature({ ...puzzle, regions }));
    }
  }
  return signatures.sort()[0];
}

function assertConnectedRegions(puzzle: Puzzle, context: string): void {
  for (let id = 0; id < BOARD_SIZE; id++) {
    const cells = puzzle.regions.flatMap((region, cell) =>
      region === id ? [cell] : [],
    );
    expect(cells.length, context).toBeGreaterThan(0);
    const visited = new Set([cells[0]]);
    const pending = [cells[0]];
    while (pending.length) {
      const cell = pending.pop()!;
      const row = Math.floor(cell / BOARD_SIZE);
      const col = cell % BOARD_SIZE;
      for (const [r, c] of [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ]) {
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
        const neighbor = r * BOARD_SIZE + c;
        if (puzzle.regions[neighbor] === id && !visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }
    expect(visited.size, `${context}, region=${id}`).toBe(cells.length);
  }
}

describe(`generator fixed-seed ${fullAudit ? "full audit" : "regression"}`, () => {
  it("uses reproducible bounded random streams and non-mutating permutation shuffles", () => {
    const streams = new Set<string>();
    const source = Array.from({ length: BOARD_SIZE ** 2 }, (_, cell) => cell);
    for (const seed of seeds) {
      const a = createSeededRandom(seed);
      const b = createSeededRandom(seed);
      const values = Array.from({ length: 256 }, () => a.next());
      expect(values).toEqual(Array.from({ length: 256 }, () => b.next()));
      expect(
        values.every(
          (value) => Number.isFinite(value) && value >= 0 && value < 1,
        ),
      ).toBe(true);
      streams.add(JSON.stringify(values));
      const mixed = shuffled(source, createSeededRandom(seed));
      expect([...mixed].sort((x, y) => x - y)).toEqual(source);
      expect(shuffled(source, createSeededRandom(seed))).toEqual(mixed);
      expect(source).toEqual(
        Array.from({ length: BOARD_SIZE ** 2 }, (_, cell) => cell),
      );
    }
    expect(streams.size).toBeGreaterThan(1);
  });
  it.each(difficulties)(
    "validates correctness, reproducibility and diversity for %s",
    (difficulty) => {
      const geometries = new Set<string>();
      const solutions = new Set<string>();
      const shapes = new Set<string>();
      let curatedMatches = 0;
      const ratings: Record<string, number> = {};
      const samples =
        fullAudit && difficulty === "easy"
          ? [
              ...seeds,
              ...Array.from(
                { length: 64 },
                (_, i) => `generator-audit:easy:${i}`,
              ),
            ]
          : seeds;
      const durations: number[] = [];
      for (const seed of samples) {
        const context = `${difficulty}, seed=${JSON.stringify(seed)}`;
        const started = performance.now();
        const generated = generatePuzzleWithAnalysis({ seed, difficulty });
        durations.push(performance.now() - started);
        const { puzzle, analysis } = generated;
        expect(puzzle.size, context).toBe(BOARD_SIZE);
        expect(puzzle.regions.length, context).toBe(BOARD_SIZE ** 2);
        expect(validatePuzzleShape(puzzle), context).toEqual({
          valid: true,
          errors: [],
        });
        expect(validateSolution(puzzle), context).toEqual({
          valid: true,
          errors: [],
        });
        assertConnectedRegions(puzzle, context);
        expect(puzzle.givens?.length ?? 0, context).toBeLessThanOrEqual(1);
        for (const given of puzzle.givens ?? [])
          expect(puzzle.solution, context).toContain(given);
        // 公開初期配置がなくてもRegionだけで唯一解を持つことを独立に確認する。
        const solved = solvePuzzle(
          { ...puzzle, givens: [] },
          { maxSolutions: 2 },
        );
        expect(solved.status, context).toBe("unique");
        expect(
          [...solved.solutions[0]].sort((a, b) => a - b),
          context,
        ).toEqual([...puzzle.solution].sort((a, b) => a - b));
        expect(analysis.solved, context).toBe(true);
        expect(analysis.stalled, context).toBe(false);
        expect(analysis.rating, context).not.toBe("unsupported");
        // 指定難易度と実際の評価が違うフォールバックは仕様上許される。
        ratings[analysis.rating] = (ratings[analysis.rating] ?? 0) + 1;
        expect(
          generatePuzzleWithAnalysis({ seed, difficulty }),
          context,
        ).toEqual(generated);
        geometries.add(geometrySignature(puzzle));
        shapes.add(shapeSignature(puzzle));
        const curated = generatePuzzleWithAnalysis({
          seed,
          difficulty,
          maxAttempts: 0,
        });
        if (geometrySignature(curated.puzzle) === geometrySignature(puzzle))
          curatedMatches++;
        solutions.add(
          JSON.stringify([...puzzle.solution].sort((a, b) => a - b)),
        );
      }
      // 別seedの完全非重複は契約にしないが、常に固定盤面を返す退行は検出する。
      const minimumDiversity = Math.ceil(samples.length * 0.75);
      expect(geometries.size).toBeGreaterThanOrEqual(minimumDiversity);
      expect(shapes.size).toBeGreaterThanOrEqual(minimumDiversity);
      expect(solutions.size).toBeGreaterThanOrEqual(samples.length / 2);
      expect(curatedMatches).toBeLessThanOrEqual(samples.length / 8);
      expect(ratings[difficulty] ?? 0).toBeGreaterThanOrEqual(
        Math.ceil(samples.length * (difficulty === "easy" ? 0.95 : 0.75)),
      );
      durations.sort((a, b) => a - b);
      console.info("generator audit", {
        difficulty,
        samples: samples.length,
        uniqueGeometries: geometries.size,
        duplicateRate: (samples.length - geometries.size) / samples.length,
        uniqueSolutions: solutions.size,
        uniqueShapesIgnoringRotationAndReflection: shapes.size,
        curatedMatches,
        ratings,
        generationMs: {
          median: Math.round(durations[Math.floor(durations.length / 2)]),
          p95: Math.round(durations[Math.floor(durations.length * 0.95)]),
          max: Math.round(durations[durations.length - 1]),
        },
      });
    },
    300000,
  );

  it.each(difficulties)(
    "validates the curated fallback with no random attempts for %s",
    (difficulty) => {
      const generated = generatePuzzleWithAnalysis({
        seed: "audit-curated",
        difficulty,
        maxAttempts: 0,
      });
      expect(validatePuzzleShape(generated.puzzle).valid).toBe(true);
      expect(validateSolution(generated.puzzle).valid).toBe(true);
      assertConnectedRegions(generated.puzzle, difficulty);
      expect(solvePuzzle(generated.puzzle, { maxSolutions: 2 }).status).toBe(
        "unique",
      );
      expect(generated.analysis.solved).toBe(true);
      expect(
        generatePuzzleWithAnalysis({
          seed: "audit-curated",
          difficulty,
          maxAttempts: 0,
        }),
      ).toEqual(generated);
    },
  );
});
