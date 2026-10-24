import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { ACHIEVEMENTS, achievementDefinition } from "../src/core/achievements";
import {
  achievementIcon,
  completeTutorial,
  markAchievementSeen,
  parseAchievementList,
  reportUnlocks,
  seenAchievements,
  startTutorialAchievementSync,
  unlockSummaries,
} from "../src/ui/achievements";

const account = vi.hoisted(() => ({
  id: null as { value: string | null } | null,
}));
// この端末の ID だけを差し替える。送信は本物の apiFetch から、下の fetch のスタブへ行く。
vi.mock("../src/ui/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ui/auth")>();
  const { ref } = await import("vue");
  const id = ref<string | null>(null);
  account.id = id;
  return {
    ...actual,
    useId: () => ({ id, name: ref(null), status: ref("ready") }),
  };
});

let data: Map<string, string>;
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  account.id!.value = null;
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  request = vi.fn(async () => Response.json({ newAchievements: [] }));
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("achievement icons", () => {
  it("has one icon for every achievement and the secret one", () => {
    const files = readdirSync(
      new URL("../src/assets/achievements/", import.meta.url),
    ).filter((file) => file.endsWith(".svg"));
    const ids = [...ACHIEVEMENTS.map((item) => item.id), "secret"];
    expect(files.sort()).toEqual(ids.map((id) => `${id}.svg`).sort());
    for (const id of ids) expect(achievementIcon(id)).not.toBe("");
  });
});

describe("achievement list response", () => {
  it("keeps known ids in definition order and fills the missing ones", () => {
    const list = parseAchievementList({
      achievements: [
        { id: "clear_10", unlockedAt: null, progress: 3 },
        { id: "removed", unlockedAt: 1, progress: null },
        { id: "clear_first", unlockedAt: 5, progress: 1 },
      ],
    });
    expect(list?.map((item) => item.definition)).toEqual(ACHIEVEMENTS);
    expect(list?.[0]).toMatchObject({ unlockedAt: null, progress: null });
    expect(
      list?.find((item) => item.definition.id === "clear_first"),
    ).toMatchObject({ unlockedAt: 5, progress: 1 });
  });

  it("refuses a response of another shape", () => {
    expect(parseAchievementList(null)).toBeNull();
    expect(parseAchievementList({ achievements: {} })).toBeNull();
    expect(
      parseAchievementList({
        achievements: [{ id: "clear_10", unlockedAt: "today", progress: 1 }],
      }),
    ).toBeNull();
  });
});

describe("unlocks reported by completions", () => {
  it("keeps known ids per play and merges repeats", () => {
    reportUnlocks("play-a", { newAchievements: ["clear_first", "unknown"] });
    reportUnlocks("play-a", { newAchievements: ["clear_first", "no_mistake"] });
    reportUnlocks("play-b", { newAchievements: "clear_10" });
    expect(unlockSummaries("play-a")).toEqual([
      {
        id: "clear_first",
        name: "初クリア",
        icon: achievementIcon("clear_first"),
      },
      {
        id: "no_mistake",
        name: "ノーミス",
        icon: achievementIcon("no_mistake"),
      },
    ]);
    expect(unlockSummaries("play-b")).toEqual([]);
    expect(unlockSummaries(undefined)).toEqual([]);
  });
});

