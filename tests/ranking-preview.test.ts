import { describe, expect, it } from "vitest";
import { rankingPreview } from "../src/ui/ranking-preview";

describe("ranking preview", () => {
  const entries = [1, 2, 3, 4, 5];
  it.each([
    [1, [1, 2, 3]],
    [3, [2, 3, 4]],
    [5, [3, 4, 5]],
  ])("shows self and neighboring entries for position %s", (self, expected) => {
    expect(rankingPreview(entries, (entry) => entry === self)).toEqual(
      expected,
    );
  });
  it("handles fewer than three people without inventing entries", () => {
    expect(rankingPreview([1, 2], (entry) => entry === 2)).toEqual([1, 2]);
    expect(rankingPreview([1], () => true)).toEqual([1]);
  });
  it("does not substitute leaders when self is missing or outside the fetched range", () => {
    expect(rankingPreview(entries, () => false)).toEqual([]);
    expect(rankingPreview([], () => true)).toEqual([]);
  });
  it("keeps supplied ordering and tied ranks intact", () => {
    const tied = [{ rank: 1 }, { rank: 1 }, { rank: 3 }, { rank: 4 }];
    expect(rankingPreview(tied, (entry) => entry === tied[1])).toEqual(
      tied.slice(0, 3),
    );
    expect(tied).toHaveLength(4);
  });
});
