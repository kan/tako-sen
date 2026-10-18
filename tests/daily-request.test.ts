import { afterEach, describe, expect, it, vi } from "vitest";

describe("the daily notice's request to open the daily", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load(href: string) {
    const replaceState = vi.fn();
    vi.stubGlobal("window", { location: { href } });
    vi.stubGlobal("history", { state: null, replaceState });
    const module = await import("../src/ui/daily-request");
    return { ...module, replaceState };
  }

  it("takes ?daily=1 off the address and asks for the daily", async () => {
    const { dailyRequested, takeDailyRequestFromUrl, replaceState } =
      await load("https://tako.kan-game.app/?daily=1&seed=x#top");
    takeDailyRequestFromUrl();
    expect(dailyRequested.value).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?seed=x#top");
  });

  it("leaves other addresses alone", async () => {
    const { dailyRequested, takeDailyRequestFromUrl, replaceState } =
      await load("https://tako.kan-game.app/?seed=x");
    takeDailyRequestFromUrl();
    expect(dailyRequested.value).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
