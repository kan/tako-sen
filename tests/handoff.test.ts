import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyHandoffSettings,
  parseHandoff,
  transferLink,
} from "../src/core/handoff";
import {
  loadAutoExclusionsEnabled,
  loadDifficultySelection,
} from "../src/core/settings";
import { shouldShowTutorial } from "../src/core/tutorial";

const TOKEN = "A".repeat(42) + "_";

function memoryStorage(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("the handoff from the old URL", () => {
  it("reads the token and every setting", () => {
    expect(
      parseHandoff(
        `#migration=${TOKEN}&auto=1&difficulty=random&sound=0&haptics=1&tutorial=seen`,
      ),
    ).toEqual({
      migrationToken: TOKEN,
      settings: {
        autoExclusions: true,
        difficulty: "random",
        sound: false,
        haptics: true,
        tutorialSeen: true,
      },
    });
  });

  it("ignores parts that do not parse, and fragments with none", () => {
    expect(
      parseHandoff("#migration=short&auto=yes&difficulty=extreme&sound=1"),
    ).toEqual({
      migrationToken: undefined,
      settings: {
        autoExclusions: undefined,
        difficulty: undefined,
        sound: true,
        haptics: undefined,
        tutorialSeen: undefined,
      },
    });
    expect(parseHandoff("")).toBeUndefined();
    expect(parseHandoff("#section-2")).toBeUndefined();
    // A damaged token is still a handoff, so it is cleared from the address.
    expect(parseHandoff("#migration=短い")?.migrationToken).toBeUndefined();
    expect(parseHandoff("#migration=短い")).toBeDefined();
  });

  it("reads the transfer code a QR code carries", () => {
    const link = transferLink("https://tako.kan-game.app", "ABCD2345");
    expect(link).toBe("https://tako.kan-game.app/#transfer=ABCD2345");
    expect(parseHandoff(new URL(link).hash)?.transferCode).toBe("ABCD2345");
    // A reader that lowercased the address still works.
    expect(parseHandoff("#transfer=abcd2345")?.transferCode).toBe("ABCD2345");
    // Not a code (0, O, 1 and I are never used): cleared, not offered.
    const damaged = parseHandoff("#transfer=ABCD0123");
    expect(damaged).toBeDefined();
    expect(damaged?.transferCode).toBeUndefined();
  });

  it("stores settings in the form the loaders read", () => {
    const storage = memoryStorage();
    applyHandoffSettings(
      storage,
      parseHandoff("#auto=1&difficulty=hard&sound=1&haptics=0&tutorial=seen")!
        .settings,
    );
    expect(loadAutoExclusionsEnabled(storage)).toBe(true);
    expect(loadDifficultySelection(storage)).toBe("hard");
    expect(storage.data.get("tako-sen:sound-enabled")).toBe("1");
    expect(storage.data.get("tako-sen:haptics-enabled")).toBe("0");
    expect(shouldShowTutorial(storage)).toBe(false);
  });

  it("keeps a setting already chosen on this device", () => {
    const storage = memoryStorage({
      "tako-sen:difficulty-selection": "easy",
      "tako-sen:sound-enabled": "0",
    });
    applyHandoffSettings(storage, {
      difficulty: "hard",
      sound: true,
      autoExclusions: true,
    });
    expect(loadDifficultySelection(storage)).toBe("easy");
    expect(storage.data.get("tako-sen:sound-enabled")).toBe("0");
    expect(loadAutoExclusionsEnabled(storage)).toBe(true);
  });

  it("carries on when storage refuses", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() =>
      applyHandoffSettings(storage, { sound: true, tutorialSeen: true }),
    ).not.toThrow();
  });
});

describe("the migration offer", () => {
  const ID = "33333333-3333-4333-8333-333333333333";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("switches the ID only after the player agrees", async () => {
    const migration = await import("../src/ui/migration");
    const auth = await import("../src/ui/auth");
    migration.offerMigration(TOKEN);
    expect(migration.migrationOffer.value).toEqual({
      state: "asking",
      kind: "migration",
      secret: TOKEN,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(Response.json({ id: ID, name: "昔のタコ" }));
    await migration.acceptMigration();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/id/migration/redeem",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: TOKEN }),
      }),
    );
    expect(migration.migrationOffer.value).toEqual({
      state: "done",
      kind: "migration",
    });
    expect(auth.useId().id.value).toBe(ID);
    migration.closeMigration();
    expect(migration.migrationOffer.value).toBeUndefined();
  });

  it("lets the player try again after a lost connection", async () => {
    const migration = await import("../src/ui/migration");
    migration.offerMigration(TOKEN);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await migration.acceptMigration();
    expect(migration.migrationOffer.value?.state).toBe("failed");
    fetchMock.mockResolvedValue(Response.json({ id: ID, name: null }));
    await migration.acceptMigration();
    expect(migration.migrationOffer.value).toEqual({
      state: "done",
      kind: "migration",
    });
  });

  it("explains a refused token and does not send it again", async () => {
    const migration = await import("../src/ui/migration");
    migration.offerMigration(TOKEN);
    fetchMock.mockResolvedValue(
      Response.json({ error: "invalid_code" }, { status: 400 }),
    );
    await migration.acceptMigration();
    const refused = migration.migrationOffer.value;
    expect(refused?.state).toBe("refused");
    expect(refused && "message" in refused && refused.message).toContain(
      "期限が切れている",
    );
    await migration.acceptMigration();
    expect(fetchMock).toHaveBeenCalledOnce();
    migration.closeMigration();
    expect(migration.migrationOffer.value).toBeUndefined();
  });

  it("cannot be closed while the switch is under way", async () => {
    const migration = await import("../src/ui/migration");
    migration.offerMigration(TOKEN);
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const accepting = migration.acceptMigration();
    migration.closeMigration();
    expect(migration.migrationOffer.value).toEqual({
      state: "working",
      kind: "migration",
    });
    finish(Response.json({ id: ID, name: null }));
    await accepting;
    expect(migration.migrationOffer.value).toEqual({
      state: "done",
      kind: "migration",
    });
  });

  it("switches to the ID of another device's QR code after the player agrees", async () => {
    const migration = await import("../src/ui/migration");
    const auth = await import("../src/ui/auth");
    migration.offerTransfer("ABCD2345");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(Response.json({ id: ID, name: "タコ" }));
    await migration.acceptMigration();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/id/transfer-codes/redeem",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "ABCD2345" }),
      }),
    );
    expect(migration.migrationOffer.value).toEqual({
      state: "done",
      kind: "transfer",
    });
    expect(auth.useId().id.value).toBe(ID);
  });

  it("keeps a switch under way when another link arrives", async () => {
    const migration = await import("../src/ui/migration");
    migration.offerTransfer("ABCD2345");
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const accepting = migration.acceptMigration();
    migration.offerTransfer("WXYZ6789");
    expect(migration.migrationOffer.value).toEqual({
      state: "working",
      kind: "transfer",
    });
    finish(Response.json({ id: ID, name: null }));
    await accepting;
    expect(migration.migrationOffer.value).toEqual({
      state: "done",
      kind: "transfer",
    });
  });

  it("explains a used or expired QR code", async () => {
    const migration = await import("../src/ui/migration");
    migration.offerTransfer("ABCD2345");
    fetchMock.mockResolvedValue(
      Response.json({ error: "invalid_code" }, { status: 400 }),
    );
    await migration.acceptMigration();
    const refused = migration.migrationOffer.value;
    expect(refused?.state).toBe("refused");
    expect(refused && "message" in refused && refused.message).toContain(
      "QR コードは使えません",
    );
  });
});