describe("seen unlocks", () => {
  const status = (id: string, unlockedAt: number | null) => ({
    definition: achievementDefinition(id)!,
    unlockedAt,
    progress: null,
  });

  const list = [
    status("clear_first", 900),
    status("no_mistake", 2000),
    status("clear_10", null),
  ];

  it("remembers each tapped achievement per ID", () => {
    expect(seenAchievements("me", list)).toEqual(new Set());
    const seen = markAchievementSeen("me", new Set(), "no_mistake");
    expect(markAchievementSeen("me", seen, "clear_first")).toEqual(
      new Set(["no_mistake", "clear_first"]),
    );
    expect(seenAchievements("me", list)).toEqual(
      new Set(["no_mistake", "clear_first"]),
    );
    expect(seenAchievements("someone-else", list)).toEqual(new Set());
  });

  it("takes over v1: what was unlocked by the time the list was seen", () => {
    data.set("tako-sen.achievements-seen.v1:me", "1000");
    expect(seenAchievements("me", list)).toEqual(new Set(["clear_first"]));
    // 読んだ時点で v2 を書き、v1 は消す。
    expect(data.get("tako-sen.achievements-seen.v2:me")).toBe(
      JSON.stringify(["clear_first"]),
    );
    expect(data.has("tako-sen.achievements-seen.v1:me")).toBe(false);
    // 読めない v1 は、何も押していないものとして引き継ぐ。
    data.set("tako-sen.achievements-seen.v1:other", "later");
    expect(seenAchievements("other", list)).toEqual(new Set());
    expect(data.has("tako-sen.achievements-seen.v1:other")).toBe(false);
  });

  it("keeps what another tab marked", () => {
    const thisTab = seenAchievements("me", list);
    // 別のタブが先に no_mistake を押した。
    markAchievementSeen("me", seenAchievements("me", list), "no_mistake");
    expect(markAchievementSeen("me", thisTab, "clear_first")).toEqual(
      new Set(["clear_first", "no_mistake"]),
    );
    expect(seenAchievements("me", list)).toEqual(
      new Set(["clear_first", "no_mistake"]),
    );
  });

  it("treats an unreadable record as nothing seen", () => {
    data.set("tako-sen.achievements-seen.v2:me", "{broken");
    expect(seenAchievements("me", list)).toEqual(new Set());
    data.set("tako-sen.achievements-seen.v2:me", JSON.stringify({ id: 1 }));
    expect(seenAchievements("me", list)).toEqual(new Set());
    data.set("tako-sen.achievements-seen.v2:me", JSON.stringify(["a", 3]));
    expect(seenAchievements("me", list)).toEqual(new Set(["a"]));
  });
});

describe("tutorial achievement", () => {
  const unlocks = () =>
    request.mock.calls.filter(([path]) => path === "/api/achievements/unlock");

  let stop = () => {};
  afterEach(() => stop());
  const switchTo = async (id: string | null) => {
    account.id!.value = id;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve));
  };

  it("sends for the ID that finished, retrying when the ID is known again", async () => {
    stop = startTutorialAchievementSync();
    await switchTo("me");
    // 終える前は送らない。
    expect(unlocks()).toHaveLength(0);
    // ID がまだないときに終えたら、次に確かめられた ID が引き取る。
    await switchTo(null);
    await completeTutorial();
    expect(unlocks()).toHaveLength(0);
    request.mockRejectedValueOnce(new TypeError("offline"));
    await switchTo("me");
    expect(unlocks()).toHaveLength(1);
    // 送れなかったので、次に ID が確かめられたときに送り直す。
    await switchTo(null);
    await switchTo("me");
    expect(unlocks()).toHaveLength(2);
    expect(JSON.parse(unlocks()[1][1].body)).toEqual({
      id: "tutorial_complete",
    });
    // 送れたら、もう送らない。
    await switchTo(null);
    await switchTo("me");
    expect(unlocks()).toHaveLength(2);
  });

  it("does not send for another ID that uses the device later", async () => {
    stop = startTutorialAchievementSync();
    await switchTo("finisher");
    request.mockResolvedValueOnce(
      Response.json({ error: "service_unavailable" }, { status: 503 }),
    );
    await completeTutorial();
    expect(unlocks()).toHaveLength(1);
    await switchTo("someone-else");
    expect(unlocks()).toHaveLength(1);
    // 終えた ID に戻れば送り直す。
    await switchTo("finisher");
    expect(unlocks()).toHaveLength(2);
  });

  it("gives up on an answer that would never change", async () => {
    stop = startTutorialAchievementSync();
    await switchTo("me");
    request.mockResolvedValueOnce(
      Response.json({ error: "invalid_achievement" }, { status: 400 }),
    );
    await completeTutorial();
    await switchTo(null);
    await switchTo("me");
    expect(unlocks()).toHaveLength(1);
  });

  it("sends right away even when the device cannot store", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    account.id!.value = "me";
    await completeTutorial();
    expect(unlocks()).toHaveLength(1);
  });
});
