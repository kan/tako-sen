import { describe, expect, it } from "vitest";
import {
  loadDifficultySelection,
  saveDifficultySelection,
} from "../src/core/settings";

describe("difficulty selection preference", () => {
  it.each(["easy", "normal", "hard", "random"] as const)(
    "persists %s independently of the current puzzle",
    (selection) => {
      const data = new Map([["game", "unchanged"]]);
      const storage = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
      };
      expect(saveDifficultySelection(storage, selection)).toBe(true);
      expect(loadDifficultySelection(storage, "normal")).toBe(selection);
      expect(data.get("game")).toBe("unchanged");
    },
  );

  it.each([null, "", "super", "RANDOM", '"random"'])(
    "uses the legacy puzzle difficulty for missing or invalid settings: %s",
    (value) => {
      const storage = { getItem: () => value, setItem: () => {} };
      expect(loadDifficultySelection(storage, "hard")).toBe("hard");
      expect(loadDifficultySelection(storage)).toBe("easy");
    },
  );

  it("keeps storage failures from blocking play", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadDifficultySelection(storage, "normal")).toBe("normal");
    expect(saveDifficultySelection(storage, "random")).toBe(false);
  });
});
