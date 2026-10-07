import { describe, expect, it } from "vitest";
import { createTutorialLesson } from "../src/core/interactive-tutorial";
import { validateSolution } from "../src/core/rules";
import { solvePuzzle } from "../src/core/solver";

describe("interactive tutorial lesson", () => {
  it("uses a fixed valid beginner puzzle with deductions for every guided mark", () => {
    const lesson = createTutorialLesson();
    expect(validateSolution(lesson.puzzle).valid).toBe(true);
    expect(solvePuzzle(lesson.puzzle, { maxSolutions: 2 }).status).toBe(
      "unique",
    );
    expect(lesson.puzzle.solution).toContain(lesson.firstPiece);
    expect(lesson.puzzle.givens).not.toContain(lesson.firstPiece);
    expect(lesson.dragTargets).toHaveLength(3);
    for (const target of lesson.dragTargets) {
      expect(lesson.dragReason.excludeCells).toContain(target);
      expect(lesson.puzzle.solution).not.toContain(target);
    }
    expect(lesson.reasoningMove.excludeCells).toContain(lesson.reasoningTarget);
    expect(lesson.puzzle.solution).not.toContain(lesson.reasoningTarget);
    expect(createTutorialLesson()).toEqual(lesson);
  });
});
