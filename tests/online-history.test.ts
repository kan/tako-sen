import { describe, expect, it } from "vitest";
import { generatePuzzle } from "../src/core/generator";
import {
  createCompletedPlayUpload,
  verifyCompletedPlayUpload,
} from "../src/core/online-history";
import { encodePuzzleSeed } from "../src/core/puzzle-code";
import type { PlayResult } from "../src/core/results";

const puzzle = generatePuzzle({ seed: "online-history", difficulty: "easy" });
const completed: PlayResult = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  userId: "local-anonymous-id",
  seedCode: encodePuzzleSeed(puzzle),
  generatorVersion: puzzle.generatorVersion ?? "g1",
  difficulty: puzzle.difficulty ?? "easy",
  startedAt: 1000,
  completedAt: 61000,
  elapsedSeconds: 60,
  mistakes: 1,
  hintsUsed: 2,
  status: "completed",
};

describe("online history contract", () => {
  it("builds a verified upload without the local anonymous user id", async () => {
    const upload = await createCompletedPlayUpload(completed);
    expect(upload.playId).toBe(completed.id);
    expect(upload.puzzleId).toMatch(/^p1:[0-9a-f]{64}$/);
    expect(upload).not.toHaveProperty("userId");
    expect(await verifyCompletedPlayUpload(upload)).toEqual(upload);
  });

  it("rejects incomplete, inconsistent, and tampered results", async () => {
    await expect(
      createCompletedPlayUpload({ ...completed, status: "in-progress" }),
    ).rejects.toThrow("Invalid completed play");
    await expect(
      createCompletedPlayUpload({ ...completed, completedAt: 999 }),
    ).rejects.toThrow("Invalid completed play");
    await expect(
      createCompletedPlayUpload({ ...completed, generatorVersion: "g2" }),
    ).rejects.toThrow("Invalid puzzle seed code");
    const upload = await createCompletedPlayUpload(completed);
    await expect(
      verifyCompletedPlayUpload({ ...upload, puzzleId: "p1:wrong" }),
    ).rejects.toThrow("Puzzle ID does not match");
    await expect(
      verifyCompletedPlayUpload({ ...upload, elapsedSeconds: -1 }),
    ).rejects.toThrow("Invalid completed play");
  });
});
