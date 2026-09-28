import { describe, expect, it } from "vitest";
import { cellIndex, isAdjacent } from "../src/core/model";
import { tutorialDiagramCells } from "../src/ui/tutorial-diagrams";

describe("tutorial board illustrations", () => {
  it("shows two nonadjacent octopuses in distinct rows, columns and regions on the rules page", () => {
    const cells = tutorialDiagramCells("rules", true);
    const pieces = cells.filter((cell) => cell.mark === "piece");
    expect(pieces.map((cell) => cell.index)).toEqual([1, 11]);
    expect(new Set(pieces.map((cell) => cell.row)).size).toBe(2);
    expect(new Set(pieces.map((cell) => cell.col)).size).toBe(2);
    expect(new Set(pieces.map((cell) => cell.region)).size).toBe(2);
    expect(isAdjacent(pieces[0].index, pieces[1].index)).toBe(false);
    expect(cells.find((cell) => cell.index === cellIndex(3, 0))?.mark).toBe(
      "excluded",
    );
    expect(cells.find((cell) => cell.index === cellIndex(2, 4))?.mark).toBe(
      "excluded",
    );
    expect(cells.find((cell) => cell.index === cellIndex(3, 5))?.mark).toBe(
      "candidate",
    );
    expect(cells.some((cell) => cell.added)).toBe(false);
  });
  it("crops an 8×8 board without changing its cell identifiers", () => {
    const cells = tutorialDiagramCells("piece", false);
    expect(cells).toHaveLength(24);
    expect(cells.map((cell) => cell.index)).toEqual([
      0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21, 24, 25,
      26, 27, 28, 29,
    ]);
    expect(
      cells.filter((cell) => cell.mark === "piece").map((cell) => cell.index),
    ).toEqual([cellIndex(1, 3)]);
    expect(cells.filter((cell) => cell.mark === "excluded")).toHaveLength(0);
  });

  it("shows row, column, region and diagonal adjacency exclusions but allows distant diagonals", () => {
    const cells = tutorialDiagramCells("piece", true);
    const at = (row: number, col: number) =>
      cells.find((cell) => cell.index === cellIndex(row, col))!;
    for (const [row, col] of [
      [1, 0],
      [3, 3],
      [3, 2],
      [0, 4],
      [2, 4],
    ]) {
      expect(at(row, col)).toMatchObject({ mark: "excluded", added: true });
    }
    expect(at(1, 3)).toMatchObject({ mark: "piece", added: false });
    expect(at(3, 5)).toMatchObject({ mark: "candidate", added: false });
    expect(at(0, 0)).toMatchObject({ mark: "candidate", added: false });
    expect(at(0, 1).borderRight).toBe(true);
    expect(at(0, 2).borderRight).toBe(false);
  });

  it("leaves both line candidates undecided while marking only other regions on that row", () => {
    const before = tutorialDiagramCells("line", false);
    const after = tutorialDiagramCells("line", true);
    expect(
      before
        .filter((cell) => cell.mark === "candidate")
        .map((cell) => cell.index),
    ).toEqual([10, 11]);
    expect(
      after
        .filter((cell) => cell.mark === "candidate")
        .map((cell) => cell.index),
    ).toEqual([10, 11]);
    expect(
      before
        .filter((cell) => cell.mark === "excluded")
        .map((cell) => cell.index),
    ).toEqual([2, 3, 18, 19, 26, 27]);
    expect(
      after.filter((cell) => cell.added).map((cell) => cell.index),
    ).toEqual([8, 9, 12, 13]);
    expect(after.filter((cell) => cell.mark === "piece")).toHaveLength(0);
    expect(tutorialDiagramCells("line", false)).toEqual(before);
  });
});
