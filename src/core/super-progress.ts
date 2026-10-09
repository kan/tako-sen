export const SUPER_REQUIRED_PLAYS = 10;

export interface SuperProgress {
  /** Incremented only by consuming a right. Late events from old cycles cannot
   * become credit towards the next right after offline replay. */
  readonly cycle: number;
  readonly count: number;
  readonly offerPending: boolean;
}

export type SuperEntry = "earned" | "shared";

export function initialSuperProgress(): SuperProgress {
  return { cycle: 0, count: 0, offerPending: false };
}

export function hasSuperRight(progress: SuperProgress): boolean {
  return progress.count === SUPER_REQUIRED_PLAYS;
}

export function remainingSuperPlays(progress: SuperProgress): number {
  return SUPER_REQUIRED_PLAYS - progress.count;
}

/** The server must deduplicate playId and persist the event atomically with
 * this transition. cycle is captured when the normal trial begins, not when
 * the upload arrives. Completed history is never replayed as new events. */
export function recordSuperPlay(
  progress: SuperProgress,
  trialCycle: number,
  alreadyRecorded: boolean,
): SuperProgress {
  if (
    alreadyRecorded ||
    trialCycle !== progress.cycle ||
    hasSuperRight(progress)
  )
    return progress;
  const count = progress.count + 1;
  return { ...progress, count, offerPending: count === SUPER_REQUIRED_PLAYS };
}

export function deferSuperOffer(progress: SuperProgress): SuperProgress {
  return progress.offerPending
    ? { ...progress, offerPending: false }
    : progress;
}

/** Called only after authenticated online start and durable trial storage.
 * Cancellation, generation, READY display and resumption never call this. */
export function consumeSuperRight(
  progress: SuperProgress,
  expectedCycle: number,
  entry: SuperEntry,
): SuperProgress | undefined {
  if (entry === "shared") return progress;
  if (
    expectedCycle !== progress.cycle ||
    !hasSuperRight(progress) ||
    progress.cycle === Number.MAX_SAFE_INTEGER
  )
    return undefined;
  return { cycle: progress.cycle + 1, count: 0, offerPending: false };
}

export function parseSuperProgress(value: unknown): SuperProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(data.cycle) ||
    (data.cycle as number) < 0 ||
    !Number.isInteger(data.count) ||
    (data.count as number) < 0 ||
    (data.count as number) > SUPER_REQUIRED_PLAYS ||
    typeof data.offerPending !== "boolean" ||
    (data.offerPending && data.count !== SUPER_REQUIRED_PLAYS)
  )
    return undefined;
  return {
    cycle: data.cycle as number,
    count: data.count as number,
    offerPending: data.offerPending,
  };
}
