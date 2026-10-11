import type { HintStage } from "./hint-progress";

/** The ranking of one board as returned together with a stored result. */
export interface SyncedRanking {
  readonly puzzleId: string;
  readonly entries: readonly LeaderboardEntry[];
}

/** Public response deliberately excludes account IDs, play IDs and dates. */
export interface LeaderboardEntry {
  readonly rank: number;
  readonly displayName: string;
  readonly elapsedSeconds: number;
  readonly hintsUsed: number;
  readonly maxHintStage?: HintStage | null;
  readonly mistakes: number;
}
