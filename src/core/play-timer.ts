export interface PlayTimer {
  readonly status: "ready" | "running" | "finished";
  readonly elapsedMs: number;
  readonly activeSince?: number;
  readonly hasStarted: boolean;
}

export interface SavedPlayTimer {
  readonly waitingToStart: boolean;
  readonly elapsedMs?: number;
  readonly hasStarted?: boolean;
}

export function createWaitingTimer(): PlayTimer {
  return { status: "ready", elapsedMs: 0, hasStarted: false };
}

export function elapsedTimerMs(timer: PlayTimer, now: number): number {
  return (
    timer.elapsedMs +
    (timer.status === "running" && timer.activeSince !== undefined
      ? Math.max(0, now - timer.activeSince)
      : 0)
  );
}

export function resumeTimer(timer: PlayTimer, now: number): PlayTimer {
  if (timer.status !== "ready") return timer;
  return { ...timer, status: "running", activeSince: now, hasStarted: true };
}

export function pauseTimer(timer: PlayTimer, now: number): PlayTimer {
  if (timer.status !== "running") return timer;
  return {
    ...timer,
    status: "ready",
    elapsedMs: elapsedTimerMs(timer, now),
    activeSince: undefined,
  };
}

export function finishTimer(timer: PlayTimer, now: number): PlayTimer {
  return {
    ...timer,
    status: "finished",
    elapsedMs: elapsedTimerMs(timer, now),
    activeSince: undefined,
  };
}

export function restoreTimer(
  saved: SavedPlayTimer,
  startedAt: number,
  now: number,
  completed: boolean,
): PlayTimer {
  const hasStarted = saved.hasStarted ?? !saved.waitingToStart;
  return {
    status: completed ? "finished" : "ready",
    elapsedMs:
      saved.elapsedMs ?? (hasStarted ? Math.max(0, now - startedAt) : 0),
    hasStarted,
  };
}
