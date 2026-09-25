import { describe, expect, it } from "vitest";
import {
  createSharedPuzzleSnapshot,
  restoreSharedPuzzleSnapshot,
} from "../src/core/shared-puzzle";
import { puzzleId } from "../src/core/puzzle-identity";

describe("shared puzzle snapshots", () => {
  it("restores a uniquely solved puzzle without publishing the solution", async () => {
    const snapshot = await createSharedPuzzleSnapshot(
      "TAKO:g1:easy:shared-puzzle-test",
    );
    expect("solution" in snapshot).toBe(false);
    const restored = await restoreSharedPuzzleSnapshot(snapshot);
    expect(await puzzleId(restored)).toBe(snapshot.id);
    expect(restored.regions).toEqual(snapshot.regions);
    expect(restored.givens).toEqual(snapshot.givens);
    const oldVersionPuzzle = { ...restored, generatorVersion: "g-older" };
    const oldVersionSnapshot = {
      ...snapshot,
      generatorVersion: "g-older",
      id: await puzzleId(oldVersionPuzzle),
    };
    await expect(
      restoreSharedPuzzleSnapshot(oldVersionSnapshot),
    ).resolves.toMatchObject({ generatorVersion: "g-older" });
  });

  it("rejects tampered and invalid snapshots", async () => {
    const snapshot = await createSharedPuzzleSnapshot(
      "TAKO:g1:normal:shared-puzzle-tamper",
    );
    await expect(
      restoreSharedPuzzleSnapshot({ ...snapshot, id: `p1:${"0".repeat(64)}` }),
    ).rejects.toThrow();
    await expect(
      restoreSharedPuzzleSnapshot({ ...snapshot, regions: [] }),
    ).rejects.toThrow();
    await expect(
      restoreSharedPuzzleSnapshot({ ...snapshot, givens: [999] }),
    ).rejects.toThrow();
    await expect(
      createSharedPuzzleSnapshot("TAKO:g2:easy:old"),
    ).rejects.toThrow();
  });
});
