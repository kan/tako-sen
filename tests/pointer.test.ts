import { describe, expect, it } from "vitest";
import { cellIndexAtPoint } from "../src/ui/pointer";

describe("coordinate-based cell hit testing", () => {
  const bounds = { left: 14, top: 104, width: 320, height: 320 };
  it("selects the touched row and column with an offset/scrolled board", () => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        expect(cellIndexAtPoint(34 + col * 40, 124 + row * 40, bounds, 8)).toBe(
          row * 8 + col,
        );
      }
    }
  });
  it("uses actual CSS pixel dimensions for a fractional 10 by 10 board", () => {
    expect(
      cellIndexAtPoint(
        10 + 9.5 * 31.25,
        20 + 5.5 * 31.25,
        { left: 10, top: 20, width: 312.5, height: 312.5 },
        10,
      ),
    ).toBe(59);
  });
  it("rejects the border and points outside the playable area", () => {
    for (const [x, y] of [
      [13, 124],
      [34, 103],
      [334, 124],
      [34, 424],
    ]) {
      expect(cellIndexAtPoint(x, y, bounds, 8)).toBeUndefined();
    }
    expect(cellIndexAtPoint(14, 104, bounds, 8)).toBe(0);
    expect(
      cellIndexAtPoint(34, 124, { ...bounds, width: 0 }, 8),
    ).toBeUndefined();
  });
});
