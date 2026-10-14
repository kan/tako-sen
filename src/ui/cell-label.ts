import {
  cellCoord,
  getCellViewState,
  type CellViewState,
  type PlayerState,
  type Puzzle,
} from "../core/model";

const VIEW_STATE_NAMES: Record<CellViewState, string> = {
  empty: "空き",
  excluded: "×",
  piece: "タコ",
  "fixed-error": "誤答の×",
};

/**
 * The accessible name of a board cell. `notes` add what the board shows only
 * visually, such as a hint highlight, so a screen reader hears it too.
 */
export function cellLabel(
  puzzle: Pick<Puzzle, "size" | "regions">,
  state: PlayerState,
  index: number,
  notes: readonly string[] = [],
): string {
  const { row, col } = cellCoord(index, puzzle.size);
  return [
    `${row + 1}行${col + 1}列`,
    `エリア${puzzle.regions[index] + 1}`,
    VIEW_STATE_NAMES[getCellViewState(state, index)],
    ...notes,
  ].join("、");
}
