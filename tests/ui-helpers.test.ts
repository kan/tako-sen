import { describe, expect, it } from "vitest";
import { generatePuzzle } from "../src/core/generator";
import { createInitialPlayerState } from "../src/core/model";
import { cellLabel } from "../src/ui/cell-label";
import {
  answerConfirm,
  askConfirm,
  pendingConfirm,
} from "../src/ui/confirm-dialog";
import {
  SuperConnectionError,
  SuperNotice,
  superNoticeText,
} from "../src/ui/super-connection";

describe("cell accessible names", () => {
  const puzzle = generatePuzzle({ seed: "cell-label" });

  it("reads the position, the area and the state in Japanese, then any notes", () => {
    const state = {
      ...createInitialPlayerState(),
      excluded: new Set([1]),
      pieces: new Set([2]),
      fixedErrors: new Set([3]),
    };
    const area = (index: number) => puzzle.regions[index] + 1;
    expect(cellLabel(puzzle, state, 0)).toBe(`1行1列、エリア${area(0)}、空き`);
    expect(cellLabel(puzzle, state, 1)).toBe(`1行2列、エリア${area(1)}、×`);
    expect(cellLabel(puzzle, state, 2)).toBe(`1行3列、エリア${area(2)}、タコ`);
    expect(cellLabel(puzzle, state, 3)).toBe(
      `1行4列、エリア${area(3)}、誤答の×`,
    );
    expect(cellLabel(puzzle, state, 0, ["ヒント注目", "×候補"])).toBe(
      `1行1列、エリア${area(0)}、空き、ヒント注目、×候補`,
    );
  });
});

describe("confirm dialog requests", () => {
  const request = { title: "t", message: "m", confirmLabel: "ok" };

  it("resolves with the answer and clears the question", async () => {
    const answer = askConfirm(request);
    expect(pendingConfirm.value?.title).toBe("t");
    answerConfirm(true);
    await expect(answer).resolves.toBe(true);
    expect(pendingConfirm.value).toBeUndefined();
  });

  it("cancels a question still open when a new one arrives", async () => {
    const first = askConfirm(request);
    const second = askConfirm({ ...request, title: "second" });
    await expect(first).resolves.toBe(false);
    expect(pendingConfirm.value?.title).toBe("second");
    answerConfirm(false);
    await expect(second).resolves.toBe(false);
  });
});

describe("super failure text", () => {
  it("shows only messages written for the player", () => {
    const fallback = "もう一度お試しください。";
    expect(superNoticeText(new SuperNotice("日本語の案内"), fallback)).toBe(
      "日本語の案内",
    );
    expect(superNoticeText(new SuperConnectionError("network"), fallback)).toBe(
      new SuperConnectionError("network").message,
    );
    expect(superNoticeText(new Error("Invalid shared puzzle."), fallback)).toBe(
      fallback,
    );
    expect(superNoticeText(new SyntaxError("JSON"), fallback)).toBe(fallback);
  });
});
