import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GENERATOR_VERSIONS,
  generatePuzzle,
  generatePuzzleWithAnalysis,
} from "../src/core/generator";
import type { PuzzleDifficulty } from "../src/core/model";
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

// 版ごとの盤面は問題ID・共有リンク・ランキングの同一性の元になる。生成器や
// ソルバ、難易度解析を変えても、公開済みの版の盤面が変わらないことを固定する。
// キーは「版 難易度 seed」、値は盤面のJSONのSHA-256。
const frozenBoards: Record<string, string> = {
  "g1 easy restore-seed":
    "06fbefe10c5ffeb87f944267e86d4ae95a4fae4f26ea7663f93fc86f86548bd4",
  "g1 easy タコ🐙":
    "18be598083a4521a88e1025bff2e2ae9af17727332034b32b6fc290519489784",
  "g1 easy generator-audit:0":
    "1dcb5bd36d22c27b507d813b0ac557c389c77b533045cb8fad52af3ffcc0ec3a",
  "g1 normal restore-seed":
    "bd80887a109188de60817948fe94bf7aa0d71cd615e585dc3ca5d30f17606fbc",
  "g1 normal タコ🐙":
    "90a8b0ba3e257da8ccd138edff1affe573c20e42cea945a49ebede4a3a9e7b64",
  "g1 normal generator-audit:0":
    "06ce51583d1abbf1ce763e3d39ce81317e77e8b7808d7ddf7ba5830a15cc308a",
  "g1 hard restore-seed":
    "45b79a7f1ae1bd4d84e652088050002f64c9e9ad0c2ec060c8d91aabe3006500",
  "g1 hard タコ🐙":
    "75c43427d85e7a3a33d0509e19565815397c5a1fdd324ddfbcbe8a255be62a51",
  "g1 hard generator-audit:0":
    "3edcae479b025f43f58440fd1584795b50fdc82d15464c1d0ac2b1b14a6b5d09",
  "g2 easy restore-seed":
    "5f91c383d76602f7b1758681ee48dfa5b82668e0b0be4749abbb6f5877be214c",
  "g2 easy タコ🐙":
    "ec442e0573e64a78eb87e6d8a32122c1316d22f8bddd5bf0aab95f7bd60a002f",
  "g2 easy generator-audit:0":
    "62a34a0db2856d4c2499e9f0c2d7a9b6e2a9c9074a3c5a5d9ff70813cd78739f",
  "g2 normal restore-seed":
    "8060a2663b382330ec648377757e836da26f83364fdf841ff6f0c664bf4d5460",
  "g2 normal タコ🐙":
    "262dee6f1a245e44342a1bdba7419e11a9eb53f8e48bccdac0b3d3f76c5b412b",
  "g2 normal generator-audit:0":
    "9ae7b9d797428dbfdaa777cc8d21dd3e5a049e3d364cd45cfe5cd76fa13d63f5",
  "g2 hard restore-seed":
    "a9ba1c1e6c86ea5870f59a835455e727dd72765e38598a1b3baf552993a5caf2",
  "g2 hard タコ🐙":
    "e3d9256b050534a64690794c865f6bf840dbb6aa4280aed643d6e2a6d51e239a",
  "g2 hard generator-audit:0":
    "abafc64a7f1361ef26a1b6e90acaea64d41c56e39488e3c170889fd23d0fc29b",
  "g3 easy restore-seed":
    "6e2cc48d024c43a3142f25eeed68aafae017dbfe7b43ba2fb7d20af0e68aba2a",
  "g3 easy タコ🐙":
    "d026266d244103ec1c046530c6f4c17f0b0ccdce76b3454a995a71441f578b6a",
  "g3 easy generator-audit:0":
    "6d5102e4cb3aa094a0203f2149537ad16d4402289c4c34ad2de92aca6482c61b",
  "g3 normal restore-seed":
    "a0a4cd5a053cb7608e20dc48e1d5b24983a0e650c4a347505171696a19a5013e",
  "g3 normal タコ🐙":
    "3371a2c211efd2c177b53b8ed6d7d6ed25e9a3af79e986817e83fa090653e3bf",
  "g3 normal generator-audit:0":
    "7fd3676574b31dc68cfe4fa52a29450beb3c6ee2345be6b57fb9e7cce5508825",
  "g3 hard restore-seed":
    "390b22312dc823137071339cdc8371098eb91ddd80f92edb6fc816a177dea424",
  "g3 hard タコ🐙":
    "e95d5d216c41bd7bc3ca7fa9c43e6660d31c45fd1d2b79960819c3a2b74c0344",
  "g3 hard generator-audit:0":
    "91f9c4b9100ff7280af5a2be1da5324c388614b6847c4c9d069f5774b2c31470",
  "g4 easy restore-seed":
    "546b80c62dfb92cabe54199dfba8c11dcfb119f651dcd45eddc9a1db3f4bfc48",
  "g4 easy タコ🐙":
    "e66382fb1ca2f1e5c4e51b04ab526bfc9f8bc8ff1c60157683b7fc79ca4607b1",
  "g4 easy generator-audit:0":
    "5a36170df8060ec6e0a716d546c54dd3358e7e41912a619966f2ad123a1046e2",
  "g4 normal restore-seed":
    "5128090ba5c97e4f90d633bea74fa94d76f3116741d2b46b8f2261915a10e0e9",
  "g4 normal タコ🐙":
    "e89e9bd1d8474d683ecc917b1b0d1b5119ca66aa68919069b4291caa136e8ec9",
  "g4 normal generator-audit:0":
    "6095fe5c1dcae91e6900c1d86f24140e4f198ff2adb3f7b833dfe75e2156622b",
  "g4 hard restore-seed":
    "8141a08b64a1301acf3e10e2f76fb8882942145a76ec5ff7f7b117128a020e6f",
  "g4 hard タコ🐙":
    "b2e34ece6b3ca9c24961379a8078300b5132a4465ee292374b8c2837cfa58756",
  "g4 hard generator-audit:0":
    "90dab15a3b7662b4593c1e79d4d23802241dde301e3183d39648f34b8e23be51",
};

