import { describe, expect, it } from "vitest";
import { rememberTutorial, shouldShowTutorial } from "../src/core/tutorial";
import type { KeyValueStorage } from "../src/core/storage";

describe("tutorial visit marker", () => {
  it("shows on first visit and remembers both completion and skipping without changing game data", () => {
    const values = new Map([["tako-sen.current-game.v1", "saved-game"]]);
    const storage: KeyValueStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    expect(shouldShowTutorial(storage)).toBe(true);
    rememberTutorial(storage);
    expect(shouldShowTutorial(storage)).toBe(false);
    expect(values.get("tako-sen.current-game.v1")).toBe("saved-game");
    expect(values.size).toBe(2);
  });

  it("shows again for invalid markers and survives unavailable storage", () => {
    expect(
      shouldShowTutorial({ getItem: () => "invalid", setItem: () => {} }),
    ).toBe(true);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(shouldShowTutorial(blocked)).toBe(true);
    expect(() => rememberTutorial(blocked)).not.toThrow();
  });

  it("shows the interactive version once even when the old tutorial was seen", () => {
    const values = new Map([["tako-sen.tutorial.v1", "seen"]]);
    const storage: KeyValueStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    expect(shouldShowTutorial(storage)).toBe(true);
    rememberTutorial(storage);
    expect(values.get("tako-sen.tutorial.v1")).toBe("seen");
    expect(values.get("tako-sen.tutorial.v2")).toBe("seen");
    expect(shouldShowTutorial(storage)).toBe(false);
  });
});
