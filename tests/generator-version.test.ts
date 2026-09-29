import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generatePuzzle,
  generatePuzzleWithAnalysis,
} from "../src/core/generator";
import { encodePuzzleSeed, parsePuzzleSeedCode } from "../src/core/puzzle-code";
import {
  createSharedPuzzleSnapshot,
  restoreSharedPuzzleSnapshot,
} from "../src/core/shared-puzzle";
import {
  createCompletedPlayUpload,
  verifyCompletedPlayUpload,
} from "../src/core/online-history";
import { puzzleId } from "../src/core/puzzle-identity";

const legacySamples = [
  [
    "easy",
    "restore-seed",
    "06fbefe10c5ffeb87f944267e86d4ae95a4fae4f26ea7663f93fc86f86548bd4",
  ],
  [
    "easy",
    "タコ🐙",
    "18be598083a4521a88e1025bff2e2ae9af17727332034b32b6fc290519489784",
  ],
  [
    "easy",
    "generator-audit:0",
    "1dcb5bd36d22c27b507d813b0ac557c389c77b533045cb8fad52af3ffcc0ec3a",
  ],
  [
    "normal",
    "restore-seed",
    "bd80887a109188de60817948fe94bf7aa0d71cd615e585dc3ca5d30f17606fbc",
  ],
  [
    "normal",
    "タコ🐙",
    "90a8b0ba3e257da8ccd138edff1affe573c20e42cea945a49ebede4a3a9e7b64",
  ],
  [
    "normal",
    "generator-audit:0",
    "06ce51583d1abbf1ce763e3d39ce81317e77e8b7808d7ddf7ba5830a15cc308a",
  ],
  [
    "hard",
    "restore-seed",
    "45b79a7f1ae1bd4d84e652088050002f64c9e9ad0c2ec060c8d91aabe3006500",
  ],
  [
    "hard",
    "タコ🐙",
    "75c43427d85e7a3a33d0509e19565815397c5a1fdd324ddfbcbe8a255be62a51",
  ],
  [
    "hard",
    "generator-audit:0",
    "3edcae479b025f43f58440fd1584795b50fdc82d15464c1d0ac2b1b14a6b5d09",
  ],
] as const;

describe("versioned puzzle generation", () => {
  it.each(legacySamples)(
    "keeps frozen g1 %s seed %s",
    (difficulty, seed, hash) => {
      const puzzle = generatePuzzle({ version: "g1", difficulty, seed });
      expect(
        createHash("sha256").update(JSON.stringify(puzzle)).digest("hex"),
      ).toBe(hash);
      const code = parsePuzzleSeedCode(encodePuzzleSeed(puzzle))!;
      expect(
        generatePuzzle({
          version: code.version,
          seed: code.seed,
          difficulty: code.difficulty,
        }),
      ).toEqual(puzzle);
    },
  );

  it.each(["g1", "g2"])(
    "preserves %s through sharing and result verification",
    async (version) => {
      const puzzle = generatePuzzle({
        version,
        seed: "version-contract",
        difficulty: "normal",
      });
      const seedCode = encodePuzzleSeed(puzzle);
      const snapshot = await createSharedPuzzleSnapshot(seedCode);
      expect(snapshot.generatorVersion).toBe(version);
      expect(snapshot.id).toBe(await puzzleId(puzzle));
      const restored = await restoreSharedPuzzleSnapshot(snapshot);
      expect(restored.regions).toEqual(puzzle.regions);
      expect(restored.generatorVersion).toBe(version);
      const upload = await createCompletedPlayUpload({
        id: "550e8400-e29b-41d4-a716-446655440000",
        userId: "local",
        seedCode,
        generatorVersion: version,
        difficulty: "normal",
        startedAt: 0,
        completedAt: 1000,
        elapsedSeconds: 1,
        hintsUsed: 0,
        mistakes: 0,
        status: "completed",
      });
      expect(upload.puzzleId).toBe(snapshot.id);
      expect(await verifyCompletedPlayUpload(upload)).toEqual(upload);
    },
    30000,
  );

  it("defaults to g2, retains implicit legacy encoding and rejects unsupported versions", () => {
    expect(generatePuzzle({ seed: "version-default" }).generatorVersion).toBe(
      "g2",
    );
    expect(encodePuzzleSeed({ seed: "old", difficulty: "easy" })).toBe(
      "TAKO:g1:easy:old",
    );
    expect(parsePuzzleSeedCode("TAKO:g99:easy:test")).toBeUndefined();
    expect(() => generatePuzzle({ version: "g99" })).toThrow(
      "Unsupported generator version",
    );
    for (const maxAttempts of [-1, 0.5, NaN, Infinity]) {
      expect(() => generatePuzzleWithAnalysis({ maxAttempts })).toThrow(
        "maxAttempts",
      );
    }
  });
});