describe("versioned puzzle generation", () => {
  it("freezes boards of every supported version", () => {
    const frozen = new Set(
      Object.keys(frozenBoards).map((key) => key.split(" ")[0]),
    );
    expect([...frozen].sort()).toEqual([...GENERATOR_VERSIONS].sort());
  });

  it.each(Object.entries(frozenBoards))("keeps frozen %s", (key, hash) => {
    const [version, difficulty, seed] = key.split(" ");
    const puzzle = generatePuzzle({
      version,
      difficulty: difficulty as PuzzleDifficulty,
      seed,
    });
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
  });

  it.each(GENERATOR_VERSIONS)(
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
      // 保存したシードコードは接頭辞で版を絞るので、前後に空白があるものは受けない。
      await expect(
        verifyCompletedPlayUpload({ ...upload, seedCode: ` ${seedCode}` }),
      ).rejects.toThrow();
    },
    30000,
  );

  it("defaults to g4, retains implicit legacy encoding and rejects unsupported versions", () => {
    expect(generatePuzzle({ seed: "version-default" }).generatorVersion).toBe(
      "g4",
    );
    expect(encodePuzzleSeed({ seed: "old", difficulty: "easy" })).toBe(
      "TAKO:g1:easy:old",
    );
    expect(parsePuzzleSeedCode("TAKO:g99:easy:test")).toBeUndefined();
    expect(parsePuzzleSeedCode("TAKO:toString:easy:test")).toBeUndefined();
    expect(() => generatePuzzle({ version: "g99" })).toThrow(
      "Unsupported generator version",
    );
    for (const maxAttempts of [-1, 0.5, NaN, Infinity]) {
      expect(() =>
        generatePuzzleWithAnalysis({ version: "g2", maxAttempts }),
      ).toThrow("maxAttempts");
    }
    // g3以降はシードコードだけで盤面が決まるよう、試行回数の指定を読まない。
    const seeded = { seed: "attempts-ignored", difficulty: "hard" } as const;
    expect(generatePuzzle({ ...seeded, maxAttempts: 0 })).toEqual(
      generatePuzzle(seeded),
    );
  });
});
