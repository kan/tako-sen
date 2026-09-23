import { describe, expect, it } from "vitest";
import {
  createWaitingTimer,
  elapsedTimerMs,
  finishTimer,
  pauseTimer,
  restoreTimer,
  resumeTimer,
} from "../src/core/play-timer";

describe("play timer", () => {
  it("counts only between OK and pause, then resumes from the saved duration", () => {
    const ready = createWaitingTimer();
    expect(elapsedTimerMs(ready, 100000)).toBe(0);
    const running = resumeTimer(ready, 100000);
    expect(elapsedTimerMs(running, 112345)).toBe(12345);
    const paused = pauseTimer(running, 112345);
    expect(elapsedTimerMs(paused, 900000)).toBe(12345);
    const resumed = resumeTimer(paused, 900000);
    expect(elapsedTimerMs(resumed, 902000)).toBe(14345);
    const finished = finishTimer(resumed, 903000);
    expect(elapsedTimerMs(finished, 999999)).toBe(15345);
    expect(finished.status).toBe("finished");
  });

  it("restores an active save into READY without counting time after its last save", () => {
    const restored = restoreTimer(
      { waitingToStart: false, elapsedMs: 12000, hasStarted: true },
      100000,
      500000,
      false,
    );
    expect(restored.status).toBe("ready");
    expect(elapsedTimerMs(restored, 900000)).toBe(12000);
    expect(elapsedTimerMs(resumeTimer(restored, 900000), 901000)).toBe(13000);
  });

  it("keeps a not-yet-started save at zero and migrates an older save", () => {
    expect(
      restoreTimer(
        { waitingToStart: true, elapsedMs: 0, hasStarted: false },
        1000,
        900000,
        false,
      ),
    ).toMatchObject({ status: "ready", elapsedMs: 0, hasStarted: false });
    expect(
      restoreTimer({ waitingToStart: false }, 1000, 5100, false),
    ).toMatchObject({ status: "ready", elapsedMs: 4100, hasStarted: true });
  });
});
